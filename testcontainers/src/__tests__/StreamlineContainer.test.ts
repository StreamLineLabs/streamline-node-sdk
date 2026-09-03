import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for the container builder.
 *
 * The `testcontainers` module is mocked so these tests exercise the option →
 * container mapping without requiring a Docker daemon. Docker-backed coverage
 * lives in the SDK's conformance suite.
 */

interface RecordedContainer {
  image: string;
  ports: number[];
  environment: Record<string, string>;
  waitStrategy: { path: string; port: number; statusCode?: number; timeoutMs?: number };
  started: boolean;
}

const recorded: RecordedContainer[] = [];
let execOutput = '[]';

vi.mock('testcontainers', () => {
  class FakeWaitStrategy {
    statusCode: number | undefined;
    timeoutMs: number | undefined;

    constructor(
      public readonly path: string,
      public readonly port: number,
    ) {}

    forStatusCode(code: number): this {
      this.statusCode = code;
      return this;
    }

    withStartupTimeout(ms: number): this {
      this.timeoutMs = ms;
      return this;
    }
  }

  class FakeGenericContainer {
    private readonly state: RecordedContainer;

    constructor(image: string) {
      this.state = {
        image,
        ports: [],
        environment: {},
        waitStrategy: { path: '', port: 0 },
        started: false,
      };
      recorded.push(this.state);
    }

    withExposedPorts(...ports: number[]): this {
      this.state.ports = ports;
      return this;
    }

    withEnvironment(environment: Record<string, string>): this {
      this.state.environment = { ...this.state.environment, ...environment };
      return this;
    }

    withWaitStrategy(strategy: FakeWaitStrategy): this {
      this.state.waitStrategy = {
        path: strategy.path,
        port: strategy.port,
        ...(strategy.statusCode !== undefined ? { statusCode: strategy.statusCode } : {}),
        ...(strategy.timeoutMs !== undefined ? { timeoutMs: strategy.timeoutMs } : {}),
      };
      return this;
    }

    start(): Promise<Record<string, unknown>> {
      this.state.started = true;
      return Promise.resolve({
        getHost: () => 'test-host',
        getMappedPort: (port: number) => (port === 9092 ? 32_001 : 32_002),
        stop: () => Promise.resolve(),
        exec: () => Promise.resolve({ exitCode: 0, output: execOutput }),
      });
    }
  }

  return {
    GenericContainer: FakeGenericContainer,
    Wait: {
      forHttp: (path: string, port: number) => new FakeWaitStrategy(path, port),
    },
  };
});

const { StreamlineContainer } = await import('../StreamlineContainer');

beforeEach(() => {
  recorded.length = 0;
  execOutput = '[]';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StreamlineContainer', () => {
  it('uses the default image, ports and health wait strategy', () => {
    new StreamlineContainer();
    const state = recorded[0];
    expect(state.image).toBe('ghcr.io/streamlinelabs/streamline:0.4.0');
    expect(state.ports).toEqual([9092, 9094]);
    expect(state.waitStrategy).toEqual({
      path: '/health',
      port: 9094,
      statusCode: 200,
      timeoutMs: 30_000,
    });
  });

  it('honours an explicit tag', () => {
    new StreamlineContainer({ tag: '0.4.0' });
    expect(recorded[0].image).toBe('ghcr.io/streamlinelabs/streamline:0.4.0');
  });

  it('lets a full image override the tag', () => {
    new StreamlineContainer({ image: 'registry.example.com/streamline:custom', tag: '0.4.0' });
    expect(recorded[0].image).toBe('registry.example.com/streamline:custom');
  });

  it('maps log level, in-memory and playground options to environment variables', () => {
    new StreamlineContainer({ logLevel: 'debug', inMemory: true, playground: true });
    expect(recorded[0].environment).toMatchObject({
      STREAMLINE_LOG_LEVEL: 'debug',
      STREAMLINE_IN_MEMORY: 'true',
      STREAMLINE_PLAYGROUND: 'true',
      STREAMLINE_LISTEN_ADDR: '0.0.0.0:9092',
      STREAMLINE_HTTP_ADDR: '0.0.0.0:9094',
    });
  });

  it('omits optional mode flags when not requested', () => {
    new StreamlineContainer();
    expect(recorded[0].environment['STREAMLINE_IN_MEMORY']).toBeUndefined();
    expect(recorded[0].environment['STREAMLINE_PLAYGROUND']).toBeUndefined();
  });

  it('applies custom environment variables last', () => {
    new StreamlineContainer({
      logLevel: 'info',
      environment: { STREAMLINE_LOG_LEVEL: 'trace', STREAMLINE_RETENTION_MS: '1000' },
    });
    expect(recorded[0].environment['STREAMLINE_LOG_LEVEL']).toBe('trace');
    expect(recorded[0].environment['STREAMLINE_RETENTION_MS']).toBe('1000');
  });

  it('honours a custom startup timeout', () => {
    new StreamlineContainer({ startupTimeoutMs: 5_000 });
    expect(recorded[0].waitStrategy.timeoutMs).toBe(5_000);
  });

  it('supports chained withEnvironment builder calls', () => {
    new StreamlineContainer()
      .withEphemeral()
      .withEphemeralIdleTimeout(30)
      .withEphemeralAutoTopics('events:3');

    expect(recorded[0].environment).toMatchObject({
      STREAMLINE_EPHEMERAL: 'true',
      STREAMLINE_IN_MEMORY: 'true',
      STREAMLINE_EPHEMERAL_IDLE_TIMEOUT: '30',
      STREAMLINE_EPHEMERAL_AUTO_TOPICS: 'events:3',
    });
  });
});

describe('StartedStreamlineContainer', () => {
  it('exposes mapped connection details', async () => {
    const started = await new StreamlineContainer().start();
    expect(started.getBootstrapServers()).toBe('test-host:32001');
    expect(started.getHttpUrl()).toBe('http://test-host:32002');
    expect(started.getHealthUrl()).toBe('http://test-host:32002/health');
    expect(started.getMetricsUrl()).toBe('http://test-host:32002/metrics');
    expect(started.getInfoUrl()).toBe('http://test-host:32002/info');
    expect(started.getKafkaPort()).toBe(32_001);
    expect(started.getHttpPort()).toBe(32_002);
    expect(started.getHost()).toBe('test-host');
    await started.stop();
  });

  it('parses an empty consumer group listing', async () => {
    const started = await new StreamlineContainer().start();
    await expect(started.listConsumerGroups()).resolves.toEqual([]);
    await started.stop();
  });

  it('extracts group IDs from Streamline JSON objects', async () => {
    execOutput = JSON.stringify([
      { group_id: 'orders', state: 'Stable' },
      { group_id: 'billing', state: 'Empty' },
    ]);
    const started = await new StreamlineContainer().start();
    await expect(started.listConsumerGroups()).resolves.toEqual(['orders', 'billing']);
    await started.stop();
  });
});
