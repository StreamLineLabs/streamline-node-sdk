/**
 * Main Streamline client for Node.js
 */

import {
  Message,
  ProduceRecord,
  ProduceResult,
  TopicInfo,
  ConsumerGroupInfo,
  QueryRow,
  StreamlineError,
  ConnectionError,
} from './types';

/**
 * TLS configuration for secure connections.
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
 */
/**
 * Sanitizes and validates a broker list, removing duplicates and empty entries.
 */
function sanitizeBrokerList(brokers: string[]): string[] {
  const cleaned = brokers
    .map(b => b.trim())
    .filter(b => b.length > 0);
  
  if (cleaned.length === 0) {
    throw new ConnectionError('At least one broker address is required');
  }
  
  return [...new Set(cleaned)];
}

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
  /** Client identifier */
  clientId?: string;
  /** API key for authentication */
  apiKey?: string;
  /** TLS configuration (true for defaults, or TlsOptions for custom) */
  tls?: boolean | TlsOptions;
  /** SASL authentication configuration */
  sasl?: SaslOptions;
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
}

/**
 * Consume options.
 */
export interface ConsumeOptions {
  /** Consumer group ID */
  group?: string;
  /** Start from beginning of topic */
  fromBeginning?: boolean;
  /** Start from specific offset */
  fromOffset?: number;
  /** Maximum messages to fetch per poll */
  maxMessages?: number;
  /** Poll timeout in milliseconds */
  pollTimeout?: number;
}

/**
 * Main Streamline client.
 *
 * @example
 * ```typescript
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
 */
export class Streamline {
  private options: Omit<Required<StreamlineOptions>, 'sasl'> & { sasl?: SaslOptions };
  private connected: boolean = false;
  private abortController?: AbortController;

  /**
   * Create a new Streamline client.
   *
   * @param bootstrapServers - Comma-separated list of broker addresses
   * @param options - Client configuration options
   */
  constructor(_bootstrapServers: string, options: StreamlineOptions = {}) {
    this.options = {
      httpEndpoint: options.httpEndpoint ?? process.env['STREAMLINE_URL'] ?? 'http://localhost:9094',
      clientId: options.clientId ?? 'streamline-nodejs',
      apiKey: options.apiKey ?? '',
      tls: options.tls ?? false,
      ...(options.sasl ? { sasl: options.sasl } : {}),
      timeout: options.timeout ?? 30000,
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
      reconnectDelay: options.reconnectDelay ?? 1000,
      maxReconnectDelay: options.maxReconnectDelay ?? 30000,
    };
  }

