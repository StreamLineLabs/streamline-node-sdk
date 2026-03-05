/**
 * Schema-aware producer and consumer wrappers for Streamline.
 *
 * Provides high-level produce/consume with automatic schema registration,
 * wire format serialization (Confluent-compatible), and deserialization.
 */

import { Streamline, ConsumeOptions } from './client';
import { SchemaRegistry, SchemaType } from './schema';
import { ProduceResult } from './types';

// =========================================================================
// Wire format helpers
// =========================================================================

const MAGIC_BYTE = 0x00;
const HEADER_SIZE = 5; // 1 magic byte + 4 byte schema ID

/**
 * Encode a value into Confluent wire format:
 * [0x00] [4-byte BE schema ID] [JSON payload]
 */
export function encodeWireFormat(schemaId: number, value: Record<string, unknown>): Buffer {
  const payload = Buffer.from(JSON.stringify(value), 'utf-8');
  const buf = Buffer.alloc(HEADER_SIZE + payload.length);
  buf[0] = MAGIC_BYTE;
  buf.writeUInt32BE(schemaId, 1);
  payload.copy(buf, HEADER_SIZE);
  return buf;
}

/**
 * Decode Confluent wire format, returning the schema ID and parsed JSON value.
 */
export function decodeWireFormat<T = Record<string, unknown>>(data: Buffer | Uint8Array): { schemaId: number; value: T } {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

  if (buf.length < HEADER_SIZE) {
    throw new Error('Data too short for wire format');
  }
  if (buf[0] !== MAGIC_BYTE) {
    throw new Error(`Invalid magic byte: expected 0x00, got 0x${buf[0].toString(16).padStart(2, '0')}`);
  }

  const schemaId = buf.readUInt32BE(1);
  const payload = buf.subarray(HEADER_SIZE);
  const value = JSON.parse(payload.toString('utf-8')) as T;
  return { schemaId, value };
}

// =========================================================================
// SchemaProducer
// =========================================================================

export interface SchemaProducerOptions {
  /** Schema Registry URL (default: http://localhost:9094) */
  schemaRegistryUrl?: string;
  /** Subject name for schema registration */
  subject: string;
  /** Schema definition (JSON string) */
  schema: string;
  /** Schema type (default: 'JSON') */
  schemaType?: SchemaType;
  /** Automatically register schema on first send (default: true) */
  autoRegister?: boolean;
}

/**
 * High-level producer that automatically serializes values with schema
 * registry wire format.
 *
 * @example
 * ```typescript
 * const schemaProducer = new SchemaProducer(client, {
 *   subject: 'users-value',
 *   schema: JSON.stringify({ type: 'object', properties: { id: { type: 'number' } } }),
 * });
 *
 * await schemaProducer.send('users', { id: 1, name: 'Alice' });
 * ```
 */
export class SchemaProducer {
  private registry: SchemaRegistry;
  private cachedSchemaId: number | undefined;
  private registering: Promise<number> | undefined;

  constructor(
    private client: Streamline,
    private options: SchemaProducerOptions,
  ) {
    this.registry = new SchemaRegistry(
      options.schemaRegistryUrl ?? 'http://localhost:9094',
    );
  }

  /**
   * Ensure the schema is registered, caching the ID after first registration.
   */
  private async ensureRegistered(): Promise<number> {
    if (this.cachedSchemaId !== undefined) {
      return this.cachedSchemaId;
    }

    // Deduplicate concurrent registration attempts
    if (!this.registering) {
      this.registering = this.registry
        .register(this.options.subject, this.options.schema, this.options.schemaType ?? 'JSON')
        .then((id) => {
          this.cachedSchemaId = id;
          this.registering = undefined;
          return id;
        })
        .catch((err) => {
          this.registering = undefined;
          throw err;
        });
    }

    return this.registering;
  }

