/**
 * Typed loader for optional CommonJS modules — optional peer dependencies and
 * native N-API addons that must not be statically bundled.
 *
 * A bare `require('...')` call is statically analysed by the bundler, which
 * turns a genuinely optional dependency into a hard build-time requirement
 * (and is unavailable at all in the ESM output). Resolving through
 * {@link createRequire} keeps the specifier opaque to the bundler and works
 * identically from the CommonJS and ES module builds.
 *
 * @internal
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';

/** Resolves a module specifier to its exports. */
type ModuleLoader = (specifier: string) => unknown;

/**
 * Normalise a module's own directory for use as a resolution base.
 *
 * `__dirname` is defined in the CommonJS build and shimmed into the ES module
 * build. Hosts that provide neither yield `undefined`, which makes relative
 * lookups fail closed rather than silently re-anchoring somewhere else.
 *
 * Callers resolving **relative** specifiers must pass their own `__dirname`,
 * because bundling collapses every source file into a single output file whose
 * directory differs from the source layout.
 */
export function moduleDir(dirname: unknown): string | undefined {
  return typeof dirname === 'string' && dirname !== '' ? dirname : undefined;
}

const loaderCache = new Map<string, ModuleLoader>();

function moduleLoader(baseDir: string): ModuleLoader {
  let loader = loaderCache.get(baseDir);
  if (!loader) {
    // `createRequire` resolves relative specifiers against the *file* it is
    // given, so anchor it to a placeholder file inside `baseDir`.
    loader = createRequire(join(baseDir, 'noop.js'));
    loaderCache.set(baseDir, loader);
  }
  return loader;
}

/**
 * Load an optional module.
 *
 * @param specifier - Bare or relative module specifier.
 * @param baseDir - Importing module directory. Required for every lookup so
 *   optional dependencies resolve from the installed SDK rather than from a
 *   caller-controlled working directory.
 * @returns The module exports as `unknown`, or `undefined` when the module
 *   cannot be resolved or fails to initialise. Callers must narrow the result
 *   with a type guard before use.
 */
export function loadOptionalModule(specifier: string, baseDir?: string): unknown {
  if (baseDir === undefined) {
    return undefined;
  }
  try {
    return moduleLoader(baseDir)(specifier);
  } catch {
    return undefined;
  }
}
