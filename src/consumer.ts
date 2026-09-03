/**
 * High-level consumer with automatic offset management.
 */

import { Streamline, ConsumeOptions } from './client';
import {
  Message,
  StreamlineError,
  TopicNotFoundError,
  UnsupportedOperationError,
  SearchOptions,
  SearchResult,
  validateTopicName,
} from './types';
import { fromSync } from './internal/async';

/**
 * Consumer configuration.
 *
 * Options that the Streamline HTTP/GraphQL transport cannot honour are
 * rejected at construction time rather than silently ignored.
 */
export interface ConsumerConfig {
  /**
   * Automatically commit offsets.
   *
   * @deprecated Not supported by the Streamline 0.3 HTTP API. The default is
   * `false`; setting this to `true` throws {@link UnsupportedOperationError}.
   */
  autoCommit?: boolean;
  /**
   * Auto-commit interval in ms.
   *
   * @deprecated Not supported because HTTP offset commits are unavailable.
   * Supplying this option throws {@link UnsupportedOperationError}.
   */
  autoCommitIntervalMs?: number;
  /** Maximum records to return per poll (default: 500) */
  maxPollRecords?: number;
  /**
   * Session timeout in ms.
   *
   * @deprecated Not supported: this client does not join the Kafka group
   * membership protocol, so no session timeout is negotiated. Setting it
   * throws {@link UnsupportedOperationError}.
   */
  sessionTimeoutMs?: number;
  /**
   * Heartbeat interval in ms.
   *
   * @deprecated Not supported: this client does not send group heartbeats.
   * Setting it throws {@link UnsupportedOperationError}.
   */
  heartbeatIntervalMs?: number;
  /**
   * Where to start when no offset is committed: `'earliest'` or `'latest'`
   * (default: `'latest'`). `'none'` is rejected — the transport cannot report
   * "no committed offset" as a distinct condition.
   */
  autoOffsetReset?: 'earliest' | 'latest' | 'none';
  /**
   * Partition to consume.
   *
   * This client polls the Streamline HTTP/GraphQL messages query, which
   * fetches exactly one partition per request — it never joins Kafka's
   * group-membership/rebalance protocol, so it cannot correctly discover and
   * balance an arbitrary number of partitions across consumers the way a
   * real consumer group does.
   *
   * When omitted, the consumer looks up the topic's partition count on the
   * first `poll()`/iteration: a single-partition topic defaults to partition
   * `0` (unchanged behaviour); a topic with more than one partition throws
   * {@link UnsupportedOperationError} instead of silently reading only
   * partition `0` and dropping records on every other partition.
   */
  partition?: number;
}

/**
 * Rebalance event.
 */
export interface RebalanceEvent {
  type: 'assign' | 'revoke';
  partitions: number[];
}

/** Resolved consumer configuration with all defaults applied. */
type ResolvedConsumerConfig = {
  maxPollRecords: number;
  autoOffsetReset: 'earliest' | 'latest';
};

/**
 * High-level consumer with automatic offset management.
 *
 * ## Supported semantics
 *
 * The consumer reads through the Streamline HTTP/GraphQL API. Operations that
 * depend on the Kafka group-membership protocol — rebalance callbacks,
 * partition-scoped seeks, session timeouts — are **not** emulated: they throw
 * {@link UnsupportedOperationError} instead of pretending to succeed.
 *
 * @example
 * ```typescript
 * const consumer = new Consumer(client, 'events', undefined, {
 *   autoCommit: false,
 *   autoOffsetReset: 'earliest',
 * });
 *
 * await consumer.start();
 *
 * for await (const msg of consumer) {
 *   console.log(msg.value);
 * }
 *
 * await consumer.close();
 * ```
 */
