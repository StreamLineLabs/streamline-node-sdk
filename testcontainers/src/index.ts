/**
 * Testcontainers module for Streamline - The Redis of Streaming.
 *
 * Streamline is a Kafka-compatible streaming platform that provides a lightweight,
 * single-binary alternative to Apache Kafka for development and testing.
 *
 * @example
 * ```typescript
 * import { StreamlineContainer } from '@streamline/testcontainers';
 *
 * const container = await new StreamlineContainer().start();
 * const bootstrapServers = container.getBootstrapServers();
 * // Use with any Kafka client
 *
 * await container.stop();
 * ```
 *
 * @packageDocumentation
 */

export {
  StreamlineContainer,
  StartedStreamlineContainer,
  type StreamlineContainerOptions,
} from './StreamlineContainer';
