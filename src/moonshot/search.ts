/**
 * HTTP client for semantic-topic search (M2 P1, Experimental).
 *
 * Wraps `POST /api/v1/topics/{topic}/search`. Named `SemanticSearchClient`
 * to avoid clashing with the existing `SearchResult` exported from `ai.ts`.
 */

import { StreamlineError } from '../types';
import { MoonshotHttpClient, MoonshotClientOptions } from './http';

export class SemanticSearchError extends StreamlineError {
  constructor(message: string) {
    super(message);
    this.name = 'SemanticSearchError';
  }
}

export interface SemanticSearchHit {
  partition: number;
  offset: number;
  score: number;
  value: string | null;
}

export interface SemanticSearchResult {
  hits: SemanticSearchHit[];
  tookMs: number;
}

interface HitWire {
  partition?: number;
  offset?: number;
  score?: number;
  value?: string | null;
}

interface ResultWire {
  hits?: HitWire[];
  took_ms?: number;
}

export interface SemanticSearchOptions {
  k?: number;
  filter?: Record<string, unknown>;
}

export class SemanticSearchClient extends MoonshotHttpClient {
  constructor(opts: MoonshotClientOptions) {
    super(opts);
  }

  async search(
    topic: string,
    query: string,
    opts: SemanticSearchOptions = {},
  ): Promise<SemanticSearchResult> {
    if (!topic) throw new SemanticSearchError('topic must not be empty');
    if (!query) throw new SemanticSearchError('query must not be empty');
    const k = opts.k ?? 10;
    if (k <= 0 || k > 1000)
      throw new SemanticSearchError('k must be in [1, 1000]');

    const body: Record<string, unknown> = { query, k };
    if (opts.filter) body['filter'] = opts.filter;

    const { status, body: payload, rawText } = await this.request(
      'POST',
      `/api/v1/topics/${encodeURIComponent(topic)}/search`,
      body,
    );
    if (status >= 400) {
      throw new SemanticSearchError(
        `search request to /api/v1/topics/${topic}/search failed (HTTP ${status}): ${rawText.slice(0, 512)}`,
      );
    }
    const w = (payload ?? {}) as ResultWire;
    return {
      hits: (w.hits ?? []).map((h) => ({
        partition: Number(h.partition ?? 0),
        offset: Number(h.offset ?? 0),
        score: Number(h.score ?? 0),
        value: h.value ?? null,
      })),
      tookMs: Number(w.took_ms ?? 0),
    };
  }
}
