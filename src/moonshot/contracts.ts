/**
 * Contracts validate client (M4 wiring, Experimental).
 *
 * Wraps `POST /api/v1/contracts/validate`.
 */

import { StreamlineError } from '../types';
import { MoonshotHttpClient, MoonshotClientOptions } from './http';

export class ContractsError extends StreamlineError {
  constructor(message: string) {
    super(message);
    this.name = 'ContractsError';
  }
}

export interface ContractValidationFailure {
  fieldPath: string;
  expected: string;
  actual: string;
  message: string;
}

export interface ContractValidationResult {
  valid: boolean;
  schemaId: number | null;
  errors: ContractValidationFailure[];
}

export type ContractValue =
  | Record<string, unknown>
  | unknown[]
  | string
  | Uint8Array;

interface FailureWire {
  field_path?: string;
  expected?: string;
  actual?: string;
  message?: string;
}

interface ValidateResponseWire {
  schema_id?: number | null;
  errors?: FailureWire[];
}

export class ContractsClient extends MoonshotHttpClient {
  constructor(opts: MoonshotClientOptions) {
    super(opts);
  }

  async validate(
    contract: Record<string, unknown>,
    value: ContractValue,
  ): Promise<ContractValidationResult> {
    if (!contract) throw new ContractsError('contract must not be empty');
    const body: Record<string, unknown> = { contract };
    if (value instanceof Uint8Array) {
      body['value_string'] = new TextDecoder('utf-8', { fatal: false }).decode(value);
    } else if (typeof value === 'string') {
      body['value_string'] = value;
    } else {
      body['value'] = value;
    }

    const { status, body: payload, rawText } = await this.request(
      'POST',
      '/api/v1/contracts/validate',
      body,
    );
    if (status === 200) {
      const data = (payload ?? {}) as ValidateResponseWire;
      return {
        valid: true,
        schemaId: data.schema_id ?? null,
        errors: [],
      };
    }
    if (status === 400) {
      const data = (payload ?? {}) as ValidateResponseWire;
      return {
        valid: false,
        schemaId: data.schema_id ?? null,
        errors: (data.errors ?? []).map((e) => ({
          fieldPath: String(e.field_path ?? ''),
          expected: String(e.expected ?? ''),
          actual: String(e.actual ?? ''),
          message: String(e.message ?? ''),
        })),
      };
    }
    throw new ContractsError(
      `validate -> HTTP ${status}: ${rawText.slice(0, 512)}`,
    );
  }
}
