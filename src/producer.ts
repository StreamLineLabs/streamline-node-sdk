/**
 * High-level producer with batching and delivery guarantees.
 */

import { Streamline } from './client';
import { CircuitBreaker } from './circuit-breaker';
import { ProduceRecord, ProduceResult, StreamlineError } from './types';

/**
 * Producer configuration.
 */
export interface ProducerConfig {
  /** Maximum batch size before auto-flush (default: 1000) */
  batchSize?: number;
  /** Maximum time to wait before flushing in ms (default: 100) */
  lingerMs?: number;
  /** Compression type: 'none', 'gzip', 'snappy', 'lz4', 'zstd' (default: 'none') */
  compression?: 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';
  /** Number of retries on failure (default: 3) */
  retries?: number;
  /** Retry backoff in ms (default: 100) */
  retryBackoffMs?: number;
  /** Enable idempotent producer (default: true) */
  idempotent?: boolean;
  /** Optional circuit breaker for resilient sending. */
  circuitBreaker?: CircuitBreaker;
}

interface PendingRecord {
  record: ProduceRecord;
  resolve: (result: ProduceResult) => void;
  reject: (error: Error) => void;
}

/**
 * High-level producer with automatic batching.
 *
 * @example
 * ```typescript
 * const producer = new Producer(client, 'events', {
 *   batchSize: 1000,
 *   lingerMs: 10,
 *   compression: 'zstd',
 * });
 *
 * await producer.start();
 *
 * // Send messages (auto-batched)
 * for (const event of events) {
 *   await producer.send({ value: event });
 * }
 *
 * // Flush remaining messages
 * await producer.flush();
 * await producer.close();
 * ```
 */
