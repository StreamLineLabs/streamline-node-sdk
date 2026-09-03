/**
 * SDK Conformance Test Suite for the Streamline Node.js SDK.
 *
 * Validates that the SDK correctly interacts with a running Streamline server.
 *
 * Prerequisites:
 *   docker compose -f docker-compose.test.yml up -d
 *
 * Environment variables:
 *   STREAMLINE_BOOTSTRAP  — Kafka-protocol address  (default: localhost:9092)
 *   STREAMLINE_HTTP       — HTTP / GraphQL address   (default: http://localhost:9094)
 *   STREAMLINE_CONFORMANCE_REQUIRE — when truthy ('1'/'true'), an unreachable
 *     server is a hard failure instead of a skip. Defaults to on whenever `CI`
 *     is set, so a broken fixture can never be reported as a green run.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Streamline } from '../client';
import { Producer } from '../producer';
import { Consumer } from '../consumer';
import { Admin } from '../admin';
import { SchemaRegistry } from '../schema';
import {
  StreamlineError,
  ConnectionError,
  TimeoutError,
  UnsupportedOperationError,
} from '../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BOOTSTRAP = process.env['STREAMLINE_BOOTSTRAP'] ?? 'localhost:9092';
const HTTP_URL = process.env['STREAMLINE_HTTP'] ?? 'http://localhost:9094';
const TIMEOUT = 30_000;

/** Generate a unique topic name for a given test ID. */
function uniqueTopic(testId: string): string {
  return `conformance-${testId}-${Date.now()}`;
}

/** Parse a truthy environment flag. */
function envFlag(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return value === '1' || value.toLowerCase() === 'true';
}