  /**
   * Send a single message with schema wire format.
   */
  async send(
    topic: string,
    value: Record<string, unknown>,
    options?: { key?: string; headers?: Record<string, string> },
  ): Promise<ProduceResult> {
    const schemaId = this.options.autoRegister !== false
      ? await this.ensureRegistered()
      : this.cachedSchemaId;

    if (schemaId === undefined) {
      throw new Error('Schema not registered. Enable autoRegister or register the schema manually.');
    }

    const serialized = encodeWireFormat(schemaId, value);

    const produceOpts: { key?: string; headers?: Record<string, string> } = {};
    if (options?.key) produceOpts.key = options.key;
    if (options?.headers) produceOpts.headers = options.headers;

    return this.client.produce(topic, serialized.toString('base64'), produceOpts);
  }

  /**
   * Send multiple messages with schema wire format.
   */
  async sendBatch(
    topic: string,
    values: Record<string, unknown>[],
  ): Promise<ProduceResult[]> {
    const schemaId = this.options.autoRegister !== false
      ? await this.ensureRegistered()
      : this.cachedSchemaId;

    if (schemaId === undefined) {
      throw new Error('Schema not registered. Enable autoRegister or register the schema manually.');
    }

    return Promise.all(
      values.map((value) => {
        const serialized = encodeWireFormat(schemaId, value);
        return this.client.produce(topic, serialized.toString('base64'));
      }),
    );
  }
}

// =========================================================================
// SchemaConsumer
// =========================================================================

/**
 * A consumed message with its schema ID and deserialized value.
 */
export interface DeserializedMessage<T = Record<string, unknown>> {
  topic: string;
  partition: number;
  offset: number;
  key?: string | undefined;
  value: T;
  schemaId: number;
  headers?: Record<string, string> | undefined;
  timestamp?: number | undefined;
}

/**
 * High-level consumer that automatically deserializes schema wire-format
 * messages.
 *
 * @example
 * ```typescript
 * const schemaConsumer = new SchemaConsumer(client);
 * const messages = await schemaConsumer.consume<User>('users');
 * for (const msg of messages) {
 *   console.log(msg.schemaId, msg.value);
 * }
 * ```
 */
export class SchemaConsumer {
  constructor(
    private client: Streamline,
    schemaRegistryUrl?: string,
  ) {
    // Registry URL stored for potential future schema lookup
    void (schemaRegistryUrl ?? 'http://localhost:9094');
  }

  /**
   * Consume a batch of messages, deserializing wire-format payloads.
   */
  async consume<T = Record<string, unknown>>(
    topic: string,
    options?: ConsumeOptions,
  ): Promise<DeserializedMessage<T>[]> {
    const messages = await this.client.consumeBatch(topic, options);

    return messages.map((msg) => {
      const headersRecord = msg.headers?.length
        ? Object.fromEntries(msg.headers.map((h: { key: string; value: string }) => [h.key, h.value]))
        : undefined;

      // Convert value to Buffer for wire format parsing
      let buf: Buffer;
      if (Buffer.isBuffer(msg.value)) {
        buf = msg.value;
      } else if (msg.value instanceof Uint8Array) {
        buf = Buffer.from(msg.value);
      } else if (typeof msg.value === 'string') {
        // Try base64 decoding first, fall back to UTF-8
        buf = Buffer.from(msg.value, 'base64');
        if (buf.length < HEADER_SIZE || buf[0] !== MAGIC_BYTE) {
          buf = Buffer.from(msg.value, 'utf-8');
        }
      } else {
        // Value is already parsed JSON — wrap it without wire format
        const result: DeserializedMessage<T> = {
          topic: msg.topic,
          partition: msg.partition,
          offset: msg.offset,
          value: msg.value as T,
          schemaId: 0,
          timestamp: msg.timestamp,
        };
        if (msg.key) result.key = msg.key;
        if (headersRecord) result.headers = headersRecord;
        return result;
      }

      const { schemaId, value } = decodeWireFormat<T>(buf);

      const result: DeserializedMessage<T> = {
        topic: msg.topic,
        partition: msg.partition,
        offset: msg.offset,
        value,
        schemaId,
        timestamp: msg.timestamp,
      };
      if (msg.key) result.key = msg.key;
      if (headersRecord) result.headers = headersRecord;
      return result;
    });
  }
}
