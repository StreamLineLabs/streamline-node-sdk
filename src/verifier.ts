/**
 * Local Ed25519 attestation verifier for Streamline consumer records.
 *
 * Verifies `streamline-attest` headers locally using one or more trusted
 * Ed25519 public keys without any network calls.
 *
 * The envelope embedded in the header is self-reported by whoever attached
 * the header — it must never be trusted on its own. A verified result is
 * only meaningful if it is bound to:
 *  - a **trusted `key_id`**: the signature is checked against the public key
 *    registered for the envelope's claimed `key_id`; an unregistered
 *    `key_id` never verifies, regardless of signature validity;
 *  - the **actual raw payload bytes** of the message being checked: the
 *    envelope's `payload_sha256` is recomputed from `message.rawValue` and
 *    compared, so a header copied onto a message with different content
 *    fails verification even if the signature over the (stale) envelope is
 *    itself valid;
 *  - the **actual topic, partition, and offset** of the message being
 *    checked: the envelope's claimed coordinates are compared against
 *    `message.topic` / `message.partition` / `message.offset`, so a header
 *    replayed onto a different record (same producer, different position)
 *    fails verification.
 */

import { verify as verifyEd25519, createHash } from 'node:crypto';
import type { Message } from './types';

/** Kafka header name carrying the attestation envelope. */
export const ATTEST_HEADER = 'streamline-attest';

/** Result of an attestation verification. */
export interface VerificationResult {
  /** Whether the Ed25519 signature was valid and every binding matched. */
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

/** One or more trusted Ed25519 public keys, keyed by the `key_id` they sign as. */
export type TrustedKeys = Uint8Array | Map<string, Uint8Array> | Record<string, Uint8Array>;

const UNVERIFIED: VerificationResult = { verified: false, producerId: '', timestampMs: 0 };

function unverifiedWithEnvelope(envelope?: AttestationEnvelope): VerificationResult {
  if (!envelope) {
    return UNVERIFIED;
  }
  const result: VerificationResult = {
    verified: false,
    producerId: envelope.key_id ?? '',
    timestampMs: envelope.timestamp_ms ?? 0,
  };
  if (envelope.schema_id !== undefined && envelope.schema_id !== 0) {
    result.schemaId = envelope.schema_id;
  }
  if (envelope.contract_id !== undefined) {
    result.contractId = envelope.contract_id;
  }
  return result;
}

/**
 * Verifies `streamline-attest` headers on consumed messages using one or
 * more locally held Ed25519 public keys. No network calls are made.
 *
 * @example
 * ```ts
 * import { StreamlineVerifier } from '@streamlinelabs/sdk';
 *
 * // Single trusted key, bound to the key_id it is trusted to sign as.
 * const verifier = new StreamlineVerifier(publicKeyBytes, 'broker-0');
 *
 * // Or multiple trusted keys (e.g. during key rotation):
 * const rotating = new StreamlineVerifier({ 'broker-0': oldKey, 'broker-1': newKey });
 *
 * const result = verifier.verify(message);
 * if (result.verified) {
 *   console.log(`Verified from ${result.producerId}`);
 * }
 * ```
 */
export class StreamlineVerifier {
  /** key_id -> DER-encoded (SubjectPublicKeyInfo) Ed25519 public key. */
  private readonly trustedKeys: Map<string, Buffer>;

  /**
   * @param publicKeyOrTrustedKeys - Either a single raw 32-byte Ed25519
   *   public key (must be paired with `keyId`), or a `Map`/plain object of
   *   `key_id -> raw 32-byte public key` when more than one key is trusted.
   * @param keyId - Required, and only meaningful, when
   *   `publicKeyOrTrustedKeys` is a single raw key: binds that key to the
   *   `key_id` it is trusted to have signed as.
   * @throws {Error} If no trusted key is supplied, a key is not 32 bytes, or
   *   a single raw key is given without a `keyId`.
   */
  constructor(publicKeyOrTrustedKeys: TrustedKeys, keyId?: string) {
    this.trustedKeys = new Map();

    if (publicKeyOrTrustedKeys instanceof Uint8Array) {
      if (!keyId) {
        throw new Error(
          'StreamlineVerifier: a keyId is required when constructing with a single public key, ' +
            'so the verifier can bind the envelope\'s claimed key_id to a trusted key',
        );
      }
      this.trustedKeys.set(keyId, this.toDerPublicKey(publicKeyOrTrustedKeys));
    } else {
      const entries =
        publicKeyOrTrustedKeys instanceof Map
          ? publicKeyOrTrustedKeys.entries()
          : Object.entries(publicKeyOrTrustedKeys);
      for (const [id, key] of entries) {
        this.trustedKeys.set(id, this.toDerPublicKey(key));
      }
    }

    if (this.trustedKeys.size === 0) {
      throw new Error('StreamlineVerifier requires at least one trusted public key');
    }
  }