export class Consumer implements AsyncIterable<Message> {
  private client: Streamline;
  private topic: string;
  private groupId?: string | undefined;
  private config: ResolvedConsumerConfig;
  private currentOffsets: Map<string, number> = new Map();
  private committedOffsets: Map<string, number> = new Map();
  /** Next offset to request per partition, advanced for every fetched record. */
  private nextFetchOffsets: Map<number, number> = new Map();
  private pausedAll: boolean = false;
  private pausedPartitions: Set<number> = new Set();
  /** Records fetched by {@link Consumer.poll} for partitions that were paused. */
  private heldRecords: Message[] = [];
  private closed: boolean = false;
  /** Serializes commits so an older request cannot overwrite a newer offset. */
  private commitTail: Promise<void> = Promise.resolve();
  private assignedPartitions: Set<number> = new Set();
  /** How often the message iterator re-checks the paused state. */
  private static readonly PAUSE_POLL_INTERVAL_MS = 50;
  /** Explicit partition selection from {@link ConsumerConfig.partition}, if given. */
  private readonly explicitPartition: number | undefined;
  /** Cached result of partition resolution/discovery; set at most once. */
  private resolvedPartition: number | undefined;
  /** In-flight partition discovery request, memoized so it only runs once. */
  private partitionDiscovery: Promise<number> | undefined;


  /**
   * Create a new consumer.
   *
   * @param client - Streamline client
   * @param topic - Topic to consume from
   * @param groupId - Consumer group ID (optional). Required for any offset
   *   commit or seek operation.
   * @param config - Consumer configuration
   * @throws {UnsupportedOperationError} When a configuration option cannot be
   *   honoured by this transport.
   */
  constructor(
    client: Streamline,
    topic: string,
    groupId?: string,
    config: ConsumerConfig = {}
  ) {
    validateTopicName(topic);

    if (config.sessionTimeoutMs !== undefined) {
      throw new UnsupportedOperationError(
        'ConsumerConfig.sessionTimeoutMs',
        'this client does not join the Kafka group-membership protocol, so no session timeout is negotiated',
        'Remove sessionTimeoutMs; use the Kafka protocol when group session management is required',
      );
    }
    if (config.heartbeatIntervalMs !== undefined) {
      throw new UnsupportedOperationError(
        'ConsumerConfig.heartbeatIntervalMs',
        'this client does not send group heartbeats',
        'Remove heartbeatIntervalMs; group liveness is managed by the broker',
      );
    }
    if (config.autoOffsetReset === 'none') {
      throw new UnsupportedOperationError(
        "ConsumerConfig.autoOffsetReset: 'none'",
        'the broker API does not report "no committed offset" as a distinct condition',
        "Use 'earliest' or 'latest'",
      );
    }
    if (config.autoCommit === true) {
      throw new UnsupportedOperationError(
        'ConsumerConfig.autoCommit',
        'the Streamline 0.3 HTTP API exposes no consumer offset-commit operation',
        'Use autoCommit: false and manage offsets in the application, or use the Kafka protocol',
      );
    }
    if (config.autoCommitIntervalMs !== undefined) {
      throw new UnsupportedOperationError(
        'ConsumerConfig.autoCommitIntervalMs',
        'automatic HTTP offset commits are unavailable',
        'Remove autoCommitIntervalMs; use the Kafka protocol for automatic group commits',
      );
    }
    if (config.partition !== undefined && (!Number.isInteger(config.partition) || config.partition < 0)) {
      throw new StreamlineError(
        `Invalid partition: ${config.partition}`,
        'INVALID_PARTITION',
      );
    }

    this.client = client;
    this.topic = topic;
    this.groupId = groupId;
    this.explicitPartition = config.partition;
    this.config = {
      maxPollRecords: config.maxPollRecords ?? 500,
      autoOffsetReset: config.autoOffsetReset ?? 'latest',
    };
  }

  /**
   * Resolve which single partition this consumer polls.
   *
   * Returns {@link ConsumerConfig.partition} immediately when it was
   * explicitly configured. Otherwise looks up the topic's partition count
   * exactly once (memoized): a single-partition topic resolves to partition
   * `0`; a topic with more than one partition throws
   * {@link UnsupportedOperationError} rather than silently reading only
   * partition `0` forever. Failure to resolve topic metadata throws
   * {@link TopicNotFoundError}; it never guesses partition `0`.
   */
  private async resolvePartition(): Promise<number> {
    if (this.resolvedPartition !== undefined) {
      return this.resolvedPartition;
    }
    if (this.explicitPartition !== undefined) {
      this.resolvedPartition = this.explicitPartition;
      return this.resolvedPartition;
    }
    if (this.partitionDiscovery === undefined) {
      this.partitionDiscovery = this.discoverPartition();
    }
    const partition = await this.partitionDiscovery;
    this.resolvedPartition = partition;
    return partition;
  }

