/**
 * Shared HTTP helper for moonshot clients (M1, M2, M4, M5).
 *
 * Uses the global `fetch` available in Node 18+. No external deps.
 * @internal
 */

import { StreamlineError } from '../types';

export interface MoonshotClientOptions {
  /** Broker HTTP base URL (e.g. `http://localhost:9094`). */
  httpUrl: string;
  /** Per-request timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
  /** Optional override for the global fetch (used in tests). */
  fetchImpl?: typeof fetch;
}

export interface RequestResult {
  status: number;
  body: unknown;
  rawText: string;
}

export class MoonshotHttpClient {
  protected readonly httpUrl: string;
  protected readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: MoonshotClientOptions) {
    if (!opts.httpUrl) {
      throw new StreamlineError('httpUrl is required');
    }
    this.httpUrl = opts.httpUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async request(
    method: string,
    path: string,
    jsonBody?: unknown,
  ): Promise<RequestResult> {
    const url = `${this.httpUrl}${path}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: string | undefined;
    if (jsonBody !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(jsonBody);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (body !== undefined) init.body = body;
    let resp: Response;
    try {
      resp = await this.fetchImpl(url, init);
    } finally {
      clearTimeout(timer);
    }

    const rawText = await resp.text();
    let parsed: unknown = undefined;
    if (rawText) {
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = { raw: rawText };
      }
    }
    return { status: resp.status, body: parsed, rawText };
  }
}
