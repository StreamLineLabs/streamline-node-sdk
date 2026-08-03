import { describe, it, expect, vi, afterEach } from 'vitest';
import { AIClient, toAnomalyAlert } from '../ai';
import { StreamlineError } from '../types';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Build a Response whose body streams the given SSE text in fixed-size chunks. */
function sseResponse(text: string, chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Response(body, { status: 200 });
}

function stubFetch(response: Response | (() => Response)): ReturnType<typeof vi.fn> {
  const impl = vi.fn(() => Promise.resolve(typeof response === 'function' ? response() : response));
  globalThis.fetch = impl as unknown as typeof fetch;
  return impl;
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
}

describe('toAnomalyAlert', () => {
  it('maps a complete snake_case payload', () => {
    expect(
      toAnomalyAlert({ field: 'latency', value: 1.5, z_score: 3.2, timestamp: 1700 }),
    ).toEqual({ field: 'latency', value: 1.5, zScore: 3.2, timestamp: 1700 });
  });

  it('applies defaults for missing fields instead of emitting undefined', () => {
    expect(toAnomalyAlert({})).toEqual({ field: '', value: 0, zScore: 0, timestamp: 0 });
  });

  it('coerces numeric strings sent by the broker', () => {
    expect(toAnomalyAlert({ field: 'cpu', value: '90', z_score: '4', timestamp: '5' })).toEqual({
      field: 'cpu',
      value: 90,
      zScore: 4,
      timestamp: 5,
    });
  });

  it('never yields NaN for unparseable numbers', () => {
    const alert = toAnomalyAlert({ field: 'x', value: 'abc', z_score: null, timestamp: {} });
    expect(alert).toEqual({ field: 'x', value: 0, zScore: 0, timestamp: 0 });
  });

  it('returns undefined for non-object payloads', () => {
    expect(toAnomalyAlert(null)).toBeUndefined();
    expect(toAnomalyAlert(undefined)).toBeUndefined();
    expect(toAnomalyAlert('data')).toBeUndefined();
    expect(toAnomalyAlert(42)).toBeUndefined();
    expect(toAnomalyAlert([{ field: 'x' }])).toBeUndefined();
  });
});

describe('AIClient', () => {
  describe('constructor', () => {
    it('strips a trailing slash from the base URL', async () => {
      const impl = stubFetch(new Response(JSON.stringify({ results: [] }), { status: 200 }));
      await new AIClient('http://ai:9094/').search('q', 'topic');
      expect(String(impl.mock.calls[0][0])).toBe('http://ai:9094/api/v1/ai/search');
    });
  });

  describe('post error path', () => {
    it('throws StreamlineError with the response text', async () => {
      stubFetch(new Response('model unavailable', { status: 503 }));
      await expect(new AIClient('http://ai:9094').embed(['x'])).rejects.toThrow(StreamlineError);
      stubFetch(new Response('model unavailable', { status: 503 }));
      await expect(new AIClient('http://ai:9094').embed(['x'])).rejects.toThrow(
        /AI API error: model unavailable/,
      );
    });
  });

  describe('detectAnomalies', () => {
    it('decodes alerts across chunk boundaries', async () => {
      const text =
        'data: {"field":"a","value":1,"z_score":2,"timestamp":10}\n' +
        'data: {"field":"b","value":2,"z_score":3,"timestamp":20}\n';
      stubFetch(() => sseResponse(text, 5));

      await expect(collect(new AIClient('http://ai:9094').detectAnomalies('metrics'))).resolves.toEqual([
        { field: 'a', value: 1, zScore: 2, timestamp: 10 },
        { field: 'b', value: 2, zScore: 3, timestamp: 20 },
      ]);
    });

    it('ignores non-data lines and skips non-object events', async () => {
      const text = ': keep-alive\nevent: ping\ndata: "not an object"\ndata: {"field":"ok"}\n';
      stubFetch(() => sseResponse(text));

      await expect(collect(new AIClient('http://ai:9094').detectAnomalies('metrics'))).resolves.toEqual([
        { field: 'ok', value: 0, zScore: 0, timestamp: 0 },
      ]);
    });

    it('propagates malformed JSON as a SyntaxError', async () => {
      stubFetch(() => sseResponse('data: {broken\n'));
      await expect(collect(new AIClient('http://ai:9094').detectAnomalies('m'))).rejects.toThrow(
        SyntaxError,
      );
    });

    it('throws StreamlineError when the request fails', async () => {
      stubFetch(new Response('nope', { status: 500 }));
      await expect(collect(new AIClient('http://ai:9094').detectAnomalies('m'))).rejects.toThrow(
        StreamlineError,
      );
    });

    it('throws StreamlineError when the response has no body', async () => {
      stubFetch(new Response(null, { status: 200 }));
      await expect(collect(new AIClient('http://ai:9094').detectAnomalies('m'))).rejects.toThrow(
        /Anomaly detection failed/,
      );
    });

    it('sends the configured threshold and window size', async () => {
      const impl = stubFetch(() => sseResponse(''));
      await collect(
        new AIClient('http://ai:9094').detectAnomalies('m', { threshold: 4, windowSize: 50 }),
      );
      expect(JSON.parse(String(impl.mock.calls[0][1].body))).toEqual({
        topic: 'm',
        config: { threshold: 4, window_size: 50 },
      });
    });

    it('defaults threshold to 2.0 and window size to 100', async () => {
      const impl = stubFetch(() => sseResponse(''));
      await collect(new AIClient('http://ai:9094').detectAnomalies('m'));
      expect(JSON.parse(String(impl.mock.calls[0][1].body))).toEqual({
        topic: 'm',
        config: { threshold: 2.0, window_size: 100 },
      });
    });
  });
});