  private async discoverPartition(): Promise<number> {
    const info = await this.client.topicInfo(this.topic);
    if (info === undefined) {
      throw new TopicNotFoundError(this.topic);
    }
    const partitionCount = info.partitions ?? info.partitionCount;
    if (partitionCount > 1) {
      throw new UnsupportedOperationError(
        'Consumer partition selection',
        `topic "${this.topic}" has ${partitionCount} partitions; this HTTP transport polls a ` +
          'single partition per consumer and does not join the Kafka group-membership protocol, ' +
          'so it cannot discover and balance all partitions automatically',
        'Construct the consumer with an explicit `partition` in ConsumerConfig to select one ' +
          '(e.g. run one consumer per partition), or use the Kafka protocol for group-managed ' +
          'multi-partition consumption',
      );
    }
    return 0;
  }

  /**
   * Start the consumer.
   *
   * This only marks the local consumer open. Group membership and automatic
   * commits are not available through the Streamline 0.3 HTTP API.
   */
  start(): Promise<void> {
    return fromSync(() => {
      this.closed = false;
    });
  }

  /**
   * Async iterator for consuming messages.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<Message> {
    yield* this.messages();
  }

  /**
   * Iterate over messages.
   *
   * A record fetched for a paused partition is held — not discarded — until
   * the partition is resumed or the consumer is closed. Pausing one partition
   * does not block records already available for other partitions.
   */
  async *messages(): AsyncGenerator<Message> {
    this.rejectUnsupportedGroupConsumption('Consumer.messages');

    const partition = await this.resolvePartition();
    const options: ConsumeOptions = {
      partition,
      fromBeginning: this.config.autoOffsetReset === 'earliest',
      maxMessages: this.config.maxPollRecords,
    };

    const source = this.client.consume(this.topic, options)[Symbol.asyncIterator]();
    let sourceDone = false;

    try {
      while (!this.closed) {
        const resumedIndex = this.heldRecords.findIndex(
          (record) => !this.isPaused(record.partition),
        );
        if (resumedIndex >= 0) {
          const [resumed] = this.heldRecords.splice(resumedIndex, 1);
          this.trackDelivered([resumed]);
          yield resumed;
          continue;
        }

        if (this.isPaused(partition) || sourceDone) {
          if (sourceDone && this.heldRecords.length === 0) {
            return;
          }
          await this.sleep(Consumer.PAUSE_POLL_INTERVAL_MS);
          continue;
        }

        const next = await source.next();
        if (next.done) {
          sourceDone = true;
          continue;
        }

        this.trackFetched(next.value);
        if (this.isPaused(next.value.partition)) {
          this.heldRecords.push(next.value);
          continue;
        }

        this.trackDelivered([next.value]);
        yield next.value;
      }
    } finally {
      await source.return?.(undefined);
    }
  }

  /**
   * Commit current offsets.
   *
   * Errors are propagated: a rejected promise means the offsets were **not**
   * committed. Locally tracked committed offsets are only updated after the
   * broker accepts the commit.
   *
   * @param offsets - Optional specific offsets to commit, keyed `"topic:partition"`
   * @throws {UnsupportedOperationError} When the consumer has no group ID.
   * @throws {StreamlineError} When the broker rejects the commit.
   */
  async commit(offsets?: Map<string, number>): Promise<void> {
    const toCommit = offsets ?? new Map(this.currentOffsets);
    if (toCommit.size === 0) {
      return;
    }

    if (this.groupId === undefined) {
      throw new UnsupportedOperationError(
        'Consumer.commit',
        'offsets are stored per consumer group and this consumer has none',
        'Construct the consumer with a groupId, or track offsets in your application',
      );
    }

    const operation = this.commitTail.then(async () => {
      await this.client.commitOffsets(this.groupId as string, toCommit);

      // Only record locally once the broker has accepted the commit.
      for (const [key, offset] of toCommit) {
        this.committedOffsets.set(key, offset);
      }
    });

    // Keep the queue usable after a failure while returning the real operation
    // promise so the caller still observes the error.
    this.commitTail = operation.catch(() => {});
    return operation;
  }

  /**
   * Seek a single partition to an offset.
   *
   * @param partition - Partition number
   * @param offset - Offset to seek to
   * @throws {UnsupportedOperationError} Always: the Streamline 0.3 HTTP API
   *   exposes no consumer offset-reset operation.
   */
  seek(partition: number, offset: number): Promise<void> {
    return Promise.reject(
      new UnsupportedOperationError(
        'Consumer.seek',
        `the Streamline 0.3 HTTP API cannot reset partition ${partition} to offset ${offset}`,
        'Track fromOffset in the application or use the Kafka protocol for seek support',
      ),
    );
  }

