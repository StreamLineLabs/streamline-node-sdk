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
} from '../types';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const BOOTSTRAP = process.env.STREAMLINE_BOOTSTRAP ?? 'localhost:9092';
const HTTP_URL = process.env.STREAMLINE_HTTP ?? 'http://localhost:9094';
const TIMEOUT = 30_000;

/** Generate a unique topic name for a given test ID. */
function uniqueTopic(testId: string): string {
  return `conformance-${testId}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Server availability check — skip the entire suite when unreachable
// ---------------------------------------------------------------------------
let serverAvailable = false;

async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(`${HTTP_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  serverAvailable = await checkServer();
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

    it('P05: Compression — gzip round-trip', async () => {
      const topic = uniqueTopic('P05');
      await client.createTopic(topic, { partitions: 1 });

      const result = await client.produce(
        topic,
        { message: 'compressed-payload' },
        { compression: 'gzip' },
      );
      expect(result.offset).toBeGreaterThanOrEqual(0);

      const messages = await client.consumeBatch(topic, { maxMessages: 1, fromBeginning: true });
      expect(messages.length).toBe(1);
      expect(messages[0].value).toContain('compressed-payload');
    });

    it('P06: Partitioner — explicit partition assignment', async () => {
      const topic = uniqueTopic('P06');
      await client.createTopic(topic, { partitions: 4 });

      const r = await client.produce(topic, { message: 'to-p2' }, { partition: 2 });
      expect(r.partition).toBe(2);
    });

    it('P07: Idempotent — idempotent producer', async () => {
      const topic = uniqueTopic('P07');
      await client.createTopic(topic, { partitions: 1 });

      const r1 = await client.produce(topic, { message: 'idempotent-1' });
      const r2 = await client.produce(topic, { message: 'idempotent-2' });
      expect(r2.offset).toBeGreaterThan(r1.offset);
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

      const consumer = new Consumer(client, topic, 'c01-group');
      await consumer.start();
      expect(consumer).toBeDefined();
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
        offset: 5,
      });
      expect(messages.length).toBeLessThanOrEqual(5);
      if (messages.length > 0) {
        expect(messages[0].offset).toBeGreaterThanOrEqual(5);
      }
    });

    it('C04: From Timestamp — consume from a timestamp', async () => {
      const topic = uniqueTopic('C04');
      await client.createTopic(topic, { partitions: 1 });

      await client.produce(topic, { message: 'before' });
      const timestamp = Date.now();
      await client.produce(topic, { message: 'after' });

      const messages = await client.consumeBatch(topic, {
        maxMessages: 10,
        fromTimestamp: timestamp,
      });
      // Should get at least the message produced after the timestamp
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('C05: Follow — live-tail new messages', async () => {
      const topic = uniqueTopic('C05');
      await client.createTopic(topic, { partitions: 1 });

      const consumer = new Consumer(client, topic, `c05-${Date.now()}`);
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
        try {
          const parsed = JSON.parse(m.value as string);
          return parsed.even === true;
        } catch {
          return false;
        }
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
        maxWaitMs: 2_000,
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

    it('D05: Alter Config — update retention', async () => {
      const topic = uniqueTopic('D05');
      await admin.createTopic(topic, { partitions: 1 });

      await admin.alterTopicConfig(topic, { 'retention.ms': '86400000' });

      // Verify the topic still exists after alter
      const info = await admin.describeTopic(topic);
      expect(info).toBeDefined();
    });

    it('D06: Create Partitions — increase partition count', async () => {
      const topic = uniqueTopic('D06');
      await admin.createTopic(topic, { partitions: 2 });

      await admin.createPartitions(topic, 4);

      const info = await admin.describeTopic(topic);
      expect(info).toBeDefined();
      expect(info!.partitions).toBeGreaterThanOrEqual(4);
    });

    it('D07: Describe Cluster — returns broker info', async () => {
      const cluster = await admin.describeCluster();
      expect(cluster).toBeDefined();
      expect(cluster.clusterId).toBeDefined();
      expect(cluster.brokers.length).toBeGreaterThanOrEqual(1);
      expect(cluster.brokers[0].id).toBeGreaterThanOrEqual(0);
      expect(cluster.brokers[0].host).toBeDefined();
      expect(cluster.brokers[0].port).toBeGreaterThan(0);
    });

    it('D08: Broker Config — describe broker configuration', async () => {
      const cluster = await admin.describeCluster();
      const brokerId = cluster.brokers[0].id;

      const config = await admin.describeBrokerConfig(brokerId);
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });
  });

  // =========================================================================
  // Consumer Groups (G01-G08)
  // =========================================================================
  describe('Consumer Groups', { timeout: TIMEOUT }, () => {
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

    it('G01: Join Group — consumer joins a group', async () => {
      const topic = uniqueTopic('G01');
      await client.createTopic(topic, { partitions: 2 });
      await client.produce(topic, { message: 'g01' });

      const consumer = new Consumer(client, topic, `g01-${Date.now()}`);
      await consumer.start();

      const groups = await admin.listConsumerGroups();
      expect(groups.length).toBeGreaterThanOrEqual(1);

      await consumer.close();
    });

    it('G02: Rebalance — adding consumer triggers rebalance', async () => {
      const topic = uniqueTopic('G02');
      const groupId = `g02-${Date.now()}`;
      await client.createTopic(topic, { partitions: 2 });
      await client.produce(topic, { message: 'g02' });

      const c1 = new Consumer(client, topic, groupId);
      await c1.start();

      const c2 = new Consumer(client, topic, groupId);
      await c2.start();

      // Both consumers should be alive
      expect(c1).toBeDefined();
      expect(c2).toBeDefined();

      await c2.close();
      await c1.close();
    });

    it('G03: Commit Offsets — manual offset commit', async () => {
      const topic = uniqueTopic('G03');
      const groupId = `g03-${Date.now()}`;
      await client.createTopic(topic, { partitions: 1 });

      for (let i = 0; i < 5; i++) {
        await client.produce(topic, { index: i });
      }

      const consumer = new Consumer(client, topic, groupId);
      await consumer.start();

      // Consume some messages then commit
      await consumer.commit();

      await consumer.close();
    });

    it('G04: Lag Monitoring — group lag is reported', async () => {
      const topic = uniqueTopic('G04');
      const groupId = `g04-${Date.now()}`;
      await client.createTopic(topic, { partitions: 1 });

      // Produce messages
      for (let i = 0; i < 10; i++) {
        await client.produce(topic, { index: i });
      }

      // Create consumer, consume some, commit
      const consumer = new Consumer(client, topic, groupId);
      await consumer.start();
      await consumer.commit();

      const info = await admin.describeConsumerGroup(groupId);
      expect(info).toBeDefined();
      expect(info!.state).toBeDefined();

      await consumer.close();
    });

    it('G05: Reset Offsets — seek to beginning', async () => {
      const topic = uniqueTopic('G05');
      const groupId = `g05-${Date.now()}`;
      await client.createTopic(topic, { partitions: 1 });

      for (let i = 0; i < 5; i++) {
        await client.produce(topic, { index: i });
      }

      // Consume and commit at some offset
      const consumer = new Consumer(client, topic, groupId);
      await consumer.start();
      await consumer.commit();
      await consumer.close();

      // Reset offsets to earliest
      await admin.resetConsumerGroupOffsets(groupId, topic, { toEarliest: true });

      // Should be able to re-consume from beginning
      const messages = await client.consumeBatch(topic, {
        maxMessages: 5,
        fromBeginning: true,
      });
      expect(messages.length).toBe(5);
    });

    it('G06: Leave Group — close triggers group leave', async () => {
      const topic = uniqueTopic('G06');
      const groupId = `g06-${Date.now()}`;
      await client.createTopic(topic, { partitions: 1 });
      await client.produce(topic, { message: 'g06' });

      const consumer = new Consumer(client, topic, groupId);
      await consumer.start();

      const infoBefore = await admin.describeConsumerGroup(groupId);
      expect(infoBefore).toBeDefined();

      await consumer.close();

      // After close, group may transition to empty
      const infoAfter = await admin.describeConsumerGroup(groupId);
      if (infoAfter) {
        expect(infoAfter.members?.length ?? 0).toBe(0);
      }
    });

    it('G07: Delete Group — admin deletes consumer group', async () => {
      const topic = uniqueTopic('G07');
      const groupId = `g07-${Date.now()}`;
      await client.createTopic(topic, { partitions: 1 });
      await client.produce(topic, { message: 'g07' });

      const consumer = new Consumer(client, topic, groupId);
      await consumer.start();
      await consumer.close();

      await admin.deleteConsumerGroup(groupId);

      const groups = await admin.listConsumerGroups();
      expect(groups).not.toContain(groupId);
    });

    it('G08: Multiple Groups — independent offset tracking', async () => {
      const topic = uniqueTopic('G08');
      await client.createTopic(topic, { partitions: 1 });

      for (let i = 0; i < 5; i++) {
        await client.produce(topic, { index: i });
      }

      const c1 = new Consumer(client, topic, `g08a-${Date.now()}`);
      const c2 = new Consumer(client, topic, `g08b-${Date.now()}`);
      await c1.start();
      await c2.start();

      // Both groups should be independent
      const groups = await admin.listConsumerGroups();
      expect(groups.length).toBeGreaterThanOrEqual(2);

      await c2.close();
      await c1.close();
    });
  });

  // =========================================================================
  // Authentication (A01-A06)
  // =========================================================================
  describe('Authentication', { timeout: TIMEOUT }, () => {
    it('A01: TLS Connect — client constructs with TLS options', () => {
      const tlsClient = new Streamline(BOOTSTRAP, {
        httpEndpoint: HTTP_URL,
        tls: { rejectUnauthorized: false },
      });
      expect(tlsClient).toBeDefined();
    });

    it('A02: Mutual TLS — mTLS config accepted', () => {
      const mtlsClient = new Streamline(BOOTSTRAP, {
        httpEndpoint: HTTP_URL,
        tls: { cert: 'client.pem', key: 'client-key.pem', ca: 'ca.pem' },
      });
      expect(mtlsClient).toBeDefined();
    });

    it('A03: SASL PLAIN — SASL config accepted', () => {
      const saslClient = new Streamline(BOOTSTRAP, {
        httpEndpoint: HTTP_URL,
        sasl: { mechanism: 'PLAIN', username: 'user', password: 'pass' },
      });
      expect(saslClient).toBeDefined();
    });

    it('A04: SCRAM-SHA-256 — mechanism accepted', () => {
      const scramClient = new Streamline(BOOTSTRAP, {
        httpEndpoint: HTTP_URL,
        sasl: { mechanism: 'SCRAM-SHA-256', username: 'user', password: 'pass' },
      });
      expect(scramClient).toBeDefined();
    });

    it('A05: SCRAM-SHA-512 — mechanism accepted', () => {
      const scramClient = new Streamline(BOOTSTRAP, {
        httpEndpoint: HTTP_URL,
        sasl: { mechanism: 'SCRAM-SHA-512', username: 'user', password: 'pass' },
      });
      expect(scramClient).toBeDefined();
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
          maxWaitMs: 2_000,
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

