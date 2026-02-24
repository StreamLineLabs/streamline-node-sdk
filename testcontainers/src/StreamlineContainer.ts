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
 *
 * // Use with any Kafka client
 * // ...
 *
 * await container.stop();
 * ```
 */

import {
  GenericContainer,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';

/** Default Docker image for Streamline */
const DEFAULT_IMAGE = 'ghcr.io/streamlinelabs/streamline';

/** Default Docker image tag */
const DEFAULT_TAG = 'latest';

/** Kafka protocol port */
const KAFKA_PORT = 9092;

/** HTTP API port */
const HTTP_PORT = 9094;

/** Default startup timeout in milliseconds */
const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;

/**
 * Configuration options for the Streamline container.
 */
export interface StreamlineContainerOptions {
  /** Docker image tag to use (default: "latest") */
  tag?: string;
  /** Full Docker image name with tag (overrides tag option) */
  image?: string;
  /** Log level: "trace" | "debug" | "info" | "warn" | "error" (default: "info") */
  logLevel?: string;
  /** Enable in-memory storage mode with no disk persistence (default: false) */
  inMemory?: boolean;
  /** Enable playground mode with pre-seeded demo topics (default: false) */
  playground?: boolean;
  /** Startup timeout in milliseconds (default: 30000) */
  startupTimeoutMs?: number;
  /** Additional environment variables to pass to the container */
  environment?: Record<string, string>;
}

/**
 * A started Streamline container with methods to retrieve connection details.
 *
 * This wraps a started testcontainer and provides convenient accessors
 * for Kafka bootstrap servers, HTTP API URLs, and container management
 * operations like topic creation and message production.
 *
 * @example
 * ```typescript
 * const container = await new StreamlineContainer().start();
 *
 * // Kafka bootstrap servers for client connections
 * const servers = container.getBootstrapServers();
 *
 * // HTTP API endpoints
 * const httpUrl = container.getHttpUrl();
 * const healthUrl = container.getHealthUrl();
 * const metricsUrl = container.getMetricsUrl();
 *
 * // Create topics
 * await container.createTopic('my-topic', 3);
 *
 * // Produce messages
 * await container.produceMessage('my-topic', 'hello');
 *
 * await container.stop();
 * ```
 */
export class StartedStreamlineContainer {
  private readonly startedContainer: StartedTestContainer;

  constructor(startedContainer: StartedTestContainer) {
    this.startedContainer = startedContainer;
  }

  /**
   * Returns the Kafka bootstrap servers connection string.
   *
   * Use this value for the `bootstrap.servers` or equivalent property
   * in any Kafka-compatible client library.
   *
   * @returns The bootstrap servers string in "host:port" format
   *
   * @example
   * ```typescript
   * const servers = container.getBootstrapServers();
   * // e.g. "localhost:32789"
   * ```
   */
  getBootstrapServers(): string {
    const host = this.startedContainer.getHost();
    const port = this.startedContainer.getMappedPort(KAFKA_PORT);
    return `${host}:${port}`;
  }

  /**
   * Returns the HTTP API base URL.
   *
   * The HTTP API provides endpoints for health checks, metrics,
   * server info, and administration.
   *
   * @returns The HTTP API base URL
   *
   * @example
   * ```typescript
   * const httpUrl = container.getHttpUrl();
   * // e.g. "http://localhost:32790"
   * ```
   */
  getHttpUrl(): string {
    const host = this.startedContainer.getHost();
    const port = this.startedContainer.getMappedPort(HTTP_PORT);
    return `http://${host}:${port}`;
  }

  /**
   * Returns the health check endpoint URL.
   *
   * @returns The health endpoint URL
   */
  getHealthUrl(): string {
    return `${this.getHttpUrl()}/health`;
  }

  /**
   * Returns the Prometheus-compatible metrics endpoint URL.
   *
   * @returns The metrics endpoint URL
   */
  getMetricsUrl(): string {
    return `${this.getHttpUrl()}/metrics`;
  }

  /**
   * Returns the server info endpoint URL.
   *
   * @returns The info endpoint URL
   */
  getInfoUrl(): string {
    return `${this.getHttpUrl()}/info`;
  }

  /**
   * Returns the mapped Kafka protocol port on the host.
   *
   * @returns The host-mapped Kafka port number
   */
  getKafkaPort(): number {
    return this.startedContainer.getMappedPort(KAFKA_PORT);
  }

  /**
   * Returns the mapped HTTP API port on the host.
   *
   * @returns The host-mapped HTTP port number
   */
  getHttpPort(): number {
    return this.startedContainer.getMappedPort(HTTP_PORT);
  }

  /**
   * Returns the host address of the container.
   *
   * @returns The host address
   */
  getHost(): string {
    return this.startedContainer.getHost();
  }

  /**
   * Creates a topic with the specified name and number of partitions.
   *
   * Note: Streamline supports auto-topic creation, so topics are created
   * automatically when a producer first writes to them. Use this method
   * if you need to pre-create topics with specific configurations.
   *
   * @param name - The topic name
   * @param partitions - The number of partitions (default: 1)
   * @throws Error if topic creation fails
   *
   * @example
   * ```typescript
   * await container.createTopic('events', 3);
   * await container.createTopic('logs'); // 1 partition
   * ```
   */
  async createTopic(name: string, partitions: number = 1): Promise<void> {
    const result = await this.startedContainer.exec([
      'streamline-cli',
      'topics',
      'create',
      name,
      '--partitions',
      String(partitions),
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to create topic '${name}': ${result.output}`
      );
    }
  }

  /**
   * Creates multiple topics at once.
   *
   * @param topics - Map of topic name to partition count
   * @throws Error if any topic creation fails
   *
   * @example
   * ```typescript
   * await container.createTopics({
   *   'events': 3,
   *   'logs': 1,
   *   'metrics': 6,
   * });
   * ```
   */
  async createTopics(topics: Record<string, number>): Promise<void> {
    for (const [name, partitions] of Object.entries(topics)) {
      await this.createTopic(name, partitions);
    }
  }

  /**
   * Produces a single message to a topic using the built-in CLI.
   *
   * @param topic - The topic name
   * @param value - The message value
   * @param key - Optional message key
   * @throws Error if message production fails
   *
   * @example
   * ```typescript
   * await container.produceMessage('events', 'hello world');
   * await container.produceMessage('events', '{"data": 1}', 'key-1');
   * ```
   */
  async produceMessage(
    topic: string,
    value: string,
    key?: string
  ): Promise<void> {
    const args = ['streamline-cli', 'produce', topic, '-m', value];
    if (key !== undefined) {
      args.push('-k', key);
    }
    const result = await this.startedContainer.exec(args);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to produce message to '${topic}': ${result.output}`
      );
    }
  }

  /**
   * Asserts that the container is healthy by calling the health endpoint.
   *
   * @throws Error if the health check fails
   */
  async assertHealthy(): Promise<void> {
    const response = await fetch(this.getHealthUrl(), {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`Health check returned status ${response.status}`);
    }
  }

  /**
   * Asserts that a topic exists on the server.
   *
   * @param name - The topic name to verify
   * @throws Error if the topic does not exist
   */
  async assertTopicExists(name: string): Promise<void> {
    const result = await this.startedContainer.exec([
      'streamline-cli',
      'topics',
      'describe',
      name,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`Topic '${name}' does not exist`);
    }
  }

  /**
   * Waits until all specified topics exist, with a timeout.
   *
   * @param topics - List of topic names to wait for
   * @param timeoutMs - Maximum time to wait in milliseconds (default: 10000)
   * @throws Error if topics do not appear within the timeout
   *
   * @example
   * ```typescript
   * await container.createTopics({ 'events': 3, 'logs': 1 });
   * await container.waitForTopics(['events', 'logs'], 5000);
   * ```
   */
  async waitForTopics(
    topics: string[],
    timeoutMs: number = 10_000
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      let allExist = true;
      for (const topic of topics) {
        const result = await this.startedContainer.exec([
          'streamline-cli',
          'topics',
          'describe',
          topic,
        ]);
        if (result.exitCode !== 0) {
          allExist = false;
          break;
        }
      }
      if (allExist) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(
      `Timeout waiting for topics [${topics.join(', ')}] after ${timeoutMs}ms`
    );
  }

  /**
   * Stops the container.
   */
  async stop(): Promise<void> {
    await this.startedContainer.stop();
  }

  // -------------------------------------------------------------------------
  // Enhanced capabilities: batch produce, consumer groups, migration helpers
  // -------------------------------------------------------------------------

  /**
   * Produces a batch of messages to a topic.
   *
   * @param topic - The topic name
   * @param messages - Array of message values
   */
  async produceMessages(topic: string, messages: string[]): Promise<void> {
    for (const msg of messages) {
      await this.produceMessage(topic, msg);
    }
  }

  /**
   * Produces a batch of keyed messages to a topic.
   *
   * @param topic - The topic name
   * @param messages - Map of key to value
   */
  async produceKeyedMessages(
    topic: string,
    messages: Record<string, string>
  ): Promise<void> {
    for (const [key, value] of Object.entries(messages)) {
      await this.produceMessage(topic, value, key);
    }
  }

  /**
   * Lists consumer groups.
   *
   * @returns Array of consumer group IDs
   */
  async listConsumerGroups(): Promise<string[]> {
    const result = await this.startedContainer.exec([
      'streamline-cli',
      'groups',
      'list',
      '--format',
      'json',
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to list consumer groups: ${result.output}`);
    }
    try {
      return JSON.parse(result.output);
    } catch {
      return result.output
        .trim()
        .split('\n')
        .map((line: string) => line.trim().replace(/["\[\],]/g, ''))
        .filter((line: string) => line.length > 0);
    }
  }

  /**
   * Asserts that a consumer group exists.
   *
   * @param groupId - The consumer group ID
   * @throws Error if the group does not exist
   */
  async assertConsumerGroupExists(groupId: string): Promise<void> {
    const result = await this.startedContainer.exec([
      'streamline-cli',
      'groups',
      'describe',
      groupId,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(`Consumer group '${groupId}' does not exist`);
    }
  }

  /**
   * Gets cluster information from the HTTP API.
   *
   * @returns Cluster info object
   */
  async getClusterInfo(): Promise<Record<string, unknown>> {
    const response = await fetch(this.getInfoUrl(), {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`Failed to get cluster info: HTTP ${response.status}`);
    }
    return response.json() as Promise<Record<string, unknown>>;
  }

  /**
   * Stops the container.
   */
  async stop(): Promise<void> {
    await this.startedContainer.stop();
  }

  /**
   * Returns the underlying started testcontainer instance.
   *
   * Use this for advanced operations not covered by the wrapper methods.
   *
   * @returns The started testcontainer
   */
  getContainer(): StartedTestContainer {
    return this.startedContainer;
  }
}

/**
 * Testcontainers container for Streamline - The Redis of Streaming.
 *
 * Streamline is a Kafka-compatible streaming platform that provides a lightweight,
 * single-binary alternative to Apache Kafka. This container module makes it easy
 * to spin up a Streamline instance for integration testing.
 *
 * Features:
 * - Kafka protocol compatible on port 9092
 * - HTTP API on port 9094 (health, metrics, admin)
 * - Fast startup (~100ms vs seconds for Kafka)
 * - Low memory footprint (<50MB)
 * - No ZooKeeper or KRaft required
 * - In-memory and playground modes
 *
 * @example Basic usage
 * ```typescript
 * import { StreamlineContainer } from '@streamline/testcontainers';
 *
 * const container = await new StreamlineContainer().start();
 * const bootstrapServers = container.getBootstrapServers();
 *
 * // Use bootstrapServers with any Kafka client library
 * // ...
 *
 * await container.stop();
 * ```
 *
 * @example With options
 * ```typescript
 * const container = await new StreamlineContainer({
 *   tag: '0.2.0',
 *   logLevel: 'debug',
 *   inMemory: true,
 * }).start();
 * ```
 *
 * @example Playground mode with pre-seeded topics
 * ```typescript
 * const container = await new StreamlineContainer({
 *   playground: true,
 * }).start();
 * ```
 */
export class StreamlineContainer {
  private readonly container: GenericContainer;
  private readonly startupTimeoutMs: number;

  /**
   * Creates a new Streamline container configuration.
   *
   * @param options - Container configuration options
   */
  constructor(options: StreamlineContainerOptions = {}) {
    const image = options.image ?? `${DEFAULT_IMAGE}:${options.tag ?? DEFAULT_TAG}`;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

    this.container = new GenericContainer(image)
      .withExposedPorts(KAFKA_PORT, HTTP_PORT)
      .withEnvironment({
        STREAMLINE_LISTEN_ADDR: `0.0.0.0:${KAFKA_PORT}`,
        STREAMLINE_HTTP_ADDR: `0.0.0.0:${HTTP_PORT}`,
        STREAMLINE_LOG_LEVEL: options.logLevel ?? 'info',
        ...(options.inMemory ? { STREAMLINE_IN_MEMORY: 'true' } : {}),
        ...(options.playground ? { STREAMLINE_PLAYGROUND: 'true' } : {}),
        ...(options.environment ?? {}),
      })
      .withWaitStrategy(
        Wait.forHttp('/health', HTTP_PORT)
          .forStatusCode(200)
          .withStartupTimeout(this.startupTimeoutMs)
      );
  }

  /**
   * Starts the Streamline container.
   *
   * This pulls the Docker image (if not cached), starts the container,
   * and waits until the health endpoint returns HTTP 200.
   *
   * @returns A started container instance with connection details
   *
   * @example
   * ```typescript
   * const container = await new StreamlineContainer().start();
   * console.log('Bootstrap:', container.getBootstrapServers());
   * console.log('HTTP:', container.getHttpUrl());
   * ```
   */
  async start(): Promise<StartedStreamlineContainer> {
    const startedContainer = await this.container.start();
    return new StartedStreamlineContainer(startedContainer);
  }

  /**
   * Creates a Streamline container configured as a drop-in Kafka replacement.
   *
   * Useful for migrating from Kafka-based tests:
   * ```typescript
   * // Before (Kafka):
   * // const container = await new KafkaContainer().start();
   *
   * // After (Streamline):
   * const container = await StreamlineContainer.asKafkaReplacement();
   * const bootstrapServers = container.getBootstrapServers();
   * ```
   *
   * @returns A started StreamlineContainer configured for Kafka compatibility
   */
  static async asKafkaReplacement(): Promise<StartedStreamlineContainer> {
    return new StreamlineContainer({
      inMemory: true,
      environment: {
        STREAMLINE_AUTO_CREATE_TOPICS: 'true',
        STREAMLINE_DEFAULT_PARTITIONS: '1',
      },
    }).start();
  }

  /**
   * Creates a container pre-configured with topics.
   *
   * @param topics - Map of topic name to partition count
   * @returns A started StreamlineContainer with pre-configured topic env vars
   */
  static async withPreConfiguredTopics(
    topics: Record<string, number>
  ): Promise<StartedStreamlineContainer> {
    const environment: Record<string, string> = {};
    for (const [name, partitions] of Object.entries(topics)) {
      environment[`STREAMLINE_AUTO_TOPIC_${name}`] = String(partitions);
    }
    return new StreamlineContainer({
      inMemory: true,
      environment,
    }).start();
  }

  /**
   * Enable ephemeral mode: in-memory, auto-cleanup, fastest startup.
   * The server will auto-shutdown after the idle timeout if no clients are connected.
   */
  withEphemeral(): this {
    this.withEnvironment({
      STREAMLINE_EPHEMERAL: 'true',
      STREAMLINE_IN_MEMORY: 'true',
    });
    return this;
  }

  /**
   * Set the idle timeout before ephemeral server auto-shuts down.
   * @param seconds - Seconds to wait with zero connections before shutdown
   */
  withEphemeralIdleTimeout(seconds: number): this {
    this.withEnvironment({
      STREAMLINE_EPHEMERAL_IDLE_TIMEOUT: String(seconds),
    });
    return this;
  }

  /**
   * Auto-create topics on startup in ephemeral mode.
   * @param topicSpecs - Comma-separated "name:partitions" specs
   */
  withEphemeralAutoTopics(topicSpecs: string): this {
    this.withEnvironment({
      STREAMLINE_EPHEMERAL_AUTO_TOPICS: topicSpecs,
    });
    return this;
  }

  /**
   * Create and start a container optimized for CI/CD testing.
   *
   * @example
   * ```typescript
   * const container = await StreamlineContainer.forTesting();
   * const bootstrapServers = container.getBootstrapServers();
   * ```
   */
  static async forTesting(): Promise<StartedStreamlineContainer> {
    return new StreamlineContainer({
      inMemory: true,
      environment: {
        STREAMLINE_EPHEMERAL: 'true',
        STREAMLINE_AUTO_CREATE_TOPICS: 'true',
        STREAMLINE_DEFAULT_PARTITIONS: '3',
        STREAMLINE_LOG_LEVEL: 'warn',
      },
    }).start();
  }
}
