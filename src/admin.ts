/**
 * Admin client for managing topics, consumer groups, and cluster.
 */

import { Streamline } from './client';
import { TopicInfo, ConsumerGroupInfo, ClusterInfo, StreamlineError } from './types';

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
    await this.client.createTopic(name, {
      partitions: config.partitions,
      replicationFactor: config.replicationFactor,
      config: config.config,
    });
  }

  /**
   * Delete a topic.
   *
   * @param name - Topic name
   */
  async deleteTopic(name: string): Promise<void> {
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
}
