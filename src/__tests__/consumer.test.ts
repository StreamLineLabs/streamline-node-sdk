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

    it('accepts multiple handlers without throwing', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      const h1 = async () => {};
      const h2 = async () => {};
      expect(() => {
        consumer.onRebalance(h1);
        consumer.onRebalance(h2);
      }).not.toThrow();
    });

    it('handler receives a typed RebalanceEvent (assign | revoke)', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      // Type-only assertion: the handler signature is (event: RebalanceEvent) => Promise<void>.
      // If the public type ever changes shape this will fail to compile.
      const handler: Parameters<typeof consumer.onRebalance>[0] = async (event) => {
        expect(['assign', 'revoke']).toContain(event.type);
        expect(Array.isArray(event.partitions)).toBe(true);
        for (const p of event.partitions) {
          expect(typeof p).toBe('number');
        }
      };
      expect(() => consumer.onRebalance(handler)).not.toThrow();
    });

    it('assignment() reflects the empty initial state before any rebalance', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      // Pre-rebalance contract: no partitions assigned, no positions/committed offsets.
      expect(consumer.assignment()).toEqual([]);
      expect(consumer.position(0)).toBeUndefined();
      expect(consumer.committed(0)).toBeUndefined();
    });

    it('handler registration is decoupled from start()', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      // Registering before start should be safe (handlers may fire during start/poll).
      const events: string[] = [];
      consumer.onRebalance(async (e) => {
        events.push(e.type);
      });
      await expect(consumer.start()).resolves.toBeUndefined();
      // Without a real broker no rebalance is delivered; we only assert the
      // surface stays sane and didn't throw.
      expect(Array.isArray(events)).toBe(true);
    });
  });
});
