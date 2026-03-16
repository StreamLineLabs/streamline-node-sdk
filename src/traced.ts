/**
 * Traced wrappers for Producer and Consumer.
 *
 * {@link TracedProducer} and {@link TracedConsumer} delegate all operations to
 * the underlying producer/consumer and add OpenTelemetry tracing around I/O
 * operations (send, poll, consume). Non-I/O methods are pure passthrough
 * with zero tracing overhead.
 *
 * @example
 * ```typescript
 * import { Streamline, Producer, Consumer, StreamlineTracing, TracedProducer, TracedConsumer } from 'streamline';
 *
 * const client = new Streamline('localhost:9092');
 * const tracing = new StreamlineTracing();
 *
 * // Traced producer
 * const producer = new Producer(client, 'orders');
 * const tracedProducer = new TracedProducer(producer, 'orders', tracing);
 * await tracedProducer.send({ value: { orderId: 123 } });
 *
 * // Traced consumer
 * const consumer = new Consumer(client, 'orders', 'my-group');
 * const tracedConsumer = new TracedConsumer(consumer, 'orders', tracing);
 * const messages = await tracedConsumer.poll();
 * ```
 *
 * @packageDocumentation
 */

import { Producer } from './producer';
import { Consumer, RebalanceEvent } from './consumer';
import { StreamlineTracing } from './telemetry';
import { CircuitBreaker } from './circuit-breaker';
import type { ProduceRecord, ProduceResult, Message } from './types';

/**
 * A producer wrapper that adds OpenTelemetry tracing to send operations.
 *
 * Delegates all methods to the underlying {@link Producer}. Only {@link send}
 * and {@link sendBatch} are traced; transaction and lifecycle methods are pure
 * delegation with no tracing overhead.
 */
export class TracedProducer {
  private readonly producer: Producer;
  private readonly tracing: StreamlineTracing;
  private readonly topic: string;

  /**
   * Create a traced producer wrapper.
   *
   * @param producer - The underlying producer to wrap
   * @param topic - Topic name used for trace span naming
   * @param tracing - Optional tracing instance (creates a default if omitted)
   */
  constructor(producer: Producer, topic: string, tracing?: StreamlineTracing) {
    this.producer = producer;
    this.topic = topic;
    this.tracing = tracing ?? new StreamlineTracing();
  }

  /** Start the producer. */
  async start(): Promise<void> {
    return this.producer.start();
  }

  /**
   * Send a message to the topic with a PRODUCER tracing span.
   *
   * Trace context is injected into the record's headers when present.
   */
  async send(record: ProduceRecord): Promise<ProduceResult> {
    return this.tracing.traceProducer(this.topic, record.headers, () =>
      this.producer.send(record),
    );
  }

  /**
   * Send multiple messages with a PRODUCER tracing span.
   */
  async sendBatch(records: ProduceRecord[]): Promise<ProduceResult[]> {
    return this.tracing.traceProducer(this.topic, undefined, () =>
      this.producer.sendBatch(records),
    );
  }

  /** Flush all pending messages. */
  async flush(): Promise<void> {
    return this.producer.flush();
  }

  /** Close the producer, flushing remaining messages. */
  async close(): Promise<void> {
    return this.producer.close();
  }

  /** Set a circuit breaker on this producer. */
  withCircuitBreaker(cb: CircuitBreaker): this {
    this.producer.withCircuitBreaker(cb);
    return this;
  }

  /** Begin a new transaction. */
  async beginTransaction(): Promise<void> {
    return this.producer.beginTransaction();
  }

  /** Commit the current transaction. */
  async commitTransaction(): Promise<ProduceResult[]> {
    return this.producer.commitTransaction();
  }

  /** Abort the current transaction. */
  async abortTransaction(): Promise<void> {
    return this.producer.abortTransaction();
  }
}

/**
 * A consumer wrapper that adds OpenTelemetry tracing to poll and consume
 * operations.
 *
 * {@link poll} is wrapped with a CONSUMER span. The {@link messages} async
 * generator traces each yielded message with a process span linked to the
 * producer via header context extraction. All other methods are pure delegation.
 */
export class TracedConsumer implements AsyncIterable<Message> {
  private readonly consumer: Consumer;
  private readonly tracing: StreamlineTracing;
  private readonly topic: string;

  /**
   * Create a traced consumer wrapper.
   *
   * @param consumer - The underlying consumer to wrap
   * @param topic - Topic name used for trace span naming
   * @param tracing - Optional tracing instance (creates a default if omitted)
   */
  constructor(consumer: Consumer, topic: string, tracing?: StreamlineTracing) {
    this.consumer = consumer;
    this.topic = topic;
    this.tracing = tracing ?? new StreamlineTracing();
  }

  /** Start the consumer. */
  async start(): Promise<void> {
    return this.consumer.start();
  }

  /** Async iterator — delegates to {@link messages}. */
  async *[Symbol.asyncIterator](): AsyncGenerator<Message> {
    yield* this.messages();
  }

  /**
   * Iterate over messages with per-record process tracing.
   *
   * Each yielded message is wrapped in a process span that extracts the
   * parent trace context from message headers, enabling end-to-end
   * distributed tracing from producer to consumer.
   */
  async *messages(): AsyncGenerator<Message> {
    for await (const msg of this.consumer.messages()) {
      const headers = Object.fromEntries(
        msg.headers.map(h => [h.key, h.value]),
      );
      yield await this.tracing.traceProcess(
        msg.topic,
        msg.partition,
        msg.offset,
        headers,
        async () => msg,
      );
    }
  }

  /**
   * Poll for messages with a CONSUMER tracing span.
   *
   * @param timeoutMs - Maximum time to wait for messages (default: 1000)
   * @param maxRecords - Maximum records to return
   */
  async poll(timeoutMs: number = 1000, maxRecords?: number): Promise<Message[]> {
    return this.tracing.traceConsumer(this.topic, () =>
      this.consumer.poll(timeoutMs, maxRecords),
    );
  }

  /** Commit current offsets. */
  async commit(offsets?: Map<string, number>): Promise<void> {
    return this.consumer.commit(offsets);
  }

  /** Seek to a specific offset. */
  async seek(partition: number, offset: number): Promise<void> {
    return this.consumer.seek(partition, offset);
  }

  /** Seek to the beginning of partitions. */
  async seekToBeginning(partitions?: number[]): Promise<void> {
    return this.consumer.seekToBeginning(partitions);
  }

  /** Seek to the end of partitions. */
  async seekToEnd(partitions?: number[]): Promise<void> {
    return this.consumer.seekToEnd(partitions);
  }

  /** Pause consumption. */
  pause(partitions?: number[]): void {
    this.consumer.pause(partitions);
  }

  /** Resume consumption. */
  resume(partitions?: number[]): void {
    this.consumer.resume(partitions);
  }

  /** Register a rebalance handler. */
  onRebalance(handler: (event: RebalanceEvent) => Promise<void>): void {
    this.consumer.onRebalance(handler);
  }

  /** Get assigned partitions. */
  assignment(): number[] {
    return this.consumer.assignment();
  }

  /** Get current position for a partition. */
  position(partition: number): number | undefined {
    return this.consumer.position(partition);
  }

  /** Get committed offset for a partition. */
  committed(partition: number): number | undefined {
    return this.consumer.committed(partition);
  }

  /** Close the consumer. */
  async close(): Promise<void> {
    return this.consumer.close();
  }
}
