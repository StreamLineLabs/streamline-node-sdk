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
});
