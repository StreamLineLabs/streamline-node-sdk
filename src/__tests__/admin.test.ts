import { describe, it, expect, beforeEach } from 'vitest';
import { Admin } from '../admin';
import { Streamline } from '../client';
import { StreamlineError } from '../types';

describe('Admin', () => {
  let mockClient: Streamline;
  let admin: Admin;

  beforeEach(() => {
    mockClient = new Streamline('localhost:9092');
    admin = new Admin(mockClient);
  });

  it('creates admin client', () => {
    expect(admin).toBeDefined();
  });

  describe('not-yet-implemented methods', () => {
    it('alterTopicConfig throws NOT_IMPLEMENTED', async () => {
      await expect(
        admin.alterTopicConfig('test', { 'retention.ms': '86400000' })
      ).rejects.toThrow(StreamlineError);
    });

    it('createPartitions throws NOT_IMPLEMENTED', async () => {
      await expect(admin.createPartitions('test', 6)).rejects.toThrow(
        StreamlineError
      );
    });

    it('deleteConsumerGroup throws NOT_IMPLEMENTED', async () => {
      await expect(admin.deleteConsumerGroup('group')).rejects.toThrow(
        StreamlineError
      );
    });

    it('resetConsumerGroupOffsets throws NOT_IMPLEMENTED', async () => {
      await expect(
        admin.resetConsumerGroupOffsets('group', 'topic', { toEarliest: true })
      ).rejects.toThrow(StreamlineError);
    });

    it('describeBrokerConfig throws NOT_IMPLEMENTED', async () => {
      await expect(admin.describeBrokerConfig(0)).rejects.toThrow(
        StreamlineError
      );
    });
  });

  describe('describeCluster', () => {
    it('returns cluster info', async () => {
      const info = await admin.describeCluster();
      expect(info).toBeDefined();
      expect(info.clusterId).toBe('streamline');
      expect(info.brokers).toHaveLength(1);
    });
  });
});
