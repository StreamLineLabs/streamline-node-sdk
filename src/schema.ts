/**
 * Schema Registry client for Streamline.
 */

import { StreamlineError } from './types';

/**
 * Supported schema types.
 */
export type SchemaType = 'AVRO' | 'PROTOBUF' | 'JSON';

/**
 * Registered schema information.
 */
export interface SchemaInfo {
  id: number;
  subject?: string;
  version?: number;
  schemaType: SchemaType;
  schema: string;
}

/**
 * Schema Registry client.
 *
 * @example
 * ```typescript
 * const registry = new SchemaRegistry('http://localhost:9094');
 * const id = await registry.register('user-events-value', '{"type":"record",...}', 'AVRO');
 * const schema = await registry.getSchema(id);
 * ```
 */
export class SchemaRegistry {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:9094') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Register a schema under a subject. Returns the schema ID.
   */
  async register(subject: string, schema: string, type: SchemaType = 'JSON'): Promise<number> {
    const response = await fetch(
      `${this.baseUrl}/api/schemas/subjects/${encodeURIComponent(subject)}/versions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema, schema_type: type }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new StreamlineError(`Failed to register schema: ${error}`, 'SCHEMA_ERROR');
    }

    const result = await response.json() as { id: number };
    return result.id;
  }

  /**
   * Get a schema by its global ID.
   */
  async getSchema(id: number): Promise<SchemaInfo> {
    const response = await fetch(`${this.baseUrl}/api/schemas/ids/${id}`);

    if (!response.ok) {
      const error = await response.text();
      throw new StreamlineError(`Failed to get schema: ${error}`, 'SCHEMA_ERROR');
    }

    return response.json() as Promise<SchemaInfo>;
  }

  /**
   * Get all versions for a subject.
   */
  async getVersions(subject: string): Promise<number[]> {
    const response = await fetch(
      `${this.baseUrl}/api/schemas/subjects/${encodeURIComponent(subject)}/versions`
    );

    if (!response.ok) {
      const error = await response.text();
      throw new StreamlineError(`Failed to get versions: ${error}`, 'SCHEMA_ERROR');
    }

    return response.json() as Promise<number[]>;
  }

  /**
   * Check schema compatibility with existing schemas for a subject.
   */
  async checkCompatibility(
    subject: string,
    schema: string,
    type: SchemaType = 'JSON'
  ): Promise<boolean> {
    const response = await fetch(
      `${this.baseUrl}/api/schemas/compatibility/subjects/${encodeURIComponent(subject)}/versions/latest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema, schema_type: type }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new StreamlineError(`Compatibility check failed: ${error}`, 'SCHEMA_ERROR');
    }

    const result = await response.json() as { is_compatible: boolean };
    return result.is_compatible;
  }
}
