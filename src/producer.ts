/**
 * High-level producer with batching and delivery guarantees.
 */

import { Streamline } from './client';
import { CircuitBreaker } from './circuit-breaker';
import {
  ProduceRecord,
  ProduceResult,
  StreamlineError,
  UnsupportedOperationError,
  validateTopicName,
  calculateExponentialBackoff,
} from './types';
import { fromSync } from './internal/async';

/**
 * Producer configuration.
 */
export interface ProducerConfig {
  /** Maximum number of records to buffer before auto-flush (default: 1000) */
  batchSize?: number;
  /** Maximum time to wait before flushing in ms (default: 100) */
  lingerMs?: number;
  /**
   * Compression type (default: `'none'`).
   *
   * @deprecated Streamline 0.3's HTTP API exposes no compressed batch
   * operation. Any value other than `'none'` throws
   * {@link UnsupportedOperationError}.
   */
  compression?: 'none' | 'gzip' | 'snappy' | 'lz4' | 'zstd';
  /**
   * Number of retries on failure (default: 3).
   *
   * Retries are at-least-once: a retried batch can be written twice if the
   * first attempt succeeded but its response was lost.
   */
  retries?: number;
  /** Retry backoff in ms (default: 100) */
  retryBackoffMs?: number;
  /** Maximum retry backoff in ms (default: 30000) */
  maxRetryBackoffMs?: number;
  /**
   * Enable the idempotent producer (default: `false`).
   *
   * @deprecated Not supported. The Streamline HTTP produce API assigns no
   * producer id or sequence number, so duplicate suppression cannot be
   * performed. Setting this to `true` throws
   * {@link UnsupportedOperationError} rather than implying exactly-once
   * delivery that the client cannot provide.
   */
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
 *   compression: 'none',
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
  private config: Required<Omit<ProducerConfig, 'circuitBreaker' | 'maxRetryBackoffMs'>> & { maxRetryBackoffMs: number };
  private batch: PendingRecord[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private circuitBreaker: CircuitBreaker | undefined;
  private closed: boolean = false;
  /** Serializes background and explicit flush requests. */
  private flushTail: Promise<void> = Promise.resolve();
  /** Background flush errors are rethrown by the next explicit flush/close. */
  private unobservedFlushError: Error | undefined;
  private transactionState: 'idle' | 'open' | 'committing' = 'idle';
  private transactionBuffer: PendingRecord[] = [];
  private transactionCommit: Promise<ProduceResult[]> | undefined;

  /**
   * Create a new producer.
   *
   * @param client - Streamline client
   * @param topic - Topic to produce to
   * @param config - Producer configuration
   * @throws {UnsupportedOperationError} When `idempotent: true` is requested.
   */
  constructor(client: Streamline, topic: string, config: ProducerConfig = {}) {
    validateTopicName(topic);
    if (config.idempotent === true) {
      throw new UnsupportedOperationError(
        'ProducerConfig.idempotent',
        'the HTTP produce API assigns no producer id or sequence number, so duplicates from retries cannot be suppressed',
        'Leave idempotent unset (delivery is at-least-once) and de-duplicate downstream with a message key or business id',
      );
    }
    if (config.compression !== undefined && config.compression !== 'none') {
      throw new UnsupportedOperationError(
        'ProducerConfig.compression',
        'Streamline 0.3 exposes only single-message HTTP production and no wire-compression option',
        'Use compression: "none", or use the Kafka protocol for compressed batches',
      );
    }
    this.client = client;
    this.topic = topic;
    this.circuitBreaker = config.circuitBreaker;
    this.config = {
      batchSize: config.batchSize ?? 1000,
      lingerMs: config.lingerMs ?? 100,
      compression: config.compression ?? 'none',
      retries: config.retries ?? 3,
      retryBackoffMs: config.retryBackoffMs ?? 100,
      maxRetryBackoffMs: config.maxRetryBackoffMs ?? 30000,
      idempotent: false,
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
  start(): Promise<void> {
    return fromSync(() => {
      this.closed = false;
    });
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
    if (this.transactionState === 'open') {
      return new Promise((resolve, reject) => {
        this.transactionBuffer.push({ record, resolve, reject });
      });
    }
    if (this.transactionState === 'committing') {
      throw new StreamlineError(
        'Cannot send while a transaction commit is in progress',
        'TRANSACTION_COMMITTING',
      );
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
   *
   * Waits for an active background flush, drains records queued behind it, and
   * rejects if any drained batch failed.
   */
  async flush(): Promise<void> {
    this.clearFlushTimer();

    await this.enqueueFlush();

    if (this.unobservedFlushError) {
      const error = this.unobservedFlushError;
      this.unobservedFlushError = undefined;
      throw error;
    }
  }

  /**
   * Close the producer, flushing remaining messages.
   *
   * If a client-side transaction is still open, its buffered sends and this
   * close call reject with `TRANSACTION_ABORTED`.
   */
  async close(): Promise<void> {
    this.closed = true;

    let transactionError: Error | undefined;
    if (this.transactionState === 'committing' && this.transactionCommit) {
      try {
        await this.transactionCommit;
      } catch (error) {
        transactionError = error instanceof Error ? error : new Error(String(error));
      }
    } else if (this.transactionState === 'open') {
      transactionError = new StreamlineError(
        'Producer closed with a transaction in progress',
        'TRANSACTION_ABORTED',
      );
      for (const pending of this.transactionBuffer) {
        pending.reject(transactionError);
      }
      this.transactionBuffer = [];
      this.transactionState = 'idle';
    }

    await this.flush();
    if (transactionError) {
      throw transactionError;
    }
  }

  /**
   * Begin a new client-side transaction. Messages sent after this call are
   * buffered until commitTransaction() or abortTransaction() is called.
   *
   * This is **not** a broker transaction: there is no transactional producer
   * id, no atomic visibility across partitions, and no exactly-once guarantee.
   * Commit submits buffered records in order; a mid-commit failure can leave a
   * successfully written prefix on the broker.
   */
  beginTransaction(): Promise<void> {
    return fromSync(() => {
      if (this.closed) {
        throw new StreamlineError('Producer is closed', 'PRODUCER_CLOSED');
      }
      if (this.transactionState !== 'idle') {
        throw new StreamlineError('Transaction already in progress', 'TRANSACTION_IN_PROGRESS');
      }
      this.transactionState = 'open';
      this.transactionBuffer = [];
    });
  }

  /**
   * Commit the current client-side transaction, submitting buffered messages
   * in order through the Streamline 0.3 single-message HTTP mutation.
   *
   * Delivery remains at-least-once: retries can duplicate an already-written
   * prefix, and a failure can leave a partial write.
   *
   * @returns Array of produce results for all messages in the transaction
   */
  async commitTransaction(): Promise<ProduceResult[]> {
    if (this.transactionState !== 'open') {
      throw new StreamlineError('No transaction in progress', 'NO_TRANSACTION');
    }

    const pending = this.transactionBuffer;
    this.transactionBuffer = [];
    this.transactionState = 'committing';

    const operation = (async (): Promise<ProduceResult[]> => {
      try {
        const records = pending.map(p => p.record);
        const results = records.length > 0
          ? await this.sendWithRetry(records)
          : [];
        if (results.length !== pending.length) {
          throw new StreamlineError(
            `Produce returned ${results.length} results for ${pending.length} transaction records`,
            'INVALID_PRODUCE_RESPONSE',
          );
        }

        for (let i = 0; i < pending.length; i++) {
          pending[i].resolve(results[i]);
        }

        return results;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        for (const record of pending) {
          record.reject(err);
        }
        throw error;
      } finally {
        this.transactionState = 'idle';
        this.transactionCommit = undefined;
      }
    })();

    this.transactionCommit = operation;
    return operation;
  }

  /**
   * Abort the current transaction, discarding all buffered messages.
   */
  abortTransaction(): Promise<void> {
    return fromSync(() => {
      if (this.transactionState !== 'open') {
        throw new StreamlineError('No transaction in progress', 'NO_TRANSACTION');
      }

      // Reject all buffered promises
      const err = new StreamlineError('Transaction aborted', 'TRANSACTION_ABORTED');
      for (const p of this.transactionBuffer) {
        p.reject(err);
      }

      this.transactionState = 'idle';
      this.transactionBuffer = [];
    });
  }

  private flushNow(): void {
    this.clearFlushTimer();

    if (this.batch.length > 0) {
      this.enqueueFlush().catch((error: unknown) => {
        this.unobservedFlushError = error instanceof Error
          ? error
          : new Error(String(error));
      });
    }
  }

  private enqueueFlush(): Promise<void> {
    const operation = this.flushTail.then(() => this.drainBatches());
    this.flushTail = operation.catch(() => {});
    return operation;
  }

  private async drainBatches(): Promise<void> {
    let firstError: Error | undefined;

    while (this.batch.length > 0) {
      const pending = this.batch;
      this.batch = [];

      try {
        const results = await this.sendWithRetry(pending.map(p => p.record));
        if (results.length !== pending.length) {
          throw new StreamlineError(
            `Produce returned ${results.length} results for ${pending.length} records`,
            'INVALID_PRODUCE_RESPONSE',
          );
        }

        for (let i = 0; i < pending.length; i++) {
          pending[i].resolve(results[i]);
        }
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        firstError ??= normalized;
        for (const record of pending) {
          record.reject(normalized);
        }
      }
    }

    this.clearFlushTimer();
    if (firstError) {
      throw firstError;
    }
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
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
          const backoff = calculateExponentialBackoff(
            this.config.retryBackoffMs,
            attempt,
            this.config.maxRetryBackoffMs,
          );
          await this.sleep(backoff);
        }
      }
    }

    throw lastError ?? new StreamlineError('Send failed', 'SEND_ERROR');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
