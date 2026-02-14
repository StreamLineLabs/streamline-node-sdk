/**
 * High-level consumer with automatic offset management.
 */

import { Streamline, ConsumeOptions } from './client';
import { Message, StreamlineError } from './types';

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
  private groupId?: string;
  private config: Required<ConsumerConfig>;
  private currentOffsets: Map<string, number> = new Map();
  private committedOffsets: Map<string, number> = new Map();
  private paused: boolean = false;
  private closed: boolean = false;
  private commitTimer?: ReturnType<typeof setInterval>;
  private assignedPartitions: Set<number> = new Set();
  private rebalanceHandler?: (event: RebalanceEvent) => Promise<void>;

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

      // Track offset
      const key = `${msg.topic}:${msg.partition}`;
      this.currentOffsets.set(key, msg.offset);

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

    // TODO: Implement actual offset commit via API
    // For now, track locally
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
    // TODO: Get high watermarks from API
    const _parts = partitions ?? Array.from(this.assignedPartitions);
    // Would need to query for latest offsets
  }

  /**
   * Pause consumption.
   *
   * @param partitions - Partitions to pause (default: all)
   */
  pause(partitions?: number[]): void {
    this.paused = true;
  }

  /**
   * Resume consumption.
   *
   * @param partitions - Partitions to resume (default: all)
   */
  resume(partitions?: number[]): void {
    this.paused = false;
  }

  /**
   * Register a rebalance handler.
   *
   * @param handler - Async function called on rebalance events
   */
  onRebalance(handler: (event: RebalanceEvent) => Promise<void>): void {
    this.rebalanceHandler = handler;
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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
