/**
 * Main Streamline client for Node.js
 */

import {
  Message,
  ProduceRecord,
  ProduceResult,
  TopicInfo,
  ConsumerGroupInfo,
  ClusterInfo,
  QueryRow,
  StreamlineError,
  ConnectionError,
  TimeoutError,
  UnsupportedOperationError,
} from './types';
import type { AuthConfig } from './auth';
import type { TlsConfig } from './tls';
import { CircuitBreaker, CircuitBreakerConfig } from './circuit-breaker';
import { fromSync } from './internal/async';
import {
  assertAuthTransportSupported,
  assertTlsTransportSupported,
  assertLegacyTlsTransportSupported,
} from './internal/transport-support';

/**
 * TLS configuration for secure connections.
 *
 * @deprecated These options are **not** applied to the SDK's HTTP requests.
 * Transport security comes from using an `https://` {@link StreamlineOptions.httpEndpoint}.
 * Use {@link TlsConfig} from `./tls` with `createTlsOptions()` when you need to
 * build Node TLS options yourself.
 */
export interface TlsOptions {
  /** CA certificate (PEM string or Buffer) */
  ca?: string | Buffer;
  /** Client certificate for mutual TLS (PEM string or Buffer) */
  cert?: string | Buffer;
  /** Client private key for mutual TLS (PEM string or Buffer) */
  key?: string | Buffer;
  /** Skip server certificate verification (NOT recommended for production) */
  rejectUnauthorized?: boolean;
}

/**
 * SASL authentication configuration.
 *
 * @deprecated Use {@link AuthConfig} from `./auth` for first-class SASL support.
 */
export interface SaslOptions {
  /** SASL mechanism */
  mechanism: 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512';
  /** Username */
  username: string;
  /** Password */
  password: string;
}

/**
 * Client configuration options.
 */
export interface StreamlineOptions {
  /** HTTP endpoint for REST/GraphQL API (default: http://localhost:9094) */
  httpEndpoint?: string;
  /** Client identifier, sent as the `X-Client-Id` header */
  clientId?: string;
  /** API key used as a bearer credential when no `auth`/`sasl` is configured */
  apiKey?: string;
  /**
   * TLS configuration.
   *
   * @deprecated Not applied to HTTP requests — use an `https://` `httpEndpoint`
   * for transport security.
   */
  tls?: boolean | TlsOptions;
  /** SASL authentication configuration, mapped onto HTTP auth headers */
  sasl?: SaslOptions;
  /** First-class Streamline SASL authentication configuration. */
  auth?: AuthConfig;
  /**
   * First-class Streamline TLS configuration.
   *
   * Consumed by `createTlsOptions()`; it is **not** applied to the HTTP
   * requests this client makes.
   */
  tlsConfig?: TlsConfig;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Auto-reconnect on connection loss (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnect attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Reconnect delay in milliseconds (default: 1000) */
  reconnectDelay?: number;
  /** Maximum reconnect delay in milliseconds (default: 30000) */
  maxReconnectDelay?: number;
  /** Circuit breaker configuration (opt-in). Pass `true` for defaults or a config object. */
  circuitBreaker?: boolean | CircuitBreakerConfig;
}

/**
 * Consume options.
 */
export interface ConsumeOptions {
  /**
   * Consumer group ID.
   *
   * @deprecated Not supported by the Streamline 0.3 HTTP/GraphQL messages
   * query. Supplying this option throws {@link UnsupportedOperationError}
   * instead of silently consuming without group semantics.
   */
  group?: string | undefined;
  /** Partition to read (default: 0) */
  partition?: number;
  /** Start from beginning of topic */
  fromBeginning?: boolean;
  /** Start from specific offset */
  fromOffset?: number;
  /** Maximum messages to fetch per poll */
  maxMessages?: number;
  /**
   * Poll timeout in milliseconds.
   *
   * For {@link Streamline.consume} this is the idle delay between empty polls.
   * For {@link Streamline.consumeBatch} it is the request deadline: the fetch
   * is aborted and a {@link TimeoutError} is thrown when it elapses.
   */
  pollTimeout?: number;
}

/** Options accepted by {@link Streamline.request}. */
export interface RequestOptions {
  /**
   * Per-request deadline in milliseconds. When it elapses the request is
   * aborted and a {@link TimeoutError} is thrown.
   */
  timeoutMs?: number | undefined;
}

interface WireMessage {
  topic: string;
  partition: number;
  offset: number;
  key?: string | null;
  value: string;
  timestamp: string;
  headers: { key: string; value: string }[];
}

interface WireProduceResult {
  topic: string;
  partition: number;
  offset: number;
  timestamp: string;
}

interface WireTopic {
  name: string;
  partitions: number;
  replicationFactor: number;
  messageCount: number;
  retentionMs?: number | null;
  createdAt: string;
}

interface WireConsumerGroup {
  groupId: string;
  state: string;
  protocolType: string;
  memberCount: number;
}

interface WireClusterInfo {
  nodeId: number;
  version: string;
  uptime: number;
  topicCount: number;
}

/**
 * Main Streamline client.
 *
 * ## Transport
 *
 * This client speaks to Streamline over its **HTTP/GraphQL API** (default
 * `http://localhost:9094`). It does **not** open a Kafka wire-protocol
 * connection and does not depend on a Kafka client library. The
 * `bootstrapServers` constructor argument is retained for API compatibility
 * and identification only — see {@link Streamline.bootstrapServers} — and the
 * endpoint that is actually used is {@link Streamline.httpEndpoint}.
 *
 * @example
 * ```typescript
 * const client = new Streamline('localhost:9092', {
 *   httpEndpoint: 'http://localhost:9094',
 * });
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
 */
export class Streamline {
  private options: Omit<Required<StreamlineOptions>, 'sasl' | 'auth' | 'tlsConfig' | 'circuitBreaker'> & { sasl?: SaslOptions; auth?: AuthConfig; tlsConfig?: TlsConfig };
  private connected: boolean = false;
  /**
   * Set by an explicit {@link Streamline.close}, cleared by
   * {@link Streamline.connect}. Distinct from `connected` (which also
   * transiently reads `false` before the first successful connect, or after
   * a connection is merely lost): this flag specifically means "the caller
   * asked us to stop", and is checked by {@link Streamline.reconnect} so an
   * explicit close cancels any in-flight reconnect/backoff instead of
   * letting it keep retrying in the background.
   */
  private closed: boolean = false;
  private abortController?: AbortController;
  /**
   * Monotonically increasing lifecycle generation. Bumped by every
   * {@link Streamline.connect} and {@link Streamline.close}. A `connect()`
   * attempt (whether called directly or via {@link Streamline.reconnect})
   * captures the generation in effect when it starts; if that generation is
   * no longer current by the time its health check settles -- because a
   * newer `connect()` or an explicit `close()` ran in the meantime -- the
   * attempt is stale and is discarded quietly: it must not set
   * `connected = true` and must not touch `abortController`, which already
   * belongs to whichever attempt is current. An explicit manual reopen
   * (`close()` then `connect()`) is unaffected: it starts its own new,
   * current generation and completes normally.
   */
  private generation = 0;
  private cb?: CircuitBreaker;
  private readonly bootstrap: string;

