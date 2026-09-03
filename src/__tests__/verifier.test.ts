import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign as signEd25519, createHash } from 'node:crypto';
import { StreamlineVerifier, ATTEST_HEADER } from '../verifier';
import type { Message, Header } from '../types';

/** Extract the raw 32-byte Ed25519 public key from a KeyObject. */
function rawPublicKey(publicKeyDer: Buffer): Uint8Array {
  // SPKI DER for Ed25519 is a fixed 12-byte prefix followed by the 32-byte key.
  return new Uint8Array(publicKeyDer.subarray(publicKeyDer.length - 32));
}

interface Envelope {
  topic: string;
  partition: number;
  offset: number;
  payload_sha256: string;
  schema_id: number;
  timestamp_ms: number;
  key_id: string;
  signature: string;
  contract_id?: string;
}

function canonicalBytes(env: Omit<Envelope, 'signature'>): Buffer {
  return Buffer.from(
    [env.topic, env.partition, env.offset, env.payload_sha256, env.schema_id, env.timestamp_ms, env.key_id].join(
      '|',
    ),
    'utf-8',
  );
}

function sha256Hex(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function makeSignedHeader(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  env: Omit<Envelope, 'signature'>,
): Header {
  const signature = signEd25519(null, canonicalBytes(env), privateKey).toString('base64');
  const envelope: Envelope = { ...env, signature };
  const value = Buffer.from(JSON.stringify(envelope), 'utf-8').toString('base64');
  return { key: ATTEST_HEADER, value };
}

function baseMessage(overrides: Partial<Message> = {}): Message {
  return {
    topic: 'orders',
    partition: 0,
    offset: 42,
    value: 'payload',
    rawValue: Buffer.from('payload', 'utf-8'),
    timestamp: 1_700_000_000_000,
    headers: [],
    ...overrides,
  };
}

describe('StreamlineVerifier', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyRaw = rawPublicKey(publicKey.export({ type: 'spki', format: 'der' }) as Buffer);
  const keyId = 'broker-0';

  function validEnvelopeFor(message: Message): Omit<Envelope, 'signature'> {
    return {
      topic: message.topic,
      partition: message.partition,
      offset: message.offset,
      payload_sha256: sha256Hex(message.rawValue as Buffer),
      schema_id: 0,
      timestamp_ms: 1_700_000_000_000,
      key_id: keyId,
    };
  }

  it('verifies a correctly signed, matching envelope', () => {
    const message = baseMessage();
    const header = makeSignedHeader(privateKey, validEnvelopeFor(message));
    message.headers = [header];

    const verifier = new StreamlineVerifier(publicKeyRaw, keyId);
    const result = verifier.verify(message);

    expect(result.verified).toBe(true);
    expect(result.producerId).toBe(keyId);
  });

  it('returns unverified when there is no attestation header', () => {
    const verifier = new StreamlineVerifier(publicKeyRaw, keyId);
    const result = verifier.verify(baseMessage());
    expect(result).toEqual({ verified: false, producerId: '', timestampMs: 0 });
  });

  it('rejects a header replayed onto a message with different payload bytes', () => {
    const message = baseMessage();
    const header = makeSignedHeader(privateKey, validEnvelopeFor(message));
    // Attacker swaps the actual content but keeps the original (now stale) header.
    const tampered = baseMessage({
      value: 'attacker-controlled',
      rawValue: Buffer.from('attacker-controlled', 'utf-8'),
      headers: [header],
    });

    const verifier = new StreamlineVerifier(publicKeyRaw, keyId);
    const result = verifier.verify(tampered);

    expect(result.verified).toBe(false);
  });

  it('rejects a header replayed onto a different topic/partition/offset', () => {
    const original = baseMessage();
    const header = makeSignedHeader(privateKey, validEnvelopeFor(original));

    const replayedElsewhere = baseMessage({ topic: 'orders', partition: 1, offset: 42, headers: [header] });
    const replayedAtOtherOffset = baseMessage({ offset: 999, headers: [header] });
    const replayedOnOtherTopic = baseMessage({ topic: 'other-topic', headers: [header] });

    const verifier = new StreamlineVerifier(publicKeyRaw, keyId);
    expect(verifier.verify(replayedElsewhere).verified).toBe(false);
    expect(verifier.verify(replayedAtOtherOffset).verified).toBe(false);
    expect(verifier.verify(replayedOnOtherTopic).verified).toBe(false);
  });

  it('rejects an envelope claiming an untrusted key_id', () => {
    const message = baseMessage();
    const env = { ...validEnvelopeFor(message), key_id: 'unregistered-key' };
    const header = makeSignedHeader(privateKey, env);
    message.headers = [header];

    const verifier = new StreamlineVerifier(publicKeyRaw, keyId);
    const result = verifier.verify(message);

    expect(result.verified).toBe(false);
  });

  it('fails closed when the message has no preserved raw bytes', () => {
    const message = baseMessage();
    const header = makeSignedHeader(privateKey, validEnvelopeFor(message));
    // Simulate a hand-constructed Message that never went through
    // Streamline.consume()/consumeBatch() and so has no rawValue.
    const withoutRawValue: Message = { ...message, headers: [header] };
    delete (withoutRawValue as { rawValue?: Buffer }).rawValue;

    const verifier = new StreamlineVerifier(publicKeyRaw, keyId);
    const result = verifier.verify(withoutRawValue);

    expect(result.verified).toBe(false);
  });

  it('rejects a well-formed envelope with a forged signature', () => {
    const message = baseMessage();
    const env = validEnvelopeFor(message);
    const forgedSignature = Buffer.alloc(64, 7).toString('base64');
    const envelope: Envelope = { ...env, signature: forgedSignature };
    message.headers = [
      { key: ATTEST_HEADER, value: Buffer.from(JSON.stringify(envelope), 'utf-8').toString('base64') },
    ];

    const verifier = new StreamlineVerifier(publicKeyRaw, keyId);
    expect(verifier.verify(message).verified).toBe(false);
  });

  it('supports multiple trusted keys and verifies against the matching one', () => {
    const { publicKey: otherPublic, privateKey: otherPrivate } = generateKeyPairSync('ed25519');
    const otherRaw = rawPublicKey(otherPublic.export({ type: 'spki', format: 'der' }) as Buffer);

    const message = baseMessage();
    const env = { ...validEnvelopeFor(message), key_id: 'broker-1' };
    const header = makeSignedHeader(otherPrivate, env);
    message.headers = [header];

    const verifier = new StreamlineVerifier({ 'broker-0': publicKeyRaw, 'broker-1': otherRaw });
    const result = verifier.verify(message);

    expect(result.verified).toBe(true);
    expect(result.producerId).toBe('broker-1');
  });

  it('rejects cross-key signatures even when the key_id is trusted', () => {
    const { privateKey: otherPrivate } = generateKeyPairSync('ed25519');
    const message = baseMessage();
    // Signed by a different, untrusted private key but claims the trusted key_id.
    const env = validEnvelopeFor(message);
    const header = makeSignedHeader(otherPrivate, env);
    message.headers = [header];

    const verifier = new StreamlineVerifier(publicKeyRaw, keyId);
    expect(verifier.verify(message).verified).toBe(false);
  });

  it('throws when constructed with a single key and no keyId', () => {
    expect(() => new StreamlineVerifier(publicKeyRaw)).toThrow(/keyId/);
  });

  it('throws when constructed with an empty trusted-key map', () => {
    expect(() => new StreamlineVerifier({})).toThrow(/at least one trusted/);
  });

  it('throws when a supplied public key is not 32 bytes', () => {
    expect(() => new StreamlineVerifier(new Uint8Array(16), keyId)).toThrow(/32 raw bytes/);
  });
});
