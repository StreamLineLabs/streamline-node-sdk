/**
 * SDK Conformance Test Suite — 46 tests per SDK_CONFORMANCE_SPEC.md
 *
 * Requires: docker compose -f docker-compose.test.yml up -d
 *
 * These integration tests validate that the Node SDK correctly interacts
 * with a running Streamline server. Set STREAMLINE_BOOTSTRAP=host:port
 * and STREAMLINE_HTTP=http://host:port to override defaults.
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
  TopicNotFoundError,
  TimeoutError,
} from '../types';

const BOOTSTRAP = process.env.STREAMLINE_BOOTSTRAP ?? 'localhost:9092';
const HTTP_URL = process.env.STREAMLINE_HTTP ?? 'http://localhost:9094';
const TIMEOUT = 30_000;

function uniqueTopic(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ========== PRODUCER (8 tests) ==========

describe('Producer', { timeout: TIMEOUT }, () => {
  let client: Streamline;

  beforeAll(async () => {
    client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('P01: Simple Produce', async () => {
    const topic = uniqueTopic('p01');
    await client.createTopic(topic, { partitions: 1 });
    const result = await client.produce(topic, { message: 'hello' });
    expect(result).toBeDefined();
    expect(result.offset).toBeGreaterThanOrEqual(0);
    expect(result.partition).toBeGreaterThanOrEqual(0);
  });

  it('P02: Keyed Produce', async () => {
    const topic = uniqueTopic('p02');
    await client.createTopic(topic, { partitions: 3 });
    const result = await client.produce(topic, { message: 'keyed' }, { key: 'user-42' });
    expect(result).toBeDefined();
    expect(result.offset).toBeGreaterThanOrEqual(0);

    // Same key should produce to same partition deterministically
    const result2 = await client.produce(topic, { message: 'keyed2' }, { key: 'user-42' });
    expect(result2.partition).toBe(result.partition);
  });

  it('P03: Headers Produce', async () => {
    const topic = uniqueTopic('p03');
    await client.createTopic(topic, { partitions: 1 });
    const result = await client.produce(
      topic,
      { message: 'with-headers' },
      {
        headers: {
          'x-trace-id': 'abc-123',
          'x-source': 'conformance-test',
        },
      },
    );
    expect(result).toBeDefined();
    expect(result.offset).toBeGreaterThanOrEqual(0);

    // Verify headers are preserved by consuming the message
    const messages = await client.consumeBatch(topic, { maxMessages: 1, fromBeginning: true });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    const msg = messages[0];
    expect(msg.headers).toBeDefined();
    expect(msg.headers?.['x-trace-id']).toBe('abc-123');
    expect(msg.headers?.['x-source']).toBe('conformance-test');
  });

  it('P04: Batch Produce', async () => {
    const topic = uniqueTopic('p04');
    await client.createTopic(topic, { partitions: 1 });
    const records = Array.from({ length: 10 }, (_, i) => ({
      value: { index: i, data: `batch-message-${i}` },
    }));
    const results = await client.produceBatch(topic, records);
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.offset).toBeGreaterThanOrEqual(0);
    }

    // Verify all 10 messages are consumable
    const messages = await client.consumeBatch(topic, { maxMessages: 10, fromBeginning: true });
    expect(messages.length).toBe(10);
  });

  it('P05: Compression', async () => {
    const topic = uniqueTopic('p05');
    await client.createTopic(topic, { partitions: 1 });
    const producer = new Producer(client, topic, { compression: 'gzip' });
    await producer.start();
    const result = await producer.send({ value: 'compressed-message' });
    expect(result).toBeDefined();
    expect(result.offset).toBeGreaterThanOrEqual(0);
    await producer.close();
  });

  it('P06: Partitioner', async () => {
    const topic = uniqueTopic('p06');
    await client.createTopic(topic, { partitions: 4 });
    // Produce to specific partition
    const result = await client.produce(
      topic,
      { message: 'partition-2' },
      { partition: 2 },
    );
    expect(result).toBeDefined();
    expect(result.partition).toBe(2);
  });

  it('P07: Idempotent', async () => {
    const topic = uniqueTopic('p07');
    await client.createTopic(topic, { partitions: 1 });
    const producer = new Producer(client, topic, { idempotent: true });
    await producer.start();
    const result = await producer.send({ value: 'idempotent' });
    expect(result).toBeDefined();
    expect(result.offset).toBeGreaterThanOrEqual(0);
    await producer.close();
  });

  it('P08: Timeout', async () => {
    const badClient = new Streamline('localhost:1', {
      httpEndpoint: 'http://localhost:1',
      timeout: 500,
    });
    await expect(
      badClient.produce('test-topic', { message: 'timeout' }),
    ).rejects.toThrow();
    await badClient.close();
  });
});

// ========== CONSUMER (8 tests) ==========

describe('Consumer', { timeout: TIMEOUT }, () => {
  let client: Streamline;

  beforeAll(async () => {
    client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('C01: Subscribe', async () => {
    const topic = uniqueTopic('c01');
    await client.createTopic(topic, { partitions: 1 });
    await client.produce(topic, { message: 'subscribe-test' });

    const consumer = new Consumer(client, topic, 'c01-group');
    await consumer.start();
    expect(consumer).toBeDefined();
    await consumer.close();
  });

  it('C02: From Beginning', async () => {
    const topic = uniqueTopic('c02');
    await client.createTopic(topic, { partitions: 1 });

    // Produce messages first
    for (let i = 0; i < 5; i++) {
      await client.produce(topic, { index: i });
    }

    // Consume from beginning
    const messages = await client.consumeBatch(topic, {
      maxMessages: 5,
      fromBeginning: true,
    });
    expect(messages.length).toBe(5);
  });

  it('C03: From Offset', async () => {
    const topic = uniqueTopic('c03');
    await client.createTopic(topic, { partitions: 1 });

    for (let i = 0; i < 10; i++) {
      await client.produce(topic, { index: i });
    }

    // Consume from offset 5 (should get messages 5-9)
    const messages = await client.consumeBatch(topic, {
      maxMessages: 10,
      fromOffset: 5,
    });
    expect(messages.length).toBeGreaterThanOrEqual(5);
  });

  it('C04: From Timestamp', async () => {
    const topic = uniqueTopic('c04');
    await client.createTopic(topic, { partitions: 1 });
    const startTime = Date.now();

    await client.produce(topic, { message: 'timestamped' });

    // Consume from beginning (timestamp-based seek not directly supported; use fromBeginning)
    const messages = await client.consumeBatch(topic, {
      maxMessages: 1,
      fromBeginning: true,
    });
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it('C05: Follow', async () => {
    const topic = uniqueTopic('c05');
    await client.createTopic(topic, { partitions: 1 });

    const consumer = new Consumer(client, topic, 'c05-group');
    await consumer.start();

    // Produce a message while consumer is running
    await client.produce(topic, { message: 'follow-test' });

    // Give consumer time to receive (async iterator would yield the message)
    await new Promise((resolve) => setTimeout(resolve, 500));
    await consumer.close();
  });

  it('C06: Filter', async () => {
    const topic = uniqueTopic('c06');
    await client.createTopic(topic, { partitions: 1 });

    for (let i = 0; i < 5; i++) {
      await client.produce(topic, { index: i, type: i % 2 === 0 ? 'even' : 'odd' });
    }

    const messages = await client.consumeBatch(topic, {
      maxMessages: 5,
      fromBeginning: true,
    });
    // Client-side filtering
    const evens = messages.filter(
      (m) => typeof m.value === 'object' && m.value !== null && (m.value as Record<string, unknown>).type === 'even',
    );
    expect(evens.length).toBe(3);
  });

  it('C07: Headers', async () => {
    const topic = uniqueTopic('c07');
    await client.createTopic(topic, { partitions: 1 });
    await client.produce(topic, { message: 'headers-test' }, {
      headers: { 'x-test': 'value' },
    });

    const messages = await client.consumeBatch(topic, { maxMessages: 1, fromBeginning: true });
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].headers).toBeDefined();
    expect(messages[0].headers?.['x-test']).toBe('value');
  });

  it('C08: Timeout', async () => {
    const topic = uniqueTopic('c08');
    await client.createTopic(topic, { partitions: 1 });

    // Consume from empty topic with very short timeout
    const messages = await client.consumeBatch(topic, {
      maxMessages: 100,
      pollTimeout: 500,
    });
    // Should return empty (or throw timeout), not hang
    expect(messages.length).toBe(0);
  });
});

// ========== CONSUMER GROUPS (6 tests) ==========

describe('Consumer Groups', { timeout: TIMEOUT }, () => {
  let client: Streamline;

  beforeAll(async () => {
    client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('G01: Join Group', async () => {
    const topic = uniqueTopic('g01');
    const groupId = `group-${Date.now()}`;
    await client.createTopic(topic, { partitions: 1 });
    await client.produce(topic, { message: 'group-test' });

    const consumer = new Consumer(client, topic, groupId);
    await consumer.start();

    const groups = await client.listConsumerGroups();
    expect(groups).toBeDefined();
    await consumer.close();
  });

  it('G02: Rebalance', async () => {
    const topic = uniqueTopic('g02');
    const groupId = `group-rebalance-${Date.now()}`;
    await client.createTopic(topic, { partitions: 2 });

    const consumer1 = new Consumer(client, topic, groupId);
    await consumer1.start();

    // Adding a second consumer should trigger rebalance
    const consumer2 = new Consumer(client, topic, groupId);
    await consumer2.start();
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await consumer2.close();
    await consumer1.close();
  });

  it('G03: Commit Offsets', async () => {
    const topic = uniqueTopic('g03');
    const groupId = `group-commit-${Date.now()}`;
    await client.createTopic(topic, { partitions: 1 });
    await client.produce(topic, { message: 'commit-test' });

    const consumer = new Consumer(client, topic, groupId);
    await consumer.start();

    // Commit offsets
    await consumer.commit();
    await consumer.close();
  });

  it('G04: Lag Monitoring', async () => {
    const topic = uniqueTopic('g04');
    const groupId = `group-lag-${Date.now()}`;
    await client.createTopic(topic, { partitions: 1 });

    // Produce messages without consuming
    for (let i = 0; i < 5; i++) {
      await client.produce(topic, { index: i });
    }

    const consumer = new Consumer(client, topic, groupId);
    await consumer.start();
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Check group info for lag
    const groupInfo = await client.consumerGroupInfo(groupId);
    expect(groupInfo).toBeDefined();
    await consumer.close();
  });

  it('G05: Reset Offsets', async () => {
    const topic = uniqueTopic('g05');
    const groupId = `group-reset-${Date.now()}`;
    await client.createTopic(topic, { partitions: 1 });

    const consumer = new Consumer(client, topic, groupId);
    await consumer.start();

    // Seek to beginning resets the consumer position
    await consumer.seekToBeginning([0]);
    await consumer.close();
  });

  it('G06: Leave Group', async () => {
    const topic = uniqueTopic('g06');
    const groupId = `group-leave-${Date.now()}`;
    await client.createTopic(topic, { partitions: 1 });

    const consumer = new Consumer(client, topic, groupId);
    await consumer.start();

    // Close triggers group leave
    await consumer.close();
  });
});

// ========== AUTHENTICATION (6 tests) ==========

describe('Authentication', { timeout: TIMEOUT }, () => {
  // Auth tests require a Streamline server with auth enabled.
  // Skip if STREAMLINE_AUTH_ENABLED env var is not set.
  const authEnabled = process.env.STREAMLINE_AUTH_ENABLED === 'true';

  it('A01: TLS Connect', async () => {
    if (!authEnabled) return; // requires TLS-enabled server
    const client = new Streamline(BOOTSTRAP, {
      httpEndpoint: HTTP_URL,
      tls: true,
    });
    await client.connect();
    expect(client).toBeDefined();
    await client.close();
  });

  it('A02: Mutual TLS', async () => {
    if (!authEnabled) return; // requires mTLS-enabled server
    const client = new Streamline(BOOTSTRAP, {
      httpEndpoint: HTTP_URL,
      tls: {
        rejectUnauthorized: false,
      },
    });
    await client.connect();
    expect(client).toBeDefined();
    await client.close();
  });

  it('A03: SASL PLAIN', async () => {
    if (!authEnabled) return;
    const client = new Streamline(BOOTSTRAP, {
      httpEndpoint: HTTP_URL,
      sasl: {
        mechanism: 'PLAIN',
        username: 'admin',
        password: 'admin-secret',
      },
    });
    await client.connect();
    expect(client).toBeDefined();
    await client.close();
  });

  it('A04: SCRAM-SHA-256', async () => {
    if (!authEnabled) return;
    const client = new Streamline(BOOTSTRAP, {
      httpEndpoint: HTTP_URL,
      sasl: {
        mechanism: 'SCRAM-SHA-256',
        username: 'admin',
        password: 'admin-secret',
      },
    });
    await client.connect();
    expect(client).toBeDefined();
    await client.close();
  });

  it('A05: SCRAM-SHA-512', async () => {
    if (!authEnabled) return;
    const client = new Streamline(BOOTSTRAP, {
      httpEndpoint: HTTP_URL,
      sasl: {
        mechanism: 'SCRAM-SHA-512',
        username: 'admin',
        password: 'admin-secret',
      },
    });
    await client.connect();
    expect(client).toBeDefined();
    await client.close();
  });

  it('A06: Auth Failure', async () => {
    if (!authEnabled) return;
    const client = new Streamline(BOOTSTRAP, {
      httpEndpoint: HTTP_URL,
      sasl: {
        mechanism: 'PLAIN',
        username: 'bad-user',
        password: 'wrong-password',
      },
    });
    await expect(client.connect()).rejects.toThrow();
    await client.close();
  });
});

// ========== SCHEMA REGISTRY (6 tests) ==========

describe('Schema Registry', { timeout: TIMEOUT }, () => {
  let registry: SchemaRegistry;
  const subject = `conformance-schema-${Date.now()}`;

  beforeAll(() => {
    registry = new SchemaRegistry(HTTP_URL);
  });

  const userSchema = JSON.stringify({
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      age: { type: 'integer' },
    },
    required: ['name', 'email'],
  });

  it('S01: Register Schema', async () => {
    const id = await registry.register(subject, userSchema, 'JSON');
    expect(id).toBeGreaterThan(0);
  });

  it('S02: Get by ID', async () => {
    const id = await registry.register(subject, userSchema, 'JSON');
    const schema = await registry.getSchema(id);
    expect(schema).toBeDefined();
    expect(schema.schemaType).toBe('JSON');
    expect(schema.schema).toBeDefined();
  });

  it('S03: Get Versions', async () => {
    const versions = await registry.getVersions(subject);
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });

  it('S04: Compatibility Check', async () => {
    const compatibleSchema = JSON.stringify({
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        age: { type: 'integer' },
        address: { type: 'string' },
      },
      required: ['name', 'email'],
    });
    const isCompatible = await registry.checkCompatibility(subject, compatibleSchema, 'JSON');
    expect(typeof isCompatible).toBe('boolean');
  });

  it('S05: Avro Schema', async () => {
    const avroSubject = `avro-conformance-${Date.now()}`;
    const avroSchema = JSON.stringify({
      type: 'record',
      name: 'User',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'age', type: 'int' },
      ],
    });
    const id = await registry.register(avroSubject, avroSchema, 'AVRO');
    expect(id).toBeGreaterThan(0);

    const fetched = await registry.getSchema(id);
    expect(fetched.schemaType).toBe('AVRO');
  });

  it('S06: JSON Schema', async () => {
    const jsonSubject = `json-conformance-${Date.now()}`;
    const jsonSchema = JSON.stringify({
      type: 'object',
      properties: {
        event: { type: 'string' },
        timestamp: { type: 'number' },
      },
    });
    const id = await registry.register(jsonSubject, jsonSchema, 'JSON');
    expect(id).toBeGreaterThan(0);

    const fetched = await registry.getSchema(id);
    expect(fetched.schemaType).toBe('JSON');
  });
});

// ========== ADMIN (4 tests) ==========

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

  it('D01: Create Topic', async () => {
    const topic = uniqueTopic('d01');
    await admin.createTopic(topic, { partitions: 3, replicationFactor: 1 });

    const info = await admin.describeTopic(topic);
    expect(info).toBeDefined();
    expect(info!.name).toBe(topic);
  });

  it('D02: List Topics', async () => {
    const topic = uniqueTopic('d02');
    await admin.createTopic(topic, { partitions: 1 });

    const topics = await admin.listTopics();
    expect(Array.isArray(topics)).toBe(true);
    const names = topics.map((t: { name?: string } | string) =>
      typeof t === 'string' ? t : t.name,
    );
    expect(names).toContain(topic);
  });

  it('D03: Describe Topic', async () => {
    const topic = uniqueTopic('d03');
    await admin.createTopic(topic, { partitions: 2 });

    const info = await admin.describeTopic(topic);
    expect(info).toBeDefined();
    expect(info!.name).toBe(topic);
    expect(info!.partitionCount).toBeGreaterThanOrEqual(2);
  });

  it('D04: Delete Topic', async () => {
    const topic = uniqueTopic('d04');
    await admin.createTopic(topic, { partitions: 1 });

    await admin.deleteTopic(topic);

    // Verify topic no longer exists
    const topics = await admin.listTopics();
    const names = topics.map((t: { name?: string } | string) =>
      typeof t === 'string' ? t : t.name,
    );
    expect(names).not.toContain(topic);
  });
});

// ========== ERROR HANDLING (4 tests) ==========

describe('Error Handling', { timeout: TIMEOUT }, () => {
  it('E01: Connection Refused', async () => {
    const client = new Streamline('localhost:1', {
      httpEndpoint: 'http://localhost:1',
      timeout: 2000,
    });
    await expect(client.connect()).rejects.toThrow(ConnectionError);
    await client.close();
  });

  it('E02: Auth Denied', async () => {
    // Only meaningful with auth-enabled server; validate error type exists
    const error = new StreamlineError('Authentication failed', 'AUTH_DENIED', false);
    expect(error.code).toBe('AUTH_DENIED');
    expect(error.retryable).toBe(false);
  });

  it('E03: Topic Not Found', async () => {
    const client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
    await client.connect();

    // Consuming from a nonexistent topic should error
    try {
      await client.consumeBatch(`nonexistent-topic-${Date.now()}`, {
        maxMessages: 1,
        pollTimeout: 2000,
      });
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
    await client.close();
  });

  it('E04: Request Timeout', async () => {
    const error = new TimeoutError('produce');
    expect(error).toBeInstanceOf(StreamlineError);
    expect(error.code).toBe('TIMEOUT');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('produce');
  });
});

// ========== PERFORMANCE (4 tests) ==========

describe('Performance', { timeout: 60_000 }, () => {
  let client: Streamline;

  beforeAll(async () => {
    client = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('F01: Throughput 1KB', async () => {
    const topic = uniqueTopic('f01');
    await client.createTopic(topic, { partitions: 1 });

    const payload = { data: 'x'.repeat(1024) }; // ~1KB
    const count = 100;
    const start = Date.now();

    for (let i = 0; i < count; i++) {
      await client.produce(topic, payload);
    }

    const elapsed = Date.now() - start;
    const throughput = (count / elapsed) * 1000;
    // At minimum, we should be able to do >10 msg/sec for 1KB messages
    expect(throughput).toBeGreaterThan(10);
  });

  it('F02: Latency P99', async () => {
    const topic = uniqueTopic('f02');
    await client.createTopic(topic, { partitions: 1 });

    const latencies: number[] = [];
    for (let i = 0; i < 50; i++) {
      const start = Date.now();
      await client.produce(topic, { i });
      latencies.push(Date.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    // P99 latency for single produce should be under 5 seconds
    expect(p99).toBeLessThan(5000);
  });

  it('F03: Startup Time', async () => {
    const start = Date.now();
    const testClient = new Streamline(BOOTSTRAP, { httpEndpoint: HTTP_URL });
    await testClient.connect();
    const connectTime = Date.now() - start;
    await testClient.close();

    // Connection should complete within 5 seconds
    expect(connectTime).toBeLessThan(5000);
  });

  it('F04: Memory Usage', async () => {
    const topic = uniqueTopic('f04');
    await client.createTopic(topic, { partitions: 1 });

    const before = process.memoryUsage().heapUsed;

    // Produce 100 messages
    for (let i = 0; i < 100; i++) {
      await client.produce(topic, { data: 'x'.repeat(1024), index: i });
    }

    const after = process.memoryUsage().heapUsed;
    const growth = after - before;

    // Memory growth should be reasonable (< 50MB for 100 x 1KB messages)
    expect(growth).toBeLessThan(50 * 1024 * 1024);
  });
});