  /**
   * Connect to the Streamline cluster.
   */
  async connect(): Promise<void> {
    this.abortController = new AbortController();

    try {
      // Test connection with health check
      const response = await this.request('/health', { method: 'GET' });
      if (!response.ok) {
        throw new ConnectionError(`Health check failed: ${response.statusText}`);
      }
      this.connected = true;
    } catch (error) {
      throw new ConnectionError(
        `Failed to connect to ${this.options.httpEndpoint}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Close the client connection.
   */
  async close(): Promise<void> {
    this.connected = false;
    this.abortController?.abort();
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
    const response = await this.graphql<{ produce: ProduceResult }>(`
      mutation Produce($topic: String!, $messages: [MessageInput!]!) {
        produce(topic: $topic, messages: $messages) {
          topic
          partition
          offset
          timestamp
        }
      }
    `, {
      topic,
      messages: [{
        value: typeof value === 'string' ? value : JSON.stringify(value),
        key: options.key,
        partition: options.partition,
        headers: options.headers
          ? Object.entries(options.headers).map(([k, v]) => ({ key: k, value: v }))
          : undefined,
      }],
    });

    return response.produce;
  }

  /**
   * Produce multiple messages to a topic.
   *
   * @param topic - Topic name
   * @param records - Array of records to produce
   * @returns Array of produce results
   */
  async produceBatch(topic: string, records: ProduceRecord[], options?: { compression?: string }): Promise<ProduceResult[]> {
    const compression = options?.compression ?? 'none';
    const response = await this.graphql<{ produceBatch: ProduceResult[] }>(`
      mutation ProduceBatch($topic: String!, $messages: [MessageInput!]!, $compression: String) {
        produceBatch(topic: $topic, messages: $messages, compression: $compression) {
          topic
          partition
          offset
          timestamp
        }
      }
    `, {
      topic,
      compression: compression !== 'none' ? compression : undefined,
      messages: records.map(r => ({
        value: typeof r.value === 'string' ? r.value : JSON.stringify(r.value),
        key: r.key,
        partition: r.partition,
        headers: r.headers
          ? Object.entries(r.headers).map(([k, v]) => ({ key: k, value: v }))
          : undefined,
      })),
    });

    return response.produceBatch;
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
    const { group, fromBeginning = false, fromOffset, maxMessages = 100, pollTimeout = 5000 } = options;

    let currentOffset = fromOffset ?? (fromBeginning ? 0 : undefined);

    while (this.connected) {
      try {
        const response = await this.graphql<{ messages: Message[] }>(`
          query Messages($topic: String!, $partition: Int, $offset: Int, $limit: Int, $group: String) {
            messages(topic: $topic, partition: $partition, offset: $offset, limit: $limit, group: $group) {
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
          offset: currentOffset,
          limit: maxMessages,
          group: group ?? undefined,
        });

        const messages = response.messages;

        if (messages.length === 0) {
          // No new messages, wait before polling again
          await this.sleep(pollTimeout);
          continue;
        }

        for (const msg of messages) {
          // Parse JSON value if possible
          let value = msg.value;
          if (typeof value === 'string') {
            try {
              value = JSON.parse(value);
            } catch {
              // Keep as string
            }
          }

          yield {
            ...msg,
            value,
          };

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
   * @param options - Consume options including maxMessages
   * @returns Array of messages
   */
  async consumeBatch(topic: string, options: ConsumeOptions = {}): Promise<Message[]> {
    const { fromBeginning = false, fromOffset, maxMessages = 100 } = options;
    const offset = fromOffset ?? (fromBeginning ? 0 : undefined);

    const response = await this.graphql<{ messages: Message[] }>(`
      query Messages($topic: String!, $offset: Int, $limit: Int) {
        messages(topic: $topic, offset: $offset, limit: $limit) {
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
      offset,
      limit: maxMessages,
    });

    return response.messages.map(msg => {
      let value = msg.value;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch {
          // Keep as string
        }
      }
      return { ...msg, value };
    });
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

    await this.graphql(`
      mutation CreateTopic($name: String!, $partitions: Int!, $replicationFactor: Int!) {
        createTopic(name: $name, partitions: $partitions, replicationFactor: $replicationFactor)
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
    const response = await this.graphql<{ topic: TopicInfo | null }>(`
      query Topic($name: String!) {
        topic(name: $name) {
          name
          partitionCount
          replicationFactor
          messageCount
          sizeBytes
        }
      }
    `, { name });

    return response.topic ?? undefined;
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
    const response = await this.graphql<{ consumerGroups: { groupId: string }[] }>(`
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
    const response = await this.graphql<{ consumerGroup: ConsumerGroupInfo | null }>(`
      query ConsumerGroup($groupId: String!) {
        consumerGroup(groupId: $groupId) {
          groupId
          state
          protocolType
          protocol
          members {
            memberId
            clientId
            clientHost
            partitions
          }
        }
      }
    `, { groupId });

    return response.consumerGroup ?? undefined;
  }

  /**
   * Commit consumer offsets for a group.
   *
   * @param groupId - Consumer group ID
   * @param offsets - Map of "topic:partition" to offset
   */
  async commitOffsets(
    groupId: string,
    offsets: Map<string, number>,
  ): Promise<void> {
    const offsetEntries = Array.from(offsets.entries()).map(([key, offset]) => {
      const [topic, partition] = key.split(':');
      return { topic, partition: parseInt(partition, 10), offset };
    });

    await this.graphql(`
      mutation CommitOffsets($groupId: String!, $offsets: [OffsetCommitInput!]!) {
        commitOffsets(groupId: $groupId, offsets: $offsets)
      }
    `, { groupId, offsets: offsetEntries });
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
  async alterTopicConfig(name: string, config: Record<string, string>): Promise<void> {
    const configEntries = Object.entries(config).map(([key, value]) => ({ key, value }));
    await this.graphql(`
      mutation AlterTopicConfig($name: String!, $config: [ConfigEntryInput!]!) {
        alterTopicConfig(name: $name, config: $config)
      }
    `, { name, config: configEntries });
  }

  /**
   * Increase the number of partitions for a topic.
   *
   * @param name - Topic name
   * @param newTotal - New total number of partitions (must be greater than current)
   */
  async createPartitions(name: string, newTotal: number): Promise<void> {
    if (newTotal < 1) {
      throw new StreamlineError('Partition count must be at least 1', 'INVALID_ARGUMENT');
    }
    await this.graphql(`
      mutation CreatePartitions($name: String!, $newTotal: Int!) {
        createPartitions(name: $name, totalCount: $newTotal)
      }
    `, { name, newTotal });
  }

  /**
   * Delete a consumer group.
   *
   * @param groupId - Consumer group ID
   */
  async deleteConsumerGroup(groupId: string): Promise<void> {
    await this.graphql(`
      mutation DeleteConsumerGroup($groupId: String!) {
        deleteConsumerGroup(groupId: $groupId)
      }
    `, { groupId });
  }

  /**
   * Reset consumer group offsets.
   *
   * @param groupId - Consumer group ID
   * @param topic - Topic name
   * @param options - Reset strategy
   */
  async resetConsumerGroupOffsets(
    groupId: string,
    topic: string,
    options: { toEarliest?: boolean; toLatest?: boolean; toOffset?: number; toDatetime?: Date }
  ): Promise<void> {
    let strategy: string;
    let value: string | undefined;

    if (options.toEarliest) {
      strategy = 'EARLIEST';
    } else if (options.toLatest) {
      strategy = 'LATEST';
    } else if (options.toOffset !== undefined) {
      strategy = 'TO_OFFSET';
      value = String(options.toOffset);
    } else if (options.toDatetime) {
      strategy = 'TO_DATETIME';
      value = options.toDatetime.toISOString();
    } else {
      throw new StreamlineError('Must specify one of: toEarliest, toLatest, toOffset, toDatetime', 'INVALID_ARGUMENT');
    }

    await this.graphql(`
      mutation ResetOffsets($groupId: String!, $topic: String!, $strategy: String!, $value: String) {
        resetConsumerGroupOffsets(groupId: $groupId, topic: $topic, strategy: $strategy, value: $value)
      }
    `, { groupId, topic, strategy, value });
  }

  /**
   * Get cluster information including brokers and controller.
   */
  async describeCluster(): Promise<{ clusterId: string; controller: number; brokers: { id: number; host: string; port: number }[] }> {
    const response = await this.graphql<{
      cluster: { clusterId: string; controller: number; brokers: { id: number; host: string; port: number }[] };
    }>(`
      query {
        cluster {
          clusterId
          controller
          brokers {
            id
            host
            port
          }
        }
      }
    `);
    return response.cluster;
  }

  /**
   * Get broker configuration.
   *
   * @param brokerId - Broker ID
   * @returns Configuration key-value pairs
   */
  async describeBrokerConfig(brokerId: number): Promise<Record<string, string>> {
    const response = await this.graphql<{
      brokerConfig: { key: string; value: string }[];
    }>(`
      query BrokerConfig($brokerId: Int!) {
        brokerConfig(brokerId: $brokerId) {
          key
          value
        }
      }
    `, { brokerId });

    const config: Record<string, string> = {};
    for (const { key, value } of response.brokerConfig) {
      config[key] = value;
    }
    return config;
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
    const response = await this.request('/api/v1/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new StreamlineError(`Query failed: ${error}`, 'QUERY_ERROR');
    }

    return response.json() as Promise<QueryRow[]>;
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

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.options.httpEndpoint}${path}`;
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };

    if (this.options.sasl) {
      const { mechanism, username, password } = this.options.sasl;
      headers['X-Sasl-Mechanism'] = mechanism;
      headers['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    } else if (this.options.apiKey) {
      headers['Authorization'] = `Bearer ${this.options.apiKey}`;
    }

    if (this.options.clientId) {
      headers['X-Client-Id'] = this.options.clientId;
    }

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: this.abortController?.signal ?? null,
      });
      return response;
    } catch (error) {
      throw new ConnectionError(
        `Request failed: ${path}`,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await this.request('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });

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

  private async reconnect(): Promise<void> {
    let attempts = 0;
    let delay = this.options.reconnectDelay;

    while (attempts < this.options.maxReconnectAttempts) {
      attempts++;
      // Exponential backoff with jitter to prevent thundering herd
      const jitter = delay * 0.2 * Math.random();
      await this.sleep(Math.min(delay + jitter, this.options.maxReconnectDelay));

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

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
