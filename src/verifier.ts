/**
 * Local Ed25519 attestation verifier for Streamline consumer records.
 *
 * Verifies `streamline-attest` headers locally using an Ed25519 public key
 * without any network calls.
 */

import { verify } from 'node:crypto';
import type { Message } from './types';

/** Kafka header name carrying the attestation envelope. */
export const ATTEST_HEADER = 'streamline-attest';

/** Result of an attestation verification. */
export interface VerificationResult {
  /** Whether the Ed25519 signature was valid. */
  verified: boolean;
  /** The key_id from the attestation envelope. */
  producerId: string;
  /** Schema id (undefined when zero / absent). */
  schemaId?: number;
  /** Optional contract id. */
  contractId?: string;
  /** Attestation timestamp in epoch milliseconds. */
  timestampMs: number;
}

/** Parsed attestation envelope from the header. */
interface AttestationEnvelope {
  payload_sha256: string;
  topic: string;
  partition: number;
  offset: number;
  schema_id: number;
  timestamp_ms: number;
  key_id: string;
  signature: string;
  contract_id?: string;
}

/**
 * Verifies `streamline-attest` headers on consumed messages using a local
 * Ed25519 public key. No network calls are made.
 *
 * @example
 * ```ts
 * import { StreamlineVerifier } from '@streamlinelabs/sdk';
 * import { createPublicKey } from 'node:crypto';
 *
 * const pubKey = createPublicKey({ key: pemString, format: 'pem' });
 * const verifier = new StreamlineVerifier(pubKey);
 *
 * const result = verifier.verify(message);
 * if (result.verified) {
 *   console.log(`Verified from ${result.producerId}`);
 * }
 * ```
 */
export class StreamlineVerifier {
  private readonly publicKeyDer: Buffer;

  /**
   * Creates a verifier from raw Ed25519 public key bytes (32 bytes).
   *
   * @param publicKey - Raw 32-byte Ed25519 public key
   */
  constructor(publicKey: Uint8Array) {
    // Wrap the raw 32-byte key into a DER-encoded SubjectPublicKeyInfo
    // OID 1.3.101.112 (Ed25519) header: 302a300506032b6570032100
    const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    this.publicKeyDer = Buffer.concat([derPrefix, Buffer.from(publicKey)]);
  }

  /**
   * Verify the attestation header on a consumed message.
   *
   * Extracts the `streamline-attest` header, parses the base64-encoded JSON
   * attestation, reconstructs the canonical bytes, and verifies the Ed25519
   * signature.
   */
  verify(message: Message): VerificationResult {
    const header = message.headers.find((h) => h.key === ATTEST_HEADER);
    if (!header) {
      return { verified: false, producerId: '', timestampMs: 0 };
    }

    let envelope: AttestationEnvelope;
    try {
      const decoded = Buffer.from(header.value, 'base64');
      envelope = JSON.parse(decoded.toString('utf-8')) as AttestationEnvelope;
    } catch {
      return { verified: false, producerId: '', timestampMs: 0 };
    }

    const canonical = [
      envelope.topic,
      envelope.partition,
      envelope.offset,
      envelope.payload_sha256,
      envelope.schema_id,
      envelope.timestamp_ms,
      envelope.key_id,
    ].join('|');

    let signatureBytes: Buffer;
    try {
      signatureBytes = Buffer.from(envelope.signature, 'base64');
    } catch {
      return { verified: false, producerId: '', timestampMs: 0 };
    }

    let verified: boolean;
    try {
      // Ed25519 uses null algorithm (hash is built into the scheme)
      verified = verify(
        null,
        Buffer.from(canonical, 'utf-8'),
        { key: this.publicKeyDer, format: 'der', type: 'spki' },
        signatureBytes,
      );
    } catch {
      verified = false;
    }

    const result: VerificationResult = {
      verified,
      producerId: envelope.key_id,
      timestampMs: envelope.timestamp_ms,
    };
    if (envelope.schema_id !== 0) {
      result.schemaId = envelope.schema_id;
    }
    if (envelope.contract_id !== undefined) {
      result.contractId = envelope.contract_id;
    }
    return result;
  }
}
