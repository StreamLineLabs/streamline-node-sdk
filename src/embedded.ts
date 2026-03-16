/**
 * Embedded Streamline server running in-process via N-API native bindings.
 *
 * **⚠️ EXPERIMENTAL**: This module requires a native Rust binary that is NOT
 * included in the published npm package. To use embedded mode:
 *
 * 1. Install Rust toolchain: https://rustup.rs
 * 2. Build the native module: `cd native && npm run build`
 * 3. The compiled `streamline.node` binary must be in the `native/` directory
 *
 * For most use cases, prefer the standard `Streamline` client connecting to
 * a remote server, or use Docker for local development:
 * ```
 * docker run -d -p 9092:9092 -p 9094:9094 ghcr.io/streamlinelabs/streamline:latest
 * ```
 *
 * @experimental
 *
 * @example
 * ```typescript
 * import { EmbeddedStreamline } from 'streamline-sdk/embedded';
 *
 * const instance = new EmbeddedStreamline({ inMemory: true });
 * await instance.produce('my-topic', Buffer.from('hello'));
 * const msg = await instance.consume('my-topic', 5000);
 * instance.close();
 * ```
 */

export interface EmbeddedConfig {
  dataDir?: string;
  inMemory?: boolean;
  partitions?: number;
}

export interface EmbeddedMessage {
  topic: string;
  partition: number;
  offset: number;
  key: Buffer | null;
  value: Buffer;
  timestamp: number;
}

/**
 * Embedded Streamline instance.
 * 
 * Note: This is a type-safe wrapper. The actual native bindings
 * must be compiled from the Rust FFI layer using napi-rs or node-bindgen.
 * See streamline/include/streamline.h for the C API.
 */
export class EmbeddedStreamline {
  private native: unknown; // Native binding handle
  private closed = false;

  private static _nativeAvailable: boolean | null = null;

  /**
   * Check if the native module is available.
   */
  static get isAvailable(): boolean {
    if (EmbeddedStreamline._nativeAvailable === null) {
      try {
        require('../native/streamline.node');
        EmbeddedStreamline._nativeAvailable = true;
      } catch {
        EmbeddedStreamline._nativeAvailable = false;
      }
    }
    return EmbeddedStreamline._nativeAvailable;
  }

  constructor(config: EmbeddedConfig = {}) {
    if (!EmbeddedStreamline.isAvailable) {
      throw new Error(
        'Streamline native module not found. The embedded SDK requires ' +
        'a native Rust binary (native/streamline.node) that is NOT included ' +
        'in the published npm package.\n\n' +
        'To build the native module:\n' +
        '  1. Install Rust toolchain: https://rustup.rs\n' +
        '  2. Clone the Streamline repo and build libstreamline:\n' +
        '     cd streamline && cargo build --release --lib\n' +
        '  3. Build the N-API bindings:\n' +
        '     cd native && npm run build\n\n' +
        'For most use cases, prefer the standard Streamline client:\n' +
        '  import { Streamline } from \'streamline\';\n' +
        '  const client = new Streamline(\'localhost:9092\');\n\n' +
        'Or run Streamline locally with Docker:\n' +
        '  docker run -d -p 9092:9092 -p 9094:9094 ghcr.io/streamlinelabs/streamline:latest'
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const binding = require('../native/streamline.node');
    this.native = binding.create(JSON.stringify(config));
  }

  /** Produce a message to a topic. */
  async produce(topic: string, value: Buffer, key?: Buffer): Promise<void> {
    this.ensureOpen();
    const binding = this.native as { produce: (topic: string, value: Buffer, key?: Buffer) => void };
    binding.produce(topic, value, key);
  }

  /** Consume a single message from a topic. */
  async consume(topic: string, timeoutMs = 5000): Promise<EmbeddedMessage | null> {
    this.ensureOpen();
    const binding = this.native as { consume: (topic: string, timeout: number) => EmbeddedMessage | null };
    return binding.consume(topic, timeoutMs);
  }

  /** Create a topic. */
  async createTopic(name: string, partitions = 1): Promise<void> {
    this.ensureOpen();
    const binding = this.native as { createTopic: (name: string, partitions: number) => void };
    binding.createTopic(name, partitions);
  }

  /** Execute a SQL query. */
  async query(sql: string): Promise<unknown[]> {
    this.ensureOpen();
    const binding = this.native as { query: (sql: string) => string };
    const json = binding.query(sql);
    try {
      return JSON.parse(json);
    } catch {
      throw new Error(`Failed to parse query response: ${json?.substring(0, 200)}`);
    }
  }

  /** Close the instance and free resources. */
  close(): void {
    if (!this.closed && this.native) {
      const binding = this.native as { destroy: () => void };
      binding.destroy();
      this.closed = true;
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('EmbeddedStreamline instance is closed');
    }
  }
}
