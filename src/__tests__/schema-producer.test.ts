import { describe, it, expect } from 'vitest';
import { encodeWireFormat, decodeWireFormat } from '../schema-producer';

describe('Wire format', () => {
  const sampleValue = { id: 42, name: 'Alice', active: true };

  describe('encodeWireFormat', () => {
    it('produces buffer starting with magic byte 0x00', () => {
      const buf = encodeWireFormat(1, sampleValue);
      expect(buf[0]).toBe(0x00);
    });

    it('writes schema ID as 4-byte big-endian after magic byte', () => {
      const schemaId = 256;
      const buf = encodeWireFormat(schemaId, sampleValue);
      expect(buf.readUInt32BE(1)).toBe(schemaId);
    });

    it('writes JSON payload after the 5-byte header', () => {
      const buf = encodeWireFormat(1, sampleValue);
      const payload = buf.subarray(5).toString('utf-8');
      expect(JSON.parse(payload)).toEqual(sampleValue);
    });

    it('total length equals 5 + JSON byte length', () => {
      const jsonBytes = Buffer.byteLength(JSON.stringify(sampleValue), 'utf-8');
      const buf = encodeWireFormat(1, sampleValue);
      expect(buf.length).toBe(5 + jsonBytes);
    });

    it('handles large schema IDs (max 32-bit)', () => {
      const largeId = 0xffffffff;
      const buf = encodeWireFormat(largeId, sampleValue);
      expect(buf.readUInt32BE(1)).toBe(largeId);
    });

    it('handles empty object', () => {
      const buf = encodeWireFormat(1, {});
      const payload = buf.subarray(5).toString('utf-8');
      expect(JSON.parse(payload)).toEqual({});
    });

    it('handles unicode values', () => {
      const unicodeValue = { greeting: '你好世界', emoji: '🎉' };
      const buf = encodeWireFormat(7, unicodeValue);
      const payload = buf.subarray(5).toString('utf-8');
      expect(JSON.parse(payload)).toEqual(unicodeValue);
    });
  });

  describe('decodeWireFormat', () => {
    it('extracts schema ID from encoded buffer', () => {
      const schemaId = 99;
      const buf = encodeWireFormat(schemaId, sampleValue);
      const result = decodeWireFormat(buf);
      expect(result.schemaId).toBe(schemaId);
    });

    it('extracts value from encoded buffer', () => {
      const buf = encodeWireFormat(1, sampleValue);
      const result = decodeWireFormat(buf);
      expect(result.value).toEqual(sampleValue);
    });

    it('works with Uint8Array input', () => {
      const buf = encodeWireFormat(5, sampleValue);
      const uint8 = new Uint8Array(buf);
      const result = decodeWireFormat(uint8);
      expect(result.schemaId).toBe(5);
      expect(result.value).toEqual(sampleValue);
    });

    it('throws on buffer shorter than 5 bytes', () => {
      const short = Buffer.alloc(3);
      expect(() => decodeWireFormat(short)).toThrow('Data too short');
    });

    it('throws on invalid magic byte', () => {
      const buf = encodeWireFormat(1, sampleValue);
      buf[0] = 0xff;
      expect(() => decodeWireFormat(buf)).toThrow('Invalid magic byte');
    });
  });

  describe('round-trip', () => {
    it('encode then decode returns original value and schema ID', () => {
      const schemaId = 123;
      const original = { userId: 1, email: 'test@example.com', tags: ['a', 'b'] };
      const encoded = encodeWireFormat(schemaId, original);
      const decoded = decodeWireFormat(encoded);
      expect(decoded.schemaId).toBe(schemaId);
      expect(decoded.value).toEqual(original);
    });

    it('round-trips nested objects', () => {
      const nested = {
        user: { name: 'Bob', address: { city: 'NYC', zip: '10001' } },
        scores: [100, 200, 300],
      };
      const encoded = encodeWireFormat(42, nested);
      const decoded = decodeWireFormat(encoded);
      expect(decoded.value).toEqual(nested);
    });

    it('round-trips with schema ID 0', () => {
      const value = { key: 'value' };
      const encoded = encodeWireFormat(0, value);
      const decoded = decodeWireFormat(encoded);
      expect(decoded.schemaId).toBe(0);
      expect(decoded.value).toEqual(value);
    });
  });
});
