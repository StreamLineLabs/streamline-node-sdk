# Streamline Node.js SDK

[![CI](https://github.com/streamlinelabs/streamline-node-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/streamlinelabs/streamline-node-sdk/actions/workflows/ci.yml)
[![codecov](https://img.shields.io/codecov/c/github/streamlinelabs/streamline-node-sdk?style=flat-square)](https://codecov.io/gh/streamlinelabs/streamline-node-sdk)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue.svg)](https://www.typescriptlang.org/)
[![Docs](https://img.shields.io/badge/docs-streamlinelabs.dev-blue.svg)](https://streamlinelabs.dev/docs/sdks/node)

A developer-friendly TypeScript/Node.js SDK for [Streamline](https://github.com/streamlinelabs/streamline-node-sdk) - The Redis of Streaming.

## Installation

```bash
npm install streamline
# or
yarn add streamline
# or
pnpm add streamline
```

## Quick Start

```typescript
import { Streamline } from 'streamline';

async function main() {
  // Connect to Streamline
  const client = new Streamline('localhost:9092');
  await client.connect();

  // Create a topic
  await client.createTopic('events', { partitions: 3 });

  // Produce messages
  await client.produce('events', {
    user: 'alice',
    action: 'login',
    timestamp: new Date().toISOString(),
  });

  // Consume messages
  for await (const msg of client.consume('events', { fromBeginning: true })) {
    console.log('Got:', msg.value);
    if (msg.value.action === 'logout') {
      break;
    }
  }

  // Execute SQL query
  const results = await client.query(`
    SELECT user, COUNT(*) as count
    FROM streamline_topic('events')
    GROUP BY user
  `);
  console.log(results);

  await client.close();
}

main();
```

## Features

- **TypeScript-first**: Full type safety with comprehensive type definitions
- **Async/await**: Modern async API with async iterators for consumption
- **Auto-batching**: Efficient message batching for producers
- **Auto-commit**: Automatic offset management for consumers
- **Reconnection**: Automatic reconnection with configurable backoff
- **OpenTelemetry Tracing**: Optional distributed tracing for produce/consume operations

## OpenTelemetry Tracing

The SDK supports optional distributed tracing via `@opentelemetry/api` as an
optional peer dependency. When the package is not installed, the tracing layer
is a zero-overhead no-op.

### Setup

```bash
npm install streamline @opentelemetry/api @opentelemetry/sdk-node
```

### Usage

```typescript
import { StreamlineTracing } from 'streamline';

const tracing = new StreamlineTracing();

// Trace produce operations
const headers: Record<string, string> = {};
await tracing.traceProducer('orders', headers, async () => {
  return await producer.send({ value: orderData, headers });
});

// Trace consume operations
await tracing.traceConsumer('events', async () => {
  return await consumer.poll();
});

// Trace individual record processing (links to producer span)
await tracing.traceProcess('events', partition, offset, msg.headers, async () => {
  processMessage(msg);
});
```

### Span Conventions

| Attribute | Value |
|-----------|-------|
| Span name | `{topic} {operation}` (e.g., "orders produce") |
| `messaging.system` | `streamline` |
| `messaging.destination.name` | Topic name |
| `messaging.operation` | `produce`, `consume`, or `process` |
| Span kind | `PRODUCER` for produce, `CONSUMER` for consume |

Trace context is propagated via W3C TraceContext headers.

## API Reference

### Streamline Client

```typescript
import { Streamline } from 'streamline';

const client = new Streamline('localhost:9092', {
  httpEndpoint: 'http://localhost:9094',  // HTTP API endpoint
  clientId: 'my-app',                      // Client identifier
  apiKey: '...',                           // API key for auth
  tls: false,                              // Enable TLS
  timeout: 30000,                          // Request timeout (ms)
  autoReconnect: true,                     // Auto-reconnect on failure
  maxReconnectAttempts: 10,                // Max reconnect attempts
  reconnectDelay: 1000,                    // Base reconnect delay (ms)
});

await client.connect();
```

### Producing Messages

```typescript
// Simple produce
await client.produce('topic', { key: 'value' });

// With options
await client.produce('topic', { data: '...' }, {
  key: 'user-123',
  partition: 0,
  headers: { 'trace-id': 'abc123' },
});

// Batch produce
await client.produceBatch('topic', [
  { value: { event: 'a' } },
  { value: { event: 'b' }, key: 'key1' },
  { value: { event: 'c' }, partition: 2 },
]);
```

### Consuming Messages

```typescript
// Simple consume (async iterator)
for await (const msg of client.consume('topic')) {
  console.log(msg.value);
}

// With options
for await (const msg of client.consume('topic', {
  group: 'my-group',
  fromBeginning: true,
  maxMessages: 100,
  pollTimeout: 5000,
})) {
  process(msg);
}

// Batch consume
const messages = await client.consumeBatch('topic', { maxMessages: 100 });
```

### Topic Management

```typescript
// List topics
const topics = await client.listTopics();

// Create topic
await client.createTopic('events', { partitions: 3 });

// Get topic info
const info = await client.topicInfo('events');
console.log(`Partitions: ${info?.partitionCount}`);

// Delete topic
await client.deleteTopic('events');
```

### SQL Queries

```typescript
const results = await client.query(`
  SELECT
    date_trunc('hour', timestamp) as hour,
    COUNT(*) as count
  FROM streamline_topic('events')
  WHERE timestamp > now() - interval '24 hours'
  GROUP BY 1
  ORDER BY 1
`);

for (const row of results) {
  console.log(row);
}
```

## Advanced Usage

### High-Level Producer

```typescript
import { Streamline, Producer } from 'streamline';

const client = new Streamline('localhost:9092');
await client.connect();

const producer = new Producer(client, 'events', {
  batchSize: 1000,      // Max batch size
  lingerMs: 10,         // Max wait before flush
  compression: 'zstd',  // Compression type
  retries: 3,           // Retry attempts
  idempotent: true,     // Enable idempotence
});

await producer.start();

for (const event of events) {
  await producer.send({ value: event });
}

await producer.flush();
await producer.close();
```

### High-Level Consumer

```typescript
import { Streamline, Consumer } from 'streamline';

const client = new Streamline('localhost:9092');
await client.connect();

const consumer = new Consumer(client, 'events', 'my-app', {
  autoCommit: true,
  autoCommitIntervalMs: 5000,
  autoOffsetReset: 'earliest',
  maxPollRecords: 500,
});

await consumer.start();

for await (const msg of consumer) {
  process(msg);
  // Offsets auto-committed periodically
}

await consumer.close();
```

### Admin Operations

```typescript
import { Streamline, Admin } from 'streamline';

const client = new Streamline('localhost:9092');
await client.connect();

const admin = new Admin(client);

// List consumer groups
const groups = await admin.listConsumerGroups();

// Describe consumer group
const info = await admin.describeConsumerGroup('my-group');
console.log(`State: ${info?.state}`);
console.log(`Members: ${info?.members.length}`);
```

## Error Handling

```typescript
import { Streamline, StreamlineError, ConnectionError, TopicNotFoundError } from 'streamline';

try {
  const client = new Streamline('localhost:9092');
  await client.connect();
  await client.produce('topic', { data: '...' });
} catch (error) {
  if (error instanceof TopicNotFoundError) {
    console.error(`Topic not found: ${error.topic}`);
  } else if (error instanceof ConnectionError) {
    console.error('Connection failed:', error.message);
  } else if (error instanceof StreamlineError) {
    console.error(`Streamline error [${error.code}]: ${error.message}`);
    if (error.retryable) {
      // Can retry this operation
    }
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Testing

### Testcontainers

For integration testing, use the [`@streamline/testcontainers`](./testcontainers/) package to automatically spin up a Streamline container in your tests. No manual Docker setup required.

```bash
npm install --save-dev @streamline/testcontainers
```

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StreamlineContainer, StartedStreamlineContainer } from '@streamline/testcontainers';
import { Streamline } from 'streamline';

describe('My Integration Test', () => {
  let container: StartedStreamlineContainer;
  let client: Streamline;

  beforeAll(async () => {
    container = await new StreamlineContainer().start();
    client = new Streamline(container.getBootstrapServers(), {
      httpEndpoint: container.getHttpUrl(),
    });
    await client.connect();
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    await container?.stop();
  });

  it('should produce and consume messages', async () => {
    await client.produce('test-topic', { hello: 'world' });
    const messages = await client.consumeBatch('test-topic', {
      fromBeginning: true,
      maxMessages: 1,
    });
    expect(messages).toHaveLength(1);
  });
});
```

See the [testcontainers README](./testcontainers/README.md) for the full API reference, configuration options, and additional examples.

### Docker Compose

Alternatively, start a local Streamline server via Docker Compose:

```bash
docker compose -f docker-compose.test.yml up -d
```

Run tests:

```bash
npm test
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type checking
npm run typecheck

# Linting
npm run lint
```

## License

Apache-2.0

## Security

To report a security vulnerability, please email **security@streamline.dev**.
Do **not** open a public issue.

See the [Security Policy](https://github.com/streamlinelabs/streamline/blob/main/SECURITY.md) for details.
