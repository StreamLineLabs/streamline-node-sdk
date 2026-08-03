import { describe, it, expect } from 'vitest';
import { isOtelApi, StreamlineTracing } from '../telemetry';
import { loadOptionalModule } from '../internal/optional-module';

/** Whether the optional peer is actually installed in this environment. */
const otelInstalled = isOtelApi(loadOptionalModule('@opentelemetry/api'));

/** A stand-in shaped like the real `@opentelemetry/api` module namespace. */
function fakeOtelApi(): Record<string, unknown> {
  return {
    trace: { getTracer: () => undefined, setSpan: () => undefined },
    context: { active: () => undefined, with: () => undefined },
    propagation: { inject: () => undefined, extract: () => undefined },
    SpanKind: { PRODUCER: 3, CONSUMER: 4 },
    SpanStatusCode: { OK: 1, ERROR: 2 },
  };
}

describe('isOtelApi', () => {
  it('accepts a module exposing every member the SDK dereferences', () => {
    expect(isOtelApi(fakeOtelApi())).toBe(true);
  });

  it('accepts class-instance style APIs with prototype methods', () => {
    class TraceApi {
      getTracer(): undefined {
        return undefined;
      }
      setSpan(): undefined {
        return undefined;
      }
    }
    const mod = fakeOtelApi();
    mod['trace'] = new TraceApi();
    expect(isOtelApi(mod)).toBe(true);
  });

  it('accepts the real @opentelemetry/api when it is installed', () => {
    if (!otelInstalled) {
      // Optional peer dependency is absent — nothing to assert here.
      expect(otelInstalled).toBe(false);
      return;
    }
    expect(isOtelApi(loadOptionalModule('@opentelemetry/api'))).toBe(true);
  });

  it('rejects non-object values', () => {
    expect(isOtelApi(undefined)).toBe(false);
    expect(isOtelApi(null)).toBe(false);
    expect(isOtelApi('api')).toBe(false);
    expect(isOtelApi([fakeOtelApi()])).toBe(false);
  });

  it.each([
    'trace',
    'context',
    'propagation',
    'SpanKind',
    'SpanStatusCode',
  ])('rejects a module missing %s', (key) => {
    const mod = fakeOtelApi();
    delete mod[key];
    expect(isOtelApi(mod)).toBe(false);
  });

  it.each([
    ['trace', 'getTracer'],
    ['trace', 'setSpan'],
    ['context', 'active'],
    ['context', 'with'],
    ['propagation', 'inject'],
    ['propagation', 'extract'],
  ])('rejects a module whose %s.%s is not callable', (group, method) => {
    const mod = fakeOtelApi();
    (mod[group] as Record<string, unknown>)[method] = 'not a function';
    expect(isOtelApi(mod)).toBe(false);
  });
});

describe('StreamlineTracing auto-detection', () => {
  it('matches the availability of the optional peer', () => {
    expect(new StreamlineTracing().isEnabled).toBe(otelInstalled);
  });

  it('never enables tracing when the module is unavailable', () => {
    expect(new StreamlineTracing({ enabled: true }).isEnabled).toBe(otelInstalled);
  });

  it('honours an explicit disable regardless of availability', () => {
    expect(new StreamlineTracing({ enabled: false }).isEnabled).toBe(false);
  });
});

describe('StreamlineTracing pass-through behaviour', () => {
  it('returns the action result from every trace wrapper', async () => {
    const tracing = new StreamlineTracing();
    await expect(tracing.traceProducer('t', {}, () => Promise.resolve('produced'))).resolves.toBe(
      'produced',
    );
    await expect(tracing.traceConsumer('t', () => Promise.resolve(['a']))).resolves.toEqual(['a']);
    await expect(
      tracing.traceProcess('t', 0, 1, {}, () => Promise.resolve('processed')),
    ).resolves.toBe('processed');
  });

  it('propagates action failures', async () => {
    const tracing = new StreamlineTracing();
    await expect(
      tracing.traceProducer('t', undefined, () => Promise.reject(new Error('send failed'))),
    ).rejects.toThrow('send failed');
    await expect(
      tracing.traceConsumer('t', () => Promise.reject(new Error('poll failed'))),
    ).rejects.toThrow('poll failed');
    await expect(
      tracing.traceProcess('t', 0, 0, undefined, () => Promise.reject(new Error('proc failed'))),
    ).rejects.toThrow('proc failed');
  });

  it('accepts undefined headers without throwing', async () => {
    const tracing = new StreamlineTracing();
    await expect(
      tracing.traceProducer('t', undefined, () => Promise.resolve(1)),
    ).resolves.toBe(1);
  });

  it('leaves headers untouched when tracing is disabled', () => {
    const tracing = new StreamlineTracing({ enabled: false });
    const headers: Record<string, string> = { existing: 'value' };
    tracing.injectContext(headers);
    expect(headers).toEqual({ existing: 'value' });
    expect(tracing.extractContext(headers)).toBeUndefined();
  });
});
