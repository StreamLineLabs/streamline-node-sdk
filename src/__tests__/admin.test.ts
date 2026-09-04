import { describe, it, expect, beforeEach } from 'vitest';
import { Admin } from '../admin';
import { Streamline } from '../client';
import { UnsupportedOperationError } from '../types';

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

  describe('admin methods require server connection', () => {
    it('alterTopicConfig rejects explicitly when absent from the server schema', async () => {
      await expect(
        admin.alterTopicConfig('test', { 'retention.ms': '86400000' })
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
    });

    it('createPartitions validates input', async () => {
      await expect(admin.createPartitions('test', 0)).rejects.toThrow(
        'Partition count must be at least 1'
      );
    });

    it('createPartitions rejects explicitly when absent from the server schema', async () => {
      await expect(admin.createPartitions('test', 6)).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
    });

    it('deleteConsumerGroup rejects explicitly when absent from the server schema', async () => {
      await expect(admin.deleteConsumerGroup('group')).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
    });

    it('resetConsumerGroupOffsets validates strategy', async () => {
      await expect(
        admin.resetConsumerGroupOffsets('group', 'topic', {})
      ).rejects.toThrow('Must specify one of');
    });

    it('resetConsumerGroupOffsets rejects explicitly when the server API lacks it', async () => {
      await expect(
        admin.resetConsumerGroupOffsets('group', 'topic', { toEarliest: true })
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
    });

    it('describeBrokerConfig rejects explicitly when absent from the server schema', async () => {
      await expect(admin.describeBrokerConfig(0)).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
    });

    it('describeCluster rejects without server', async () => {
      await expect(admin.describeCluster()).rejects.toThrow();
    });
  });
});
