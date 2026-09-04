/**
 * Runtime narrowing helpers shared by the SDK's HTTP and native adapters.
 *
 * Wire payloads (JSON from the broker, values produced by native addons) arrive
 * untyped. These helpers keep the parsing layer free of `any` by funnelling
 * everything through `unknown` and narrowing it with explicit, testable guards.
 *
 * @internal
 */

/**
 * Narrow an unknown value to a plain (non-array, non-null) JSON object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse JSON text into an `unknown` value.
 *
 * Behaves exactly like {@link JSON.parse} — including throwing `SyntaxError`
 * on malformed input — but returns `unknown` instead of `any` so callers are
 * forced to narrow the result.
 */
export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/**
 * Parse JSON text that is required to describe an object.
 *
 * @param text - Raw JSON text
 * @param context - Human-readable description used in the error message
 * @throws SyntaxError when `text` is not valid JSON
 * @throws TypeError when the parsed value is not a JSON object
 */
export function parseJsonObject(text: string, context: string): Record<string, unknown> {
  const parsed = parseJson(text);
  if (!isRecord(parsed)) {
    throw new TypeError(`${context}: expected a JSON object, got ${describeJson(parsed)}`);
  }
  return parsed;
}

/**
 * Coerce an unknown wire value to a string.
 *
 * Strings, numbers and booleans are converted like `String(value)`. Anything
 * else — including `null`, `undefined`, objects and arrays — yields
 * `fallback`, so malformed payloads can never surface as `"[object Object]"`.
 */
export function coerceString(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return fallback;
}

/**
 * Coerce an unknown wire value to a finite number.
 *
 * Finite numbers pass through and numeric strings are parsed. Anything that
 * would produce `NaN` or a non-finite value yields `fallback`.
 */
export function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/**
 * Narrow an unknown value to an array of `unknown` elements.
 *
 * Prefer this over a bare {@link Array.isArray} check, which widens `unknown`
 * to `any[]`.
 */
export function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Narrow an unknown value to an array of JSON objects, dropping entries that
 * are not objects. Non-array inputs yield an empty array.
 */
export function toRecordArray(value: unknown): Record<string, unknown>[] {
  if (!isUnknownArray(value)) {
    return [];
  }
  return value.filter(isRecord);
}

/**
 * Describe an unknown value for use in error messages, without stringifying
 * potentially large or cyclic payloads.
 */
function describeJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'an array' : typeof value;
}
