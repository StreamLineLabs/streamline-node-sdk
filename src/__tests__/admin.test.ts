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

  describe('admin methods require server connection', () => {
    it('alterTopicConfig rejects without server', async () => {
      await expect(
        admin.alterTopicConfig('test', { 'retention.ms': '86400000' })
      ).rejects.toThrow();
    });

    it('createPartitions validates input', async () => {
      await expect(admin.createPartitions('test', 0)).rejects.toThrow(
        'Partition count must be at least 1'
      );
    });

    it('createPartitions rejects without server', async () => {
      await expect(admin.createPartitions('test', 6)).rejects.toThrow();
    });

    it('deleteConsumerGroup rejects without server', async () => {
      await expect(admin.deleteConsumerGroup('group')).rejects.toThrow();
    });

    it('resetConsumerGroupOffsets validates strategy', async () => {
      await expect(
        admin.resetConsumerGroupOffsets('group', 'topic', {})
      ).rejects.toThrow('Must specify one of');
    });

    it('resetConsumerGroupOffsets rejects without server', async () => {
      await expect(
        admin.resetConsumerGroupOffsets('group', 'topic', { toEarliest: true })
      ).rejects.toThrow();
    });

    it('describeBrokerConfig rejects without server', async () => {
      await expect(admin.describeBrokerConfig(0)).rejects.toThrow();
    });

    it('describeCluster rejects without server', async () => {
      await expect(admin.describeCluster()).rejects.toThrow();
    });
  });
});
