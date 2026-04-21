/**
 * Admin client for managing topics, consumer groups, and cluster.
 */

import { Streamline } from './client';
import { TopicInfo, ConsumerGroupInfo, ClusterInfo, BranchInfo, StreamlineError, validateTopicName } from './types';

/**
 * Topic configuration.
 */
export interface TopicConfig {
  /** Number of partitions */
  partitions?: number;
  /** Replication factor */
  replicationFactor?: number;
  /** Additional configuration */
  config?: Record<string, string>;
}

/**
 * Admin client for cluster management operations.
 *
 * @example
 * ```typescript
 * const admin = new Admin(client);
 *
 * // List topics
 * const topics = await admin.listTopics();
 *
 * // Create topic
 * await admin.createTopic('events', { partitions: 3 });
 *
 * // Describe topic
 * const info = await admin.describeTopic('events');
 * console.log(`Partitions: ${info?.partitionCount}`);
 *
 * // Delete topic
 * await admin.deleteTopic('events');
 * ```
 */
export class Admin {
  private client: Streamline;

  /**
   * Create a new admin client.
   *
   * @param client - Streamline client
   */
  constructor(client: Streamline) {
    this.client = client;
  }

  private get httpUrl(): string {
    return (this.client as any).options?.httpEndpoint ?? 'http://localhost:9094';
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
    return this.client.listTopics();
  }

  /**
   * Create a new topic.
   *
   * @param name - Topic name
   * @param config - Topic configuration
   */
  async createTopic(name: string, config: TopicConfig = {}): Promise<void> {
    validateTopicName(name);
    await this.client.createTopic(name, {
      ...(config.partitions !== undefined && { partitions: config.partitions }),
      ...(config.replicationFactor !== undefined && { replicationFactor: config.replicationFactor }),
      ...(config.config !== undefined && { config: config.config }),
    });
  }

  /**
   * Delete a topic.
   *
   * @param name - Topic name
   */
  async deleteTopic(name: string): Promise<void> {
    validateTopicName(name);
    await this.client.deleteTopic(name);
  }

  /**
   * Get detailed topic information.
   *
   * @param name - Topic name
   * @returns TopicInfo or undefined if not found
   */
  async describeTopic(name: string): Promise<TopicInfo | undefined> {
    return this.client.topicInfo(name);
  }

  /**
   * Alter topic configuration.
   *
   * @param name - Topic name
   * @param config - Configuration changes
   */
  async alterTopicConfig(name: string, config: Record<string, string>): Promise<void> {
    await this.client.alterTopicConfig(name, config);
  }

  /**
   * Increase the number of partitions.
   *
   * @param name - Topic name
   * @param newTotal - New total number of partitions
   */
  async createPartitions(name: string, newTotal: number): Promise<void> {
    await this.client.createPartitions(name, newTotal);
  }

  // =========================================================================
  // Consumer Group Management
  // =========================================================================

  /**
   * List all consumer groups.
   *
   * @returns Array of group IDs
   */
  async listConsumerGroups(): Promise<string[]> {
    return this.client.listConsumerGroups();
  }

  /**
   * Get detailed consumer group information.
   *
   * @param groupId - Consumer group ID
   * @returns ConsumerGroupInfo or undefined if not found
   */
  async describeConsumerGroup(groupId: string): Promise<ConsumerGroupInfo | undefined> {
    return this.client.consumerGroupInfo(groupId);
  }

  /**
   * Delete a consumer group.
   *
   * @param groupId - Consumer group ID
   */
  async deleteConsumerGroup(groupId: string): Promise<void> {
    await this.client.deleteConsumerGroup(groupId);
  }

  /**
   * Reset consumer group offsets.
   *
   * @param groupId - Consumer group ID
   * @param topic - Topic name
   * @param options - Reset options
   */
  async resetConsumerGroupOffsets(
    groupId: string,
    topic: string,
    options: {
      toEarliest?: boolean;
      toLatest?: boolean;
      toOffset?: number;
      toDatetime?: Date;
    }
  ): Promise<void> {
    await this.client.resetConsumerGroupOffsets(groupId, topic, options);
  }

  // =========================================================================
  // Cluster Management
  // =========================================================================

  /**
   * Get cluster information.
   *
   * @returns Cluster information
   */
  async describeCluster(): Promise<ClusterInfo> {
    const result = await this.client.describeCluster();
    return result;
  }

  /**
   * Get broker configuration.
   *
   * @param brokerId - Broker ID
   * @returns Broker configuration
   */
  async describeBrokerConfig(brokerId: number): Promise<Record<string, string>> {
    return this.client.describeBrokerConfig(brokerId);
  }

  // =========================================================================
  // Branch Management (M5, Experimental)
  // =========================================================================

  /**
   * Create a copy-on-write branch of a topic.
   *
   * @param name - Branch name
   * @param baseTopic - Topic to branch from
   * @param baseOffsets - Per-partition base offsets (optional)
   * @returns Branch information
   */
  async createBranch(
    name: string,
    baseTopic: string,
    baseOffsets?: Record<number, number>,
  ): Promise<BranchInfo> {
    const body: Record<string, unknown> = { name, base_topic: baseTopic };
    if (baseOffsets) {
      body['base_offsets'] = baseOffsets;
    }
    const resp = await fetch(`${this.httpUrl}/api/v1/branches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new StreamlineError(`Failed to create branch: HTTP ${resp.status}: ${text}`);
    }
    const data = await resp.json() as Record<string, unknown>;
    return {
      name: (data['name'] as string) ?? name,
      baseTopic: (data['base_topic'] as string) ?? baseTopic,
      state: (data['state'] as string) ?? 'active',
      createdAt: Number(data['created_at'] ?? 0),
    };
  }

  /**
   * List copy-on-write topic branches.
   *
   * @param topic - Filter by base topic (optional)
   * @returns Array of branch info objects
   */
  async listBranches(topic?: string): Promise<BranchInfo[]> {
    let path = '/api/v1/branches';
    if (topic) {
      path += `?topic=${encodeURIComponent(topic)}`;
    }
    const resp = await fetch(`${this.httpUrl}${path}`);
    if (!resp.ok) {
      const text = await resp.text();
      throw new StreamlineError(`Failed to list branches: HTTP ${resp.status}: ${text}`);
    }
    const data = await resp.json() as Record<string, unknown>;
    const items: unknown[] = Array.isArray(data) ? data : ((data['items'] as unknown[]) ?? []);
    return items.map((b: any) => ({
      name: String(b.name ?? ''),
      baseTopic: String(b.base_topic ?? ''),
      state: String(b.state ?? 'active'),
      createdAt: Number(b.created_at ?? 0),
    }));
  }

  /**
   * Discard (delete) a copy-on-write topic branch.
   *
   * @param branchId - Branch identifier
   */
  async discardBranch(branchId: string): Promise<void> {
    const resp = await fetch(
      `${this.httpUrl}/api/v1/branches/${encodeURIComponent(branchId)}`,
      { method: 'DELETE' },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new StreamlineError(`Failed to discard branch: HTTP ${resp.status}: ${text}`);
    }
  }
}
