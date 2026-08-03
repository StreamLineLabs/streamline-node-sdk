import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  AvroSchemaSerializer,
  JsonSchemaSerializer,
  SchemaRegistryClient,
  stripWireFormatHeader,
} from '../serializers';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const impl = vi.fn(
    () =>
      Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
      ),
  );
  globalThis.fetch = impl as unknown as typeof fetch;
  return impl;
}

function framed(schemaId: number, json: string): Uint8Array {
  const payload = new TextEncoder().encode(json);
  const buf = new Uint8Array(5 + payload.length);
  buf[0] = 0x00;
  new DataView(buf.buffer).setUint32(1, schemaId, false);
  buf.set(payload, 5);
  return buf;
}

const plain = (json: string): Uint8Array => new TextEncoder().encode(json);

describe('stripWireFormatHeader', () => {
  it('removes the magic byte and 4-byte schema id', () => {
    expect(new TextDecoder().decode(stripWireFormatHeader(framed(7, '{"a":1}')))).toBe('{"a":1}');
  });

  it('leaves unframed payloads untouched', () => {
    const data = plain('{"a":1}');
    expect(stripWireFormatHeader(data)).toBe(data);
  });

  it('leaves short payloads untouched even when they start with 0x00', () => {
    const short = new Uint8Array([0x00, 0x01]);
    expect(stripWireFormatHeader(short)).toBe(short);
  });

  it('leaves long payloads without the magic byte untouched', () => {
    const data = new Uint8Array([0x01, 0, 0, 0, 7, 123]);
    expect(stripWireFormatHeader(data)).toBe(data);
  });
});

describe.each([
  ['JsonSchemaSerializer', () => new JsonSchemaSerializer()],
  ['AvroSchemaSerializer', () => new AvroSchemaSerializer()],
] as const)('%s.deserialize', (_name, make) => {
  it('returns a Promise rather than throwing synchronously', () => {
    const result = make().deserialize(plain('nope'));
    expect(result).toBeInstanceOf(Promise);
    return expect(result).rejects.toThrow(SyntaxError);
  });

  it('decodes an unframed JSON object', async () => {
    await expect(make().deserialize(plain('{"id":1,"name":"Alice"}'))).resolves.toEqual({
      id: 1,
      name: 'Alice',
    });
  });

  it('decodes a Confluent wire-format payload', async () => {
    await expect(make().deserialize(framed(42, '{"id":2}'))).resolves.toEqual({ id: 2 });
  });

  it('rejects with TypeError for valid JSON that is not an object', async () => {
    await expect(make().deserialize(plain('[1,2]'))).rejects.toThrow(TypeError);
    await expect(make().deserialize(plain('42'))).rejects.toThrow(
      /Failed to deserialize payload: expected a JSON object, got number/,
    );
    await expect(make().deserialize(plain('null'))).rejects.toThrow(/got null/);
  });

  it('round-trips values written by serialize', async () => {
    const serializer = make();
    const value = { id: 1, name: 'Alice', nested: { ok: true } };
    const bytes = await serializer.serialize('users', value);
    await expect(serializer.deserialize(bytes)).resolves.toEqual(value);
  });
});

describe('serialize wire format', () => {
  it('emits a bare payload when no schema is registered', async () => {
    const bytes = await new JsonSchemaSerializer().serialize('users', { id: 1 });
    expect(bytes[0]).not.toBe(0x00);
    expect(new TextDecoder().decode(bytes)).toBe('{"id":1}');
  });

  it('prefixes magic byte + big-endian schema id once registered', async () => {
    stubFetch(200, { id: 258 });
    const serializer = new JsonSchemaSerializer({
      schemaRegistryUrl: 'http://registry:9094',
      schema: { type: 'object' },
    });
    const bytes = await serializer.serialize('users', { id: 1 });
    expect(bytes[0]).toBe(0x00);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(1, false)).toBe(258);
    expect(new TextDecoder().decode(bytes.slice(5))).toBe('{"id":1}');
  });

  it('registers the schema only once', async () => {
    const impl = stubFetch(200, { id: 1 });
    const serializer = new AvroSchemaSerializer({
      schemaRegistryUrl: 'http://registry:9094',
      schema: { type: 'record', name: 'User', fields: [] },
    });
    await serializer.serialize('users', { id: 1 });
    await serializer.serialize('users', { id: 2 });
    expect(impl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(impl.mock.calls[0][1].body)).schemaType).toBe('AVRO');
  });
});

describe('SchemaRegistryClient', () => {
  it('posts to the versions endpoint and returns the id', async () => {
    const impl = stubFetch(200, { id: 9 });
    const client = new SchemaRegistryClient({ url: 'http://registry:9094' });
    await expect(client.registerSchema('users-value', '{}')).resolves.toBe(9);
    expect(String(impl.mock.calls[0][0])).toBe(
      'http://registry:9094/subjects/users-value/versions',
    );
  });

  it('throws with status and body when registration fails', async () => {
    stubFetch(422, 'incompatible');
    const client = new SchemaRegistryClient({ url: 'http://registry:9094' });
    await expect(client.registerSchema('users-value', '{}')).rejects.toThrow(
      /Schema registration failed: 422 incompatible/,
    );
  });

  it('throws when a schema id is not found', async () => {
    stubFetch(404, '');
    const client = new SchemaRegistryClient({ url: 'http://registry:9094' });
    await expect(client.getSchema(5)).rejects.toThrow(/Schema not found: 5/);
  });
});
