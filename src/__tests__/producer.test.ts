import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Producer } from '../producer';
import { Streamline } from '../client';
import { StreamlineError, UnsupportedOperationError } from '../types';

describe('Producer', () => {
  let mockClient: Streamline;

  beforeEach(() => {
    mockClient = new Streamline('localhost:9092');
  });

  describe('constructor', () => {
    it('creates with default config', () => {
      const producer = new Producer(mockClient, 'test-topic');
      expect(producer).toBeDefined();
    });

    it('creates with custom config', () => {
      const producer = new Producer(mockClient, 'test-topic', {
        batchSize: 500,
        lingerMs: 50,
        compression: 'none',
        retries: 5,
        retryBackoffMs: 200,
      });
      expect(producer).toBeDefined();
    });

    it('rejects idempotent: true instead of silently ignoring it', () => {
      expect(
        () => new Producer(mockClient, 'test-topic', { idempotent: true }),
      ).toThrow(UnsupportedOperationError);
      expect(
        () => new Producer(mockClient, 'test-topic', { idempotent: true }),
      ).toThrow(/no producer id or sequence number/);
    });

    it('accepts an explicit idempotent: false', () => {
      expect(
        () => new Producer(mockClient, 'test-topic', { idempotent: false }),
      ).not.toThrow();
    });

    it('rejects unsupported HTTP batch compression', () => {
      expect(
        () => new Producer(mockClient, 'test-topic', { compression: 'zstd' }),
      ).toThrow(UnsupportedOperationError);
    });

    it('applies default values for omitted config', () => {
      const producer = new Producer(mockClient, 'test-topic', {
        batchSize: 200,
      });
      // Should not throw — other defaults applied
      expect(producer).toBeDefined();
    });
  });

  describe('start', () => {
    it('can be started', async () => {
      const producer = new Producer(mockClient, 'test-topic');
      await expect(producer.start()).resolves.toBeUndefined();
    });
  });

  describe('send', () => {
    it('throws when closed', async () => {
      const producer = new Producer(mockClient, 'test-topic');
      await producer.close();

      await expect(
        producer.send({ value: 'test' })
      ).rejects.toThrow(StreamlineError);
    });

    it('throws StreamlineError with PRODUCER_CLOSED code', async () => {
      const producer = new Producer(mockClient, 'test-topic');
      await producer.close();

      try {
        await producer.send({ value: 'test' });
      } catch (err) {
        expect(err).toBeInstanceOf(StreamlineError);
        expect((err as StreamlineError).code).toBe('PRODUCER_CLOSED');
      }
    });
  });

  describe('close', () => {
    it('can be called multiple times', async () => {
      const producer = new Producer(mockClient, 'test-topic');
      await producer.start();
      await producer.close();
      await expect(producer.close()).resolves.toBeUndefined();
    });

    it('waits for an active flush and drains records queued behind it', async () => {
      let releaseFirst: ((results: {
        topic: string;
        partition: number;
        offset: number;
        timestamp: number;
      }[]) => void) | undefined;
      const firstResult = new Promise<{
        topic: string;
        partition: number;
        offset: number;
        timestamp: number;
      }[]>((resolve) => {
        releaseFirst = resolve;
      });
      const produceBatch = vi
        .spyOn(mockClient, 'produceBatch')
        .mockImplementationOnce(() => firstResult)
        .mockResolvedValueOnce([
          { topic: 'test-topic', partition: 0, offset: 1, timestamp: Date.now() },
        ]);

      const producer = new Producer(mockClient, 'test-topic', { batchSize: 1 });
      await producer.start();
      const first = producer.send({ value: 'first' });
      await vi.waitFor(() => expect(produceBatch).toHaveBeenCalledTimes(1));
      const second = producer.send({ value: 'second' });

      const closing = producer.close();
      releaseFirst?.([
        { topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now() },
      ]);

      await expect(closing).resolves.toBeUndefined();
      await expect(first).resolves.toMatchObject({ offset: 0 });
      await expect(second).resolves.toMatchObject({ offset: 1 });
      expect(produceBatch).toHaveBeenCalledTimes(2);
    });

    it('rejects close and buffered sends when a transaction is still open', async () => {
      const producer = new Producer(mockClient, 'test-topic');
      await producer.start();
      await producer.beginTransaction();
      const pending = producer.send({ value: 'buffered' });
      const pendingRejection = expect(pending).rejects.toThrow(/transaction in progress/);

      await expect(producer.close()).rejects.toMatchObject({
        code: 'TRANSACTION_ABORTED',
      });
      await pendingRejection;
    });

    it('waits for an in-flight transaction commit instead of aborting written records', async () => {
      let releaseCommit: ((results: {
        topic: string;
        partition: number;
        offset: number;
        timestamp: number;
      }[]) => void) | undefined;
      const commitResult = new Promise<{
        topic: string;
        partition: number;
        offset: number;
        timestamp: number;
      }[]>((resolve) => {
        releaseCommit = resolve;
      });
      const produceBatch = vi.spyOn(mockClient, 'produceBatch').mockReturnValue(commitResult);

      const producer = new Producer(mockClient, 'test-topic');
      await producer.start();
      await producer.beginTransaction();
      const pending = producer.send({ value: 'transactional' });
      const committing = producer.commitTransaction();
      await vi.waitFor(() => expect(produceBatch).toHaveBeenCalledTimes(1));

      const closing = producer.close();
      await expect(producer.send({ value: 'late' })).rejects.toMatchObject({
        code: 'PRODUCER_CLOSED',
      });
      releaseCommit?.([
        { topic: 'test-topic', partition: 0, offset: 4, timestamp: Date.now() },
      ]);

      await expect(committing).resolves.toHaveLength(1);
      await expect(pending).resolves.toMatchObject({ offset: 4 });
      await expect(closing).resolves.toBeUndefined();
    });
  });

  describe('flush', () => {
    it('resolves when no pending messages', async () => {
      const producer = new Producer(mockClient, 'test-topic');
      await producer.start();
      await expect(producer.flush()).resolves.toBeUndefined();
    });

    it('propagates delivery failures while rejecting affected sends', async () => {
      vi.spyOn(mockClient, 'produceBatch').mockRejectedValue(
        new StreamlineError('write failed', 'WRITE_FAILED', false),
      );
      const producer = new Producer(mockClient, 'test-topic', {
        batchSize: 10,
        lingerMs: 10_000,
      });
      await producer.start();
      const pending = producer.send({ value: 'x' });
      const pendingRejection = expect(pending).rejects.toThrow(/write failed/);

      await expect(producer.flush()).rejects.toThrow(/write failed/);
      await pendingRejection;
    });
  });

  describe('batching', () => {
    it('accumulates messages until batch size', async () => {
      const produceBatchSpy = vi.spyOn(mockClient, 'produceBatch')
        .mockResolvedValue([{ topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now() }]);

      const producer = new Producer(mockClient, 'test-topic', {
        batchSize: 3,
        lingerMs: 10000, // long linger so only size triggers flush
      });
      await producer.start();

      // Send 3 messages to hit batch size
      const p1 = producer.send({ value: 'msg1' });
      const p2 = producer.send({ value: 'msg2' });
      const p3 = producer.send({ value: 'msg3' });

      // Wait for all to resolve
      await Promise.allSettled([p1, p2, p3]);

      // produceBatch should have been called at least once
      expect(produceBatchSpy).toHaveBeenCalled();

      produceBatchSpy.mockRestore();
    });

    it('flushes on linger timeout', async () => {
      const produceBatchSpy = vi.spyOn(mockClient, 'produceBatch')
        .mockResolvedValue([{ topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now() }]);

      const producer = new Producer(mockClient, 'test-topic', {
        batchSize: 1000, // high batch size
        lingerMs: 50,    // short linger to trigger time-based flush
      });
      await producer.start();

      // Send 1 message (below batch size)
      const promise = producer.send({ value: 'msg1' });

      // Wait for linger timer to fire
      await new Promise(r => setTimeout(r, 100));
      await Promise.allSettled([promise]);

      expect(produceBatchSpy).toHaveBeenCalled();

      produceBatchSpy.mockRestore();
    });

    it('passes the supported none compression mode to produceBatch', async () => {
      const produceBatchSpy = vi.spyOn(mockClient, 'produceBatch')
        .mockResolvedValue([{ topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now() }]);

      const producer = new Producer(mockClient, 'test-topic', {
        batchSize: 1,
        compression: 'none',
      });
      await producer.start();

      const promise = producer.send({ value: 'msg1' });
      await Promise.allSettled([promise]);

      expect(produceBatchSpy).toHaveBeenCalledWith(
        'test-topic',
        expect.any(Array),
        { compression: 'none' }
      );

      produceBatchSpy.mockRestore();
    });
  });

  describe('retry', () => {
    it('retries on retryable error', async () => {
      let callCount = 0;
      vi.spyOn(mockClient, 'produceBatch').mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new StreamlineError('transient', 'CONN', true);
        }
        return [{ topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now() }];
      });

      const producer = new Producer(mockClient, 'test-topic', {
        batchSize: 1,
        retries: 3,
        retryBackoffMs: 10, // short for test speed
      });
      await producer.start();

      const result = await producer.send({ value: 'msg1' });
      expect(result).toBeDefined();
      expect(callCount).toBe(3);
    });

    it('does not retry non-retryable errors', async () => {
      let callCount = 0;
      vi.spyOn(mockClient, 'produceBatch').mockImplementation(async () => {
        callCount++;
        throw new StreamlineError('auth failed', 'AUTH', false);
      });

      const producer = new Producer(mockClient, 'test-topic', {
        batchSize: 1,
        retries: 3,
        retryBackoffMs: 10,
      });
      await producer.start();

      await expect(producer.send({ value: 'msg1' })).rejects.toThrow('auth failed');
      expect(callCount).toBe(1); // no retries
    });

    it('gives up after max retries', async () => {
      vi.spyOn(mockClient, 'produceBatch').mockRejectedValue(
        new StreamlineError('transient', 'CONN', true)
      );

      const producer = new Producer(mockClient, 'test-topic', {
        batchSize: 1,
        retries: 2,
        retryBackoffMs: 10,
      });
      await producer.start();

      await expect(producer.send({ value: 'msg1' })).rejects.toThrow('transient');
    });
  });

  describe('sendBatch', () => {
    it('sends multiple messages', async () => {
      vi.spyOn(mockClient, 'produceBatch')
        .mockResolvedValue([
          { topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now() },
          { topic: 'test-topic', partition: 0, offset: 1, timestamp: Date.now() },
        ]);

      const producer = new Producer(mockClient, 'test-topic', { batchSize: 10 });
      await producer.start();

      const results = await producer.sendBatch([
        { value: 'a' },
        { value: 'b' },
      ]);

      expect(results).toHaveLength(2);
    });
  });
});