  /**
   * Create a new Streamline client.
   *
   * @param bootstrapServers - Comma-separated list of broker addresses. Kept
   *   for Kafka-client familiarity and surfaced as
   *   {@link Streamline.bootstrapServers}; all traffic is sent to
   *   `options.httpEndpoint` instead. Passing an empty string is rejected so
   *   the mistake surfaces at construction time.
   * @param options - Client configuration options
   * @throws {StreamlineError} When `bootstrapServers` is not a non-empty string.
   */
  constructor(bootstrapServers: string, options: StreamlineOptions = {}) {
    if (typeof bootstrapServers !== 'string' || bootstrapServers.trim().length === 0) {
      throw new StreamlineError(
        'bootstrapServers is required and must be a non-empty string',
        'CONFIG_ERROR',
        false,
        undefined,
        'Provide at least one broker address, e.g. "localhost:9092"',
      );
    }
    // Reject SASL/TLS configuration this HTTP transport cannot genuinely
    // honour before any I/O is attempted, rather than silently accepting it
    // and downgrading (SCRAM -> plaintext Basic auth) or ignoring it
    // (custom CA / mTLS / rejectUnauthorized never reach fetch()).
    assertAuthTransportSupported(options.auth?.mechanism, 'auth.mechanism');
    assertAuthTransportSupported(options.sasl?.mechanism, 'sasl.mechanism');
    assertTlsTransportSupported(options.tlsConfig);
    assertLegacyTlsTransportSupported(options.tls);

    this.bootstrap = bootstrapServers;
    this.options = {
      httpEndpoint: options.httpEndpoint ?? process.env['STREAMLINE_URL'] ?? 'http://localhost:9094',
      clientId: options.clientId ?? 'streamline-nodejs',
      apiKey: options.apiKey ?? '',
      tls: options.tls ?? false,
      ...(options.sasl ? { sasl: options.sasl } : {}),
      ...(options.auth ? { auth: options.auth } : {}),
      ...(options.tlsConfig ? { tlsConfig: options.tlsConfig } : {}),
      timeout: options.timeout ?? 30000,
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      reconnectDelay: options.reconnectDelay ?? 1000,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
    };

    if (options.circuitBreaker) {
      const cbConfig = options.circuitBreaker === true ? {} : options.circuitBreaker;
      this.cb = new CircuitBreaker(cbConfig);
    }
  }

