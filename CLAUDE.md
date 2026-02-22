# CLAUDE.md — Streamline Node.js SDK

## Overview
TypeScript-first SDK for [Streamline](https://github.com/streamlinelabs/streamline). Dual CJS + ESM output via tsup. Communicates via the Kafka wire protocol on port 9092.

## Build & Test
```bash
npm install               # Install dependencies
npm run build             # Build (tsup → CJS + ESM + dts)
npm test                  # Run tests (vitest)
npm run typecheck         # tsc --noEmit
npm run lint              # ESLint
```

## Architecture
```
src/
├── index.ts              # Public API exports
├── client.ts             # StreamlineClient — main entry point
├── producer.ts           # Producer with auto-batching
├── consumer.ts           # Consumer with async iterator
├── admin.ts              # Topic/group admin operations
├── config.ts             # Configuration interfaces
├── errors.ts             # Error types with hints & retryable flag
├── types.ts              # Shared TypeScript types
├── telemetry.ts          # OpenTelemetry integration (optional peer dep)
└── __tests__/            # Vitest test files
```

## Coding Conventions
- **TypeScript strict mode**: `strict: true` with `noImplicitAny`, `exactOptionalPropertyTypes`, `noImplicitOverride`
- **Async/await**: All I/O operations return Promises
- **Error types**: Custom error classes extending `StreamlineError` with `.hint` and `.retryable`
- **No `any`**: Use proper types or `unknown` with narrowing
- **Naming**: camelCase for functions/variables, PascalCase for classes/interfaces/types

## Error Handling Pattern
```typescript
import { StreamlineClient, StreamlineError } from '@streamlinelabs/sdk';

try {
    await client.produce('topic', { value: Buffer.from('hello') });
} catch (err) {
    if (err instanceof StreamlineError && err.retryable) {
        // Retry logic
    }
}
```

## Dependencies
- `kafkajs` — Core Kafka protocol client
- Optional peer: `@opentelemetry/api` for tracing

## Testing
- Unit tests: `src/__tests__/*.test.ts` using Vitest
- Integration tests: Docker Compose with real Streamline server
- Testcontainers: `testcontainers/` directory
