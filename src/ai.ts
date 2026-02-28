/**
 * AI-native streaming capabilities for Streamline.
 */

import { StreamlineError } from './types';

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
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          yield {
            field: data.field,
            value: data.value,
            zScore: data.z_score,
            timestamp: data.timestamp,
          };
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
