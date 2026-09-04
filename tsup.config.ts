import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  // Provides `__filename`/`__dirname` in the ESM output so optional modules
  // (native addon, @opentelemetry/api) resolve relative to the package.
  shims: true,
  external: [
    '@opentelemetry/api',
  ],
  noExternal: [],
});
