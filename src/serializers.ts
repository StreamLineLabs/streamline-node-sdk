/**
 * Schema-aware serializers for Streamline.
 *
 * Provides JSON Schema and Avro serialization with automatic schema
 * registration via the built-in Streamline Schema Registry.
 *
 * @example
 * ```typescript
 * import { JsonSchemaSerializer } from '@streamlinelabs/streamline-sdk/serializers';
 *
 * const serializer = new JsonSchemaSerializer({
 *   schemaRegistryUrl: 'http://localhost:9094',
 *   schema: {
 *     type: 'object',
 *     properties: {
 *       id: { type: 'number' },
 *       name: { type: 'string' },
 *     },
 *     required: ['id', 'name'],
 *   },
 * });
 *
 * const bytes = await serializer.serialize('users', { id: 1, name: 'Alice' });
 * await producer.send('users', bytes);
 * ```
 */

export interface SchemaRegistryConfig {
  url: string;
  autoRegister?: boolean;
}

export class SchemaRegistryClient {
  private config: SchemaRegistryConfig;
  private cache: Map<string, number> = new Map();

  constructor(config: SchemaRegistryConfig) {
    this.config = config;
  }

  async registerSchema(subject: string, schema: string, schemaType: string = 'JSON'): Promise<number> {
    const resp = await fetch(`${this.config.url}/subjects/${subject}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema, schemaType }),
    });

    if (!resp.ok) {
      throw new Error(`Schema registration failed: ${resp.status} ${await resp.text()}`);
    }

    const data = await resp.json() as { id: number };
    this.cache.set(subject, data.id);
    return data.id;
  }

  async getSchema(schemaId: number): Promise<string> {
    const resp = await fetch(`${this.config.url}/schemas/ids/${schemaId}`);
    if (!resp.ok) {
      throw new Error(`Schema not found: ${schemaId}`);
    }
    const data = await resp.json() as { schema: string };
    return data.schema;
  }
}

export interface JsonSchemaSerializerOptions {
  schemaRegistryUrl?: string;
  schema?: Record<string, unknown>;
  autoRegister?: boolean;
  validate?: boolean;
}

export class JsonSchemaSerializer {
  private registry: SchemaRegistryClient;
  private schema: Record<string, unknown> | undefined;
  private schemaStr: string | undefined;
  private autoRegister: boolean;
  private schemaId: number | undefined;

  constructor(options: JsonSchemaSerializerOptions = {}) {
    this.registry = new SchemaRegistryClient({
      url: options.schemaRegistryUrl ?? 'http://localhost:9094',
    });
    this.schema = options.schema;
    this.schemaStr = options.schema ? JSON.stringify(options.schema) : undefined;
    this.autoRegister = options.autoRegister ?? true;
  }

  async serialize(topic: string, value: Record<string, unknown>): Promise<Uint8Array> {
    if (this.schemaId === undefined && this.autoRegister && this.schemaStr) {
      const subject = `${topic}-value`;
      this.schemaId = await this.registry.registerSchema(subject, this.schemaStr, 'JSON');
    }

    const payload = new TextEncoder().encode(JSON.stringify(value));

    if (this.schemaId !== undefined) {
      // Confluent wire format: 0x00 + 4-byte schema ID (big-endian) + payload
      const buf = new Uint8Array(5 + payload.length);
      buf[0] = 0x00;
      const view = new DataView(buf.buffer);
      view.setUint32(1, this.schemaId, false); // big-endian
      buf.set(payload, 5);
      return buf;
    }

    return payload;
  }

  async deserialize(data: Uint8Array): Promise<Record<string, unknown>> {
    let payload: Uint8Array;

    // Check for Confluent wire format prefix
    if (data.length >= 5 && data[0] === 0x00) {
      payload = data.slice(5);
    } else {
      payload = data;
    }

    return JSON.parse(new TextDecoder().decode(payload));
  }
}
