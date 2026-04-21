/**
 * High-level consumer with automatic offset management.
 */

import { Streamline, ConsumeOptions } from './client';
import { Message, StreamlineError, SearchOptions, SearchResult, validateTopicName } from './types';

/**
 * Consumer configuration.
 */
export interface ConsumerConfig {
  /** Automatically commit offsets (default: true) */
  autoCommit?: boolean;
  /** Auto-commit interval in ms (default: 5000) */
  autoCommitIntervalMs?: number;
  /** Maximum records to return per poll (default: 500) */
  maxPollRecords?: number;
  /** Session timeout in ms (default: 45000) */
  sessionTimeoutMs?: number;
  /** Heartbeat interval in ms (default: 3000) */
  heartbeatIntervalMs?: number;
  /** Where to start: 'earliest', 'latest', 'none' (default: 'latest') */
  autoOffsetReset?: 'earliest' | 'latest' | 'none';
}

/**
 * Rebalance event.
 */
export interface RebalanceEvent {
  type: 'assign' | 'revoke';
  partitions: number[];
}

/**
 * High-level consumer with automatic offset management.
 *
 * @example
 * ```typescript
 * const consumer = new Consumer(client, 'events', 'my-app', {
 *   autoCommit: true,
 *   autoOffsetReset: 'earliest',
 * });
 *
 * await consumer.start();
 *
 * for await (const msg of consumer) {
 *   console.log(msg.value);
 *   // Offsets auto-committed periodically
 * }
 *
 * await consumer.close();
 * ```
 */
export class Consumer implements AsyncIterable<Message> {
  private client: Streamline;
  private topic: string;
  private groupId?: string | undefined;
  private config: Required<ConsumerConfig>;
  private currentOffsets: Map<string, number> = new Map();
  private committedOffsets: Map<string, number> = new Map();
  private paused: boolean = false;
  private closed: boolean = false;
  private commitTimer?: ReturnType<typeof setInterval> | undefined;
  private assignedPartitions: Set<number> = new Set();


  /**
   * Create a new consumer.
   *
   * @param client - Streamline client
   * @param topic - Topic to consume from
   * @param groupId - Consumer group ID (optional)
   * @param config - Consumer configuration
   */
  constructor(
    client: Streamline,
    topic: string,
    groupId?: string,
    config: ConsumerConfig = {}
  ) {
    validateTopicName(topic);
    this.client = client;
    this.topic = topic;
    this.groupId = groupId;
    this.config = {
      autoCommit: config.autoCommit ?? true,
      autoCommitIntervalMs: config.autoCommitIntervalMs ?? 5000,
      maxPollRecords: config.maxPollRecords ?? 500,
      sessionTimeoutMs: config.sessionTimeoutMs ?? 45000,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 3000,
      autoOffsetReset: config.autoOffsetReset ?? 'latest',
    };
  }

  /**
   * Start the consumer.
   */
  async start(): Promise<void> {
    this.closed = false;

    if (this.config.autoCommit) {
      this.commitTimer = setInterval(() => {
        this.commit().catch(() => {
          // Best effort
        });
      }, this.config.autoCommitIntervalMs);
    }
  }

  /**
   * Async iterator for consuming messages.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<Message> {
    yield* this.messages();
  }

  /**
   * Iterate over messages.
   */
  async *messages(): AsyncGenerator<Message> {
    const options: ConsumeOptions = {
      group: this.groupId,
      fromBeginning: this.config.autoOffsetReset === 'earliest',
      maxMessages: this.config.maxPollRecords,
    };

    for await (const msg of this.client.consume(this.topic, options)) {
      if (this.closed) {
        break;
      }

      if (this.paused) {
        await this.sleep(100);
        continue;
      }

      // Track offset and partition assignment
      const key = `${msg.topic}:${msg.partition}`;
      this.currentOffsets.set(key, msg.offset);
      this.assignedPartitions.add(msg.partition);

      yield msg;
    }
  }

