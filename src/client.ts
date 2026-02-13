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
  Header,
} from './types';

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
  /** Enable TLS */
  tls?: boolean;
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
  private bootstrapServers: string;
  private options: Required<StreamlineOptions>;
  private connected: boolean = false;
  private abortController?: AbortController;

  /**
   * Create a new Streamline client.
   *
   * @param bootstrapServers - Comma-separated list of broker addresses
   * @param options - Client configuration options
   */
  constructor(bootstrapServers: string, options: StreamlineOptions = {}) {
    this.bootstrapServers = bootstrapServers;
    this.options = {
      httpEndpoint: options.httpEndpoint ?? 'http://localhost:9094',
      clientId: options.clientId ?? 'streamline-nodejs',
      apiKey: options.apiKey ?? '',
      tls: options.tls ?? false,
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
  async produceBatch(topic: string, records: ProduceRecord[]): Promise<ProduceResult[]> {
    const response = await this.graphql<{ produceBatch: ProduceResult[] }>(`
      mutation ProduceBatch($topic: String!, $messages: [MessageInput!]!) {
        produceBatch(topic: $topic, messages: $messages) {
          topic
          partition
          offset
          timestamp
        }
      }
    `, {
      topic,
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
    const { fromBeginning = false, fromOffset, maxMessages = 100, pollTimeout = 5000 } = options;

    let currentOffset = fromOffset ?? (fromBeginning ? 0 : undefined);

    while (this.connected) {
      try {
        const response = await this.graphql<{ messages: Message[] }>(`
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
          offset: currentOffset,
          limit: maxMessages,
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
    const response = await this.request('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new StreamlineError(`Query failed: ${error}`, 'QUERY_ERROR');
    }

    return response.json();
  }

  // =========================================================================
  // Internal Methods
  // =========================================================================

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.options.httpEndpoint}${path}`;
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string>),
    };

    if (this.options.apiKey) {
      headers['Authorization'] = `Bearer ${this.options.apiKey}`;
    }

    if (this.options.clientId) {
      headers['X-Client-Id'] = this.options.clientId;
    }

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: this.abortController?.signal,
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
