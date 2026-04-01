/**
 * HTTP admin client for branched streams (M5 P1, Experimental).
 *
 * Wraps the broker's `/api/v1/branches/*` admin API. Mirrors the Python SDK
 * `BranchAdminClient`.
 *
 * @example
 * ```ts
 * import { BranchAdminClient } from 'streamline';
 *
 * const client = new BranchAdminClient({ httpUrl: 'http://localhost:9094' });
 * await client.create('orders', 'exp-a');
 * const branches = await client.list();
 * await client.append('orders/exp-a', 'user', 'hi');
 * await client.delete('orders/exp-a');
 * ```
 */

import { StreamlineError } from '../types';
import { MoonshotHttpClient, MoonshotClientOptions } from './http';

export class BranchAdminError extends StreamlineError {
  constructor(message: string) {
    super(message);
    this.name = 'BranchAdminError';
  }
}

export interface BranchView {
  id: string;
  parent: string | null;
  createdAtMs: number;
  messageCount: number;
  metadata: Record<string, unknown>;
}

export interface BranchMessage {
  role: string;
  text: string;
  timestampMs: number;
}

interface BranchViewWire {
  id: string;
  parent?: string | null;
  created_at_ms?: number;
  message_count?: number;
  metadata?: Record<string, unknown>;
}

interface BranchMessageWire {
  role?: string;
  text?: string;
  timestamp_ms?: number;
}

function toBranchView(d: BranchViewWire): BranchView {
  return {
    id: d.id,
    parent: d.parent ?? null,
    createdAtMs: Number(d.created_at_ms ?? 0),
    messageCount: Number(d.message_count ?? 0),
    metadata: d.metadata ?? {},
  };
}

function toBranchMessage(d: BranchMessageWire): BranchMessage {
  return {
    role: String(d.role ?? ''),
    text: String(d.text ?? ''),
    timestampMs: Number(d.timestamp_ms ?? 0),
  };
}

export interface CreateBranchOptions {
  parent?: string;
  metadata?: Record<string, unknown>;
}

export class BranchAdminClient extends MoonshotHttpClient {
  constructor(opts: MoonshotClientOptions) {
    super(opts);
  }

  async create(topic: string, name: string, opts: CreateBranchOptions = {}): Promise<BranchView> {
    if (!topic) throw new BranchAdminError('topic must not be empty');
    if (!name) throw new BranchAdminError('name must not be empty');
    const body: Record<string, unknown> = { topic, name };
    if (opts.parent !== undefined) body['parent'] = opts.parent;
    if (opts.metadata) body['metadata'] = opts.metadata;
    const data = await this.call('POST', '/api/v1/branches', body);
    return toBranchView(data as BranchViewWire);
  }

  async list(): Promise<BranchView[]> {
    const data = await this.call('GET', '/api/v1/branches');
    const items: BranchViewWire[] = Array.isArray(data)
      ? (data as BranchViewWire[])
      : ((data as { items?: BranchViewWire[] }).items ?? []);
    return items.map(toBranchView);
  }

  async get(branchId: string): Promise<BranchView> {
    if (!branchId) throw new BranchAdminError('branchId must not be empty');
    const data = await this.call('GET', `/api/v1/branches/${encodeURIComponent(branchId)}`);
    return toBranchView(data as BranchViewWire);
  }

  async delete(branchId: string): Promise<void> {
    if (!branchId) throw new BranchAdminError('branchId must not be empty');
    await this.call('DELETE', `/api/v1/branches/${encodeURIComponent(branchId)}`);
  }

  async append(branchId: string, role: string, text: string, timestampMs = 0): Promise<void> {
    if (!branchId) throw new BranchAdminError('branchId must not be empty');
    if (!role) throw new BranchAdminError('role must not be empty');
    const body: Record<string, unknown> = { role, text };
    if (timestampMs) body['timestamp_ms'] = timestampMs;
    await this.call('POST', `/api/v1/branches/${encodeURIComponent(branchId)}/messages`, body);
  }

  async messages(branchId: string): Promise<BranchMessage[]> {
    if (!branchId) throw new BranchAdminError('branchId must not be empty');
    const data = await this.call('GET', `/api/v1/branches/${encodeURIComponent(branchId)}/messages`);
    const items: BranchMessageWire[] = Array.isArray(data)
      ? (data as BranchMessageWire[])
      : ((data as { messages?: BranchMessageWire[] }).messages ?? []);
    return items.map(toBranchMessage);
  }

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const { status, body: payload, rawText } = await this.request(method, path, body);
    if (status >= 200 && status < 300) {
      return payload ?? {};
    }
    throw new BranchAdminError(`${method} ${path} -> HTTP ${status}: ${rawText.slice(0, 512)}`);
  }
}