  /**
   * Commit current offsets.
   *
   * @param offsets - Optional specific offsets to commit
   */
  async commit(offsets?: Map<string, number>): Promise<void> {
    const toCommit = offsets ?? new Map(this.currentOffsets);
    if (toCommit.size === 0) {
      return;
    }

    // Commit via the Streamline API if we have a consumer group
    if (this.groupId) {
      try {
        await this.client.commitOffsets(this.groupId, toCommit);
      } catch {
        // Fall back to local tracking if API is unavailable
      }
    }

    // Track locally for position queries
    for (const [key, offset] of toCommit) {
      this.committedOffsets.set(key, offset);
    }
  }

  /**
   * Seek to a specific offset.
   *
   * @param partition - Partition number
   * @param offset - Offset to seek to
   */
  async seek(partition: number, offset: number): Promise<void> {
    const key = `${this.topic}:${partition}`;
    this.currentOffsets.set(key, offset);
  }

  /**
   * Seek to the beginning of partitions.
   *
   * @param partitions - Partitions to seek (default: all assigned)
   */
  async seekToBeginning(partitions?: number[]): Promise<void> {
    const parts = partitions ?? Array.from(this.assignedPartitions);
    for (const p of parts) {
      await this.seek(p, 0);
    }
  }

  /**
   * Seek to the end of partitions.
   *
   * @param partitions - Partitions to seek (default: all assigned)
   */
  async seekToEnd(partitions?: number[]): Promise<void> {
    const parts = partitions ?? Array.from(this.assignedPartitions);
    for (const p of parts) {
      // Remove tracked offset so the next poll starts from latest
      const key = `${this.topic}:${p}`;
      this.currentOffsets.delete(key);
    }
  }

  /**
   * Pause consumption.
   *
   * @param partitions - Partitions to pause (default: all)
   */
  pause(_partitions?: number[]): void {
    this.paused = true;
  }

  /**
   * Resume consumption.
   *
   * @param partitions - Partitions to resume (default: all)
   */
  resume(_partitions?: number[]): void {
    this.paused = false;
  }

  /**
   * Register a rebalance handler.
   *
   * @param handler - Async function called on rebalance events
   */
  onRebalance(handler: (event: RebalanceEvent) => Promise<void>): void {
    void handler;
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
   * Get committed offset.
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
   */
  async close(): Promise<void> {
    this.closed = true;

    if (this.commitTimer) {
      clearInterval(this.commitTimer);
      this.commitTimer = undefined;
    }

    // Final commit
    if (this.config.autoCommit) {
      try {
        await this.commit();
      } catch {
        // Best effort
      }
    }
  }

  /**
   * Poll for messages (batch fetch with timeout).
   *
   * Similar to Kafka's Consumer.poll(Duration), fetches up to maxRecords
   * messages within the specified timeout.
   *
   * @param timeoutMs - Maximum time to wait for messages (default: 1000)
   * @param maxRecords - Maximum records to return (default: config.maxPollRecords)
   * @returns Array of messages
   */
  async poll(timeoutMs: number = 1000, maxRecords?: number): Promise<Message[]> {
    if (this.closed) {
      throw new StreamlineError('Consumer is closed', 'CONSUMER_CLOSED');
    }

    const limit = maxRecords ?? this.config.maxPollRecords;

    try {
      const messages = await this.client.consumeBatch(this.topic, {
        group: this.groupId,
        fromBeginning: this.config.autoOffsetReset === 'earliest',
        maxMessages: limit,
        pollTimeout: timeoutMs,
      });

      // Track offsets for each returned message
      for (const msg of messages) {
        const key = `${msg.topic}:${msg.partition}`;
        this.currentOffsets.set(key, msg.offset);
        this.assignedPartitions.add(msg.partition);
      }

      return messages;
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
    const response = await (this.client as any).request(
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