  /** Wrap a raw 32-byte Ed25519 public key into a DER SubjectPublicKeyInfo. */
  private toDerPublicKey(publicKey: Uint8Array): Buffer {
    if (publicKey.byteLength !== 32) {
      throw new Error(
        `StreamlineVerifier: Ed25519 public keys must be 32 raw bytes (got ${publicKey.byteLength})`,
      );
    }
    // OID 1.3.101.112 (Ed25519) SubjectPublicKeyInfo header.
    const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    return Buffer.concat([derPrefix, Buffer.from(publicKey)]);
  }

  /**
   * Verify the attestation header on a consumed message.
   *
   * Extracts the `streamline-attest` header, parses the base64-encoded JSON
   * attestation, checks that its claimed topic/partition/offset/payload hash
   * match the message actually being verified, resolves the claimed
   * `key_id` against the trusted key set, and only then checks the Ed25519
   * signature over the canonical envelope bytes.
   *
   * @param message - The consumed message to verify. Its `rawValue` (exact
   *   wire bytes, populated by {@link Streamline.consume} /
   *   {@link Streamline.consumeBatch}) is required: without it there is no
   *   way to independently confirm the payload hash, so verification fails
   *   closed rather than trusting a re-serialized guess of the bytes.
   */
  verify(message: Message): VerificationResult {
    const header = message.headers.find((h) => h.key === ATTEST_HEADER);
    if (!header) {
      return UNVERIFIED;
    }

    let envelope: AttestationEnvelope;
    try {
      const decoded = Buffer.from(header.value, 'base64');
      envelope = JSON.parse(decoded.toString('utf-8')) as AttestationEnvelope;
    } catch {
      return UNVERIFIED;
    }

    if (
      typeof envelope.topic !== 'string' ||
      typeof envelope.partition !== 'number' ||
      typeof envelope.offset !== 'number' ||
      typeof envelope.payload_sha256 !== 'string' ||
      typeof envelope.key_id !== 'string' ||
      typeof envelope.signature !== 'string'
    ) {
      return UNVERIFIED;
    }

    // Bind to the actual message coordinates: an envelope for a different
    // topic/partition/offset must never verify, even with a valid
    // signature, or a captured header could be replayed onto an unrelated
    // record at another position.
    if (
      envelope.topic !== message.topic ||
      envelope.partition !== message.partition ||
      envelope.offset !== message.offset
    ) {
      return unverifiedWithEnvelope(envelope);
    }

    // Bind to the actual raw payload bytes: never trust the envelope's
    // self-reported hash. Fail closed if the raw bytes were not preserved
    // (e.g. a hand-constructed Message) rather than reserializing `value`.
    if (message.rawValue === undefined) {
      return unverifiedWithEnvelope(envelope);
    }
    const actualPayloadSha256 = createHash('sha256').update(message.rawValue).digest('hex');
    if (actualPayloadSha256 !== envelope.payload_sha256.toLowerCase()) {
      return unverifiedWithEnvelope(envelope);
    }

    // Bind to a trusted key_id: only verify with the public key registered
    // for the claimed key_id. An untrusted key_id never verifies.
    const publicKeyDer = this.trustedKeys.get(envelope.key_id);
    if (!publicKeyDer) {
      return unverifiedWithEnvelope(envelope);
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
      return unverifiedWithEnvelope(envelope);
    }

    let verified: boolean;
    try {
      // Ed25519 uses null algorithm (hash is built into the scheme)
      verified = verifyEd25519(
        null,
        Buffer.from(canonical, 'utf-8'),
        { key: publicKeyDer, format: 'der', type: 'spki' },
        signatureBytes,
      );
    } catch {
      verified = false;
    }

    const result = unverifiedWithEnvelope(envelope);
    result.verified = verified;
    return result;
  }
}
