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
export type { SearchOptions, SearchResult } from './types';
export { validateTopicName, calculateExponentialBackoff } from './types';
export { Admin } from './admin';
export { StreamlineTracing, TracingConfig } from './telemetry';
export { TracedProducer, TracedConsumer } from './traced';
export { JsonSchemaSerializer, AvroSchemaSerializer, SchemaRegistryClient } from './serializers';
export type { SchemaRegistryConfig, JsonSchemaSerializerOptions, AvroSchemaSerializerOptions } from './serializers';
export { SchemaProducer, SchemaConsumer, encodeWireFormat, decodeWireFormat } from './schema-producer';
export type { SchemaProducerOptions, DeserializedMessage } from './schema-producer';
export * from './types';
export { CircuitBreaker, CircuitBreakerConfig, CircuitState } from './circuit-breaker';
// Embedded mode is experimental and requires a native Rust build — see src/embedded.ts for details
export { EmbeddedStreamline, EmbeddedConfig, EmbeddedMessage } from './embedded';
export { AIClient, EmbeddingResult, AnomalyAlert, RAGResponse } from './ai';
export { ClientMetrics, MetricsSnapshot } from './metrics';

// First-class auth and TLS configuration
export { createSaslAuthenticator } from './auth';
export type { AuthConfig, PlainAuth, ScramAuth, OAuthBearerAuth, OAuthBearerToken, SaslMechanism, SaslAuthenticator } from './auth';
export { createTlsOptions, loadCertificateFromFile } from './tls';
export type { TlsConfig } from './tls';
export { validateConfig } from './config';
export type { StreamlineClientConfig } from './config';

// Local attestation verifier
export { StreamlineVerifier, ATTEST_HEADER } from './verifier';
export type { VerificationResult } from './verifier';

// Moonshot HTTP clients (Experimental — wraps broker /api/v1/* admin/AI APIs)
export * from './moonshot';

