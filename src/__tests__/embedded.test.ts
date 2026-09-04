import { describe, it, expect, vi, afterEach } from 'vitest';
import Module from 'node:module';
import { EmbeddedStreamline } from '../embedded';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Count how many times the native addon specifier is resolved. */
function countNativeLoads(fn: () => void): number {
  let count = 0;
  const internals = Module as unknown as { _load: (req: string, ...rest: unknown[]) => unknown };
  const original = internals._load;
  internals._load = function patched(request: string, ...rest: unknown[]): unknown {
    if (request.includes('streamline.node')) {
      count += 1;
    }
    return original.call(this, request, ...rest);
  };
  try {
    fn();
  } finally {
    internals._load = original;
  }
  return count;
}

describe('EmbeddedStreamline', () => {
  describe('isAvailable', () => {
    it('reports false when the native addon has not been built', () => {
      expect(EmbeddedStreamline.isAvailable).toBe(false);
    });

    it('memoises the negative result instead of re-resolving on every read', () => {
      // Warm the cache, then assert no further resolution attempts occur.
      void EmbeddedStreamline.isAvailable;
      const loads = countNativeLoads(() => {
        void EmbeddedStreamline.isAvailable;
        void EmbeddedStreamline.isAvailable;
        void EmbeddedStreamline.isAvailable;
        try {
          new EmbeddedStreamline();
        } catch {
          // expected — the addon is absent
        }
      });
      expect(loads).toBe(0);
    });
  });

  describe('constructor', () => {
    it('throws an actionable error when the addon is missing', () => {
      expect(() => new EmbeddedStreamline()).toThrow(/Streamline native module not found/);
    });

    it('points at the build instructions and the remote-client alternative', () => {
      let message = '';
      try {
        new EmbeddedStreamline({ inMemory: true });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain('native/streamline.node');
      expect(message).toContain('cd native && npm run build');
      expect(message).toContain('ghcr.io/streamlinelabs/streamline:latest');
    });

    it('does not fail the module import when the addon is absent', () => {
      // Loading is lazy and error-tolerant: importing the SDK must never throw
      // just because the optional native binary is not present.
      expect(EmbeddedStreamline).toBeTypeOf('function');
    });
  });
});
