import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  coerceNumber,
  coerceString,
  isRecord,
  isUnknownArray,
  parseJson,
  parseJsonObject,
  toRecordArray,
} from '../internal/guards';
import { fromSync } from '../internal/async';
import { loadOptionalModule, moduleDir } from '../internal/optional-module';

describe('internal/guards', () => {
  describe('isRecord', () => {
    it('accepts plain objects', () => {
      expect(isRecord({})).toBe(true);
      expect(isRecord({ a: 1 })).toBe(true);
      expect(isRecord(Object.create(null))).toBe(true);
    });

    it('rejects null, arrays and primitives', () => {
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
      expect(isRecord([])).toBe(false);
      expect(isRecord([{ a: 1 }])).toBe(false);
      expect(isRecord('x')).toBe(false);
      expect(isRecord(1)).toBe(false);
      expect(isRecord(true)).toBe(false);
    });
  });

  describe('isUnknownArray', () => {
    it('narrows arrays without widening the element type', () => {
      const value: unknown = [1, 'two', null];
      expect(isUnknownArray(value)).toBe(true);
      expect(isUnknownArray({})).toBe(false);
      expect(isUnknownArray(null)).toBe(false);
    });
  });

  describe('parseJson', () => {
    it('parses valid JSON of any shape', () => {
      expect(parseJson('{"a":1}')).toEqual({ a: 1 });
      expect(parseJson('[1,2]')).toEqual([1, 2]);
      expect(parseJson('42')).toBe(42);
      expect(parseJson('null')).toBeNull();
    });

    it('throws SyntaxError on malformed input, like JSON.parse', () => {
      expect(() => parseJson('{oops')).toThrow(SyntaxError);
    });
  });

  describe('parseJsonObject', () => {
    it('returns the parsed object', () => {
      expect(parseJsonObject('{"a":1}', 'ctx')).toEqual({ a: 1 });
    });

    it('throws SyntaxError on malformed JSON', () => {
      expect(() => parseJsonObject('not json', 'ctx')).toThrow(SyntaxError);
    });

    it('throws TypeError with context when the payload is not an object', () => {
      expect(() => parseJsonObject('[1,2]', 'Failed to deserialize payload')).toThrow(
        /Failed to deserialize payload: expected a JSON object, got an array/,
      );
      expect(() => parseJsonObject('null', 'ctx')).toThrow(/got null/);
      expect(() => parseJsonObject('42', 'ctx')).toThrow(/got number/);
      expect(() => parseJsonObject('"s"', 'ctx')).toThrow(TypeError);
    });
  });

  describe('coerceString', () => {
    it('passes strings through', () => {
      expect(coerceString('a', 'fb')).toBe('a');
      expect(coerceString('', 'fb')).toBe('');
    });

    it('stringifies numbers and booleans', () => {
      expect(coerceString(42, 'fb')).toBe('42');
      expect(coerceString(false, 'fb')).toBe('false');
    });

    it('falls back for nullish and structural values', () => {
      expect(coerceString(undefined, 'fb')).toBe('fb');
      expect(coerceString(null, 'fb')).toBe('fb');
      expect(coerceString({}, 'fb')).toBe('fb');
      expect(coerceString([1], 'fb')).toBe('fb');
    });
  });

  describe('coerceNumber', () => {
    it('passes finite numbers through', () => {
      expect(coerceNumber(0, 7)).toBe(0);
      expect(coerceNumber(-1.5, 7)).toBe(-1.5);
    });

    it('parses numeric strings', () => {
      expect(coerceNumber('12', 7)).toBe(12);
      expect(coerceNumber(' 12.5 ', 7)).toBe(12.5);
    });

    it('never yields NaN or Infinity', () => {
      expect(coerceNumber(NaN, 7)).toBe(7);
      expect(coerceNumber(Infinity, 7)).toBe(7);
      expect(coerceNumber('abc', 7)).toBe(7);
      expect(coerceNumber('', 7)).toBe(7);
      expect(coerceNumber('   ', 7)).toBe(7);
      expect(coerceNumber(undefined, 7)).toBe(7);
      expect(coerceNumber(null, 7)).toBe(7);
      expect(coerceNumber({}, 7)).toBe(7);
    });
  });

  describe('toRecordArray', () => {
    it('keeps only object entries', () => {
      expect(toRecordArray([{ a: 1 }, 2, null, [3], { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
    });

    it('returns an empty array for non-arrays', () => {
      expect(toRecordArray(undefined)).toEqual([]);
      expect(toRecordArray({ items: [] })).toEqual([]);
      expect(toRecordArray('[]')).toEqual([]);
    });
  });
});

describe('internal/async', () => {
  describe('fromSync', () => {
    it('resolves with the returned value', async () => {
      await expect(fromSync(() => 5)).resolves.toBe(5);
      await expect(fromSync(() => undefined)).resolves.toBeUndefined();
    });

    it('surfaces thrown errors as rejections rather than sync throws', () => {
      const err = new Error('boom');
      const promise = fromSync(() => {
        throw err;
      });
      expect(promise).toBeInstanceOf(Promise);
      return expect(promise).rejects.toBe(err);
    });

    it('preserves non-Error rejection values', async () => {
      await expect(
        fromSync(() => {
          throw 'plain string';
        }),
      ).rejects.toBe('plain string');
    });

    it('runs the operation eagerly', () => {
      let ran = false;
      void fromSync(() => {
        ran = true;
      });
      expect(ran).toBe(true);
    });
  });
});

describe('internal/optional-module', () => {
  describe('moduleDir', () => {
    it('returns the given directory when it is a non-empty string', () => {
      expect(moduleDir('/a/b')).toBe('/a/b');
    });

    it('returns undefined for unusable values so relative lookups fail closed', () => {
      expect(moduleDir(undefined)).toBeUndefined();
      expect(moduleDir('')).toBeUndefined();
      expect(moduleDir(123)).toBeUndefined();
      expect(moduleDir(null)).toBeUndefined();
    });
  });

  describe('loadOptionalModule', () => {
    it('returns exports for a resolvable bare specifier', () => {
      const mod = loadOptionalModule('node:path', __dirname);
      expect(isRecord(mod)).toBe(true);
    });

    it('returns undefined for an unresolvable bare specifier', () => {
      expect(
        loadOptionalModule('@streamlinelabs/definitely-not-installed', __dirname),
      ).toBeUndefined();
    });

    it('anchors relative specifiers to the supplied baseDir', () => {
      // `__dirname` is src/__tests__, so '../../package.json' is this package's
      // manifest. This pins the anchoring: a wrongly-anchored base cannot
      // produce this result.
      const pkg = loadOptionalModule('../../package.json', __dirname);
      expect(isRecord(pkg) && pkg['name']).toBe('streamline');
    });

    it('returns undefined when a relative specifier misses from the given base', () => {
      expect(loadOptionalModule('../native/streamline.node', __dirname)).toBeUndefined();
      expect(loadOptionalModule('../../package.json', join(__dirname, 'nope'))).toBeUndefined();
    });

    it('refuses all specifiers when no base directory is available', () => {
      // Without a real module directory the lookup must fail closed rather
      // than re-anchor to the working directory and load an unrelated file.
      expect(loadOptionalModule('node:path')).toBeUndefined();
      expect(loadOptionalModule('../../package.json')).toBeUndefined();
      expect(loadOptionalModule('./package.json')).toBeUndefined();
    });
  });
});
