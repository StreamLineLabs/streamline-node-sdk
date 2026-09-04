# Streamline Node.js SDK

[![CI](https://github.com/streamlinelabs/streamline-node-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/streamlinelabs/streamline-node-sdk/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3%2B-blue.svg)](https://www.typescriptlang.org/)

A developer-friendly TypeScript/Node.js SDK for [Streamline](https://github.com/streamlinelabs/streamline) - The Redis of Streaming.

> **Transport:** the SDK communicates with Streamline over the broker's
> **HTTP/GraphQL API** (default `http://localhost:9094`). It does not open a
> Kafka wire-protocol connection and ships no Kafka client dependency. The
> bootstrap-servers argument is retained for Kafka-client familiarity and is
> readable via `client.bootstrapServers`, but requests are sent to
> `httpEndpoint`.

## Installation

> **Release status:** this package is **not yet published to the public npm
> registry** under the scoped name in `package.json`
> (`@streamlinelabs/sdk`). Until it is published, install it from a build of
> this repository:

```bash
git clone https://github.com/streamlinelabs/streamline-node-sdk.git
cd streamline-node-sdk
npm install
npm run build
npm pack                      # produces streamlinelabs-sdk-<version>.tgz

# then, from your project:
npm install /path/to/streamlinelabs-sdk-<version>.tgz
```

Imports in this document use the package name declared in `package.json`:

```typescript
import { Streamline } from '@streamlinelabs/sdk';
```

## Quick Start

```typescript
import { Streamline } from '@streamlinelabs/sdk';

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
- **Admin client**: Topic management and consumer groups via the HTTP/GraphQL API
- **SQL queries**: Execute SQL against streaming data via `client.query()`
- **Auto-batching**: Efficient client-side message batching for producers
- **Explicit consumer semantics**: Unsupported group commits, seeks, and
  rebalances fail with `UnsupportedOperationError` instead of reporting success
- **Retries**: Configurable retry with exponential backoff and jitter (at-least-once)
- **Circuit breaker**: Opt-in failure isolation for produce/HTTP calls
- **Reconnection**: Automatic health-check reconnection with configurable backoff
- **OpenTelemetry Tracing**: Optional distributed tracing for produce/consume operations
- **Honest failures**: APIs this transport cannot honour (rebalance callbacks,
  partition-scoped seeks, idempotent producer) throw `UnsupportedOperationError`
  instead of silently doing nothing
- **Embedded Mode** *(experimental, requires native Rust build)* — Run Streamline in-process via N-API bindings. Not included in the npm package; see `src/embedded.ts` for build instructions

### Not supported by this transport

| Kafka concept | Status |
|---|---|
| Group-aware HTTP consumption (`group` / `groupId`) | Throws `UnsupportedOperationError` — Streamline 0.3's HTTP messages query has no group argument |
| Offset commit/reset | Throws `UnsupportedOperationError` — Streamline 0.3 exposes no HTTP mutation for these operations |
| Group rebalance callbacks (`Consumer.onRebalance`) | Throws `UnsupportedOperationError` — the client never joins the group protocol |
| Seek (`Consumer.seek`, `seekToBeginning`, `seekToEnd`) | Throws `UnsupportedOperationError` — the HTTP API cannot reset consumer offsets |
| Idempotent / exactly-once producer (`idempotent: true`) | Throws `UnsupportedOperationError` — no producer id or sequence numbers exist over HTTP; delivery is at-least-once |
| HTTP batch compression | Any `compression` other than `none` throws; Streamline 0.3 exposes only single-message GraphQL production |
| `sessionTimeoutMs`, `heartbeatIntervalMs`, `autoOffsetReset: 'none'` | Rejected at construction time |
| Topic config, alter config, add partitions, delete groups, describe broker config | Throw `UnsupportedOperationError`; the 0.3 server omits or does not enforce these operations |
| Connection pooling / broker-level TLS handshake | Handled by the Node HTTP stack; use an `https://` `httpEndpoint` for transport security |

## OpenTelemetry Tracing

The SDK supports optional distributed tracing via `@opentelemetry/api` as an
optional peer dependency. When the package is not installed, the tracing layer
is a zero-overhead no-op.

### Setup

Install the optional tracing peers alongside the SDK (see
[Installation](#installation) for how the SDK itself is installed today):

```bash
npm install @opentelemetry/api @opentelemetry/sdk-node
```

### Usage

```typescript
import { StreamlineTracing } from '@streamlinelabs/sdk';

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
import { Streamline } from '@streamlinelabs/sdk';

const client = new Streamline('localhost:9092', {   // recorded, not dialled
  httpEndpoint: 'https://broker.example.com:9094',  // where requests actually go
  clientId: 'my-app',                               // sent as X-Client-Id
  apiKey: '...',                                    // sent as an Authorization header
  timeout: 30000,                                   // request timeout (ms)
  autoReconnect: true,                              // re-run health check on failure
  maxReconnectAttempts: 10,                         // max reconnect attempts
  reconnectDelay: 1000,                             // base reconnect delay (ms)
  maxReconnectDelay: 30000,                         // reconnect delay ceiling (ms)
});

await client.connect();

client.bootstrapServers; // 'localhost:9092' — diagnostics only
client.httpEndpoint;     // 'https://broker.example.com:9094'
```

> **Transport security:** use an `https://` `httpEndpoint`. The legacy `tls`
> option and the `tlsConfig` option are configuration containers used by
> `createTlsOptions()` for building Node TLS options; they are **not** applied
> to the SDK's HTTP requests.

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

`produceBatch()` preserves input order by issuing the supported Streamline 0.3
`produceMessage` mutation for each record. It is not a single atomic broker
batch, and non-`none` compression is rejected.

### Transactions

```typescript
const producer = new Producer(client, 'orders');
await producer.start();

await producer.beginTransaction();
const first = producer.send({ key: 'k1', value: 'v1' });
const second = producer.send({ key: 'k2', value: 'v2' });
try {
  await producer.commitTransaction();
  await Promise.all([first, second]);
} catch (err) {
  await Promise.allSettled([first, second]);
  throw err;
}
```

Do not await a buffered `send()` before `commitTransaction()`; its promise
settles when the buffered submission is committed or aborted.

> **Note:** Transactions are **client-side buffering**, not broker transactions.
> Commit submits records in order through single-message HTTP mutations. A
> failure can leave a written prefix, and retries can duplicate that prefix.
> There is no atomic visibility or exactly-once guarantee.

### Consuming Messages

```typescript
// Simple consume (async iterator)
for await (const msg of client.consume('topic')) {
  console.log(msg.value);
}

// With options
for await (const msg of client.consume('topic', {
  fromBeginning: true,
  maxMessages: 100,
  pollTimeout: 5000,     // idle delay between empty polls
})) {
  process(msg);
}

// Batch consume — `pollTimeout` bounds the request (a TimeoutError is thrown
// when it elapses). Supplying `group` throws UnsupportedOperationError.
const messages = await client.consumeBatch('topic', {
  maxMessages: 100,
  pollTimeout: 5000,
});
```

### Topic Management

```typescript
// List topics
const topics = await client.listTopics();

// Create topic
await client.createTopic('events', { partitions: 3 });

// Get topic info
const info = await client.topicInfo('events');
console.log(`Partitions: ${info?.partitions}`);

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
import { Streamline, Producer } from '@streamlinelabs/sdk';

const client = new Streamline('localhost:9092');
await client.connect();

const producer = new Producer(client, 'events', {
  batchSize: 1000,      // Flush after this many buffered records
  lingerMs: 10,         // Max wait before flush (ms)
  compression: 'none',  // Other values are unsupported over the 0.3 HTTP API
  retries: 3,           // Retry attempts (at-least-once)
  // idempotent: true   // Not supported — throws UnsupportedOperationError
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
import { Streamline, Consumer } from '@streamlinelabs/sdk';

const client = new Streamline('localhost:9092');
await client.connect();

const consumer = new Consumer(client, 'events', undefined, {
  autoCommit: false,
  autoOffsetReset: 'earliest',
  maxPollRecords: 500,
});

await consumer.start();

for await (const msg of consumer) {
  process(msg);
}

// Pause/resume never discards fetched records — they are held until resume
consumer.pause([0]);
consumer.resume([0]);

// Group-backed consumption, commits, rebalances, and seeks are deliberately
// rejected because the Streamline 0.3 HTTP API cannot honour them.
await consumer.close();
```

### Admin Operations

```typescript
import { Streamline, Admin } from '@streamlinelabs/sdk';

const client = new Streamline('localhost:9092');
await client.connect();

const admin = new Admin(client);

// List consumer groups
const groups = await admin.listConsumerGroups();

// Describe consumer group
const info = await admin.describeConsumerGroup('my-group');
console.log(`State: ${info?.state}`);
console.log(`Members: ${info?.memberCount}`);
```

## Error Handling

```typescript
import { Streamline, StreamlineError, ConnectionError, TopicNotFoundError } from '@streamlinelabs/sdk';

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

For integration testing, use the [`@streamlinelabs/testcontainers`](./testcontainers/) workspace to automatically spin up a Streamline container in your tests. No manual Docker setup required.

> **Release status:** like the SDK itself, this workspace is **not yet published
> to npm**. Build and consume it from this repository:

```bash
npm install                                   # installs the workspace too
npm run build --workspace @streamlinelabs/testcontainers
npm pack --workspace @streamlinelabs/testcontainers

# then, from your project:
npm install --save-dev /path/to/streamlinelabs-testcontainers-<version>.tgz
```

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StreamlineContainer, StartedStreamlineContainer } from '@streamlinelabs/testcontainers';
import { Streamline } from '@streamlinelabs/sdk';

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

## Requirements

- Core SDK runtime: Node.js 18 or later
- Repository development/full validation: Node.js 22.22 or later (required by
  the security-fixed Testcontainers v12 workspace)
- Streamline server 0.4.0 or later, reachable over its HTTP/GraphQL API

## Configuration Reference

Defaults below are the values the SDK actually applies.

### Client (`new Streamline(bootstrapServers, options)`)

| Parameter | Default | Description |
|---|---|---|
| `bootstrapServers` *(arg)* | *(required, non-empty)* | Recorded and exposed as `client.bootstrapServers`; not dialled |
| `httpEndpoint` | `STREAMLINE_URL` env or `http://localhost:9094` | HTTP/GraphQL endpoint every request is sent to |
| `clientId` | `streamline-nodejs` | Sent as the `X-Client-Id` header |
| `apiKey` | — | Sent as a bearer authorization header when no `auth`/`sasl` is set |
| `auth` | — | SASL config (`PLAIN`, `SCRAM-SHA-256/512`, `OAUTHBEARER`) mapped to HTTP auth headers |
| `sasl` | — | Legacy SASL config; superseded by `auth` |
| `tls` / `tlsConfig` | — | Configuration containers for `createTlsOptions()`; **not** applied to HTTP requests |
| `timeout` | `30000` | Total HTTP request deadline, including OAuth token acquisition (ms) |
| `autoReconnect` | `true` | Re-run the health check after a connection error while consuming |
| `maxReconnectAttempts` | `10` | Maximum reconnect attempts |
| `reconnectDelay` | `1000` | Base reconnect delay (ms) |
| `maxReconnectDelay` | `30000` | Reconnect delay ceiling (ms) |
| `circuitBreaker` | *(off)* | `true` or a `CircuitBreakerConfig` to wrap HTTP calls |

### Producer (`new Producer(client, topic, config)`)

| Parameter | Default | Description |
|---|---|---|
| `batchSize` | `1000` | Number of buffered **records** that triggers a flush |
| `lingerMs` | `100` | Time to wait before flushing a partial batch (ms) |
| `compression` | `none` | **Unsupported** for non-`none` values over the Streamline 0.3 HTTP API |
| `retries` | `3` | Retries on retryable failures (delivery is at-least-once) |
| `retryBackoffMs` | `100` | Base retry backoff (ms) |
| `maxRetryBackoffMs` | `30000` | Retry backoff ceiling (ms) |
| `idempotent` | `false` | **Unsupported**: `true` throws `UnsupportedOperationError` |
| `circuitBreaker` | — | Optional `CircuitBreaker` instance |

### Consumer (`new Consumer(client, topic, groupId?, config)`)

| Parameter | Default | Description |
|---|---|---|
| `groupId` *(arg)* | *(optional)* | Compatibility-only; `poll()`/`messages()` reject it because HTTP group consumption is unsupported |
| `autoOffsetReset` | `latest` | `earliest` or `latest`; `none` is rejected |
| `autoCommit` | `false` | **Unsupported**: `true` throws because the HTTP API cannot commit group offsets |
| `autoCommitIntervalMs` | — | **Unsupported**: setting it throws `UnsupportedOperationError` |
| `maxPollRecords` | `500` | Maximum records per poll |
| `sessionTimeoutMs` | — | **Unsupported**: setting it throws `UnsupportedOperationError` |
| `heartbeatIntervalMs` | — | **Unsupported**: setting it throws `UnsupportedOperationError` |
| `partition` | *(auto)* | This transport polls one partition per consumer. Omit it on a single-partition topic (unchanged); a topic with more than one partition throws `UnsupportedOperationError` on first `poll()`/iteration unless a partition is selected explicitly here |

### Security

| Parameter | Default | Description |
|---|---|---|
| `httpEndpoint` scheme | `http` | Use an `https://` endpoint for transport security |
| `auth.mechanism` | — | `PLAIN` and `OAUTHBEARER` are genuinely implemented. `SCRAM-SHA-256`/`SCRAM-SHA-512` throw `UnsupportedOperationError` at construction: this transport cannot perform a real SCRAM handshake and would otherwise downgrade silently to plaintext Basic auth |
| `auth.username` / `auth.password` | — | Credentials sent as HTTP Basic plus `X-Sasl-Mechanism` (`PLAIN` only) |
| `auth.oauthBearerProvider` | — | Async provider used to fetch a bearer token per request |
| `apiKey` | — | Bearer credential for the HTTP API when no SASL config is given |
| `tls.*` / `tlsConfig.*` | — | A bare `{ enabled: true }` (or legacy `tls: true`) is a documented no-op; `ca`, `cert`/`key`, `passphrase`, `servername`, and `rejectUnauthorized: false` throw `UnsupportedOperationError` at construction because they are never applied to the HTTP requests this transport makes |


## Circuit Breaker

Protect your application from cascading failures when the Streamline server is unresponsive:

```typescript
import { CircuitBreaker, CircuitState } from '@streamlinelabs/sdk';

const breaker = new CircuitBreaker({
  failureThreshold: 5,      // Open after 5 consecutive failures
  successThreshold: 2,      // Close after 2 half-open successes
  openTimeout: 30000,       // 30s before probing
  onStateChange: (from, to) => console.log(`Circuit: ${from} → ${to}`),
});

// Wrap any async operation
const result = await breaker.execute(async () => {
  return client.produce('events', { action: 'click' });
});

// Check state programmatically
if (breaker.getState() === CircuitState.Open) {
  console.log('Circuit is open — requests will be rejected');
}
```

When the circuit is open, `execute()` throws a retryable `StreamlineError` with code `CIRCUIT_OPEN`. See the [Circuit Breaker guide](https://streamlinelabs.dev/docs/features/circuit-breaker) for details.

## Examples

The [`examples/`](examples/) directory contains runnable examples:

| Example | Description |
|---------|-------------|
| [basic-usage.ts](examples/basic-usage.ts) | Produce, consume, and admin operations |
| [query-usage.ts](examples/query-usage.ts) | SQL analytics with the embedded query engine |
| [schema-registry.ts](examples/schema-registry.ts) | Schema registration and validation |
| [circuit-breaker.ts](examples/circuit-breaker.ts) | Resilient production with circuit breaker |
| [security.ts](examples/security.ts) | TLS and SASL authentication |

Run any example:

```bash
npx tsx examples/basic-usage.ts
```

## Moonshot Features

> ⚠️ **Experimental** — These features require Streamline server 0.3.0+ with moonshot feature flags enabled.

### Semantic Search

Query topics by meaning instead of offset. Requires a topic created with `semantic.embed=true`.

```typescript
import { SemanticSearchClient } from '@streamlinelabs/sdk';

const search = new SemanticSearchClient({ httpUrl: 'http://localhost:9094' });
const { hits } = await search.search('logs.app', 'payment failure', { k: 10 });
for (const hit of hits) {
  console.log(`[p${hit.partition}] offset=${hit.offset} score=${hit.score.toFixed(2)}`);
}
```

### Attestation Verification

Verify cryptographic provenance attestations attached to records by data contracts.

```typescript
import { StreamlineVerifier } from '@streamlinelabs/sdk';

// The key_id binds the public key to the identity it is trusted to sign as;
// an envelope claiming any other key_id never verifies. Verification also
// binds the envelope to the actual message's topic/partition/offset and to
// a hash of its actual raw bytes, so a header cannot be replayed onto a
// different record.
const verifier = new StreamlineVerifier(publicKeyBytes, 'broker-0');
const result = verifier.verify(record);
console.log(`Verified: ${result.verified}, Producer: ${result.producerId}`);
```

### Agent Memory

Use Streamline as persistent memory for AI agents via the broker's
`/api/v1/memory/*` HTTP API.

```typescript
import { MemoryClient } from '@streamlinelabs/sdk';

const memory = new MemoryClient({ httpUrl: 'http://localhost:9094' });
await memory.remember({
  agentId: 'assistant-1',
  kind: 'observation',
  content: 'user prefers dark mode',
  tags: ['preferences'],
});
const memories = await memory.recall({ agentId: 'assistant-1', query: 'user preferences', k: 5 });
```

### Branched Streams

Create topic branches for replay, A/B testing, or counterfactual analysis.

```typescript
// createBranch(branchName, baseTopic)
const branch = await admin.createBranch('experiment-v2', 'events');
for await (const msg of client.consume(branch.name)) {
  process(msg);
}
```

## Contributing

Contributions are welcome! Please see the [organization contributing guide](https://github.com/streamlinelabs/.github/blob/main/CONTRIBUTING.md) for guidelines.

## License

Apache-2.0

## Security

To report a security vulnerability, please email **security@streamlinelabs.dev**.
Do **not** open a public issue.

See this repository's [Security Policy](SECURITY.md) for supported versions and
response timelines.

## Environment Variables

| Variable | Read by | Description | Default |
|----------|---------|-------------|---------|
| `STREAMLINE_URL` | `Streamline` client | HTTP/GraphQL endpoint used when `httpEndpoint` is not passed | `http://localhost:9094` |
| `STREAMLINE_BOOTSTRAP` | conformance suite, examples | Bootstrap address recorded by the client | `localhost:9092` |
| `STREAMLINE_HTTP` | conformance suite, examples | HTTP endpoint used by the test/example harness | `http://localhost:9094` |
| `STREAMLINE_CONFORMANCE_REQUIRE` | conformance suite | When `1`/`true`, an unreachable server fails instead of skipping (defaults to on when `CI` is set) | unset |

No other `STREAMLINE_*` variables are consulted by the SDK; pass configuration
through `StreamlineOptions` instead.