  /**
   * Seek to the beginning.
   *
   * @throws {UnsupportedOperationError} Always: the Streamline 0.3 HTTP API
   *   exposes no consumer offset-reset operation.
   */
  seekToBeginning(partitions?: number[]): Promise<void> {
    void partitions;
    return Promise.reject(
      new UnsupportedOperationError(
        'Consumer.seekToBeginning',
        'the Streamline 0.3 HTTP API exposes no consumer offset-reset operation',
        'Create a new stateless consume call with fromBeginning: true, or use the Kafka protocol',
      ),
    );
  }

  /**
   * Seek to the end.
   *
   * @throws {UnsupportedOperationError} Always: the Streamline 0.3 HTTP API
   *   exposes no consumer offset-reset operation.
   */
  seekToEnd(partitions?: number[]): Promise<void> {
    void partitions;
    return Promise.reject(
      new UnsupportedOperationError(
        'Consumer.seekToEnd',
        'the Streamline 0.3 HTTP API exposes no consumer offset-reset operation',
        'Use stateless consumption without fromBeginning, or use the Kafka protocol',
      ),
    );
  }

  /**
   * Pause consumption.
   *
   * Records already fetched for a paused partition are retained and delivered
   * once the partition is resumed; nothing is discarded.
   *
   * @param partitions - Partitions to pause (default: all)
   */
  pause(partitions?: number[]): void {
    if (partitions === undefined) {
      this.pausedAll = true;
      return;
    }
    for (const partition of partitions) {
      this.pausedPartitions.add(partition);
    }
  }

  /**
   * Resume consumption.
   *
   * @param partitions - Partitions to resume (default: all)
   */
  resume(partitions?: number[]): void {
    if (partitions === undefined) {
      this.pausedAll = false;
      this.pausedPartitions.clear();
      return;
    }
    for (const partition of partitions) {
      this.pausedPartitions.delete(partition);
    }
  }

  /**
   * Whether consumption is paused.
   *
   * @param partition - Partition to check; omit to test the global pause flag
   */
  isPaused(partition?: number): boolean {
    if (this.pausedAll) {
      return true;
    }
    return partition !== undefined && this.pausedPartitions.has(partition);
  }

  /**
   * Register a rebalance handler.
   *
   * @param handler - Async function called on rebalance events
   * @throws {UnsupportedOperationError} Always: this client does not join the
   *   Kafka group-membership protocol, so no rebalance event can ever fire and
   *   accepting the handler would be a silent no-op.
   */
  onRebalance(handler: (event: RebalanceEvent) => Promise<void>): void {
    void handler;
    throw new UnsupportedOperationError(
      'Consumer.onRebalance',
      'this client consumes over HTTP and never participates in a group rebalance, so the handler could never be invoked',
      'Track assignment() around start/close in your application instead',
    );
  }

  /**
   * Get assigned partitions.
   */
  assignment(): number[] {
    return Array.from(this.assignedPartitions);
  }

  /**
   * Get current position (next offset to consume).
   *
   * @param partition - Partition number
   * @returns Current offset or undefined
   */
  position(partition: number): number | undefined {
    const key = `${this.topic}:${partition}`;
    const offset = this.currentOffsets.get(key);
    return offset !== undefined ? offset + 1 : undefined;
  }

  /**
   * Get the last offset this consumer successfully committed.
   *
   * @param partition - Partition number
   * @returns Committed offset or undefined
   */
  committed(partition: number): number | undefined {
    const key = `${this.topic}:${partition}`;
    return this.committedOffsets.get(key);
  }

  /**
   * Close the consumer.
   *
   * No hidden final commit is attempted because automatic HTTP commits are
   * unsupported. Call {@link Consumer.commit} explicitly and handle its error.
   */
  async close(): Promise<void> {
    this.closed = true;
    await this.commitTail;
  }

