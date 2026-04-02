import { describe, it, expect, vi } from 'vitest';
import {
  BranchAdminClient,
  BranchAdminError,
  ContractsClient,
  Attestor,
  AttestationError,
  SemanticSearchClient,
  SemanticSearchError,
  MemoryClient,
  MemoryError,
} from '../moonshot';

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => {
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('moonshot http clients', () => {
  describe('BranchAdminClient', () => {
    it('createBranch returns mapped view', async () => {
      const fetchImpl = mockFetch(200, {
        id: 'orders/exp-a',
        parent: null,
        created_at_ms: 1000,
        message_count: 0,
        metadata: { owner: 'me' },
      });
      const c = new BranchAdminClient({ httpUrl: 'http://h', fetchImpl });
      const v = await c.create('orders', 'exp-a', { metadata: { owner: 'me' } });
      expect(v).toEqual({
        id: 'orders/exp-a',
        parent: null,
        createdAtMs: 1000,
        messageCount: 0,
        metadata: { owner: 'me' },
      });
    });

    it('throws BranchAdminError on 4xx', async () => {
      const fetchImpl = mockFetch(404, { error: 'not found' });
      const c = new BranchAdminClient({ httpUrl: 'http://h', fetchImpl });
      await expect(c.get('missing')).rejects.toBeInstanceOf(BranchAdminError);
    });

    it('rejects empty topic upfront', async () => {
      const c = new BranchAdminClient({ httpUrl: 'http://h', fetchImpl: mockFetch(200, {}) });
      await expect(c.create('', 'x')).rejects.toBeInstanceOf(BranchAdminError);
    });

    it('list parses both array and {items} shapes', async () => {
      const c1 = new BranchAdminClient({
        httpUrl: 'http://h',
        fetchImpl: mockFetch(200, [{ id: 'a' }]),
      });
      expect((await c1.list())[0].id).toBe('a');
      const c2 = new BranchAdminClient({
        httpUrl: 'http://h',
        fetchImpl: mockFetch(200, { items: [{ id: 'b' }] }),
      });
      expect((await c2.list())[0].id).toBe('b');
    });
  });

  describe('ContractsClient', () => {
    it('200 yields valid=true', async () => {
      const c = new ContractsClient({
        httpUrl: 'http://h',
        fetchImpl: mockFetch(200, { schema_id: 7 }),
      });
      const r = await c.validate({ name: 'c.v1' }, { id: 'x' });
      expect(r.valid).toBe(true);
      expect(r.schemaId).toBe(7);
    });

    it('400 yields valid=false with structured errors', async () => {
      const c = new ContractsClient({
        httpUrl: 'http://h',
        fetchImpl: mockFetch(400, {
          schema_id: 7,
          errors: [{ field_path: 'id', expected: 'string', actual: 'int', message: 'bad' }],
        }),
      });
      const r = await c.validate({ name: 'c.v1' }, { id: 1 });
      expect(r.valid).toBe(false);
      expect(r.errors[0].fieldPath).toBe('id');
    });

    it('encodes Uint8Array as value_string', async () => {
      let captured: any;
      const fetchImpl = vi.fn(async (_url: any, init: any) => {
        captured = JSON.parse(init.body);
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch;
      const c = new ContractsClient({ httpUrl: 'http://h', fetchImpl });
      await c.validate({ name: 'c.v1' }, new Uint8Array([104, 105]));
      expect(captured.value_string).toBe('hi');
    });
  });

  describe('Attestor', () => {
    it('sign returns parsed envelope', async () => {
      const fetchImpl = mockFetch(200, {
        key_id: 'k0',
        algorithm: 'ed25519',
        timestamp_ms: 42,
        payload_sha256: 'aa',
        signature_b64: 'bb',
        header_name: 'streamline-attest',
        header_value: 'v1.k0.aa.42.bb',
      });
      const a = new Attestor({ httpUrl: 'http://h', fetchImpl });
      const sig = await a.sign({ topic: 't', partition: 0, offset: 1, value: 'hi' });
      expect(sig.signatureB64).toBe('bb');
      expect(sig.headerName).toBe('streamline-attest');
    });

    it('verify returns valid flag', async () => {
      const a = new Attestor({
        httpUrl: 'http://h',
        fetchImpl: mockFetch(200, { valid: true }),
      });
      const ok = await a.verify({
        topic: 't',
        partition: 0,
        offset: 1,
        value: 'hi',
        timestampMs: 42,
        signatureB64: 'bb',
      });
      expect(ok).toBe(true);
    });

    it('throws on non-200 sign', async () => {
      const a = new Attestor({
        httpUrl: 'http://h',
        fetchImpl: mockFetch(500, { error: 'kms down' }),
      });
      await expect(
        a.sign({ topic: 't', partition: 0, offset: 1, value: 'hi' }),
      ).rejects.toBeInstanceOf(AttestationError);
    });
  });

  describe('SemanticSearchClient', () => {
    it('rejects empty query', async () => {
      const c = new SemanticSearchClient({ httpUrl: 'http://h', fetchImpl: mockFetch(200, {}) });
      await expect(c.search('t', '')).rejects.toBeInstanceOf(SemanticSearchError);
    });

    it('rejects k out of bounds', async () => {
      const c = new SemanticSearchClient({ httpUrl: 'http://h', fetchImpl: mockFetch(200, {}) });
      await expect(c.search('t', 'q', { k: 0 })).rejects.toBeInstanceOf(SemanticSearchError);
      await expect(c.search('t', 'q', { k: 1001 })).rejects.toBeInstanceOf(SemanticSearchError);
    });

    it('parses hits + tookMs', async () => {
      const c = new SemanticSearchClient({
        httpUrl: 'http://h',
        fetchImpl: mockFetch(200, {
          hits: [{ partition: 1, offset: 5, score: 0.9, value: 'x' }],
          took_ms: 12,
        }),
      });
      const r = await c.search('t', 'q', { k: 5 });
      expect(r.tookMs).toBe(12);
      expect(r.hits[0]).toEqual({ partition: 1, offset: 5, score: 0.9, value: 'x' });
    });
  });

  describe('MemoryClient', () => {
    it('rejects unknown kind', async () => {
      const c = new MemoryClient({ httpUrl: 'http://h', fetchImpl: mockFetch(200, {}) });
      await expect(
        c.remember({ agentId: 'a', kind: 'wat' as any, content: 'c' }),
      ).rejects.toBeInstanceOf(MemoryError);
    });

    it('requires skill for procedure', async () => {
      const c = new MemoryClient({ httpUrl: 'http://h', fetchImpl: mockFetch(200, {}) });
      await expect(
        c.remember({ agentId: 'a', kind: 'procedure', content: 'c' }),
      ).rejects.toBeInstanceOf(MemoryError);
    });

    it('remember returns mapped entries', async () => {
      const c = new MemoryClient({
        httpUrl: 'http://h',
        fetchImpl: mockFetch(200, {
          written: [
            { topic: 'agent-a-episodic', offset: 1 },
            { topic: 'agent-a-semantic', offset: 2 },
          ],
        }),
      });
      const w = await c.remember({ agentId: 'a', kind: 'fact', content: 'x', importance: 0.8 });
      expect(w).toHaveLength(2);
      expect(w[1].offset).toBe(2);
    });

    it('recall maps tier+score', async () => {
      const c = new MemoryClient({
        httpUrl: 'http://h',
        fetchImpl: mockFetch(200, {
          hits: [{ tier: 'semantic', topic: 'agent-a-semantic', offset: 5, content: 'hi', score: 0.7 }],
        }),
      });
      const hits = await c.recall({ agentId: 'a', query: 'q' });
      expect(hits[0].tier).toBe('semantic');
      expect(hits[0].score).toBe(0.7);
    });
  });
});
