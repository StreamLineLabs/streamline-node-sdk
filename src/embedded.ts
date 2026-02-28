/**
 * Embedded Streamline instance for Node.js.
 * 
 * Uses N-API bindings to embed a Streamline server directly in the Node.js process.
 * Requires the native module to be built (see native/README.md).
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
        'building the native N-API bindings from the Streamline Rust FFI layer.\n\n' +
        'To build:\n' +
        '  1. Install Rust: https://rustup.rs\n' +
        '  2. Build libstreamline: cd streamline && cargo build --release --lib\n' +
        '  3. Build N-API bindings: cd native && npm run build\n\n' +
        'For non-embedded use, use the standard StreamlineClient instead.'
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
    return JSON.parse(json);
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
