import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Streamline } from '../client';
import { ConnectionError, StreamlineError } from '../types';

describe('Streamline Client', () => {
  describe('constructor', () => {
    it('sets bootstrap servers', () => {
      const client = new Streamline('broker1:9092,broker2:9092');
      expect(client).toBeDefined();
    });

    it('applies default options', () => {
      const client = new Streamline('localhost:9092');
      // Client should be constructable with no options
      expect(client).toBeDefined();
    });

    it('accepts custom options', () => {
      const client = new Streamline('localhost:9092', {
        httpEndpoint: 'http://custom:8080',
        clientId: 'my-client',
        apiKey: 'secret',
        tls: true,
        timeout: 60000,
        autoReconnect: false,
        maxReconnectAttempts: 5,
        reconnectDelay: 2000,
      });
      expect(client).toBeDefined();
    });
  });

  describe('connect', () => {
    it('throws ConnectionError on failure', async () => {
      const client = new Streamline('localhost:9092', {
        httpEndpoint: 'http://localhost:1',
      });

      await expect(client.connect()).rejects.toThrow(ConnectionError);
    });
  });

  describe('close', () => {
    it('can be called without connect', async () => {
      const client = new Streamline('localhost:9092');
      await expect(client.close()).resolves.toBeUndefined();
    });
  });

  describe('produce', () => {
    it('throws when not connected (fetch fails)', async () => {
      const client = new Streamline('localhost:9092', {
        httpEndpoint: 'http://localhost:1',
      });

      await expect(
        client.produce('test-topic', { message: 'hello' })
      ).rejects.toThrow();
    });
  });

  describe('query', () => {
    it('throws on connection failure', async () => {
      const client = new Streamline('localhost:9092', {
        httpEndpoint: 'http://localhost:1',
      });

      await expect(
        client.query('SELECT * FROM events')
      ).rejects.toThrow();
    });
  });
});
// TODO: add vitest coverage for consumer rebalance
