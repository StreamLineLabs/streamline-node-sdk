/**
 * OpenTelemetry integration for Streamline Node.js SDK.
 *
 * Provides automatic tracing for produce and consume operations when
 * `@opentelemetry/api` is installed as a peer dependency. When the
 * package is not available, all operations are no-ops with zero overhead.
 *
 * Span conventions follow the OTel semantic conventions for messaging:
 * - Span name: `{topic} {operation}` (e.g., "orders produce")
 * - Attributes: messaging.system=streamline, messaging.destination.name={topic},
 *   messaging.operation={produce|consume}
 * - Kind: PRODUCER for produce, CONSUMER for consume
 *
 * @example
 * ```typescript
 * import { StreamlineTracing } from 'streamline';
 *
 * const tracing = new StreamlineTracing();
 *
 * // Trace a produce operation
 * const result = await tracing.traceProducer('orders', headers, async () => {
 *   return await producer.send({ value: data });
 * });
 *
 * // Trace a consume operation
 * const records = await tracing.traceConsumer('events', async () => {
 *   return await consumer.poll();
 * });
 * ```
 *
 * @packageDocumentation
 */

// OTel types (used only for type annotations when the package is available)
interface OtelApi {
  trace: {
    getTracer(name: string, version?: string): OtelTracer;
    setSpan(context: OtelContext, span: OtelSpan): OtelContext;
  };
  context: {
    active(): OtelContext;
    with<T>(context: OtelContext, fn: () => T): T;
  };
  propagation: {
    inject(context: OtelContext, carrier: Record<string, string>, setter?: unknown): void;
    extract(context: OtelContext, carrier: Record<string, string>, getter?: unknown): OtelContext;
  };
  SpanKind: {
    PRODUCER: number;
    CONSUMER: number;
  };
  SpanStatusCode: {
    OK: number;
    ERROR: number;
  };
}

interface OtelTracer {
  startSpan(name: string, options?: Record<string, unknown>, context?: OtelContext): OtelSpan;
}

interface OtelSpan {
  setAttribute(key: string, value: string | number): OtelSpan;
  setStatus(status: { code: number; message?: string }): OtelSpan;
  recordException(error: Error): OtelSpan;
  end(): void;
  spanContext(): { traceId: string; spanId: string };
}

interface OtelContext {}

/** Whether @opentelemetry/api is available */
let otelApi: OtelApi | null = null;

try {
  // Dynamic import to avoid hard dependency
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  otelApi = require('@opentelemetry/api');
} catch {
  // @opentelemetry/api not installed -- tracing disabled
  otelApi = null;
}

/**
 * Configuration for StreamlineTracing.
 */
export interface TracingConfig {
  /** Instrumentation scope name (default: "streamline-node-sdk") */
  tracerName?: string;
  /** Instrumentation scope version (default: "0.2.0") */
  tracerVersion?: string;
  /** Explicitly enable/disable tracing (default: auto-detect) */
  enabled?: boolean;
}

/**
 * OpenTelemetry tracing wrapper for Streamline operations.
 *
 * When `@opentelemetry/api` is not installed, all methods pass through
 * to the underlying action with zero overhead.
 *
 * @example
 * ```typescript
 * const tracing = new StreamlineTracing();
 *
 * // Check if tracing is active
 * console.log('Tracing enabled:', tracing.isEnabled);
 *
 * // Wrap produce
 * await tracing.traceProducer('my-topic', {}, async () => {
 *   await producer.send({ value: data });
 * });
 * ```
 */
export class StreamlineTracing {
  private tracer: OtelTracer | null = null;
  private _enabled: boolean;

  constructor(config: TracingConfig = {}) {
    const {
      tracerName = 'streamline-node-sdk',
      tracerVersion = '0.2.0',
      enabled,
    } = config;

    this._enabled = enabled !== undefined ? enabled : otelApi !== null;

    if (this._enabled && otelApi) {
      this.tracer = otelApi.trace.getTracer(tracerName, tracerVersion);
    } else if (this._enabled && !otelApi) {
      // Requested but not available
      this._enabled = false;
    }
  }

  /**
   * Whether OpenTelemetry tracing is active.
   */
  get isEnabled(): boolean {
    return this._enabled;
  }

