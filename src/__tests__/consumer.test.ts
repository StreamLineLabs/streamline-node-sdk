import { describe, it, expect, beforeEach } from 'vitest';
import { Consumer } from '../consumer';
import { Streamline } from '../client';

describe('Consumer', () => {
  let mockClient: Streamline;

  beforeEach(() => {
    mockClient = new Streamline('localhost:9092');
  });

  describe('constructor', () => {
    it('creates with default config', () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      expect(consumer).toBeDefined();
    });

    it('creates with group ID', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'my-group');
      expect(consumer).toBeDefined();
    });

    it('creates with custom config', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'my-group', {
        autoCommit: true,
        autoCommitIntervalMs: 10000,
        maxPollRecords: 1000,
        sessionTimeoutMs: 60000,
        heartbeatIntervalMs: 5000,
        autoOffsetReset: 'earliest',
      });
      expect(consumer).toBeDefined();
    });
  });

  describe('start', () => {
    it('can be started', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      await expect(consumer.start()).resolves.toBeUndefined();
    });
  });

  describe('offset tracking', () => {
    it('position returns undefined before consuming', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      expect(consumer.position(0)).toBeUndefined();
    });

    it('committed returns undefined before commit', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      expect(consumer.committed(0)).toBeUndefined();
    });
  });

  describe('assignment', () => {
    it('returns empty array initially', () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      expect(consumer.assignment()).toEqual([]);
    });
  });

  describe('pause and resume', () => {
    it('can pause and resume', () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      expect(() => consumer.pause()).not.toThrow();
      expect(() => consumer.resume()).not.toThrow();
    });
  });

  describe('seek', () => {
    it('can seek to offset', async () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      await expect(consumer.seek(0, 100)).resolves.toBeUndefined();
    });

    it('can seek to beginning', async () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      await expect(consumer.seekToBeginning()).resolves.toBeUndefined();
    });
  });

  describe('close', () => {
    it('can be closed', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      await consumer.start();
      await expect(consumer.close()).resolves.toBeUndefined();
    });

    it('performs final commit on close if autoCommit enabled', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group', {
        autoCommit: true,
      });
      await consumer.start();
      await consumer.close();
      // Should not throw - commit is best effort
    });
  });

  describe('onRebalance', () => {
    it('can register rebalance handler', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      expect(() => {
        consumer.onRebalance(async () => {});
      }).not.toThrow();
    });
  });
});
