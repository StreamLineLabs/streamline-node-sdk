import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Consumer } from '../consumer';
import { Streamline } from '../client';
import { UnsupportedOperationError, StreamlineError } from '../types';
import type { TopicInfo } from '../types';

function singlePartitionTopic(name = 'test-topic'): TopicInfo {
  return {
    name,
    partitions: 1,
    partitionCount: 1,
    replicationFactor: 1,
    messageCount: 0,
    createdAt: new Date(0).toISOString(),
    sizeBytes: 0,
    config: {},
  };
}

describe('Consumer', () => {
  let mockClient: Streamline;

  beforeEach(() => {
    mockClient = new Streamline('localhost:9092');
    // Default to a single-partition topic so existing partition-0 behaviour
    // is preserved without every test needing to mock topic discovery.
    // Multi-partition-specific tests override this per-test.
    vi.spyOn(mockClient, 'topicInfo').mockResolvedValue(singlePartitionTopic());
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
        autoCommit: false,
        maxPollRecords: 1000,
        autoOffsetReset: 'earliest',
      });
      expect(consumer).toBeDefined();
    });

    it('rejects autoCommit instead of pretending HTTP group commits exist', () => {
      expect(
        () => new Consumer(mockClient, 'test-topic', 'g', { autoCommit: true }),
      ).toThrow(UnsupportedOperationError);
    });

    it('rejects autoCommitIntervalMs instead of ignoring it', () => {
      expect(
        () => new Consumer(mockClient, 'test-topic', 'g', { autoCommitIntervalMs: 5000 }),
      ).toThrow(/autoCommitIntervalMs is not supported/);
    });

    it('rejects sessionTimeoutMs instead of ignoring it', () => {
      expect(
        () => new Consumer(mockClient, 'test-topic', 'g', { sessionTimeoutMs: 60000 }),
      ).toThrow(UnsupportedOperationError);
    });

    it('rejects heartbeatIntervalMs instead of ignoring it', () => {
      expect(
        () => new Consumer(mockClient, 'test-topic', 'g', { heartbeatIntervalMs: 5000 }),
      ).toThrow(/heartbeatIntervalMs is not supported/);
    });

    it("rejects autoOffsetReset: 'none'", () => {
      expect(
        () => new Consumer(mockClient, 'test-topic', 'g', { autoOffsetReset: 'none' }),
      ).toThrow(UnsupportedOperationError);
    });
  });

  describe('start', () => {
    it('can be started', async () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      await expect(consumer.start()).resolves.toBeUndefined();
    });

    it('rejects group-backed polling instead of silently consuming statelessly', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group', {
        autoCommit: false,
      });
      const consumeBatch = vi.spyOn(mockClient, 'consumeBatch');

      await expect(consumer.poll()).rejects.toBeInstanceOf(UnsupportedOperationError);
      expect(consumeBatch).not.toHaveBeenCalled();
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

    it('tracks global pause state', () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      expect(consumer.isPaused()).toBe(false);
      consumer.pause();
      expect(consumer.isPaused()).toBe(true);
      expect(consumer.isPaused(3)).toBe(true);
      consumer.resume();
      expect(consumer.isPaused()).toBe(false);
    });

    it('tracks per-partition pause state', () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      consumer.pause([1]);
      expect(consumer.isPaused(1)).toBe(true);
      expect(consumer.isPaused(0)).toBe(false);
      expect(consumer.isPaused()).toBe(false);
      consumer.resume([1]);
      expect(consumer.isPaused(1)).toBe(false);
    });

    it('holds records for paused partitions and re-delivers them on resume', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', undefined, {
        autoCommit: false,
        autoOffsetReset: 'earliest',
      });
      const batch = [
        { topic: 'test-topic', partition: 0, offset: 1, value: 'a', timestamp: 1, headers: [] },
        { topic: 'test-topic', partition: 1, offset: 7, value: 'b', timestamp: 1, headers: [] },
      ];
      const consumeBatch = vi
        .spyOn(mockClient, 'consumeBatch')
        .mockResolvedValue(batch);

      consumer.pause([1]);
      const first = await consumer.poll(10);
      expect(first.map((m) => m.partition)).toEqual([0]);

      consumer.resume([1]);
      const second = await consumer.poll(10);
      // The record fetched for the paused partition was held, not dropped.
      expect(second.map((m) => m.offset)).toEqual([7]);
      expect(consumeBatch).toHaveBeenCalledTimes(2);
      expect(consumeBatch.mock.calls[1][1]).toMatchObject({ fromOffset: 2 });
    });

    it('does not fetch while fully paused', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', undefined, { autoCommit: false });
      const consumeBatch = vi.spyOn(mockClient, 'consumeBatch').mockResolvedValue([]);
      consumer.pause();
      await expect(consumer.poll(10)).resolves.toEqual([]);
      expect(consumeBatch).not.toHaveBeenCalled();
    });

    it('does not fetch the HTTP transport partition while partition 0 is paused', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', undefined, {
        autoCommit: false,
      });
      const latestOffset = vi.spyOn(mockClient, 'latestOffset');
      const consumeBatch = vi.spyOn(mockClient, 'consumeBatch');

      consumer.pause([0]);
      await expect(consumer.poll(10)).resolves.toEqual([]);
      expect(latestOffset).not.toHaveBeenCalled();
      expect(consumeBatch).not.toHaveBeenCalled();
    });

    it('holds iterated records while paused instead of discarding them', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', undefined, { autoCommit: false });
      const message = {
        topic: 'test-topic',
        partition: 0,
        offset: 5,
        value: 'held',
        timestamp: 1,
        headers: [],
      };
      vi.spyOn(mockClient, 'consume').mockImplementation(async function* () {
        yield message;
      });

      consumer.pause();
      const iterator = consumer.messages();
      const pending = iterator.next();
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(settled).toBe(false);

      consumer.resume();
      const result = await pending;
      expect(result.done).toBe(false);
      expect(result.value).toEqual(message);
      await iterator.return(undefined);
    });

    it('continues delivering unpaused partitions while another partition is paused', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', undefined, {
        autoCommit: false,
      });
      const pausedMessage = {
        topic: 'test-topic',
        partition: 1,
        offset: 2,
        value: 'paused',
        timestamp: 1,
        headers: [],
      };
      const activeMessage = {
        topic: 'test-topic',
        partition: 0,
        offset: 3,
        value: 'active',
        timestamp: 1,
        headers: [],
      };
      vi.spyOn(mockClient, 'consume').mockImplementation(async function* () {
        yield pausedMessage;
        yield activeMessage;
      });

      consumer.pause([1]);
      const iterator = consumer.messages();
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: activeMessage,
      });

      consumer.resume([1]);
      await expect(iterator.next()).resolves.toEqual({
        done: false,
        value: pausedMessage,
      });
      await iterator.return(undefined);
    });

    it('retains the initial latest cursor across empty polls', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', undefined, {
        autoCommit: false,
      });
      const latestOffset = vi.spyOn(mockClient, 'latestOffset').mockResolvedValue(5);
      const consumeBatch = vi
        .spyOn(mockClient, 'consumeBatch')
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            topic: 'test-topic',
            partition: 0,
            offset: 5,
            value: 'new',
            timestamp: 1,
            headers: [],
          },
        ]);

      await expect(consumer.poll(100)).resolves.toEqual([]);
      await expect(consumer.poll(100)).resolves.toHaveLength(1);

      expect(latestOffset).toHaveBeenCalledTimes(1);
      expect(consumeBatch.mock.calls[0][1]).toMatchObject({ fromOffset: 5 });
      expect(consumeBatch.mock.calls[1][1]).toMatchObject({ fromOffset: 5 });
    });
  });

  describe('partition semantics', () => {
    it('rejects poll() on a multi-partition topic without an explicit partition', async () => {
      vi.spyOn(mockClient, 'topicInfo').mockResolvedValue({
        name: 'test-topic',
        partitions: 3,
        partitionCount: 3,
        replicationFactor: 1,
        messageCount: 0,
        createdAt: new Date(0).toISOString(),
        sizeBytes: 0,
        config: {},
      });
      const consumeBatch = vi.spyOn(mockClient, 'consumeBatch');
      const consumer = new Consumer(mockClient, 'test-topic', undefined, { autoCommit: false });

      await expect(consumer.poll(10)).rejects.toBeInstanceOf(UnsupportedOperationError);
      await expect(consumer.poll(10)).rejects.toThrow(/3 partitions/);
      expect(consumeBatch).not.toHaveBeenCalled();
    });

    it('rejects messages() on a multi-partition topic without an explicit partition', async () => {
      vi.spyOn(mockClient, 'topicInfo').mockResolvedValue({
        name: 'test-topic',
        partitions: 2,
        partitionCount: 2,
        replicationFactor: 1,
        messageCount: 0,
        createdAt: new Date(0).toISOString(),
        sizeBytes: 0,
        config: {},
      });
      const consume = vi.spyOn(mockClient, 'consume');
      const consumer = new Consumer(mockClient, 'test-topic', undefined, { autoCommit: false });

      const iterator = consumer.messages();
      await expect(iterator.next()).rejects.toBeInstanceOf(UnsupportedOperationError);
      expect(consume).not.toHaveBeenCalled();
    });

    it('discovers a single-partition topic and polls partition 0 without rejecting', async () => {
      const topicInfo = vi.spyOn(mockClient, 'topicInfo');
      const consumeBatch = vi.spyOn(mockClient, 'consumeBatch').mockResolvedValue([]);
      const consumer = new Consumer(mockClient, 'test-topic', undefined, {
        autoCommit: false,
        autoOffsetReset: 'earliest',
      });

      await expect(consumer.poll(10)).resolves.toEqual([]);
      expect(topicInfo).toHaveBeenCalledTimes(1);
      expect(consumeBatch.mock.calls[0][1]).toMatchObject({ partition: 0 });
    });

    it('fails closed when topic partition metadata cannot be discovered', async () => {
      vi.spyOn(mockClient, 'topicInfo').mockResolvedValue(undefined);
      const consumeBatch = vi.spyOn(mockClient, 'consumeBatch');
      const consumer = new Consumer(mockClient, 'missing-topic', undefined, {
        autoCommit: false,
      });

      await expect(consumer.poll(10)).rejects.toMatchObject({
        name: 'TopicNotFoundError',
        topic: 'missing-topic',
      });
      expect(consumeBatch).not.toHaveBeenCalled();
    });

    it('honours an explicit partition on a multi-partition topic without discovery', async () => {
      const topicInfo = vi.spyOn(mockClient, 'topicInfo');
      const consumeBatch = vi.spyOn(mockClient, 'consumeBatch').mockResolvedValue([]);
      const consumer = new Consumer(mockClient, 'test-topic', undefined, {
        autoCommit: false,
        autoOffsetReset: 'earliest',
        partition: 2,
      });

      await expect(consumer.poll(10)).resolves.toEqual([]);
      // No discovery call needed: the partition was explicit.
      expect(topicInfo).not.toHaveBeenCalled();
      expect(consumeBatch.mock.calls[0][1]).toMatchObject({ partition: 2 });
    });

    it('memoizes partition discovery across multiple polls', async () => {
      const topicInfo = vi.spyOn(mockClient, 'topicInfo');
      vi.spyOn(mockClient, 'latestOffset').mockResolvedValue(0);
      vi.spyOn(mockClient, 'consumeBatch').mockResolvedValue([]);
      const consumer = new Consumer(mockClient, 'test-topic', undefined, { autoCommit: false });

      await consumer.poll(10);
      await consumer.poll(10);
      expect(topicInfo).toHaveBeenCalledTimes(1);
    });

    it('rejects an invalid explicit partition at construction time', () => {
      expect(
        () => new Consumer(mockClient, 'test-topic', undefined, { partition: -1 }),
      ).toThrow(StreamlineError);
      expect(
        () => new Consumer(mockClient, 'test-topic', undefined, { partition: 1.5 }),
      ).toThrow(StreamlineError);
    });
  });

  describe('seek', () => {
    it('rejects partition-scoped seek explicitly', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'g');
      await expect(consumer.seek(0, 100)).rejects.toBeInstanceOf(UnsupportedOperationError);
    });

    it('rejects seekToBeginning with explicit partitions', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'g');
      await expect(consumer.seekToBeginning([0])).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
    });

    it('rejects seekToBeginning without pretending the server can reset offsets', async () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      await expect(consumer.seekToBeginning()).rejects.toThrow(/no consumer offset-reset/);
    });

    it('rejects seekToEnd instead of pretending success', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'g');
      await expect(consumer.seekToEnd()).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
    });
  });

  describe('commit', () => {
    it('propagates broker commit failures', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'g', { autoCommit: false });
      vi.spyOn(mockClient, 'commitOffsets').mockRejectedValue(
        new StreamlineError('commit rejected', 'GRAPHQL_ERROR'),
      );
      await expect(consumer.commit(new Map([['test-topic:0', 4]]))).rejects.toThrow(
        /commit rejected/,
      );
      // A failed commit must not be recorded as committed.
      expect(consumer.committed(0)).toBeUndefined();
    });

    it('records committed offsets only after the broker accepts', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'g', { autoCommit: false });
      vi.spyOn(mockClient, 'commitOffsets').mockResolvedValue(undefined);
      await consumer.commit(new Map([['test-topic:0', 9]]));
      expect(consumer.committed(0)).toBe(9);
    });

    it('rejects committing without a consumer group', async () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      await expect(consumer.commit(new Map([['test-topic:0', 1]]))).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
    });

    it('is a no-op when there is nothing to commit', async () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      await expect(consumer.commit()).resolves.toBeUndefined();
    });

    it('serializes overlapping commits so an older request cannot win last', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'g', { autoCommit: false });
      let releaseFirst: (() => void) | undefined;
      const firstCommit = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const commitOffsets = vi
        .spyOn(mockClient, 'commitOffsets')
        .mockImplementationOnce(() => firstCommit)
        .mockResolvedValueOnce(undefined);

      const older = consumer.commit(new Map([['test-topic:0', 5]]));
      const newer = consumer.commit(new Map([['test-topic:0', 10]]));
      await Promise.resolve();

      expect(commitOffsets).toHaveBeenCalledTimes(1);
      releaseFirst?.();
      await older;
      await newer;

      expect(commitOffsets.mock.calls.map((call) => call[1].get('test-topic:0'))).toEqual([
        5,
        10,
      ]);
      expect(consumer.committed(0)).toBe(10);
    });
  });

  describe('close', () => {
    it('can be closed', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      await consumer.start();
      await expect(consumer.close()).resolves.toBeUndefined();
    });

    it('does not perform a hidden final commit on close', async () => {
      const consumer = new Consumer(mockClient, 'test-topic');
      const commitOffsets = vi.spyOn(mockClient, 'commitOffsets');
      await consumer.start();
      await consumer.close();
      expect(commitOffsets).not.toHaveBeenCalled();
    });
  });

  describe('onRebalance', () => {
    it('rejects handler registration explicitly instead of silently ignoring it', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      expect(() => {
        consumer.onRebalance(async () => {});
      }).toThrow(UnsupportedOperationError);
    });

    it('explains why the handler can never fire', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      expect(() => {
        consumer.onRebalance(async () => {});
      }).toThrow(/never participates in a group rebalance/);
    });

    it('keeps the RebalanceEvent type on the public surface', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      // Type-only assertion: the handler signature is (event: RebalanceEvent) => Promise<void>.
      // If the public type ever changes shape this will fail to compile.
      const handler: Parameters<typeof consumer.onRebalance>[0] = async (event) => {
        expect(['assign', 'revoke']).toContain(event.type);
        expect(Array.isArray(event.partitions)).toBe(true);
      };
      expect(() => consumer.onRebalance(handler)).toThrow(UnsupportedOperationError);
    });

    it('assignment() reflects the empty initial state before any rebalance', () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      // Pre-rebalance contract: no partitions assigned, no positions/committed offsets.
      expect(consumer.assignment()).toEqual([]);
      expect(consumer.position(0)).toBeUndefined();
      expect(consumer.committed(0)).toBeUndefined();
    });

    it('rejection is independent of start()', async () => {
      const consumer = new Consumer(mockClient, 'test-topic', 'group');
      await consumer.start();
      expect(() => {
        consumer.onRebalance(async () => {});
      }).toThrow(UnsupportedOperationError);
      await consumer.close();
    });
  });
});