  /**
   * Trace a produce operation.
   *
   * Creates a PRODUCER span, injects trace context into headers, and
   * executes the action within the span context.
   *
   * @param topic - Destination topic name
   * @param headers - Message headers; trace context is injected in-place
   * @param action - The produce action to execute
   * @returns The result of the action
   */
  async traceProducer<T>(
    topic: string,
    headers: Record<string, string> | undefined,
    action: () => Promise<T>
  ): Promise<T> {
    if (!this._enabled || !this.tracer || !otelApi) {
      return action();
    }

    const span = this.tracer.startSpan(`${topic} produce`, {
      kind: otelApi.SpanKind.PRODUCER,
      attributes: {
        'messaging.system': 'streamline',
        'messaging.destination.name': topic,
        'messaging.operation': 'produce',
      },
    });

    // Inject trace context into headers
    if (headers) {
      const ctx = otelApi.trace.setSpan(otelApi.context.active(), span);
      otelApi.propagation.inject(ctx, headers);
    }

    const ctx = otelApi.trace.setSpan(otelApi.context.active(), span);

    try {
      const result = await otelApi.context.with(ctx, () => action());
      span.setStatus({ code: otelApi!.SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: otelApi.SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Trace a consume/poll operation.
   *
   * Creates a CONSUMER span for the consume action.
   *
   * @param topic - Source topic name
   * @param action - The consume action to execute
   * @returns The result of the action
   */
  async traceConsumer<T>(
    topic: string,
    action: () => Promise<T>
  ): Promise<T> {
    if (!this._enabled || !this.tracer || !otelApi) {
      return action();
    }

    const span = this.tracer.startSpan(`${topic} consume`, {
      kind: otelApi.SpanKind.CONSUMER,
      attributes: {
        'messaging.system': 'streamline',
        'messaging.destination.name': topic,
        'messaging.operation': 'consume',
      },
    });

    const ctx = otelApi.trace.setSpan(otelApi.context.active(), span);

    try {
      const result = await otelApi.context.with(ctx, () => action());
      span.setStatus({ code: otelApi!.SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: otelApi.SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Trace processing of a single consumed message.
   *
   * Extracts parent context from message headers and creates a child
   * processing span linked to the producer trace.
   *
   * @param topic - Source topic name
   * @param partition - Partition number
   * @param offset - Message offset
   * @param headers - Message headers (for context extraction)
   * @param action - The processing action
   * @returns The result of the action
   */
  async traceProcess<T>(
    topic: string,
    partition: number,
    offset: number,
    headers: Record<string, string> | undefined,
    action: () => Promise<T>
  ): Promise<T> {
    if (!this._enabled || !this.tracer || !otelApi) {
      return action();
    }

    // Extract parent context from headers
    let parentCtx = otelApi.context.active();
    if (headers) {
      parentCtx = otelApi.propagation.extract(parentCtx, headers);
    }

    const span = this.tracer.startSpan(
      `${topic} process`,
      {
        kind: otelApi.SpanKind.CONSUMER,
        attributes: {
          'messaging.system': 'streamline',
          'messaging.destination.name': topic,
          'messaging.operation': 'process',
          'messaging.destination.partition.id': String(partition),
          'messaging.message.id': String(offset),
        },
      },
      parentCtx
    );

    const ctx = otelApi.trace.setSpan(parentCtx, span);

    try {
      const result = await otelApi.context.with(ctx, () => action());
      span.setStatus({ code: otelApi!.SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: otelApi.SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Inject the current trace context into message headers.
   *
   * Useful for manual context propagation when not using traceProducer.
   *
   * @param headers - Headers object to inject context into
   */
  injectContext(headers: Record<string, string>): void {
    if (!this._enabled || !otelApi) {
      return;
    }
    otelApi.propagation.inject(otelApi.context.active(), headers);
  }

  /**
   * Extract trace context from message headers.
   *
   * Returns the extracted context that can be used as parent for new spans.
   *
   * @param headers - Headers containing trace context
   */
  extractContext(headers: Record<string, string>): unknown {
    if (!this._enabled || !otelApi) {
      return undefined;
    }
    return otelApi.propagation.extract(otelApi.context.active(), headers);
  }
}
