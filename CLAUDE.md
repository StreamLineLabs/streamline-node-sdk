# CLAUDE.md — Streamline Node.js SDK

## Overview
TypeScript-first SDK for [Streamline](https://github.com/streamlinelabs/streamline).
Dual CJS + ESM output via tsup. The SDK talks to the broker's **HTTP/GraphQL API**
(default `http://localhost:9094`) using the Node.js built-in `fetch`; it does
**not** open a Kafka wire-protocol connection and has no Kafka client dependency.
The `bootstrapServers` constructor argument is kept for Kafka-client familiarity
and is exposed as `client.bootstrapServers`, but no request is routed through it.

## Build & Test
```bash
npm install               # Install dependencies (root + workspaces)
npm run build             # Build (tsup → CJS + ESM + dts)
npm test                  # Unit tests (vitest, conformance excluded)
npm run test:conformance  # Conformance suite (needs a running server)
npm run typecheck         # tsc --noEmit (src)
npm run typecheck:tests   # tsc --noEmit (src + tests)
npm run typecheck:examples# tsc --noEmit (examples resolve 'streamline' → src)
npm run lint              # ESLint
npm run validate          # Runtime audit + everything above + build/smoke/pack
```

The published core SDK supports Node.js 18+. Repository-wide development and
validation require Node.js 22.22+ because the testcontainers workspace uses the
security-fixed Testcontainers v12 runtime.

## Architecture
```
src/
├── index.ts              # Public API exports
├── client.ts             # Streamline — main entry point (HTTP/GraphQL)
├── producer.ts           # Producer with auto-batching
├── consumer.ts           # Consumer with async iterator
├── admin.ts              # Topic/group/branch admin operations
├── config.ts             # Configuration interfaces + validateConfig
├── types.ts              # Shared types and error classes
├── auth.ts / tls.ts      # SASL and TLS configuration helpers
├── telemetry.ts          # OpenTelemetry integration (optional peer dep)
├── moonshot/             # Experimental HTTP clients (search, memory, ...)
├── internal/             # Typed guards, async contract, optional module load
└── __tests__/            # Vitest test files (incl. conformance suite)
testcontainers/           # @streamlinelabs/testcontainers workspace
```

## Coding Conventions
- **TypeScript strict mode**: `strict: true` with `noImplicitAny`, `exactOptionalPropertyTypes`, `noImplicitOverride`
- **Async/await**: All I/O operations return Promises
- **Error types**: Custom error classes extending `StreamlineError` with `.hint` and `.retryable`
- **No `any`**: Use proper types or `unknown` with narrowing
- **Naming**: camelCase for functions/variables, PascalCase for classes/interfaces/types
- **No silent no-ops**: an API that this transport cannot honour throws
  `UnsupportedOperationError` instead of pretending to succeed

## Error Handling Pattern
```typescript
import { Streamline, StreamlineError } from '@streamlinelabs/sdk';

try {
    await client.produce('topic', { hello: 'world' });
} catch (err) {
    if (err instanceof StreamlineError && err.retryable) {
        // Retry logic
    }
}
```

## Dependencies
- No required runtime dependencies (uses global `fetch`, Node 18+)
- Optional peer: `@opentelemetry/api` for tracing
- Workspace `@streamlinelabs/testcontainers` depends on `testcontainers` v12
  and requires Node.js 22.22+

## Testing
- Unit tests: `src/__tests__/*.test.ts` using Vitest
- Conformance tests: `src/__tests__/conformance.test.ts` against a real server
  (`docker compose -f docker-compose.test.yml up -d`). Set
  `STREAMLINE_CONFORMANCE_REQUIRE=1` (CI does) to make an unreachable server a
  failure rather than a skip.
- Testcontainers: `testcontainers/` workspace (`npm run test --workspaces`)