  /**
   * Connect to the Streamline cluster.
   *
   * Clears any prior {@link Streamline.close}: calling `connect()` again on a
   * previously closed client is an explicit, intentional re-open.
   */
  async connect(): Promise<void> {
    const generation = ++this.generation;
    this.closed = false;
    this.abortController = new AbortController();

    try {
      // Test connection with health check
      const response = await this.request('/health', { method: 'GET' });
      if (this.generation !== generation) {
        // Superseded by a newer connect() or an explicit close() while the
        // health check was in flight: this attempt is stale. Discard it
        // quietly rather than resurrecting `connected` or otherwise
        // clobbering state that a newer, current attempt already owns.
        return;
      }
      if (!response.ok) {
        throw new ConnectionError(`Health check failed: ${response.statusText}`);
      }
      this.connected = true;
    } catch (error) {
      if (this.generation !== generation) {
        // Also stale: a newer attempt (or close()) already decided the
        // client's state, so this failure carries no meaning anymore.
        return;
      }
      throw new ConnectionError(
        `Failed to connect to ${this.options.httpEndpoint}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * HTTP endpoint used for the REST and GraphQL APIs.
   *
   * Resolved once at construction time from the `httpEndpoint` option, the
   * `STREAMLINE_URL` environment variable, or the default `http://localhost:9094`.
   */
  get httpEndpoint(): string {
    return this.options.httpEndpoint;
  }

  /**
   * The bootstrap server string this client was constructed with.
   *
   * Exposed for logging and diagnostics. This SDK talks to Streamline over
   * HTTP/GraphQL ({@link Streamline.httpEndpoint}); it never dials the Kafka
   * wire protocol, so this value does not influence any request.
   */
  get bootstrapServers(): string {
    return this.bootstrap;
  }

  /**
   * Close the client connection.
   *
   * Cancels any in-flight requests via the current abort controller and,
   * critically, cancels any in-progress auto-reconnect backoff: a
   * {@link Streamline.reconnect} loop woken by this abort observes `closed`
   * and stops instead of sleeping out its full delay and retrying. Also
   * bumps {@link Streamline.generation}, so a health check or reconnect
   * attempt already in flight is fenced off as stale and cannot resurrect
   * `connected` (or otherwise report success) after this close, even if its
   * underlying request settles later.
   */
  close(): Promise<void> {
    return fromSync(() => {
      this.closed = true;
      this.connected = false;
      this.generation++;
      this.abortController?.abort();
    });
  }

  // =========================================================================
  // Produce
  // =========================================================================

  /**
   * Produce a message to a topic.
   *
   * @param topic - Topic name
   * @param value - Message value (will be JSON serialized if object)
   * @param options - Optional key, partition, and headers
   * @returns Produce result with offset information
   */
  async produce(
    topic: string,
    value: unknown,
    options: { key?: string; partition?: number; headers?: Record<string, string> } = {}
  ): Promise<ProduceResult> {
    const response = await this.graphql<{ produceMessage: WireProduceResult }>(`
      mutation Produce($topic: String!, $message: ProduceInput!) {
        produceMessage(topic: $topic, message: $message) {
          topic
          partition
          offset
          timestamp
        }
      }
    `, {
      topic,
      message: {
        value: typeof value === 'string' ? value : JSON.stringify(value),
        key: options.key,
        partition: options.partition,
        headers: options.headers
          ? Object.entries(options.headers).map(([k, v]) => ({ key: k, value: v }))
          : undefined,
      },
    });

    return this.normalizeProduceResult(response.produceMessage);
  }

  /**
   * Produce multiple messages to a topic.
   *
   * @param topic - Topic name
   * @param records - Array of records to produce
   * @returns Array of produce results
   */
  async produceBatch(
    topic: string,
    records: ProduceRecord[],
    options?: { compression?: string },
  ): Promise<ProduceResult[]> {
    const compression = options?.compression ?? 'none';
    if (compression !== 'none') {
      throw new UnsupportedOperationError(
        'Streamline.produceBatch compression',
        'Streamline 0.3 exposes only single-message GraphQL production and has no HTTP compression option',
        'Use compression: "none", or use the Kafka protocol when wire compression is required',
      );
    }

    const results: ProduceResult[] = [];
    for (const record of records) {
      results.push(await this.produce(topic, record.value, {
        ...(record.key !== undefined ? { key: record.key } : {}),
        ...(record.partition !== undefined ? { partition: record.partition } : {}),
        ...(record.headers !== undefined ? { headers: record.headers } : {}),
      }));
    }
    return results;
  }

  // =========================================================================
  // Consume
  // =========================================================================

  /**
   * Consume messages from a topic.
   *
   * @param topic - Topic name
   * @param options - Consume options
   * @yields Messages from the topic
   */
  async *consume(topic: string, options: ConsumeOptions = {}): AsyncGenerator<Message> {
    this.rejectUnsupportedConsumeGroup(options.group);

    const {
      partition = 0,
      fromBeginning = false,
      fromOffset,
      maxMessages = 100,
      pollTimeout = 5000,
    } = options;

    let currentOffset = await this.resolveConsumeOffset(
      topic,
      partition,
      fromBeginning,
      fromOffset,
    );

    while (this.connected) {
      try {
        const response = await this.graphql<{ messages: WireMessage[] }>(`
          query Messages($topic: String!, $partition: Int, $offset: Int, $limit: Int) {
            messages(topic: $topic, partition: $partition, offset: $offset, limit: $limit) {
              topic
              partition
              offset
              key
              value
              timestamp
              headers {
                key
                value
              }
            }
          }
        `, {
          topic,
          partition,
          offset: currentOffset,
          limit: maxMessages,
        });

        const messages = response.messages;

        if (messages.length === 0) {
          // No new messages, wait before polling again. Interruptible so an
          // explicit close() wakes this immediately instead of leaving the
          // iterator hanging for up to `pollTimeout` after being closed.
          await this.interruptibleSleep(pollTimeout);
          continue;
        }

        for (const wireMessage of messages) {
          const msg = this.normalizeMessage(wireMessage);
          yield msg;

          currentOffset = msg.offset + 1;
        }
      } catch (error) {
        if (this.options.autoReconnect && error instanceof ConnectionError) {
          await this.reconnect();
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Consume a batch of messages.
   *
   * @param topic - Topic name
   * @param options - Consume options. `group` is rejected because the required
   *   Streamline 0.3 server does not expose group-aware HTTP consumption.
   *   `pollTimeout` bounds the request and raises a {@link TimeoutError} when
   *   it elapses.
   * @returns Array of messages
   */
  async consumeBatch(topic: string, options: ConsumeOptions = {}): Promise<Message[]> {
    this.rejectUnsupportedConsumeGroup(options.group);

    const {
      partition = 0,
      fromBeginning = false,
      fromOffset,
      maxMessages = 100,
      pollTimeout,
    } = options;
    const offset = await this.resolveConsumeOffset(
      topic,
      partition,
      fromBeginning,
      fromOffset,
      pollTimeout,
    );

    const response = await this.graphql<{ messages: WireMessage[] }>(`
      query Messages($topic: String!, $partition: Int, $offset: Int, $limit: Int) {
        messages(topic: $topic, partition: $partition, offset: $offset, limit: $limit) {
          topic
          partition
          offset
          key
          value
          timestamp
          headers {
            key
            value
          }
        }
      }
    `, {
      topic,
      partition,
      offset,
      limit: maxMessages,
    }, { timeoutMs: pollTimeout });

    return response.messages.map((message) => this.normalizeMessage(message));
  }

  /**
   * Return the next offset that would be written for a partition.
   *
   * Used to establish a stable live-tail cursor before polling. Once resolved,
   * callers should retain the returned offset rather than recalculating it on
   * every empty poll.
   */
  latestOffset(topic: string, partition: number = 0, timeoutMs?: number): Promise<number> {
    return this.resolveConsumeOffset(topic, partition, false, undefined, timeoutMs);
  }

  // =========================================================================
  // Topic Management
  // =========================================================================

  /**
   * List all topics.
   *
   * @returns Array of topic names
   */
  async listTopics(): Promise<string[]> {
    const response = await this.graphql<{ topics: { name: string }[] }>(`
      query {
        topics {
          name
        }
      }
    `);

    return response.topics.map(t => t.name);
  }

  /**
   * Create a new topic.
   *
   * @param name - Topic name
   * @param options - Topic configuration
   */
  async createTopic(
    name: string,
    options: { partitions?: number; replicationFactor?: number; config?: Record<string, string> } = {}
  ): Promise<void> {
    const { partitions = 1, replicationFactor = 1 } = options;
    if (options.config !== undefined && Object.keys(options.config).length > 0) {
      throw new UnsupportedOperationError(
        'Streamline.createTopic config',
        'Streamline 0.3 accepts TopicConfig in GraphQL but does not persist or enforce it',
        'Create the topic without config and configure retention/message limits on a server release that enforces them',
      );
    }

    await this.graphql(`
      mutation CreateTopic(
        $name: String!,
        $partitions: Int!,
        $replicationFactor: Int!
      ) {
        createTopic(
          name: $name,
          partitions: $partitions,
          replicationFactor: $replicationFactor
        ) {
          name
        }
      }
    `, {
      name,
      partitions,
      replicationFactor,
    });
  }

  /**
   * Delete a topic.
   *
   * @param name - Topic name
   */
  async deleteTopic(name: string): Promise<void> {
    await this.graphql(`
      mutation DeleteTopic($name: String!) {
        deleteTopic(name: $name)
      }
    `, { name });
  }

  /**
   * Get topic information.
   *
   * @param name - Topic name
   * @returns Topic information or undefined if not found
   */
  async topicInfo(name: string): Promise<TopicInfo | undefined> {
    const response = await this.graphql<{ topic: WireTopic | null }>(`
      query Topic($name: String!) {
        topic(name: $name) {
          name
          partitions
          replicationFactor
          messageCount
          retentionMs
          createdAt
        }
      }
    `, { name });

    return response.topic ? this.normalizeTopic(response.topic) : undefined;
  }

  // =========================================================================
  // Consumer Groups
  // =========================================================================

  /**
   * List consumer groups.
   *
   * @returns Array of group IDs
   */
  async listConsumerGroups(): Promise<string[]> {
    const response = await this.graphql<{ consumerGroups: WireConsumerGroup[] }>(`
      query {
        consumerGroups {
          groupId
        }
      }
    `);

    return response.consumerGroups.map(g => g.groupId);
  }

  /**
   * Get consumer group information.
   *
   * @param groupId - Consumer group ID
   * @returns Consumer group information or undefined
   */
  async consumerGroupInfo(groupId: string): Promise<ConsumerGroupInfo | undefined> {
    const response = await this.graphql<{ consumerGroups: WireConsumerGroup[] }>(`
      query ConsumerGroups {
        consumerGroups {
          groupId
          state
          protocolType
          memberCount
        }
      }
    `);

    const group = response.consumerGroups.find((candidate) => candidate.groupId === groupId);
    return group ? this.normalizeConsumerGroup(group) : undefined;
  }

  /**
   * Commit consumer offsets for a group.
   *
   * @param groupId - Consumer group ID
   * @param offsets - Map of "topic:partition" to offset
   * @throws {UnsupportedOperationError} Always on Streamline 0.3 because its
   *   HTTP/GraphQL API exposes no commit mutation.
   */
  commitOffsets(
    groupId: string,
    offsets: Map<string, number>,
  ): Promise<void> {
    void groupId;
    void offsets;
    return Promise.reject(
      new UnsupportedOperationError(
        'Streamline.commitOffsets',
        'the Streamline 0.3 HTTP/GraphQL API exposes no offset-commit mutation',
        'Use the Kafka protocol with a Kafka client when durable consumer-group offsets are required',
      ),
    );
  }

  // =========================================================================
  // Admin Operations
  // =========================================================================

  /**
   * Alter topic configuration.
   *
   * @param name - Topic name
   * @param config - Configuration key-value pairs to set
   */
  alterTopicConfig(name: string, config: Record<string, string>): Promise<void> {
    void name;
    void config;
    return Promise.reject(
      new UnsupportedOperationError(
        'Streamline.alterTopicConfig',
        'Streamline 0.3 exposes no mutation that persists topic configuration',
        'Configure retention and message limits through server-side tooling',
      ),
    );
  }

  /**
   * Increase the number of partitions for a topic.
   *
   * @param name - Topic name
   * @param newTotal - New total number of partitions (must be greater than current)
   */
  createPartitions(name: string, newTotal: number): Promise<void> {
    if (newTotal < 1) {
      return Promise.reject(
        new StreamlineError('Partition count must be at least 1', 'INVALID_ARGUMENT'),
      );
    }
    void name;
    return Promise.reject(
      new UnsupportedOperationError(
        'Streamline.createPartitions',
        'Streamline 0.3 exposes no HTTP mutation for increasing partitions',
        'Choose the final partition count when creating the topic',
      ),
    );
  }

  /**
   * Delete a consumer group.
   *
   * @param groupId - Consumer group ID
   */
  deleteConsumerGroup(groupId: string): Promise<void> {
    void groupId;
    return Promise.reject(
      new UnsupportedOperationError(
        'Streamline.deleteConsumerGroup',
        'Streamline 0.3 exposes no HTTP mutation for deleting consumer groups',
        'Use the Kafka protocol or server-side administration tooling',
      ),
    );
  }

  /**
   * Reset consumer group offsets.
   *
   * @param groupId - Consumer group ID
   * @param topic - Topic name
   * @param options - Reset strategy
   * @throws {UnsupportedOperationError} After validating the strategy because
   *   Streamline 0.3 exposes no HTTP/GraphQL reset mutation.
   */
  resetConsumerGroupOffsets(
    groupId: string,
    topic: string,
    options: { toEarliest?: boolean; toLatest?: boolean; toOffset?: number; toDatetime?: Date }
  ): Promise<void> {
    return fromSync(() => {
      if (
        !options.toEarliest &&
        !options.toLatest &&
        options.toOffset === undefined &&
        options.toDatetime === undefined
      ) {
        throw new StreamlineError(
          'Must specify one of: toEarliest, toLatest, toOffset, toDatetime',
          'INVALID_ARGUMENT',
        );
      }

      void groupId;
      void topic;
      throw new UnsupportedOperationError(
        'Streamline.resetConsumerGroupOffsets',
        'the Streamline 0.3 HTTP/GraphQL API exposes no consumer-group offset reset mutation',
        'Use the Kafka protocol or a server release that explicitly provides an offset reset API',
      );
    });
  }

  /**
   * Get cluster information exposed by Streamline 0.3.
   */
  async describeCluster(): Promise<ClusterInfo> {
    const response = await this.graphql<{ clusterInfo: WireClusterInfo }>(`
      query {
        clusterInfo {
          nodeId
          version
          uptime
          topicCount
        }
      }
    `);
    return {
      ...response.clusterInfo,
      // Deprecated compatibility sentinels. Streamline 0.3 does not expose
      // cluster topology through this query, so these values are deliberately
      // neutral rather than fabricated from nodeId.
      clusterId: '',
      controller: -1,
      brokers: [],
    };
  }

  /**
   * Get broker configuration.
   *
   * @param brokerId - Broker ID
   * @returns Configuration key-value pairs
   */
  describeBrokerConfig(brokerId: number): Promise<Record<string, string>> {
    void brokerId;
    return Promise.reject(
      new UnsupportedOperationError(
        'Streamline.describeBrokerConfig',
        'Streamline 0.3 exposes no broker-configuration query',
        'Use server configuration files or server-side administration tooling',
      ),
    );
  }

  // =========================================================================
  // SQL Queries
  // =========================================================================

  /**
   * Execute a SQL query on stream data.
   *
   * @param sql - SQL query string
   * @returns Array of result rows
   */
  async query(sql: string): Promise<QueryRow[]> {
    const result = await this.queryFull(sql);
    return result.rows.map((row) => {
      const mapped: QueryRow = {};
      for (let index = 0; index < result.columns.length; index++) {
        mapped[result.columns[index].name] = row[index];
      }
      return mapped;
    });
  }

  /**
   * Execute a SQL query with full result metadata.
   */
  async queryFull(sql: string, options: { timeoutMs?: number; maxRows?: number } = {}): Promise<{
    columns: { name: string; type: string }[];
    rows: unknown[][];
    metadata: { execution_time_ms: number; rows_scanned: number; rows_returned: number; truncated: boolean };
  }> {
    const response = await this.request('/api/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql,
        timeout_ms: options.timeoutMs ?? 30000,
        max_rows: options.maxRows ?? 10000,
        format: 'json',
      }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new StreamlineError(`Query failed: ${error}`, 'QUERY_ERROR');
    }
    return response.json() as Promise<{
      columns: { name: string; type: string }[];
      rows: unknown[][];
      metadata: { execution_time_ms: number; rows_scanned: number; rows_returned: number; truncated: boolean };
    }>;
  }

  // =========================================================================
  // Internal Methods
  // =========================================================================

  /**
   * Perform an authenticated request against the broker's HTTP API.
   *
   * Applies the configured authentication headers, client id, abort signal and
   * circuit breaker. Exposed for first-party helpers such as {@link Admin} and
   * {@link Consumer}; prefer the typed operations on this class.
   *
   * @param path - Path appended to {@link Streamline.httpEndpoint}.
   * @param init - Standard `fetch` init. Any `signal` is replaced by the
   *   client-managed signal.
   * @param options - Optional per-request deadline.
   * @throws {TimeoutError} When `options.timeoutMs` elapses first.
   * @throws {ConnectionError} When the request cannot be completed.
   *
   * @internal
   */
  async request(
    path: string,
    init: RequestInit = {},
    options: RequestOptions = {},
  ): Promise<Response> {
    const url = `${this.options.httpEndpoint}${path}`;
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };
    const timeoutMs = options.timeoutMs ?? this.options.timeout;
    const deadline = timeoutMs !== undefined && timeoutMs > 0
      ? this.deadlineSignal(timeoutMs)
      : undefined;

    try {
      // First-class AuthConfig takes precedence over legacy sasl/apiKey. Token
      // acquisition shares the same total request deadline as the network call.
      if (this.options.auth) {
        const auth = this.options.auth;
        switch (auth.mechanism) {
          case 'PLAIN':
          case 'SCRAM-SHA-256':
          case 'SCRAM-SHA-512':
            headers['X-Sasl-Mechanism'] = auth.mechanism;
            headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`;
            break;
          case 'OAUTHBEARER': {
            const tokenPromise = auth.oauthBearerProvider();
            const token = deadline
              ? await this.awaitWithSignal(tokenPromise, deadline.signal)
              : await tokenPromise;
            headers['Authorization'] = `Bearer ${token.value}`;
            break;
          }
        }
      } else if (this.options.sasl) {
        const { mechanism, username, password } = this.options.sasl;
        headers['X-Sasl-Mechanism'] = mechanism;
        headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
      } else if (this.options.apiKey) {
        headers['Authorization'] = `Bearer ${this.options.apiKey}`;
      }

      if (this.options.clientId) {
        headers['X-Client-Id'] = this.options.clientId;
      }

      const doFetch = () => fetch(url, {
        ...init,
        headers,
        signal: deadline?.signal ?? this.abortController?.signal ?? null,
      });

      const response = this.cb
        ? await this.cb.execute(doFetch)
        : await doFetch();
      return await this.bufferResponse(response, deadline?.signal);
    } catch (error) {
      if (deadline?.timedOut === true) {
        throw new TimeoutError(`Request timed out after ${timeoutMs}ms: ${path}`);
      }
      throw new ConnectionError(
        `Request failed: ${path}`,
        error instanceof Error ? error : undefined
      );
    } finally {
      deadline?.dispose();
    }
  }

  /**
   * Await a promise while observing an abort signal.
   *
   * The underlying work may not itself support cancellation (for example, an
   * OAuth token provider), but callers still receive the configured deadline
   * instead of waiting forever.
   */
  private awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
    }

    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };

      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      }).catch(() => {
        // The chained promise only performs listener cleanup; the original
        // rejection is already forwarded through `reject`.
      });
    });
  }

  private async bufferResponse(
    response: Response,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    if (response.body === null) {
      return response;
    }

    const bodyPromise = response.arrayBuffer();
    const body = signal
      ? await this.awaitWithSignal(bodyPromise, signal)
      : await bodyPromise;

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private normalizeMessage(message: WireMessage): Message {
    let value: unknown = message.value;
    try {
      value = JSON.parse(message.value);
    } catch {
      // Non-JSON payloads remain strings.
    }

    return {
      topic: message.topic,
      partition: message.partition,
      offset: message.offset,
      ...(message.key !== undefined && message.key !== null ? { key: message.key } : {}),
      value,
      // Preserve the exact wire bytes (not a reserialized `value`) so
      // integrity checks such as StreamlineVerifier hash precisely what was
      // received, independent of JSON parsing/formatting.
      rawValue: Buffer.from(message.value, 'utf-8'),
      timestamp: this.parseWireTimestamp(message.timestamp),
      headers: message.headers,
    };
  }

  private normalizeProduceResult(result: WireProduceResult): ProduceResult {
    return {
      topic: result.topic,
      partition: result.partition,
      offset: result.offset,
      timestamp: this.parseWireTimestamp(result.timestamp),
    };
  }

  private normalizeTopic(topic: WireTopic): TopicInfo {
    return {
      name: topic.name,
      partitions: topic.partitions,
      partitionCount: topic.partitions,
      replicationFactor: topic.replicationFactor,
      messageCount: topic.messageCount,
      ...(topic.retentionMs !== undefined && topic.retentionMs !== null
        ? { retentionMs: topic.retentionMs }
        : {}),
      createdAt: topic.createdAt,
      // Deprecated compatibility sentinels. The current query has no size or
      // arbitrary configuration fields, but keeping these required members
      // avoids breaking callers compiled against the previous public shape.
      sizeBytes: 0,
      config: {},
    };
  }

  private normalizeConsumerGroup(group: WireConsumerGroup): ConsumerGroupInfo {
    return {
      ...group,
      // Deprecated compatibility sentinels: the current query exposes only
      // protocolType and memberCount, not assignment protocol/member details.
      protocol: '',
      members: [],
    };
  }

  private parseWireTimestamp(timestamp: string): number {
    const parsed = Date.parse(timestamp);
    if (!Number.isFinite(parsed)) {
      throw new StreamlineError(
        `Invalid timestamp returned by Streamline: ${timestamp}`,
        'GRAPHQL_ERROR',
      );
    }
    return parsed;
  }

  private async resolveConsumeOffset(
    topic: string,
    partition: number,
    fromBeginning: boolean,
    fromOffset: number | undefined,
    timeoutMs?: number,
  ): Promise<number> {
    if (fromOffset !== undefined) {
      return fromOffset;
    }
    if (fromBeginning) {
      return 0;
    }

    const response = await this.graphql<{
      topicStats: { partitions: { id: number; latestOffset: number }[] };
    }>(`
      query TopicLatestOffset($name: String!) {
        topicStats(name: $name) {
          partitions {
            id
            latestOffset
          }
        }
      }
    `, { name: topic }, { timeoutMs });
    return response.topicStats.partitions.find((item) => item.id === partition)?.latestOffset ?? 0;
  }

  /**
   * Build an abort signal that fires when either the client is closed or the
   * per-request deadline elapses.
   *
   * Implemented without `AbortSignal.any` so the package keeps working on the
   * declared Node 18 floor.
   */
  private deadlineSignal(timeoutMs: number): {
    signal: AbortSignal;
    timedOut: boolean;
    dispose: () => void;
  } {
    const controller = new AbortController();
    const clientSignal = this.abortController?.signal;
    const onClientAbort = (): void => controller.abort();

    const state = {
      signal: controller.signal,
      timedOut: false,
      dispose: (): void => {
        clearTimeout(timer);
        clientSignal?.removeEventListener('abort', onClientAbort);
      },
    };

    const timer = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, timeoutMs);

    if (clientSignal) {
      if (clientSignal.aborted) {
        controller.abort();
      } else {
        clientSignal.addEventListener('abort', onClientAbort, { once: true });
      }
    }

    return state;
  }

  private async graphql<T>(
    query: string,
    variables?: Record<string, unknown>,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.request('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    }, options);

    if (!response.ok) {
      const error = await response.text();
      throw new StreamlineError(`GraphQL request failed: ${error}`, 'GRAPHQL_ERROR');
    }

    const result = await response.json() as { data?: T; errors?: { message: string }[] };

    if (result.errors && result.errors.length > 0) {
      throw new StreamlineError(
        result.errors.map(e => e.message).join(', '),
        'GRAPHQL_ERROR'
      );
    }

    if (!result.data) {
      throw new StreamlineError('No data in GraphQL response', 'GRAPHQL_ERROR');
    }

    return result.data;
  }

  private rejectUnsupportedConsumeGroup(group: string | undefined): void {
    if (group === undefined) {
      return;
    }

    throw new UnsupportedOperationError(
      'ConsumeOptions.group',
      'the Streamline 0.3 HTTP/GraphQL messages query has no consumer-group argument',
      'Remove group and manage offsets in the application, or use the Kafka protocol for consumer groups',
    );
  }

  /**
   * Reconnect with exponential backoff after a lost connection.
   *
   * Checked against {@link Streamline.closed} before starting, before each
   * retry, and immediately after each backoff sleep, so an explicit
   * {@link Streamline.close} — which aborts the signal this method sleeps
   * on — cancels the loop right away instead of continuing to retry (or
   * worse, succeeding and silently resurrecting a client the caller asked
   * to shut down).
   */
  private async reconnect(): Promise<void> {
    this.assertNotClosed();

    let attempts = 0;
    let delay = this.options.reconnectDelay;

    while (attempts < this.options.maxReconnectAttempts) {
      attempts++;
      // Exponential backoff with jitter to prevent thundering herd
      const jitter = delay * 0.2 * Math.random();
      await this.interruptibleSleep(Math.min(delay + jitter, this.options.maxReconnectDelay));
      this.assertNotClosed();

      try {
        await this.connect();
        return;
      } catch {
        delay = Math.min(delay * 2, this.options.maxReconnectDelay);
      }
    }

    throw new ConnectionError(
      `Failed to reconnect after ${this.options.maxReconnectAttempts} attempts`
    );
  }

  /** @throws {ConnectionError} If the client was explicitly closed. */
  private assertNotClosed(): void {
    if (this.closed) {
      throw new ConnectionError('Reconnect cancelled: the client was closed');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Sleep for `ms` milliseconds, waking immediately (without throwing) if
   * the current connection's abort signal fires — in particular when
   * {@link Streamline.close} aborts it. Used for the idle-poll wait in
   * {@link Streamline.consume} and the backoff wait in
   * {@link Streamline.reconnect} so an explicit close never leaves either
   * loop sleeping out a stale delay before it notices.
   */
  private interruptibleSleep(ms: number): Promise<void> {
    const signal = this.abortController?.signal;
    if (signal === undefined) {
      return this.sleep(ms);
    }
    if (signal.aborted) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

/**
 * Typed wrapper for producing and consuming messages with compile-time type safety.
 *
 * @example
 * ```typescript
 * interface UserEvent {
 *   userId: string;
 *   action: 'login' | 'logout';
 *   timestamp: number;
 * }
 *
 * const typed = new TypedStreamline<UserEvent>(client, 'user-events');
 * await typed.produce({ userId: '123', action: 'login', timestamp: Date.now() });
 *
 * for await (const msg of typed.consume()) {
 *   console.log(msg.value.userId); // TypeScript knows this is string
 * }
 * ```
 */
export class TypedStreamline<T> {
  constructor(
    private client: Streamline,
    private topic: string,
  ) {}

  /** Produce a typed message. The value is JSON-serialized. */
  async produce(value: T, options: { key?: string; headers?: Record<string, string> } = {}): Promise<ProduceResult> {
    return this.client.produce(this.topic, value, options);
  }

  /** Consume typed messages. Values are parsed from JSON. */
  async *consume(options: ConsumeOptions = {}): AsyncGenerator<TypedMessage<T>> {
    for await (const msg of this.client.consume(this.topic, options)) {
      yield {
        ...msg,
        value: msg.value as T,
      };
    }
  }

  /** Consume a batch of typed messages. */
  async consumeBatch(options: ConsumeOptions = {}): Promise<TypedMessage<T>[]> {
    const messages = await this.client.consumeBatch(this.topic, options);
    return messages.map(msg => ({
      ...msg,
      value: msg.value as T,
    }));
  }
}

/** A message with a typed value. */
export interface TypedMessage<T> extends Omit<Message, 'value'> {
  value: T;
}
