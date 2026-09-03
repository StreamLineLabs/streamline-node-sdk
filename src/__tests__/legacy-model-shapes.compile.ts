import type { ClusterInfo, ConsumerGroupInfo, TopicInfo } from '../types';

// Exact public object shapes accepted before the current HTTP metadata fields
// were introduced. This file is compiled by `npm run typecheck:tests`.
export const legacyTopicInfo: TopicInfo = {
  name: 'events',
  partitionCount: 3,
  replicationFactor: 1,
  messageCount: 42,
  sizeBytes: 1024,
  config: { 'retention.ms': '60000' },
};

export const legacyConsumerGroupInfo: ConsumerGroupInfo = {
  groupId: 'orders',
  state: 'STABLE',
  protocolType: 'consumer',
  protocol: 'range',
  members: [{
    memberId: 'member-1',
    clientId: 'client-1',
    clientHost: 'localhost',
    partitions: [0],
  }],
};

export const legacyClusterInfo: ClusterInfo = {
  clusterId: 'cluster-1',
  controller: 0,
  brokers: [{ id: 0, host: 'localhost', port: 9092 }],
};