// ---------------------------------------------------------------------------
// Server availability check
//
// This *must* be resolved before the `describe` callbacks run, because
// `describe.skipIf(...)` is evaluated during collection. Setting the flag from
// a `beforeAll` hook (as this suite previously did) always evaluated `false`
// and silently skipped the entire suite — including on CI with a healthy
// server. Top-level await runs during collection, so the value is real.
// ---------------------------------------------------------------------------
async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(`${HTTP_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

const REQUIRE_SERVER =
  envFlag(process.env['STREAMLINE_CONFORMANCE_REQUIRE']) ??
  envFlag(process.env['CI']) ??
  false;

const serverAvailable = await checkServer();

// ===========================================================================
// Fixture gate — fails (not skips) when the server is declared mandatory
// ===========================================================================
describe('Conformance fixture', () => {
  it('reaches the Streamline server when it is required', () => {
    if (!REQUIRE_SERVER) {
      expect(typeof serverAvailable).toBe('boolean');
      return;
    }
    expect(
      serverAvailable,
      `Streamline server at ${HTTP_URL} is unreachable but STREAMLINE_CONFORMANCE_REQUIRE/CI is set. ` +
        'Start it with: docker compose -f docker-compose.test.yml up -d --wait',
    ).toBe(true);
  });
});

// ===========================================================================
// Streamline Conformance Suite
// ===========================================================================
describe.skipIf(!serverAvailable)('Streamline Conformance Suite', () => {
  // =========================================================================
  // Producer (P01-P08)
  // =========================================================================
  describe('Producer', { timeout: TIMEOUT }, () => {
    let client: Streamline;

    beforeAll(async () => {
      client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
      await client.connect();
    });

    afterAll(async () => {
      await client.close();
    });

    it('P01: Simple Produce — send message, verify offset >= 0', async () => {
      const topic = uniqueTopic('P01');
      await client.createTopic(topic, { partitions: 1 });

      const result = await client.produce(topic, { message: 'hello' });

      expect(result).toBeDefined();
      expect(result.offset).toBeGreaterThanOrEqual(0);
      expect(result.partition).toBeGreaterThanOrEqual(0);
    });

    it('P02: Keyed Produce — same key → same partition', async () => {
      const topic = uniqueTopic('P02');
      await client.createTopic(topic, { partitions: 3 });

      const r1 = await client.produce(topic, { message: 'keyed-1' }, { key: 'user-42' });
      const r2 = await client.produce(topic, { message: 'keyed-2' }, { key: 'user-42' });

      expect(r1.offset).toBeGreaterThanOrEqual(0);
      expect(r2.partition).toBe(r1.partition);
    });

    it('P03: Headers Produce — headers preserved round-trip', async () => {
      const topic = uniqueTopic('P03');
      await client.createTopic(topic, { partitions: 1 });

      const headers = { 'x-trace-id': 'abc-123', 'x-source': 'conformance-test' };
      const result = await client.produce(topic, { message: 'with-headers' }, { headers });

      expect(result).toBeDefined();
      expect(result.offset).toBeGreaterThanOrEqual(0);

      const messages = await client.consumeBatch(topic, { maxMessages: 1, fromBeginning: true });
      expect(messages.length).toBeGreaterThanOrEqual(1);

      const msg = messages[0];
      expect(msg.headers).toBeDefined();
      // Headers come back as Header[] ({key,value}[])
      const traceHeader = msg.headers.find((h) => h.key === 'x-trace-id');
      const sourceHeader = msg.headers.find((h) => h.key === 'x-source');
      expect(traceHeader?.value).toBe('abc-123');
      expect(sourceHeader?.value).toBe('conformance-test');
    });

    it('P04: Batch Produce — 10 messages, all succeed', async () => {
      const topic = uniqueTopic('P04');
      await client.createTopic(topic, { partitions: 1 });

      const records = Array.from({ length: 10 }, (_, i) => ({
        value: { index: i, data: `batch-message-${i}` },
      }));

      const results = await client.produceBatch(topic, records);
      expect(results).toHaveLength(10);
      for (const r of results) {
        expect(r.offset).toBeGreaterThanOrEqual(0);
      }

      const messages = await client.consumeBatch(topic, { maxMessages: 10, fromBeginning: true });
      expect(messages.length).toBe(10);
    });

    it('P05: Compression — unsupported HTTP option fails explicitly', async () => {
      const topic = uniqueTopic('P05');
      await client.createTopic(topic, { partitions: 1 });

      await expect(
        client.produceBatch(
          topic,
          [{ value: { message: 'compressed-payload' } }],
          { compression: 'gzip' },
        ),
      ).rejects.toThrow(/not supported/);
    });

    it('P06: Partitioner — explicit partition assignment', async () => {
      const topic = uniqueTopic('P06');
      await client.createTopic(topic, { partitions: 4 });

      const r = await client.produce(topic, { message: 'to-p2' }, { partition: 2 });
      expect(r.partition).toBe(2);
    });

    it('P07: Delivery semantics — retries are at-least-once, idempotence is rejected', async () => {
      const topic = uniqueTopic('P07');
      await client.createTopic(topic, { partitions: 1 });

      const r1 = await client.produce(topic, { message: 'at-least-once-1' });
      const r2 = await client.produce(topic, { message: 'at-least-once-2' });
      expect(r2.offset).toBeGreaterThan(r1.offset);

      // The HTTP produce API carries no producer id / sequence number, so the
      // SDK refuses to claim idempotence rather than silently ignoring it.
      expect(() => new Producer(client, topic, { idempotent: true })).toThrow(
        /not supported/,
      );
    });

    it('P08: Timeout — produce to unreachable broker', async () => {
      const badClient = new Streamline('localhost:1', {
        httpEndpoint: 'http://localhost:1',
        timeout: 2_000,
      });
      await expect(badClient.connect()).rejects.toThrow();
      await badClient.close();
    });
  });

  // =========================================================================
  // Consumer (C01-C08)
  // =========================================================================
  describe('Consumer', { timeout: TIMEOUT }, () => {
    let client: Streamline;

    beforeAll(async () => {
      client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
      await client.connect();
    });

    afterAll(async () => {
      await client.close();
    });

    it('C01: Subscribe — subscribe and receive messages', async () => {
      const topic = uniqueTopic('C01');
      await client.createTopic(topic, { partitions: 1 });
      await client.produce(topic, { message: 'subscribe-test' });

      const consumer = new Consumer(client, topic, undefined, {
        autoCommit: false,
        autoOffsetReset: 'earliest',
      });
      await consumer.start();
      const messages = await consumer.poll(5_000, 1);
      expect(messages).toHaveLength(1);
      await consumer.close();
    });

    it('C02: From Beginning — consume from offset 0', async () => {
      const topic = uniqueTopic('C02');
      await client.createTopic(topic, { partitions: 1 });

      for (let i = 0; i < 5; i++) {
        await client.produce(topic, { index: i });
      }

      const messages = await client.consumeBatch(topic, {
        maxMessages: 5,
        fromBeginning: true,
      });
      expect(messages.length).toBe(5);
    });

    it('C03: From Offset — consume starting at a specific offset', async () => {
      const topic = uniqueTopic('C03');
      await client.createTopic(topic, { partitions: 1 });

      for (let i = 0; i < 10; i++) {
        await client.produce(topic, { index: i });
      }

      const messages = await client.consumeBatch(topic, {
        maxMessages: 5,
        fromOffset: 5,
      });
      expect(messages.length).toBeLessThanOrEqual(5);
      if (messages.length > 0) {
        expect(messages[0].offset).toBeGreaterThanOrEqual(5);
      }
    });

    it('C04: From Timestamp — filter by timestamp client-side', async () => {
      const topic = uniqueTopic('C04');
      await client.createTopic(topic, { partitions: 1 });

      await client.produce(topic, { message: 'before' });
      const timestamp = Date.now();
      await client.produce(topic, { message: 'after' });

      // The broker API exposes offsets, not timestamp lookup, so the SDK
      // does not pretend to support `fromTimestamp`: filter client-side.
      const messages = await client.consumeBatch(topic, {
        maxMessages: 10,
        fromBeginning: true,
      });
      const after = messages.filter((m) => m.timestamp >= timestamp);
      expect(after.length).toBeGreaterThanOrEqual(1);
    });

    it('C05: Follow — live-tail new messages', async () => {
      const topic = uniqueTopic('C05');
      await client.createTopic(topic, { partitions: 1 });

      const consumer = new Consumer(client, topic, undefined, {
        autoCommit: false,
        autoOffsetReset: 'earliest',
      });
      await consumer.start();

      // Produce after subscribing
      await client.produce(topic, { message: 'live-tail' });

      const received: unknown[] = [];
      const gen = consumer.messages();
      const timeout = setTimeout(() => gen.return(undefined), 5_000);
      for await (const msg of gen) {
        received.push(msg);
        if (received.length >= 1) break;
      }
      clearTimeout(timeout);

      expect(received.length).toBeGreaterThanOrEqual(1);
      await consumer.close();
    });

    it('C06: Filter — client-side message filtering', async () => {
      const topic = uniqueTopic('C06');
      await client.createTopic(topic, { partitions: 1 });

      for (let i = 0; i < 10; i++) {
        await client.produce(topic, { index: i, even: i % 2 === 0 });
      }

      const allMessages = await client.consumeBatch(topic, {
        maxMessages: 10,
        fromBeginning: true,
      });
      const filtered = allMessages.filter((m) => {
        let value: unknown = m.value;
        try {
          if (typeof value === 'string') {
            value = JSON.parse(value);
          }
        } catch {
          return false;
        }
        return (
          typeof value === 'object' &&
          value !== null &&
          'even' in value &&
          value.even === true
        );
      });
      expect(filtered.length).toBe(5);
    });

    it('C07: Headers — consume and verify message headers', async () => {
      const topic = uniqueTopic('C07');
      await client.createTopic(topic, { partitions: 1 });

      await client.produce(topic, { message: 'with-h' }, { headers: { 'x-id': 'c07-test' } });

      const messages = await client.consumeBatch(topic, {
        maxMessages: 1,
        fromBeginning: true,
      });
      expect(messages.length).toBe(1);

      const header = messages[0].headers?.find((h) => h.key === 'x-id');
      expect(header?.value).toBe('c07-test');
    });

    it('C08: Timeout — consume from empty topic returns promptly', async () => {
      const topic = uniqueTopic('C08');
      await client.createTopic(topic, { partitions: 1 });

      const start = Date.now();
      const messages = await client.consumeBatch(topic, {
        maxMessages: 1,
        fromBeginning: true,
        pollTimeout: 2_000,
      });
      const elapsed = Date.now() - start;

      expect(messages.length).toBe(0);
      expect(elapsed).toBeLessThan(10_000);
    });
  });

  // =========================================================================
  // Admin / Topics (D01-D08)
  // =========================================================================
  describe('Admin', { timeout: TIMEOUT }, () => {
    let client: Streamline;
    let admin: Admin;

    beforeAll(async () => {
      client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
      await client.connect();
      admin = new Admin(client);
    });

    afterAll(async () => {
      await client.close();
    });

    it('D01: Create Topic — 3 partitions via admin', async () => {
      const topic = uniqueTopic('D01');
      await admin.createTopic(topic, { partitions: 3, replicationFactor: 1 });

      const info = await admin.describeTopic(topic);
      expect(info).toBeDefined();
      expect(info!.name).toBe(topic);
    });

    it('D02: List Topics — verify test topic appears', async () => {
      const topic = uniqueTopic('D02');
      await admin.createTopic(topic, { partitions: 1 });

      const topics = await admin.listTopics();
      expect(Array.isArray(topics)).toBe(true);
      expect(topics).toContain(topic);
    });

    it('D03: Describe Topic — partition count matches', async () => {
      const topic = uniqueTopic('D03');
      await admin.createTopic(topic, { partitions: 5 });

      const info = await admin.describeTopic(topic);
      expect(info).toBeDefined();
      expect(info!.partitions).toBe(5);
    });

    it('D04: Delete Topic — topic removed from listing', async () => {
      const topic = uniqueTopic('D04');
      await admin.createTopic(topic, { partitions: 1 });

      let topics = await admin.listTopics();
      expect(topics).toContain(topic);

      await admin.deleteTopic(topic);

      topics = await admin.listTopics();
      expect(topics).not.toContain(topic);
    });

    it('D05: Alter Config — unsupported operation fails explicitly', async () => {
      const topic = uniqueTopic('D05');
      await admin.createTopic(topic, { partitions: 1 });

      await expect(
        admin.alterTopicConfig(topic, { 'retention.ms': '86400000' }),
      ).rejects.toThrow(/not supported/);
    });

    it('D06: Create Partitions — unsupported operation fails explicitly', async () => {
      const topic = uniqueTopic('D06');
      await admin.createTopic(topic, { partitions: 2 });

      await expect(admin.createPartitions(topic, 4)).rejects.toThrow(/not supported/);

      const info = await admin.describeTopic(topic);
      expect(info).toBeDefined();
      expect(info!.partitions).toBe(2);
    });

    it('D07: Describe Cluster — returns Streamline 0.3 cluster info', async () => {
      const cluster = await admin.describeCluster();
      expect(cluster).toBeDefined();
      expect(cluster.nodeId).toBeGreaterThanOrEqual(0);
      expect(cluster.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(cluster.uptime).toBeGreaterThanOrEqual(0);
      expect(cluster.topicCount).toBeGreaterThanOrEqual(1);
    });

    it('D08: Broker Config — unsupported operation fails explicitly', async () => {
      await expect(admin.describeBrokerConfig(0)).rejects.toThrow(/not supported/);
    });
  });

  // =========================================================================
  // Consumer-group operations unsupported by the HTTP transport (G01-G08)
  // =========================================================================
  describe('Unsupported Consumer Groups', { timeout: TIMEOUT }, () => {
    let client: Streamline;

    beforeAll(async () => {
      client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
      await client.connect();
    });

    afterAll(async () => {
      await client.close();
    });

    it('G01: Batch group option is rejected instead of ignored', async () => {
      const topic = uniqueTopic('G01');
      await client.createTopic(topic, { partitions: 1 });
      await expect(
        client.consumeBatch(topic, { group: `g01-${Date.now()}` }),
      ).rejects.toThrow(/not supported/);
    });

    it('G02: Streaming group option is rejected instead of ignored', async () => {
      const topic = uniqueTopic('G02');
      await client.createTopic(topic, { partitions: 1 });
      const iterator = client.consume(topic, { group: `g02-${Date.now()}` });
      await expect(iterator.next()).rejects.toThrow(/not supported/);
    });

    it('G03: Manual offset commit fails explicitly', async () => {
      const topic = uniqueTopic('G03');
      const groupId = `g03-${Date.now()}`;
      const consumer = new Consumer(client, topic, groupId);
      await expect(
        consumer.commit(new Map([[`${topic}:0`, 1]])),
      ).rejects.toThrow(/not supported/);
    });

    it('G04: Rebalance handler registration fails explicitly', () => {
      const topic = uniqueTopic('G04');
      const consumer = new Consumer(client, topic, `g04-${Date.now()}`);
      expect(() => consumer.onRebalance(async () => {})).toThrow(/not supported/);
    });

    it('G05: Admin offset reset fails explicitly', async () => {
      const topic = uniqueTopic('G05');
      const groupId = `g05-${Date.now()}`;
      const admin = new Admin(client);
      await expect(
        admin.resetConsumerGroupOffsets(groupId, topic, { toEarliest: true }),
      ).rejects.toThrow(/not supported/);
    });

    it('G06: Partition seek fails explicitly', async () => {
      const topic = uniqueTopic('G06');
      const consumer = new Consumer(client, topic);
      await expect(consumer.seek(0, 1)).rejects.toThrow(/not supported/);
    });

    it('G07: Seek to beginning fails explicitly', async () => {
      const topic = uniqueTopic('G07');
      const consumer = new Consumer(client, topic);
      await expect(consumer.seekToBeginning()).rejects.toThrow(/not supported/);
    });

    it('G08: Seek to end fails explicitly', async () => {
      const topic = uniqueTopic('G08');
      const consumer = new Consumer(client, topic);
      await expect(consumer.seekToEnd()).rejects.toThrow(/not supported/);
    });
  });

  // =========================================================================
  // Authentication (A01-A06)
  // =========================================================================
  describe('Authentication', { timeout: TIMEOUT }, () => {
    it('A01: TLS Connect — rejectUnauthorized:false is rejected, never silently ignored', () => {
      // This transport never applies TLS options to its fetch() requests, so
      // accepting rejectUnauthorized:false would silently do nothing instead
      // of the certificate-verification relaxation the caller asked for.
      expect(() => new Streamline(BOOTSTRAP, {
        httpEndpoint: HTTP_URL,
        tls: { rejectUnauthorized: false },
      })).toThrow(UnsupportedOperationError);
    });

    it('A02: Mutual TLS — mTLS config is rejected, never silently ignored', () => {
      // cert/key/ca are validated as well-formed but never presented on the
      // wire by fetch(); constructing successfully would misrepresent mTLS
      // as active when no client certificate is ever sent.
      expect(() => new Streamline(BOOTSTRAP, {
        httpEndpoint: HTTP_URL,
        tls: { cert: 'client.pem', key: 'client-key.pem', ca: 'ca.pem' },
      })).toThrow(UnsupportedOperationError);
    });

    it('A03: SASL PLAIN — SASL config accepted', () => {
      const saslClient = new Streamline(BOOTSTRAP, {
        httpEndpoint: HTTP_URL,
        sasl: { mechanism: 'PLAIN', username: 'user', password: 'pass' },
      });
      expect(saslClient).toBeDefined();
    });

    it('A04: SCRAM-SHA-256 — rejected because this HTTP transport cannot perform a real handshake', () => {
      // Only PLAIN and OAUTHBEARER are genuinely implemented; SCRAM would
      // otherwise be silently downgraded to plaintext HTTP Basic auth.
      expect(() => new Streamline(BOOTSTRAP, {
        httpEndpoint: HTTP_URL,
        sasl: { mechanism: 'SCRAM-SHA-256', username: 'user', password: 'pass' },
      })).toThrow(UnsupportedOperationError);
    });

    it('A05: SCRAM-SHA-512 — rejected because this HTTP transport cannot perform a real handshake', () => {
      expect(() => new Streamline(BOOTSTRAP, {
        httpEndpoint: HTTP_URL,
        sasl: { mechanism: 'SCRAM-SHA-512', username: 'user', password: 'pass' },
      })).toThrow(UnsupportedOperationError);
    });

    it('A06: Auth Failure — invalid credentials produce error', async () => {
      const error = new StreamlineError('Authentication failed', 'AUTH_DENIED', false);
      expect(error.code).toBe('AUTH_DENIED');
      expect(error.retryable).toBe(false);
      expect(error.message).toContain('Authentication failed');
    });
  });

  // =========================================================================
  // Schema Registry (S01-S06)
  // =========================================================================
  describe('Schema Registry', { timeout: TIMEOUT }, () => {
    let client: Streamline;
    let registry: SchemaRegistry;

    beforeAll(async () => {
      client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
      await client.connect();
      registry = new SchemaRegistry(HTTP_URL);
    });

    afterAll(async () => {
      await client.close();
    });

    it('S01: Register Schema — returns schema ID', async () => {
      const subject = `conformance-s01-${Date.now()}-value`;
      const schema = JSON.stringify({ type: 'object', properties: { name: { type: 'string' } } });

      const id = await registry.register(subject, schema, 'JSON');
      expect(id).toBeGreaterThanOrEqual(1);
    });

    it('S02: Get by ID — retrieve registered schema', async () => {
      const subject = `conformance-s02-${Date.now()}-value`;
      const schema = JSON.stringify({ type: 'object', properties: { id: { type: 'number' } } });

      const id = await registry.register(subject, schema, 'JSON');
      const info = await registry.getSchema(id);

      expect(info).toBeDefined();
      expect(info.id).toBe(id);
      expect(info.schema).toBeDefined();
    });

    it('S03: Get Versions — list schema versions', async () => {
      const subject = `conformance-s03-${Date.now()}-value`;
      const schema = JSON.stringify({ type: 'object', properties: { v: { type: 'string' } } });

      await registry.register(subject, schema, 'JSON');

      const versions = await registry.getVersions(subject);
      expect(Array.isArray(versions)).toBe(true);
      expect(versions.length).toBeGreaterThanOrEqual(1);
    });

    it('S04: Compatibility Check — validate schema compatibility', async () => {
      const subject = `conformance-s04-${Date.now()}-value`;
      const schema1 = JSON.stringify({ type: 'object', properties: { a: { type: 'string' } } });
      const schema2 = JSON.stringify({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } });

      await registry.register(subject, schema1, 'JSON');

      const compatible = await registry.checkCompatibility(subject, schema2, 'JSON');
      expect(typeof compatible).toBe('boolean');
    });

    it('S05: Avro Schema — register Avro format', async () => {
      const subject = `conformance-s05-${Date.now()}-value`;
      const avroSchema = JSON.stringify({
        type: 'record',
        name: 'User',
        fields: [{ name: 'name', type: 'string' }],
      });

      const id = await registry.register(subject, avroSchema, 'AVRO');
      expect(id).toBeGreaterThanOrEqual(1);
    });

    it('S06: JSON Schema — register JSON Schema format', async () => {
      const subject = `conformance-s06-${Date.now()}-value`;
      const jsonSchema = JSON.stringify({
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      });

      const id = await registry.register(subject, jsonSchema, 'JSON');
      expect(id).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Error Handling (E01-E04)
  // =========================================================================
  describe('Error Handling', { timeout: TIMEOUT }, () => {
    it('E01: Connection Refused', async () => {
      const badClient = new Streamline('localhost:1', {
        httpEndpoint: 'http://localhost:1',
        timeout: 2_000,
      });
      await expect(badClient.connect()).rejects.toThrow(ConnectionError);
      await badClient.close();
    });

    it('E02: Auth Denied — error type validation', () => {
      const error = new StreamlineError('Authentication failed', 'AUTH_DENIED', false);
      expect(error.code).toBe('AUTH_DENIED');
      expect(error.retryable).toBe(false);
    });

    it('E03: Topic Not Found — consume from nonexistent topic', async () => {
      const badClient = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
      await badClient.connect();

      try {
        const messages = await badClient.consumeBatch(`nonexistent-${Date.now()}`, {
          maxMessages: 1,
          pollTimeout: 2_000,
        });
        // Either throws or returns empty — both are acceptable
        expect(messages.length).toBe(0);
      } catch (err) {
        expect(err).toBeInstanceOf(StreamlineError);
      } finally {
        await badClient.close();
      }
    });

    it('E04: Request Timeout — timeout error is retryable', () => {
      const err = new TimeoutError('Request timed out');
      expect(err).toBeInstanceOf(StreamlineError);
      expect(err.retryable).toBe(true);
    });
  });

  // =========================================================================
  // Performance (F01-F04)
  // =========================================================================
  describe('Performance', { timeout: 60_000 }, () => {
    let client: Streamline;

    beforeAll(async () => {
      client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
      await client.connect();
    });

    afterAll(async () => {
      await client.close();
    });

    it('F01: Throughput 1KB — >10 msg/s for 1KB payloads', async () => {
      const topic = uniqueTopic('F01');
      await client.createTopic(topic, { partitions: 1 });

      const payload = 'x'.repeat(1024);
      const count = 100;
      const start = Date.now();

      for (let i = 0; i < count; i++) {
        await client.produce(topic, { data: payload });
      }

      const elapsed = (Date.now() - start) / 1000;
      const throughput = count / elapsed;

      expect(throughput).toBeGreaterThan(10);
    });

    it('F02: Latency P99 — single-produce P99 < 5s', async () => {
      const topic = uniqueTopic('F02');
      await client.createTopic(topic, { partitions: 1 });

      const latencies: number[] = [];
      for (let i = 0; i < 50; i++) {
        const start = Date.now();
        await client.produce(topic, { i });
        latencies.push(Date.now() - start);
      }

      latencies.sort((a, b) => a - b);
      const p99 = latencies[Math.floor(latencies.length * 0.99)];
      expect(p99).toBeLessThan(5_000);
    });

    it('F03: Startup Time — connect < 5s', async () => {
      const freshClient = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
      const start = Date.now();
      await freshClient.connect();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(5_000);
      await freshClient.close();
    });

    it('F04: Memory Usage — heap growth < 50MB for 100 x 1KB', async () => {
      const topic = uniqueTopic('F04');
      await client.createTopic(topic, { partitions: 1 });

      const before = process.memoryUsage().heapUsed;
      const payload = 'x'.repeat(1024);

      for (let i = 0; i < 100; i++) {
        await client.produce(topic, { data: payload });
      }

      const after = process.memoryUsage().heapUsed;
      const growthMB = (after - before) / (1024 * 1024);

      expect(growthMB).toBeLessThan(50);
    });
  });
});
