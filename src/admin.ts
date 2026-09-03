/**
 * Admin client for managing topics, consumer groups, and cluster.
 */

import { Streamline } from './client';
import { TopicInfo, ConsumerGroupInfo, ClusterInfo, BranchInfo, StreamlineError, validateTopicName } from './types';
import { coerceNumber, coerceString, isRecord, toRecordArray } from './internal/guards';

/**
 * Wire shape of a branch object returned by `/api/v1/branches`.
 */
interface BranchWire {
  name?: unknown;
  base_topic?: unknown;
  state?: unknown;
  created_at?: unknown;
}

/**
 * Map a `/api/v1/branches` payload entry onto the public {@link BranchInfo}
 * shape, applying defaults for fields the broker omits.
 */
function toBranchInfo(wire: BranchWire, defaults: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: coerceString(wire.name, defaults.name ?? ''),
    baseTopic: coerceString(wire.base_topic, defaults.baseTopic ?? ''),
    state: coerceString(wire.state, defaults.state ?? 'active'),
    createdAt: coerceNumber(wire.created_at, defaults.createdAt ?? 0),
  };
}

/**
 * Topic configuration.
 */
export interface TopicConfig {
  /** Number of partitions */
  partitions?: number;
  /** Replication factor */
  replicationFactor?: number;
  /**
   * Additional configuration.
   *
   * @deprecated Streamline 0.3 accepts but does not persist these values, so a
   * non-empty object throws `UnsupportedOperationError`.
   */
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
 * console.log(`Partitions: ${info?.partitions}`);
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
   * @throws {UnsupportedOperationError} Streamline 0.3 exposes no alter
   *   configuration mutation.
   */
  async alterTopicConfig(name: string, config: Record<string, string>): Promise<void> {
    await this.client.alterTopicConfig(name, config);
  }

  /**
   * Increase the number of partitions.
   *
   * @param name - Topic name
   * @param newTotal - New total number of partitions
   * @throws {UnsupportedOperationError} Streamline 0.3 exposes no partition
   *   expansion mutation.
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
   * @throws {UnsupportedOperationError} Streamline 0.3 exposes no group
   *   deletion mutation.
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
   * @throws {UnsupportedOperationError} Streamline 0.3 exposes no HTTP offset
   *   reset operation.
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
   * @throws {UnsupportedOperationError} Streamline 0.3 exposes no broker
   *   configuration query.
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
   * Sent through the client's authenticated request path, so SASL/API-key
   * headers, the client id, the abort signal and the circuit breaker all apply.
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
    const resp = await this.client.request('/api/v1/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new StreamlineError(`Failed to create branch: HTTP ${resp.status}: ${text}`);
    }
    const data: unknown = await resp.json();
    const wire: BranchWire = isRecord(data) ? data : {};
    return toBranchInfo(wire, { name, baseTopic, state: 'active', createdAt: 0 });
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
    const resp = await this.client.request(path);
    if (!resp.ok) {
      const text = await resp.text();
      throw new StreamlineError(`Failed to list branches: HTTP ${resp.status}: ${text}`);
    }
    const data: unknown = await resp.json();
    const items = Array.isArray(data) ? data : (isRecord(data) ? data['items'] : []);
    return toRecordArray(items).map((branch) => toBranchInfo(branch));
  }

  /**
   * Discard (delete) a copy-on-write topic branch.
   *
   * @param branchId - Branch identifier
   */
  async discardBranch(branchId: string): Promise<void> {
    const resp = await this.client.request(
      `/api/v1/branches/${encodeURIComponent(branchId)}`,
      { method: 'DELETE' },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new StreamlineError(`Failed to discard branch: HTTP ${resp.status}: ${text}`);
    }
  }
}