  /**
   * Poll for messages (batch fetch with timeout).
   *
   * Similar to Kafka's `Consumer.poll(Duration)`. Records fetched for paused
   * partitions are held internally and returned by a later poll once the
   * partition is resumed — they are never dropped.
   *
   * @param timeoutMs - Maximum time to wait for messages (default: 1000)
   * @param maxRecords - Maximum records to return (default: config.maxPollRecords)
   * @returns Array of messages
   */
  async poll(timeoutMs: number = 1000, maxRecords?: number): Promise<Message[]> {
    if (this.closed) {
      throw new StreamlineError('Consumer is closed', 'CONSUMER_CLOSED');
    }
    this.rejectUnsupportedGroupConsumption('Consumer.poll');

    const limit = maxRecords ?? this.config.maxPollRecords;
    const delivered: Message[] = [];

    // 1. Re-deliver anything held for partitions that have since resumed.
    const stillHeld: Message[] = [];
    for (const held of this.heldRecords) {
      if (delivered.length < limit && !this.isPaused(held.partition)) {
        delivered.push(held);
      } else {
        stillHeld.push(held);
      }
    }
    this.heldRecords = stillHeld;

    // 2. Do not fetch while fully paused, and never fetch beyond the limit.
    if (this.pausedAll || delivered.length >= limit) {
      this.trackDelivered(delivered);
      return delivered;
    }

    const partition = await this.resolvePartition();
    if (this.isPaused(partition)) {
      this.trackDelivered(delivered);
      return delivered;
    }

    try {
      const startedAt = Date.now();
      let nextFetchOffset = this.nextFetchOffsets.get(partition);
      if (nextFetchOffset === undefined) {
        nextFetchOffset = this.config.autoOffsetReset === 'earliest'
          ? 0
          : await this.client.latestOffset(this.topic, partition, timeoutMs);
        this.nextFetchOffsets.set(partition, nextFetchOffset);
      }
      const remainingTimeout = Math.max(1, timeoutMs - (Date.now() - startedAt));

      const messages = await this.client.consumeBatch(this.topic, {
        partition,
        fromOffset: nextFetchOffset,
        maxMessages: limit - delivered.length,
        pollTimeout: remainingTimeout,
      });

      for (const msg of messages) {
        const nextOffset = this.nextFetchOffsets.get(msg.partition);
        if (nextOffset !== undefined && msg.offset < nextOffset) {
          continue;
        }
        this.trackFetched(msg);
        if (this.isPaused(msg.partition)) {
          this.heldRecords.push(msg);
        } else {
          delivered.push(msg);
        }
      }

      this.trackDelivered(delivered);
      return delivered;
    } catch (error) {
      if (error instanceof StreamlineError) {
        throw error;
      }
      throw new StreamlineError(
        'Poll failed',
        'POLL_ERROR',
        true,
        error instanceof Error ? error : undefined,
      );
    }
  }

  /**
   * Search a topic using semantic search via the HTTP API.
   *
   * @param topic - Topic to search
   * @param query - Free-text search query
   * @param options - Optional search configuration (k for max results)
   * @returns Array of search results ordered by descending score
   */
  async search(
    topic: string,
    query: string,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    const k = options?.k ?? 10;
    const response = await this.client.request(
      `/api/v1/topics/${encodeURIComponent(topic)}/search`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, k }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new StreamlineError(
        `Search failed: ${error}`,
        'SEARCH_ERROR',
        true,
      );
    }

    const data = (await response.json()) as {
      hits?: SearchResult[];
      took_ms?: number;
    };
    return data.hits ?? [];
  }

  /** Record offsets/assignment for messages handed to the caller. */
  private trackDelivered(messages: Message[]): void {
    for (const msg of messages) {
      const key = `${msg.topic}:${msg.partition}`;
      this.currentOffsets.set(key, msg.offset);
      this.assignedPartitions.add(msg.partition);
    }
  }

  private trackFetched(message: Message): void {
    const nextOffset = message.offset + 1;
    const current = this.nextFetchOffsets.get(message.partition);
    if (current === undefined || nextOffset > current) {
      this.nextFetchOffsets.set(message.partition, nextOffset);
    }
  }

  private rejectUnsupportedGroupConsumption(operation: string): void {
    if (this.groupId === undefined) {
      return;
    }

    throw new UnsupportedOperationError(
      operation,
      'the Streamline 0.3 HTTP/GraphQL messages API cannot join or consume as a consumer group',
      'Omit groupId for stateless HTTP consumption, or use the Kafka protocol for consumer groups',
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