export class Producer {
  private client: Streamline;
  private topic: string;
  private config: Required<Omit<ProducerConfig, 'circuitBreaker'>>;
  private batch: PendingRecord[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private circuitBreaker: CircuitBreaker | undefined;
  private closed: boolean = false;
  private flushing: boolean = false;
  private inTransaction: boolean = false;
  private transactionBuffer: PendingRecord[] = [];

  /**
   * Create a new producer.
   *
   * @param client - Streamline client
   * @param topic - Topic to produce to
   * @param config - Producer configuration
   */
  constructor(client: Streamline, topic: string, config: ProducerConfig = {}) {
    this.client = client;
    this.topic = topic;
    this.circuitBreaker = config.circuitBreaker;
    this.config = {
      batchSize: config.batchSize ?? 1000,
      lingerMs: config.lingerMs ?? 100,
      compression: config.compression ?? 'none',
      retries: config.retries ?? 3,
      retryBackoffMs: config.retryBackoffMs ?? 100,
      idempotent: config.idempotent ?? true,
    };
  }

  /**
   * Set a circuit breaker on this producer.
   *
   * @param cb - Circuit breaker instance
   * @returns this producer for chaining
   */
  withCircuitBreaker(cb: CircuitBreaker): this {
    this.circuitBreaker = cb;
    return this;
  }

  /**
   * Start the producer.
   */
  async start(): Promise<void> {
    this.closed = false;
  }

  /**
   * Send a message to the topic.
   *
   * @param record - Record to send
   * @returns Promise resolving to produce result
   */
  async send(record: ProduceRecord): Promise<ProduceResult> {
    if (this.closed) {
      throw new StreamlineError('Producer is closed', 'PRODUCER_CLOSED');
    }

    // Buffer messages during a transaction
    if (this.inTransaction) {
      return new Promise((resolve, reject) => {
        this.transactionBuffer.push({ record, resolve, reject });
      });
    }

    return new Promise((resolve, reject) => {
      this.batch.push({ record, resolve, reject });

      // Check if batch is full
      if (this.batch.length >= this.config.batchSize) {
        this.flushNow();
      } else if (!this.flushTimer) {
        // Start linger timer
        this.flushTimer = setTimeout(() => {
          this.flushNow();
        }, this.config.lingerMs);
      }
    });
  }

  /**
   * Send multiple messages.
   *
   * @param records - Records to send
   * @returns Promise resolving to array of produce results
   */
  async sendBatch(records: ProduceRecord[]): Promise<ProduceResult[]> {
    return Promise.all(records.map(r => this.send(r)));
  }

  /**
   * Flush all pending messages.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    if (this.batch.length > 0) {
      await this.flushBatch();
    }
  }

  /**
   * Close the producer, flushing remaining messages.
   */
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  /**
   * Begin a new transaction. Messages sent after this call are buffered
   * until commitTransaction() or abortTransaction() is called.
   */
  async beginTransaction(): Promise<void> {
    if (this.closed) {
      throw new StreamlineError('Producer is closed', 'PRODUCER_CLOSED');
    }
    if (this.inTransaction) {
      throw new StreamlineError('Transaction already in progress', 'TRANSACTION_IN_PROGRESS');
    }
    this.inTransaction = true;
    this.transactionBuffer = [];
  }

  /**
   * Commit the current transaction, sending all buffered messages atomically.
   *
   * @returns Array of produce results for all messages in the transaction
   */
  async commitTransaction(): Promise<ProduceResult[]> {
    if (!this.inTransaction) {
      throw new StreamlineError('No transaction in progress', 'NO_TRANSACTION');
    }

    try {
      const records = this.transactionBuffer.map(p => p.record);
      const results = records.length > 0
        ? await this.sendWithRetry(records)
        : [];

      // Resolve all buffered promises
      for (let i = 0; i < this.transactionBuffer.length; i++) {
        this.transactionBuffer[i].resolve(results[i]);
      }

      return results;
    } catch (error) {
      // Reject all buffered promises
      const err = error instanceof Error ? error : new Error(String(error));
      for (const p of this.transactionBuffer) {
        p.reject(err);
      }
      throw error;
    } finally {
      this.inTransaction = false;
      this.transactionBuffer = [];
    }
  }

  /**
   * Abort the current transaction, discarding all buffered messages.
   */
  async abortTransaction(): Promise<void> {
    if (!this.inTransaction) {
      throw new StreamlineError('No transaction in progress', 'NO_TRANSACTION');
    }

    // Reject all buffered promises
    const err = new StreamlineError('Transaction aborted', 'TRANSACTION_ABORTED');
    for (const p of this.transactionBuffer) {
      p.reject(err);
    }

    this.inTransaction = false;
    this.transactionBuffer = [];
  }

  private flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }

    if (!this.flushing && this.batch.length > 0) {
      this.flushBatch().catch(() => {
        // Errors handled in flushBatch
      });
    }
  }

  private async flushBatch(): Promise<void> {
    if (this.flushing || this.batch.length === 0) {
      return;
    }

    this.flushing = true;
    const pending = this.batch;
    this.batch = [];

    try {
      const results = await this.sendWithRetry(pending.map(p => p.record));

      // Resolve all promises
      for (let i = 0; i < pending.length; i++) {
        pending[i].resolve(results[i]);
      }
    } catch (error) {
      // Reject all promises
      const err = error instanceof Error ? error : new Error(String(error));
      for (const p of pending) {
        p.reject(err);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async sendWithRetry(records: ProduceRecord[]): Promise<ProduceResult[]> {
    if (this.circuitBreaker && !this.circuitBreaker.allow()) {
      throw new StreamlineError(
        'Circuit breaker is open — too many recent failures',
        'CIRCUIT_OPEN',
        true,
      );
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const results = await this.client.produceBatch(this.topic, records, { compression: this.config.compression });
        this.circuitBreaker?.recordSuccess();
        return results;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof StreamlineError && !error.retryable) {
          throw error;
        }

        this.circuitBreaker?.recordFailure();

        if (attempt < this.config.retries) {
          await this.sleep(this.config.retryBackoffMs * (attempt + 1));
        }
      }
    }

    throw lastError ?? new StreamlineError('Send failed', 'SEND_ERROR');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
