import { describe, it, expect, vi, afterEach } from 'vitest';
import { Admin } from '../admin';
import { Streamline } from '../client';
import { StreamlineError } from '../types';

const realFetch = globalThis.fetch;

function stubFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const impl = vi.fn(
    () =>
      Promise.resolve(
        new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
  );
  globalThis.fetch = impl as unknown as typeof fetch;
  return impl;
}

function newAdmin(httpEndpoint = 'http://broker:9094'): Admin {
  return new Admin(new Streamline('localhost:9092', { httpEndpoint }));
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('Admin branch HTTP mapping', () => {
  describe('httpUrl', () => {
    it('targets the client-configured HTTP endpoint', async () => {
      const impl = stubFetch(200, {});
      await newAdmin('http://configured:1234').listBranches();
      expect(impl).toHaveBeenCalledTimes(1);
      expect(String(impl.mock.calls[0][0])).toBe('http://configured:1234/api/v1/branches');
    });

    it('falls back to the client default endpoint', async () => {
      const impl = stubFetch(200, []);
      await new Admin(new Streamline('localhost:9092')).listBranches();
      expect(String(impl.mock.calls[0][0])).toBe('http://localhost:9094/api/v1/branches');
    });
  });

  describe('createBranch', () => {
    it('maps a complete payload onto BranchInfo', async () => {
      stubFetch(200, {
        name: 'exp-a',
        base_topic: 'orders',
        state: 'sealed',
        created_at: 1700,
      });
      await expect(newAdmin().createBranch('requested', 'orders')).resolves.toEqual({
        name: 'exp-a',
        baseTopic: 'orders',
        state: 'sealed',
        createdAt: 1700,
      });
    });

    it('falls back to the requested values when fields are missing', async () => {
      stubFetch(200, {});
      await expect(newAdmin().createBranch('exp-b', 'events')).resolves.toEqual({
        name: 'exp-b',
        baseTopic: 'events',
        state: 'active',
        createdAt: 0,
      });
    });

    it('falls back when the body is not a JSON object', async () => {
      stubFetch(200, '"just a string"');
      await expect(newAdmin().createBranch('exp-c', 'events')).resolves.toEqual({
        name: 'exp-c',
        baseTopic: 'events',
        state: 'active',
        createdAt: 0,
      });
    });

    it('coerces a non-finite created_at to 0 instead of NaN', async () => {
      stubFetch(200, { name: 'n', base_topic: 'b', state: 's', created_at: 'not-a-number' });
      const info = await newAdmin().createBranch('n', 'b');
      expect(info.createdAt).toBe(0);
      expect(Number.isNaN(info.createdAt)).toBe(false);
    });

    it('sends base_offsets only when provided', async () => {
      const impl = stubFetch(200, {});
      await newAdmin().createBranch('exp-d', 'orders');
      expect(JSON.parse(String(impl.mock.calls[0][1].body))).toEqual({
        name: 'exp-d',
        base_topic: 'orders',
      });

      const withOffsets = stubFetch(200, {});
      await newAdmin().createBranch('exp-e', 'orders', { 0: 10 });
      expect(JSON.parse(String(withOffsets.mock.calls[0][1].body))).toEqual({
        name: 'exp-e',
        base_topic: 'orders',
        base_offsets: { 0: 10 },
      });
    });

    it('throws StreamlineError on a non-2xx response', async () => {
      stubFetch(409, 'quota exceeded');
      await expect(newAdmin().createBranch('x', 'orders')).rejects.toThrow(StreamlineError);
      stubFetch(409, 'quota exceeded');
      await expect(newAdmin().createBranch('x', 'orders')).rejects.toThrow(/HTTP 409/);
    });
  });

  describe('listBranches', () => {
    it('maps a bare array payload', async () => {
      stubFetch(200, [
        { name: 'a', base_topic: 'orders', state: 'active', created_at: 1 },
        { name: 'b', base_topic: 'orders', state: 'sealed', created_at: 2 },
      ]);
      await expect(newAdmin().listBranches()).resolves.toEqual([
        { name: 'a', baseTopic: 'orders', state: 'active', createdAt: 1 },
        { name: 'b', baseTopic: 'orders', state: 'sealed', createdAt: 2 },
      ]);
    });

    it('maps an { items: [...] } envelope', async () => {
      stubFetch(200, { items: [{ name: 'a', base_topic: 'orders' }] });
      await expect(newAdmin().listBranches()).resolves.toEqual([
        { name: 'a', baseTopic: 'orders', state: 'active', createdAt: 0 },
      ]);
    });

    it('drops non-object entries instead of emitting empty rows', async () => {
      stubFetch(200, [{ name: 'a' }, 'garbage', null, 7]);
      await expect(newAdmin().listBranches()).resolves.toEqual([
        { name: 'a', baseTopic: '', state: 'active', createdAt: 0 },
      ]);
    });

    it('returns an empty list for unexpected payload shapes', async () => {
      stubFetch(200, { unexpected: true });
      await expect(newAdmin().listBranches()).resolves.toEqual([]);
    });

    it('URL-encodes the topic filter', async () => {
      const impl = stubFetch(200, []);
      await newAdmin().listBranches('my topic/1');
      expect(String(impl.mock.calls[0][0])).toBe(
        'http://broker:9094/api/v1/branches?topic=my%20topic%2F1',
      );
    });

    it('throws StreamlineError on a non-2xx response', async () => {
      stubFetch(500, 'boom');
      await expect(newAdmin().listBranches()).rejects.toThrow(/Failed to list branches: HTTP 500/);
    });
  });

  describe('discardBranch', () => {
    it('issues a DELETE against the encoded branch id', async () => {
      const impl = stubFetch(200, '');
      await expect(newAdmin().discardBranch('orders/exp a')).resolves.toBeUndefined();
      expect(String(impl.mock.calls[0][0])).toBe(
        'http://broker:9094/api/v1/branches/orders%2Fexp%20a',
      );
      expect(impl.mock.calls[0][1]).toEqual({ method: 'DELETE' });
    });

    it('throws StreamlineError on a non-2xx response', async () => {
      stubFetch(404, 'no such branch');
      await expect(newAdmin().discardBranch('missing')).rejects.toThrow(
        /Failed to discard branch: HTTP 404/,
      );
    });
  });
});
