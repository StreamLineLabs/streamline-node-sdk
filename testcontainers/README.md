# Testcontainers Streamline (Node.js)

Testcontainers module for [Streamline](https://github.com/streamlinelabs/streamline) - The Redis of Streaming.

## Features

- Kafka-compatible container for integration testing
- Fast startup (~100ms vs seconds for Kafka)
- Low memory footprint (<50MB)
- No ZooKeeper or KRaft required
- Built-in health check wait strategy (HTTP /health endpoint)
- TypeScript-first with full type definitions
- Supports playground mode with pre-seeded demo topics
- Compatible with any Kafka client library for Node.js

## Installation

```bash
npm install --save-dev @streamline/testcontainers
# or
yarn add --dev @streamline/testcontainers
# or
pnpm add --save-dev @streamline/testcontainers
```

> **Prerequisites**: Docker must be running on your machine. The `testcontainers` npm package is included as a dependency.

## Usage

### Basic Usage

```typescript
import { StreamlineContainer } from '@streamline/testcontainers';

const container = await new StreamlineContainer().start();

// Get connection details
const bootstrapServers = container.getBootstrapServers();
const httpUrl = container.getHttpUrl();

console.log(`Kafka: ${bootstrapServers}`);
console.log(`HTTP: ${httpUrl}`);

// Use with any Kafka client library...

await container.stop();
```

### Integration with vitest

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StreamlineContainer, StartedStreamlineContainer } from '@streamline/testcontainers';

describe('My Kafka Integration', () => {
  let container: StartedStreamlineContainer;

  beforeAll(async () => {
    container = await new StreamlineContainer().start();
  }, 60_000); // allow time for image pull on first run

  afterAll(async () => {
    await container?.stop();
  });

  it('should connect and return bootstrap servers', () => {
    const servers = container.getBootstrapServers();
    expect(servers).toContain(':');
  });

  it('should respond to health checks', async () => {
    const response = await fetch(container.getHealthUrl());
    expect(response.status).toBe(200);
  });

  it('should create topics', async () => {
    await container.createTopic('test-topic', 3);
    await container.assertTopicExists('test-topic');
  });
});
```

### With Debug Logging

```typescript
const container = await new StreamlineContainer({
  logLevel: 'debug',
}).start();
```

### Playground Mode (Pre-seeded Topics)

```typescript
const container = await new StreamlineContainer({
  playground: true,
}).start();

// Demo topics are already available
```

### In-Memory Mode

```typescript
const container = await new StreamlineContainer({
  inMemory: true,
}).start();
```

### Specific Image Version

```typescript
const container = await new StreamlineContainer({
  tag: '0.2.0',
}).start();
```

### Custom Image

```typescript
const container = await new StreamlineContainer({
  image: 'my-registry.example.com/streamline:custom',
}).start();
```

### Create Topics Programmatically

```typescript
const container = await new StreamlineContainer().start();

// Single topic
await container.createTopic('events', 3);

// Multiple topics
await container.createTopics({
  'events': 3,
  'logs': 1,
  'metrics': 6,
});

// Wait for topics to be ready
await container.waitForTopics(['events', 'logs', 'metrics'], 5000);
```

### Produce Messages via CLI

```typescript
await container.produceMessage('events', 'hello world');
await container.produceMessage('events', '{"user": "alice"}', 'user-key');
```

### Access HTTP API

```typescript
const container = await new StreamlineContainer().start();

// Health check
const healthUrl = container.getHealthUrl();
const response = await fetch(healthUrl);

// Prometheus metrics
const metricsUrl = container.getMetricsUrl();
const metrics = await fetch(metricsUrl).then(r => r.text());

// Server info
const infoUrl = container.getInfoUrl();
```

### Custom Environment Variables

```typescript
const container = await new StreamlineContainer({
  environment: {
    'STREAMLINE_MAX_MESSAGE_SIZE': '10485760',
    'STREAMLINE_RETENTION_MS': '86400000',
  },
}).start();
```

### Cleanup Patterns

Using try/finally for guaranteed cleanup:

```typescript
const container = await new StreamlineContainer().start();
try {
  // Your test logic here
  const servers = container.getBootstrapServers();
  // ...
} finally {
  await container.stop();
}
```

Using vitest lifecycle hooks (recommended):

```typescript
import { beforeAll, afterAll } from 'vitest';
import { StreamlineContainer, StartedStreamlineContainer } from '@streamline/testcontainers';

let container: StartedStreamlineContainer;

beforeAll(async () => {
  container = await new StreamlineContainer().start();
}, 60_000);

afterAll(async () => {
  await container?.stop();
});
```

Sharing a container across test files with a vitest global setup:

```typescript
// vitest.setup.ts
import { StreamlineContainer, StartedStreamlineContainer } from '@streamline/testcontainers';

let container: StartedStreamlineContainer;

export async function setup() {
  container = await new StreamlineContainer({ logLevel: 'debug' }).start();
  process.env.STREAMLINE_BOOTSTRAP_SERVERS = container.getBootstrapServers();
  process.env.STREAMLINE_HTTP_URL = container.getHttpUrl();
}

export async function teardown() {
  await container?.stop();
}
```

## API Reference

### StreamlineContainer

The container builder. Configure options via the constructor, then call `start()`.

| Constructor Option | Type | Default | Description |
|---|---|---|---|
| `tag` | `string` | `"latest"` | Docker image tag |
| `image` | `string` | `ghcr.io/streamlinelabs/streamline:latest` | Full Docker image (overrides `tag`) |
| `logLevel` | `string` | `"info"` | Log level: trace, debug, info, warn, error |
| `inMemory` | `boolean` | `false` | Enable in-memory storage (no disk persistence) |
| `playground` | `boolean` | `false` | Enable playground mode (pre-seeded demo topics) |
| `startupTimeoutMs` | `number` | `30000` | Startup timeout in milliseconds |
| `environment` | `Record<string, string>` | `{}` | Additional environment variables |

| Method | Returns | Description |
|---|---|---|
| `start()` | `Promise<StartedStreamlineContainer>` | Start the container |

### StartedStreamlineContainer

The running container. Provides connection details and management operations.

| Method | Returns | Description |
|---|---|---|
| `getBootstrapServers()` | `string` | Kafka bootstrap servers string (`host:port`) |
| `getHttpUrl()` | `string` | HTTP API base URL |
| `getHealthUrl()` | `string` | Health check endpoint URL |
| `getMetricsUrl()` | `string` | Prometheus metrics endpoint URL |
| `getInfoUrl()` | `string` | Server info endpoint URL |
| `getKafkaPort()` | `number` | Mapped Kafka port on host |
| `getHttpPort()` | `number` | Mapped HTTP port on host |
| `getHost()` | `string` | Container host address |
| `createTopic(name, partitions?)` | `Promise<void>` | Create a topic (default: 1 partition) |
| `createTopics(topics)` | `Promise<void>` | Create multiple topics (name -> partitions) |
| `produceMessage(topic, value, key?)` | `Promise<void>` | Produce a message via CLI |
| `assertHealthy()` | `Promise<void>` | Assert health endpoint returns 200 |
| `assertTopicExists(name)` | `Promise<void>` | Assert a topic exists |
| `waitForTopics(topics, timeoutMs?)` | `Promise<void>` | Wait for topics to exist |
| `stop()` | `Promise<void>` | Stop the container |
| `getContainer()` | `StartedTestContainer` | Access underlying testcontainer |

## License

Apache-2.0
