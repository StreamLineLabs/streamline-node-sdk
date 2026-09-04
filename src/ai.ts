/**
 * AI-native streaming capabilities for Streamline.
 */

import { StreamlineError } from './types';
import { coerceNumber, coerceString, isRecord, parseJson } from './internal/guards';

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  usage: { tokens: number };
}

export interface SearchResult {
  score: number;
  offset: number;
  value: unknown;
}

export interface AnomalyAlert {
  field: string;
  value: number;
  zScore: number;
  timestamp: number;
}

export interface RAGResponse {
  answer: string;
  sources: { offset: number; score: number }[];
  model: string;
}

/** SSE `data:` line prefix used by the anomaly detection stream. */
const SSE_DATA_PREFIX = 'data: ';

/**
 * Map one decoded anomaly event onto the public {@link AnomalyAlert} shape.
 *
 * @param payload - Parsed JSON body of an SSE `data:` line
 * @returns The alert, or `undefined` when the payload is not a JSON object
 */
export function toAnomalyAlert(payload: unknown): AnomalyAlert | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  return {
    field: coerceString(payload['field'], ''),
    value: coerceNumber(payload['value'], 0),
    zScore: coerceNumber(payload['z_score'], 0),
    timestamp: coerceNumber(payload['timestamp'], 0),
  };
}

/**
 * AI client for Streamline's AI-native streaming capabilities.
 *
 * @example
 * ```typescript
 * const ai = new AIClient('http://localhost:9094');
 *
 * const vectors = await ai.embed(['hello world']);
 * const results = await ai.search('user events', 'events');
 * const answer = await ai.rag('What happened?', 'incidents');
 * ```
 */
export class AIClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:9094') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async embed(texts: string[], model = 'default'): Promise<EmbeddingResult> {
    return this.post('/api/v1/ai/embed', { texts, model });
  }

  async search(query: string, topic: string, topK = 10): Promise<SearchResult[]> {
    const data = await this.post<{ results: SearchResult[] }>('/api/v1/ai/search', {
      query, topic, top_k: topK,
    });
    return data.results;
  }

  async *detectAnomalies(
    topic: string,
    config: { threshold?: number; windowSize?: number } = {}
  ): AsyncGenerator<AnomalyAlert> {
    const response = await fetch(`${this.baseUrl}/api/v1/ai/anomalies/detect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic,
        config: { threshold: config.threshold ?? 2.0, window_size: config.windowSize ?? 100 },
      }),
    });

    if (!response.ok || !response.body) {
      throw new StreamlineError(`Anomaly detection failed: ${response.statusText}`, 'AI_ERROR');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const result = await reader.read();
      if (result.done) break;

      const chunk: unknown = result.value;
      if (chunk instanceof Uint8Array || chunk instanceof ArrayBuffer) {
        buffer += decoder.decode(chunk, { stream: true });
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith(SSE_DATA_PREFIX)) {
          const alert = toAnomalyAlert(parseJson(line.slice(SSE_DATA_PREFIX.length)));
          if (alert) {
            yield alert;
          }
        }
      }
    }
  }

  async rag(
    query: string,
    contextTopic: string,
    model = 'gpt-4',
    topK = 5
  ): Promise<RAGResponse> {
    return this.post('/api/v1/ai/rag', {
      query, context_topic: contextTopic, model, top_k: topK,
    });
  }

  private async post<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new StreamlineError(`AI API error: ${error}`, 'AI_ERROR');
    }
    return response.json() as Promise<T>;
  }
}
