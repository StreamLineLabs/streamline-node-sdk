/**
 * Streamline Node.js SDK
 *
 * A developer-friendly SDK for the Streamline streaming platform.
 *
 * @example
 * ```typescript
 * import { Streamline } from 'streamline';
 *
 * const client = new Streamline('localhost:9092');
 * await client.connect();
 *
 * // Produce messages
 * await client.produce('my-topic', { event: 'hello' });
 *
 * // Consume messages
 * for await (const message of client.consume('my-topic')) {
 *   console.log(message.value);
 * }
 *
 * await client.close();
 * ```
 *
 * @packageDocumentation
 */

export { Streamline, StreamlineOptions } from './client';
export { Producer, ProducerConfig } from './producer';
export { Consumer, ConsumerConfig } from './consumer';
export { Admin } from './admin';
export { StreamlineTracing, TracingConfig } from './telemetry';
export { JsonSchemaSerializer, SchemaRegistryClient } from './serializers';
export type { SchemaRegistryConfig, JsonSchemaSerializerOptions } from './serializers';
export * from './types';
