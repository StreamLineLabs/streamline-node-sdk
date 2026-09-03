import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { Streamline } from '../client';
import {
  ConnectionError,
  StreamlineError,
  TimeoutError,
  UnsupportedOperationError,
} from '../types';
import type { TopicInfo, ConsumerGroupInfo, ClusterInfo } from '../types';

describe('Streamline Client', () => {
  describe('constructor', () => {
    it('sets bootstrap servers', () => {
      const client = new Streamline('broker1:9092,broker2:9092');
      expect(client.bootstrapServers).toBe('broker1:9092,broker2:9092');
    });

    it('rejects an empty bootstrap server string', () => {
      expect(() => new Streamline('')).toThrow(StreamlineError);
      expect(() => new Streamline('   ')).toThrow(/non-empty string/);
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

  describe('unsupported SASL/TLS configuration is rejected before I/O', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = realFetch;
      vi.restoreAllMocks();
    });

    it('rejects auth.mechanism SCRAM-SHA-256 at construction, before any request', async () => {
      const impl = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
      globalThis.fetch = impl as unknown as typeof fetch;

      expect(() => new Streamline('localhost:9092', {
        auth: { mechanism: 'SCRAM-SHA-256', username: 'user', password: 'pass' },
      })).toThrow(UnsupportedOperationError);
      expect(impl).not.toHaveBeenCalled();
    });

    it('rejects auth.mechanism SCRAM-SHA-512 at construction', () => {
      expect(() => new Streamline('localhost:9092', {
        auth: { mechanism: 'SCRAM-SHA-512', username: 'user', password: 'pass' },
      })).toThrow(UnsupportedOperationError);
    });

    it('rejects legacy sasl.mechanism SCRAM variants the same way', () => {
      expect(() => new Streamline('localhost:9092', {
        sasl: { mechanism: 'SCRAM-SHA-256', username: 'user', password: 'pass' },
      })).toThrow(UnsupportedOperationError);
    });

    it('still accepts PLAIN, which is genuinely implemented as HTTP Basic auth', () => {
      expect(() => new Streamline('localhost:9092', {
        auth: { mechanism: 'PLAIN', username: 'user', password: 'pass' },
      })).not.toThrow();
    });

    it('rejects a custom tlsConfig.ca, which is never applied to fetch(), before any request', async () => {
      const impl = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
      globalThis.fetch = impl as unknown as typeof fetch;

      expect(() => new Streamline('localhost:9092', {
        tlsConfig: { enabled: true, ca: '-----BEGIN CERTIFICATE-----\n...' },
      })).toThrow(UnsupportedOperationError);
      expect(impl).not.toHaveBeenCalled();
    });

    it('rejects tlsConfig mTLS cert/key, which fetch() never presents on the wire', () => {
      expect(() => new Streamline('localhost:9092', {
        tlsConfig: { enabled: true, cert: 'client.pem', key: 'client-key.pem' },
      })).toThrow(UnsupportedOperationError);
    });

    it('rejects tlsConfig.rejectUnauthorized: false, which fetch() never honours', () => {
      expect(() => new Streamline('localhost:9092', {
        tlsConfig: { enabled: true, rejectUnauthorized: false },
      })).toThrow(UnsupportedOperationError);
    });

    it('rejects the deprecated tls option when it carries mTLS/CA customization', () => {
      expect(() => new Streamline('localhost:9092', {
        tls: { cert: 'client.pem', key: 'client-key.pem', ca: 'ca.pem' },
      })).toThrow(UnsupportedOperationError);
    });

    it('still accepts a bare tlsConfig: { enabled: true } with no customization', () => {
      expect(() => new Streamline('localhost:9092', {
        tlsConfig: { enabled: true },
      })).not.toThrow();
    });

    it('still accepts the deprecated tls: true shorthand (a documented no-op)', () => {
      expect(() => new Streamline('localhost:9092', { tls: true })).not.toThrow();
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

    it('maps the 0.3 query envelope to named rows', async () => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({
          columns: [
            { name: 'user', type: 'Utf8' },
            { name: 'count', type: 'Int64' },
          ],
          rows: [
            ['alice', 2],
            ['bob', 1],
          ],
          metadata: {
            execution_time_ms: 1,
            rows_scanned: 3,
            rows_returned: 2,
            truncated: false,
          },
        }), { status: 200 }),
      );

      try {
        const client = new Streamline('localhost:9092');
        await expect(client.query('SELECT user, count FROM events')).resolves.toEqual([
          { user: 'alice', count: 2 },
          { user: 'bob', count: 1 },
        ]);
      } finally {
        fetchMock.mockRestore();
      }
    });
  });

  describe('consumeBatch options', () => {
    const realFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = realFetch;
    });

    afterEach(() => {
      globalThis.fetch = realFetch;
      vi.restoreAllMocks();
    });

    it('rejects an unsupported consumer group instead of dropping it', async () => {
      const impl: Mock<Parameters<typeof fetch>, Promise<Response>> = vi.fn(
        (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
          Promise.resolve(
            new Response(JSON.stringify({ data: { messages: [] } }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
      );
      globalThis.fetch = impl as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await expect(
        client.consumeBatch('events', { group: 'analytics', maxMessages: 5 }),
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
      expect(impl).not.toHaveBeenCalled();
    });

    it('raises TimeoutError when pollTimeout elapses', async () => {
      globalThis.fetch = vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      ) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await expect(
        client.consumeBatch('events', { pollTimeout: 20 }),
      ).rejects.toBeInstanceOf(TimeoutError);
    });

    it('does not time out when the response arrives in time', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ data: { messages: [] } }), { status: 200 }),
        ),
      ) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await expect(
        client.consumeBatch('events', { fromBeginning: true, pollTimeout: 5_000 }),
      ).resolves.toEqual([]);
    });

    it('keeps the deadline active while reading the response body', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(
          new Response(new ReadableStream<Uint8Array>({
            start() {
              // Intentionally never enqueue or close.
            },
          }), { status: 200 }),
        ),
      ) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await expect(
        client.consumeBatch('events', { fromBeginning: true, pollTimeout: 20 }),
      ).rejects.toBeInstanceOf(TimeoutError);
    });

    it('uses the configured client timeout when no request override is supplied', async () => {
      globalThis.fetch = vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      ) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092', { timeout: 20 });
      await expect(client.consumeBatch('events')).rejects.toBeInstanceOf(TimeoutError);
    });

    it('applies the request deadline while acquiring an OAuth token', async () => {
      const client = new Streamline('localhost:9092', {
        timeout: 20,
        auth: {
          mechanism: 'OAUTHBEARER',
          oauthBearerProvider: () => new Promise(() => {}),
        },
      });

      await expect(client.consumeBatch('events')).rejects.toBeInstanceOf(TimeoutError);
    });
  });

  describe('close() cancels in-flight reconnect', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = realFetch;
      vi.restoreAllMocks();
    });

    it('does not reconnect, and does not wait out the full backoff delay, once closed', async () => {
      let call = 0;
      const impl: Mock<Parameters<typeof fetch>, Promise<Response>> = vi.fn(
        (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
        call++;
        if (call === 1) {
          // Health check performed by connect().
          return Promise.resolve(new Response('{}', { status: 200 }));
        }
        if (call === 2) {
          // TopicLatestOffset lookup performed once before the consume loop.
          return Promise.resolve(
            new Response(
              JSON.stringify({ data: { topicStats: { partitions: [] } } }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            ),
          );
        }
        // Every messages-query attempt fails, forcing the reconnect path.
        return Promise.reject(new Error('network down'));
        },
      );
      globalThis.fetch = impl as unknown as typeof fetch;

      // A long delay: the test only passes if close() interrupts the sleep
      // rather than the loop actually waiting this out.
      const client = new Streamline('localhost:9092', {
        autoReconnect: true,
        reconnectDelay: 5_000,
        maxReconnectDelay: 5_000,
        maxReconnectAttempts: 5,
      });
      await client.connect();

      const iterator = client.consume('events')[Symbol.asyncIterator]();
      const nextPromise = iterator.next();

      // Let the failed messages query and the start of reconnect()'s backoff
      // sleep begin, then close while it should still be "sleeping".
      await new Promise((resolve) => setTimeout(resolve, 20));
      const callsBeforeClose = impl.mock.calls.length;
      expect(callsBeforeClose).toBe(3); // health check, offset lookup, one failed messages query

      await client.close();

      await expect(nextPromise).rejects.toThrow(/closed/i);
      // No further health-check/reconnect request was made after close().
      expect(impl.mock.calls.length).toBe(callsBeforeClose);
    }, 2_000);

    it('lets a later explicit connect() reconnect normally after a close()', async () => {
      const impl: Mock<Parameters<typeof fetch>, Promise<Response>> = vi.fn(
        (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
          Promise.resolve(new Response('{}', { status: 200 })),
      );
      globalThis.fetch = impl as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await client.connect();
      await client.close();
      await expect(client.connect()).resolves.toBeUndefined();
    });
  });

  describe('lifecycle generation fencing', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = realFetch;
      vi.restoreAllMocks();
    });

    /**
     * Narrow, read-only view onto the private lifecycle state under test.
     * These fields have no public accessor (only `consume()`'s internal loop
     * observes `connected`), so tests inspect them directly, following the
     * existing internals-casting pattern used in `embedded.test.ts`.
     */
    function internals(client: Streamline): {
      connected: boolean;
      generation: number;
      abortController?: AbortController;
    } {
      return client as unknown as {
        connected: boolean;
        generation: number;
        abortController?: AbortController;
      };
    }

    it('a health check that resolves after close() does not resurrect `connected` or replace the abort controller', async () => {
      let resolveHealth!: (res: Response) => void;
      const health = new Promise<Response>((resolve) => {
        resolveHealth = resolve;
      });
      globalThis.fetch = vi.fn(() => health) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      const connectPromise = client.connect();

      // close() while connect()'s health check is still in flight.
      await client.close();
      expect(internals(client).connected).toBe(false);
      const controllerAfterClose = internals(client).abortController;

      // The stale health check now settles successfully -- e.g. a response
      // that was already in transit when close() aborted the request.
      resolveHealth(new Response('{}', { status: 200 }));
      await connectPromise;

      expect(internals(client).connected).toBe(false);
      // The (aborted) controller close() acted on must not have been
      // replaced by the superseded connect() attempt.
      expect(internals(client).abortController).toBe(controllerAfterClose);
    });

    it('a reconnect-driven connect() that resolves after close() does not resurrect `connected`', async () => {
      let call = 0;
      let resolveReconnectHealth!: (res: Response) => void;
      const impl: Mock<Parameters<typeof fetch>, Promise<Response>> = vi.fn(
        (_input: Parameters<typeof fetch>[0], _init?: RequestInit) => {
          call++;
          if (call === 1) {
            // Initial connect()'s health check.
            return Promise.resolve(new Response('{}', { status: 200 }));
          }
          if (call === 2) {
            // TopicLatestOffset lookup performed once before the consume loop.
            return Promise.resolve(
              new Response(
                JSON.stringify({ data: { topicStats: { partitions: [] } } }),
                { status: 200, headers: { 'Content-Type': 'application/json' } },
              ),
            );
          }
          if (call === 3) {
            // The messages query fails, forcing the reconnect() path.
            return Promise.reject(new Error('network down'));
          }
          // reconnect()'s own connect() health check: held open under test
          // control so it can be resolved "late", after close().
          return new Promise<Response>((resolve) => {
            resolveReconnectHealth = resolve;
          });
        },
      );
      globalThis.fetch = impl as unknown as typeof fetch;

      const client = new Streamline('localhost:9092', {
        autoReconnect: true,
        reconnectDelay: 1,
        maxReconnectDelay: 1,
        maxReconnectAttempts: 5,
      });
      await client.connect();

      const iterator = client.consume('events')[Symbol.asyncIterator]();
      const nextPromise = iterator.next();

      // Let the failed messages query, the (near-instant) reconnect backoff,
      // and the start of reconnect()'s own connect() call all happen, so its
      // health check (call 4) is the one left in flight.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(call).toBe(4);

      await client.close();
      expect(internals(client).connected).toBe(false);
      const controllerAfterClose = internals(client).abortController;

      // The stale reconnect health check resolves successfully after close().
      resolveReconnectHealth(new Response('{}', { status: 200 }));

      // The consume loop observes `connected === false` (never resurrected)
      // and returns normally instead of looping again.
      await expect(nextPromise).resolves.toEqual({ done: true, value: undefined });
      expect(internals(client).connected).toBe(false);
      expect(internals(client).abortController).toBe(controllerAfterClose);
      // No further request was made after close().
      expect(impl.mock.calls.length).toBe(4);
    });

    it('close() clears `connected` and bumps the generation', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(new Response('{}', { status: 200 })),
      ) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await client.connect();
      expect(internals(client).connected).toBe(true);
      const generationBeforeClose = internals(client).generation;

      await client.close();
      expect(internals(client).connected).toBe(false);
      expect(internals(client).generation).toBeGreaterThan(generationBeforeClose);
    });

    it('an explicit reopen after close() is a new generation and connects normally', async () => {
      const impl: Mock<Parameters<typeof fetch>, Promise<Response>> = vi.fn(
        (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
          Promise.resolve(new Response('{}', { status: 200 })),
      );
      globalThis.fetch = impl as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await client.connect();
      const generationAfterFirstConnect = internals(client).generation;

      await client.close();
      expect(internals(client).connected).toBe(false);

      await client.connect();
      expect(internals(client).connected).toBe(true);
      expect(internals(client).generation).toBeGreaterThan(generationAfterFirstConnect);
      // The reopened client is genuinely live: it issued its own health
      // check (one for the initial connect, one for the reopen).
      expect(impl).toHaveBeenCalledTimes(2);
    });
  });

  describe('unsupported consumer-group operations', () => {
    it('rejects offset commits explicitly', async () => {
      const client = new Streamline('localhost:9092');
      await expect(
        client.commitOffsets('analytics', new Map([['events:0', 4]])),
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
    });

    it('validates reset options before reporting the unsupported server operation', async () => {
      const client = new Streamline('localhost:9092');
      await expect(
        client.resetConsumerGroupOffsets('analytics', 'events', {}),
      ).rejects.toThrow(/Must specify one of/);
      await expect(
        client.resetConsumerGroupOffsets('analytics', 'events', { toEarliest: true }),
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
    });
  });

  describe('Streamline 0.3 GraphQL documents', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = realFetch;
      vi.restoreAllMocks();
    });

    it('uses produceMessage and normalizes the ISO timestamp', async () => {
      const impl: Mock<Parameters<typeof fetch>, Promise<Response>> = vi.fn((_input) =>
        Promise.resolve(new Response(JSON.stringify({
          data: {
            produceMessage: {
              topic: 'events',
              partition: 0,
              offset: 3,
              timestamp: '2026-09-02T12:00:00Z',
            },
          },
        }), { status: 200 })),
      );
      globalThis.fetch = impl as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await expect(
        client.produce('events', { kind: 'created' }, { key: 'k' }),
      ).resolves.toEqual({
        topic: 'events',
        partition: 0,
        offset: 3,
        timestamp: Date.parse('2026-09-02T12:00:00Z'),
      });

      const body = JSON.parse(String(impl.mock.calls[0][1]?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(body.query).toContain('produceMessage(topic: $topic, message: $message)');
      expect(body.query).not.toContain('produceBatch');
      expect(body.variables['message']).toMatchObject({
        key: 'k',
        value: '{"kind":"created"}',
      });
    });

    it('implements an uncompressed batch with supported single-message mutations', async () => {
      let offset = 0;
      const impl: Mock<Parameters<typeof fetch>, Promise<Response>> = vi.fn((_input) => {
        const result = {
          topic: 'events',
          partition: 0,
          offset,
          timestamp: '2026-09-02T12:00:00Z',
        };
        offset++;
        return Promise.resolve(new Response(JSON.stringify({
          data: { produceMessage: result },
        }), { status: 200 }));
      });
      globalThis.fetch = impl as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await expect(client.produceBatch('events', [
        { value: 'a' },
        { value: 'b' },
      ])).resolves.toHaveLength(2);
      expect(impl).toHaveBeenCalledTimes(2);

      await expect(
        client.produceBatch('events', [{ value: 'c' }], { compression: 'zstd' }),
      ).rejects.toBeInstanceOf(UnsupportedOperationError);
      expect(impl).toHaveBeenCalledTimes(2);
    });

    it('uses the 0.3 topic fields and maps the partition compatibility alias', async () => {
      const impl: Mock<Parameters<typeof fetch>, Promise<Response>> = vi.fn((_input) =>
        Promise.resolve(new Response(JSON.stringify({
          data: {
            topic: {
              name: 'events',
              partitions: 3,
              replicationFactor: 1,
              messageCount: 7,
              retentionMs: 60_000,
              createdAt: '2026-09-02T12:00:00Z',
            },
          },
        }), { status: 200 })),
      );
      globalThis.fetch = impl as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await expect(client.topicInfo('events')).resolves.toMatchObject({
        name: 'events',
        partitions: 3,
        partitionCount: 3,
        retentionMs: 60_000,
      });

      const body = JSON.parse(String(impl.mock.calls[0][1]?.body)) as { query: string };
      expect(body.query).toContain('partitions');
      expect(body.query).toContain('createdAt');
      expect(body.query).not.toContain('sizeBytes');
    });

    it('selects a createTopic result required by GraphQL', async () => {
      const impl: Mock<Parameters<typeof fetch>, Promise<Response>> = vi.fn((_input) =>
        Promise.resolve(new Response(JSON.stringify({
          data: { createTopic: { name: 'events' } },
        }), { status: 200 })),
      );
      globalThis.fetch = impl as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await client.createTopic('events', {
        partitions: 3,
      });

      const body = JSON.parse(String(impl.mock.calls[0][1]?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(body.query).toContain('createTopic(');
      expect(body.query).toContain('{');
      expect(body.query).toContain('name');
      expect(body.variables['partitions']).toBe(3);
    });

    it('rejects topic config that Streamline 0.3 would ignore', async () => {
      const client = new Streamline('localhost:9092');
      await expect(client.createTopic('events', {
        config: { 'retention.ms': '60000' },
      })).rejects.toBeInstanceOf(UnsupportedOperationError);
    });

    it('selects consumer-group details from the supported list query', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({
          data: {
            consumerGroups: [{
              groupId: 'orders',
              state: 'STABLE',
              protocolType: 'consumer',
              memberCount: 2,
            }],
          },
        }), { status: 200 })),
      ) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await expect(client.consumerGroupInfo('orders')).resolves.toEqual({
        groupId: 'orders',
        state: 'STABLE',
        protocolType: 'consumer',
        memberCount: 2,
        protocol: '',
        members: [],
      });
    });

    it('uses clusterInfo and rejects admin fields absent from 0.3', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({
          data: {
            clusterInfo: {
              nodeId: 0,
              version: '0.3.0',
              uptime: 10,
              topicCount: 4,
            },
          },
        }), { status: 200 })),
      ) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      await expect(client.describeCluster()).resolves.toEqual({
        nodeId: 0,
        version: '0.3.0',
        uptime: 10,
        topicCount: 4,
        clusterId: '',
        controller: -1,
        brokers: [],
      });
      await expect(client.alterTopicConfig('events', {})).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
      await expect(client.createPartitions('events', 2)).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
      await expect(client.deleteConsumerGroup('orders')).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
      await expect(client.describeBrokerConfig(0)).rejects.toBeInstanceOf(
        UnsupportedOperationError,
      );
    });
  });

  describe('restored TopicInfo/ConsumerGroupInfo/ClusterInfo compatibility aliases', () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = realFetch;
      vi.restoreAllMocks();
    });

    it('TopicInfo populates deprecated required aliases with neutral sentinels', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({
          data: {
            topic: {
              name: 'events',
              partitions: 3,
              replicationFactor: 1,
              messageCount: 7,
              retentionMs: 60_000,
              createdAt: '2026-09-02T12:00:00Z',
            },
          },
        }), { status: 200 })),
      ) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      const info = await client.topicInfo('events');
      expect(info).toBeDefined();
      // Compile-time compatibility: prior SDK releases could read these
      // fields directly off TopicInfo without a cast or type error.
      expect(info?.sizeBytes).toBe(0);
      expect(info?.config).toEqual({});
    });

    it('ConsumerGroupInfo populates deprecated required aliases with neutral sentinels', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({
          data: {
            consumerGroups: [{
              groupId: 'orders',
              state: 'STABLE',
              protocolType: 'consumer',
              memberCount: 2,
            }],
          },
        }), { status: 200 })),
      ) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      const info = await client.consumerGroupInfo('orders');
      expect(info).toBeDefined();
      expect(info?.protocol).toBe('');
      expect(info?.members).toEqual([]);
      // Still exact on the fields Streamline 0.3 actually reports.
      expect(info).toMatchObject({
        groupId: 'orders',
        state: 'STABLE',
        protocolType: 'consumer',
        memberCount: 2,
      });
    });

    it('ClusterInfo populates deprecated required aliases with neutral sentinels', async () => {
      globalThis.fetch = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({
          data: {
            clusterInfo: {
              nodeId: 0,
              version: '0.3.0',
              uptime: 10,
              topicCount: 4,
            },
          },
        }), { status: 200 })),
      ) as unknown as typeof fetch;

      const client = new Streamline('localhost:9092');
      const info = await client.describeCluster();
      expect(info.clusterId).toBe('');
      expect(info.controller).toBe(-1);
      expect(info.brokers).toEqual([]);
      expect(info).toMatchObject({
        nodeId: 0,
        version: '0.3.0',
        uptime: 10,
        topicCount: 4,
      });
    });

    it('compiles the exact prior public model shapes without newly introduced fields', () => {
      // No server round-trip: this test exists to fail *at typecheck time*
      // (npm run typecheck:tests) if current-only fields become required.
      // These object literals mirror the committed pre-change public shapes.
      const topic: TopicInfo = {
        name: 'events',
        partitionCount: 3,
        replicationFactor: 1,
        messageCount: 0,
        sizeBytes: 1024,
        config: { 'retention.ms': '60000' },
      };
      const group: ConsumerGroupInfo = {
        groupId: 'orders',
        state: 'STABLE',
        protocolType: 'consumer',
        protocol: 'range',
        members: [{
          memberId: 'm1',
          clientId: 'c1',
          clientHost: 'localhost',
          partitions: [0],
        }],
      };
      const cluster: ClusterInfo = {
        clusterId: 'cluster-1',
        controller: 0,
        brokers: [{ id: 0, host: 'localhost', port: 9092 }],
      };

      expect(topic.sizeBytes).toBe(1024);
      expect(group.protocol).toBe('range');
      expect(cluster.clusterId).toBe('cluster-1');
    });
  });
});
// Consumer rebalance coverage lives in __tests__/consumer.test.ts ("onRebalance" describe block).


describe('Streamline validation', () => {
  it('should create client with valid broker list', () => {
    const client = new Streamline('localhost:9092');
    expect(client).toBeDefined();
  });

  it('should create client with default options', () => {
    const client = new Streamline('localhost:9092');
    expect(client).toBeDefined();
  });
});
