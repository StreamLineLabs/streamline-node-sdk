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

import { fromSync } from './internal/async';
import { isRecord, isUnknownArray, parseJson } from './internal/guards';
import { loadOptionalModule, moduleDir } from './internal/optional-module';

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

/** Module specifier of the compiled N-API addon, relative to this file. */
const NATIVE_MODULE = '../native/streamline.node';

/**
 * Handle returned by the native addon's `create()` factory.
 *
 * Mirrors the C API declared in `streamline/include/streamline.h`.
 */
interface NativeInstance {
  produce(topic: string, value: Buffer, key?: Buffer): void;
  consume(topic: string, timeoutMs: number): EmbeddedMessage | null;
  createTopic(name: string, partitions: number): void;
  /** Returns JSON text. Typed as `unknown` because the guard only proves it is callable. */
  query(sql: string): unknown;
  destroy(): void;
}

/** Exports of the compiled `streamline.node` addon. */
interface NativeBinding {
  create(configJson: string): unknown;
}

/** Structurally validate the dynamically loaded native addon. */
function isNativeBinding(value: unknown): value is NativeBinding {
  return isRecord(value) && typeof value['create'] === 'function';
}

/** Structurally validate an instance handle returned by `create()`. */
function isNativeInstance(value: unknown): value is NativeInstance {
  return (
    isRecord(value) &&
    typeof value['produce'] === 'function' &&
    typeof value['consume'] === 'function' &&
    typeof value['createTopic'] === 'function' &&
    typeof value['query'] === 'function' &&
    typeof value['destroy'] === 'function'
  );
}

/**
 * Load the native addon, returning `null` when it has not been built.
 *
 * The specifier is resolved at runtime so the bundler never treats the
 * optional binary as a build-time dependency. Resolution is anchored to this
 * module's own directory, which is `src/` when running from source and `dist/`
 * in the published package — both one level below the addon's `native/` home.
 * Hosts that expose no module directory fail closed rather than resolving the
 * relative specifier against an unrelated directory.
 */
function loadNativeModule(): Record<string, unknown> | null {
  const baseDir = moduleDir(typeof __dirname === 'string' ? __dirname : undefined);
  if (baseDir === undefined) {
    return null;
  }
  const mod = loadOptionalModule(NATIVE_MODULE, baseDir);
  return isRecord(mod) ? mod : null;
}


/**
 * Embedded Streamline instance.
 * 
 * Note: This is a type-safe wrapper. The actual native bindings
 * must be compiled from the Rust FFI layer using napi-rs or node-bindgen.
 * See streamline/include/streamline.h for the C API.
 */
export class EmbeddedStreamline {
  private native: NativeInstance;
  private closed = false;

  /** `undefined` = not resolved yet, `null` = resolved and unavailable. */
  private static _nativeModule: Record<string, unknown> | null | undefined;

  /**
   * Resolve the native addon once, caching both success and failure.
   */
  private static nativeModule(): Record<string, unknown> | null {
    if (EmbeddedStreamline._nativeModule === undefined) {
      EmbeddedStreamline._nativeModule = loadNativeModule();
    }
    return EmbeddedStreamline._nativeModule;
  }

  /**
   * Check if the native module is available.
   */
  static get isAvailable(): boolean {
    return EmbeddedStreamline.nativeModule() !== null;
  }

  constructor(config: EmbeddedConfig = {}) {
    const mod = EmbeddedStreamline.nativeModule();
    if (!mod) {
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
    if (!isNativeBinding(mod)) {
      throw new Error(
        'Streamline native module was loaded but does not export a create() ' +
        'factory. The addon is out of date or was built from a different ' +
        'revision — rebuild it: cd native && npm run build'
      );
    }
    const instance: unknown = mod.create(JSON.stringify(config));
    if (!isNativeInstance(instance)) {
      throw new Error(
        'Streamline native module returned an unusable instance handle. ' +
        'Rebuild the addon against this SDK version: cd native && npm run build'
      );
    }
    this.native = instance;
  }

  /** Produce a message to a topic. */
  produce(topic: string, value: Buffer, key?: Buffer): Promise<void> {
    return fromSync(() => {
      this.ensureOpen();
      this.native.produce(topic, value, key);
    });
  }

  /** Consume a single message from a topic. */
  consume(topic: string, timeoutMs = 5000): Promise<EmbeddedMessage | null> {
    return fromSync(() => {
      this.ensureOpen();
      return this.native.consume(topic, timeoutMs);
    });
  }

  /** Create a topic. */
  createTopic(name: string, partitions = 1): Promise<void> {
    return fromSync(() => {
      this.ensureOpen();
      this.native.createTopic(name, partitions);
    });
  }

  /** Execute a SQL query. */
  query(sql: string): Promise<unknown[]> {
    return fromSync(() => {
      this.ensureOpen();
      const raw: unknown = this.native.query(sql);
      if (typeof raw !== 'string') {
        throw new Error(`Failed to parse query response: expected JSON text, got ${typeof raw}`);
      }
      let rows: unknown;
      try {
        rows = parseJson(raw);
      } catch {
        throw new Error(`Failed to parse query response: ${raw.substring(0, 200)}`);
      }
      if (!isUnknownArray(rows)) {
        throw new Error(`Failed to parse query response: ${raw.substring(0, 200)}`);
      }
      return rows;
    });
  }

  /** Close the instance and free resources. */
  close(): void {
    if (!this.closed) {
      this.native.destroy();
      this.closed = true;
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('EmbeddedStreamline instance is closed');
    }
  }
}
