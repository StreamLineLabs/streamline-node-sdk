/**
 * Attestation client (M4 wiring, Experimental).
 *
 * Wraps `POST /api/v1/attest` and `POST /api/v1/attest/verify`.
 */

import { StreamlineError } from '../types';
import { MoonshotHttpClient, MoonshotClientOptions } from './http';

export const ATTEST_HEADER = 'streamline-attest';

export class AttestationError extends StreamlineError {
  constructor(message: string) {
    super(message);
    this.name = 'AttestationError';
  }
}

export interface SignedAttestation {
  keyId: string;
  algorithm: string;
  timestampMs: number;
  payloadSha256: string;
  signatureB64: string;
  headerName: string;
  headerValue: string;
}

interface SignedAttestationWire {
  key_id: string;
  algorithm: string;
  timestamp_ms: number;
  payload_sha256: string;
  signature_b64: string;
  header_name: string;
  header_value: string;
}

export interface AttestorOptions extends MoonshotClientOptions {
  /** Default key id used by sign. */
  keyId?: string;
  /** Default algorithm. Default: ed25519. */
  algorithm?: string;
}

export interface SignParams {
  topic: string;
  partition: number;
  offset: number;
  value: Uint8Array | string;
  schemaId?: number;
  timestampMs?: number;
  keyId?: string;
}

export interface VerifyParams extends SignParams {
  timestampMs: number;
  signatureB64: string;
  algorithm?: string;
}

function encodeValue(
  value: Uint8Array | string,
): { field: 'value' | 'value_b64'; encoded: string } {
  if (typeof value === 'string') {
    return { field: 'value', encoded: value };
  }
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(value).toString('base64')
      : btoa(String.fromCharCode(...value));
  return { field: 'value_b64', encoded: b64 };
}

export class Attestor extends MoonshotHttpClient {
  private readonly keyId: string;
  private readonly algorithm: string;

  constructor(opts: AttestorOptions) {
    super(opts);
    this.keyId = opts.keyId ?? 'broker-0';
    this.algorithm = opts.algorithm ?? 'ed25519';
  }

  async sign(params: SignParams): Promise<SignedAttestation> {
    if (!params.topic) throw new AttestationError('topic must not be empty');
    if (!Number.isFinite(params.partition))
      throw new AttestationError('partition must be a number');
    if (!Number.isFinite(params.offset))
      throw new AttestationError('offset must be a number');
    const ts = params.timestampMs ?? Date.now();
    const body: Record<string, unknown> = {
      topic: params.topic,
      partition: params.partition,
      offset: params.offset,
      schema_id: params.schemaId ?? 0,
      timestamp_ms: ts,
      key_id: params.keyId ?? this.keyId,
    };
    const { field, encoded } = encodeValue(params.value);
    body[field] = encoded;

    const { status, body: payload, rawText } = await this.request(
      'POST',
      '/api/v1/attest',
      body,
    );
    if (status !== 200) {
      throw new AttestationError(
        `sign -> HTTP ${status}: ${rawText.slice(0, 512)}`,
      );
    }
    const w = (payload ?? {}) as SignedAttestationWire;
    return {
      keyId: w.key_id,
      algorithm: w.algorithm,
      timestampMs: Number(w.timestamp_ms),
      payloadSha256: w.payload_sha256,
      signatureB64: w.signature_b64,
      headerName: w.header_name,
      headerValue: w.header_value,
    };
  }

  async verify(params: VerifyParams): Promise<boolean> {
    if (!params.topic) throw new AttestationError('topic must not be empty');
    if (!params.signatureB64)
      throw new AttestationError('signatureB64 must not be empty');
    const body: Record<string, unknown> = {
      topic: params.topic,
      partition: params.partition,
      offset: params.offset,
      schema_id: params.schemaId ?? 0,
      timestamp_ms: params.timestampMs,
      key_id: params.keyId ?? this.keyId,
      signature_b64: params.signatureB64,
      algorithm: params.algorithm ?? this.algorithm,
    };
    const { field, encoded } = encodeValue(params.value);
    body[field] = encoded;

    const { status, body: payload, rawText } = await this.request(
      'POST',
      '/api/v1/attest/verify',
      body,
    );
    if (status !== 200) {
      throw new AttestationError(
        `verify -> HTTP ${status}: ${rawText.slice(0, 512)}`,
      );
    }
    return Boolean((payload as { valid?: boolean } | null)?.valid);
  }
}
