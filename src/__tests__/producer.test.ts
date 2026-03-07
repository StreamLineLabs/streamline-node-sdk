import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Producer } from '../producer';
import { Streamline } from '../client';
import { StreamlineError } from '../types';

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
        compression: 'zstd',
        retries: 5,
        retryBackoffMs: 200,
        idempotent: true,
      });
      expect(producer).toBeDefined();
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
  });

  describe('flush', () => {
    it('resolves when no pending messages', async () => {
      const producer = new Producer(mockClient, 'test-topic');
      await producer.start();
      await expect(producer.flush()).resolves.toBeUndefined();
    });
  });

  describe('batching', () => {
    it('accumulates messages until batch size', async () => {
      const produceBatchSpy = vi.spyOn(mockClient, 'produceBatch')
        .mockResolvedValue([{ topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now().toString() }]);

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
        .mockResolvedValue([{ topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now().toString() }]);

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

    it('passes compression to produceBatch', async () => {
      const produceBatchSpy = vi.spyOn(mockClient, 'produceBatch')
        .mockResolvedValue([{ topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now().toString() }]);

      const producer = new Producer(mockClient, 'test-topic', {
        batchSize: 1,
        compression: 'zstd',
      });
      await producer.start();

      const promise = producer.send({ value: 'msg1' });
      await Promise.allSettled([promise]);

      expect(produceBatchSpy).toHaveBeenCalledWith(
        'test-topic',
        expect.any(Array),
        { compression: 'zstd' }
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
        return [{ topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now().toString() }];
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
          { topic: 'test-topic', partition: 0, offset: 0, timestamp: Date.now().toString() },
          { topic: 'test-topic', partition: 0, offset: 1, timestamp: Date.now().toString() },
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
