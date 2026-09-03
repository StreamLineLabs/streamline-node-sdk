import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { SchemaRegistry } from '../schema';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(status: number, body: unknown): Mock<Parameters<typeof fetch>, Promise<Response>> {
  const impl: Mock<Parameters<typeof fetch>, Promise<Response>> = vi.fn((_input) =>
    Promise.resolve(new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status, headers: { 'Content-Type': 'application/json' } },
    )),
  );
  globalThis.fetch = impl as unknown as typeof fetch;
  return impl;
}

describe('SchemaRegistry Streamline 0.3 routes', () => {
  it('registers at the root subjects route with schemaType', async () => {
    const fetchMock = stubFetch(200, { id: 7 });
    const registry = new SchemaRegistry('http://localhost:9094/');

    await expect(registry.register('orders/value', '{}', 'JSON')).resolves.toBe(7);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://localhost:9094/subjects/orders%2Fvalue/versions',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      schema: '{}',
      schemaType: 'JSON',
    });
  });

  it('uses the root schema ID and subject version routes', async () => {
    const fetchMock = stubFetch(200, {
      schema: '{}',
      schemaType: 'JSON',
    });
    const registry = new SchemaRegistry('http://localhost:9094');

    await expect(registry.getSchema(3)).resolves.toEqual({
      id: 3,
      schema: '{}',
      schemaType: 'JSON',
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://localhost:9094/schemas/ids/3',
    );

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([1, 2]), { status: 200 }));
    await expect(registry.getVersions('orders-value')).resolves.toEqual([1, 2]);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'http://localhost:9094/subjects/orders-value/versions',
    );
  });

  it('checks compatibility at the root route with schemaType', async () => {
    const fetchMock = stubFetch(200, { is_compatible: true });
    const registry = new SchemaRegistry('http://localhost:9094');

    await expect(
      registry.checkCompatibility('orders-value', '{}', 'AVRO'),
    ).resolves.toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://localhost:9094/compatibility/subjects/orders-value/versions/latest',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      schema: '{}',
      schemaType: 'AVRO',
    });
  });
});
