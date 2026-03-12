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

export { Streamline, StreamlineOptions, TlsOptions, SaslOptions, TypedStreamline, TypedMessage } from './client';
export { SchemaRegistry, SchemaType, SchemaInfo } from './schema';
export { Producer, ProducerConfig } from './producer';
export { Consumer, ConsumerConfig } from './consumer';
export { Admin } from './admin';
export { StreamlineTracing, TracingConfig } from './telemetry';
export { JsonSchemaSerializer, AvroSchemaSerializer, SchemaRegistryClient } from './serializers';
export type { SchemaRegistryConfig, JsonSchemaSerializerOptions, AvroSchemaSerializerOptions } from './serializers';
export { SchemaProducer, SchemaConsumer, encodeWireFormat, decodeWireFormat } from './schema-producer';
export type { SchemaProducerOptions, DeserializedMessage } from './schema-producer';
export * from './types';
export { CircuitBreaker, CircuitBreakerConfig, CircuitState } from './circuit-breaker';
export { EmbeddedStreamline, EmbeddedConfig, EmbeddedMessage } from './embedded';
export { AIClient, EmbeddingResult, SearchResult, AnomalyAlert, RAGResponse } from './ai';
export { ClientMetrics, MetricsSnapshot } from './metrics';

// First-class auth and TLS configuration
export { createSaslAuthenticator } from './auth';
export type { AuthConfig, PlainAuth, ScramAuth, OAuthBearerAuth, OAuthBearerToken, SaslMechanism, SaslAuthenticator } from './auth';
export { createTlsOptions, loadCertificateFromFile } from './tls';
export type { TlsConfig } from './tls';
export { validateConfig } from './config';
export type { StreamlineClientConfig } from './config';

