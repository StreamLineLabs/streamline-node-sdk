/**
 * HTTP client for the Agent Memory Fabric (M1 P1, Experimental).
 *
 * Wraps `POST /api/v1/memory/remember` and `POST /api/v1/memory/recall`.
 */

import { StreamlineError } from '../types';
import { MoonshotHttpClient, MoonshotClientOptions } from './http';

export class MemoryError extends StreamlineError {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryError';
  }
}

export type MemoryKind = 'observation' | 'fact' | 'procedure';
const VALID_KINDS: ReadonlySet<MemoryKind> = new Set([
  'observation',
  'fact',
  'procedure',
]);

export interface WrittenEntry {
  topic: string;
  offset: number;
}

export interface RecalledMemory {
  tier: string;
  topic: string;
  offset: number;
  content: string;
  score: number;
}

export interface RememberParams {
  agentId: string;
  kind: MemoryKind;
  content: string;
  importance?: number;
  tags?: string[];
  /** Required when `kind === 'procedure'`. */
  skill?: string;
}

export interface RecallParams {
  agentId: string;
  query: string;
  k?: number;
  minHits?: number;
}

interface WrittenWire {
  topic: string;
  offset: number;
}

interface RecalledWire {
  tier?: string;
  topic?: string;
  offset?: number;
  content?: string;
  score?: number;
}

export class MemoryClient extends MoonshotHttpClient {
  constructor(opts: MoonshotClientOptions) {
    super(opts);
  }

  async remember(params: RememberParams): Promise<WrittenEntry[]> {
    if (!params.agentId) throw new MemoryError('agentId must not be empty');
    if (!params.content) throw new MemoryError('content must not be empty');
    const kind = String(params.kind ?? '').toLowerCase() as MemoryKind;
    if (!VALID_KINDS.has(kind)) {
      throw new MemoryError(
        `kind must be one of ${[...VALID_KINDS].join(', ')}, got '${params.kind}'`,
      );
    }
    const importance = params.importance ?? 0.5;
    if (importance < 0 || importance > 1) {
      throw new MemoryError('importance must be in [0.0, 1.0]');
    }
    if (kind === 'procedure' && !params.skill) {
      throw new MemoryError("skill is required for kind='procedure'");
    }

    const body: Record<string, unknown> = {
      agent_id: params.agentId,
      kind,
      content: params.content,
      importance,
      tags: params.tags ?? [],
    };
    if (kind === 'procedure') body['skill'] = params.skill;

    const data = await this.call('/api/v1/memory/remember', body);
    const items: WrittenWire[] =
      ((data as { written?: WrittenWire[] } | null)?.written ?? []) as WrittenWire[];
    return items.map((e) => ({ topic: e.topic, offset: Number(e.offset) }));
  }

  async recall(params: RecallParams): Promise<RecalledMemory[]> {
    if (!params.agentId) throw new MemoryError('agentId must not be empty');
    if (!params.query) throw new MemoryError('query must not be empty');
    const k = params.k ?? 10;
    if (k <= 0 || k > 1000) throw new MemoryError('k must be in [1, 1000]');

    const body = {
      agent_id: params.agentId,
      query: params.query,
      k,
      min_hits: params.minHits ?? 0,
    };
    const data = await this.call('/api/v1/memory/recall', body);
    const hits: RecalledWire[] =
      ((data as { hits?: RecalledWire[] } | null)?.hits ?? []) as RecalledWire[];
    return hits.map((h) => ({
      tier: String(h.tier ?? ''),
      topic: String(h.topic ?? ''),
      offset: Number(h.offset ?? 0),
      content: String(h.content ?? ''),
      score: Number(h.score ?? 0),
    }));
  }

  private async call(path: string, body: unknown): Promise<unknown> {
    const { status, body: payload, rawText } = await this.request(
      'POST',
      path,
      body,
    );
    if (status >= 400) {
      throw new MemoryError(
        `memory request to ${path} failed (HTTP ${status}): ${rawText.slice(0, 512)}`,
      );
    }
    return payload ?? {};
  }
}
