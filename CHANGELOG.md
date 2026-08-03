# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

### Fixed
- `npm run build` no longer fails resolving the optional native addon. The
  embedded-mode binding (`native/streamline.node`) and the optional
  `@opentelemetry/api` peer are now loaded at runtime via `createRequire`, so
  the bundler never treats them as build-time dependencies and resolution works
  from both the CJS and ESM outputs.
- `package.json` `exports` now lists the `types` condition first, so TypeScript
  consumers on `node16`/`bundler` module resolution actually pick up the
  bundled declarations.
- Branch admin (`Admin.createBranch`/`listBranches`) and AI anomaly alerts no
  longer surface `NaN` timestamps, `"[object Object]"` names, or `undefined`
  fields when the broker returns a partial or unexpected payload.
- `JsonSchemaSerializer`/`AvroSchemaSerializer` `deserialize()` now reject with
  a descriptive `TypeError` when a payload decodes to valid JSON that is not an
  object, instead of returning a value that does not match its declared type.
  `EmbeddedStreamline.query()` likewise rejects when the addon returns JSON that
  is not an array, instead of resolving a non-array as `unknown[]`.

### Added
- `Streamline.httpEndpoint` — read-only accessor for the resolved HTTP endpoint.
- `Streamline.request()` — authenticated HTTP escape hatch used by `Admin` and
  `Consumer`; marked `@internal`, prefer the typed operations.

### Changed
- Internal-only: wire payloads and optional module loading are narrowed through
  typed guards (`src/internal/`) instead of `any`, and synchronous public
  methods (`Streamline.close`, `Producer.start`/`beginTransaction`/
  `abortTransaction`, `Consumer.start`/`seek`/`seekToEnd`,
  `EmbeddedStreamline.produce`/`consume`/`createTopic`/`query`) return promises
  without being declared `async`. All signatures and rejection behaviour are
  unchanged.


## [0.3.0] - 2026-04-20

### Added
- `src/moonshot.ts` — TypeScript clients for the Streamline Moonshot HTTP API
  (port `9094`): `BranchesClient`, `ContractsClient`, `AttestationClient`,
  `SearchClient`, `MemoryClient`. Shared `MoonshotOptions` + `MoonshotError`.
- All clients ship as named exports from the package root.

### Added
- Circuit breaker pattern (`CircuitBreaker`) with configurable thresholds and async `execute()`
- Circuit breaker test suite (13 tests covering state machine, async execution, error classification)
- `TypedStreamline<T>` wrapper for compile-time typed produce/consume
- Admin API: `alterTopicConfig`, `createPartitions`, `deleteConsumerGroup`, `resetConsumerGroupOffsets`, `describeCluster`, `describeBrokerConfig` — all implemented via GraphQL
- Circuit breaker usage example (`circuit-breaker.ts`)
- TLS/SASL authentication example (`security.ts`)
- Producer test expansion: batching, linger timer, compression passing, retry with backoff

### Fixed
- `seekToEnd()` now correctly removes tracked offset so next poll starts from latest (was using invalid -1)
- Consumer `group` parameter now wired to GraphQL Messages query (was silently ignored)
- Producer passes compression type to `produceBatch()` call
- `embedded.ts` query: JSON.parse wrapped in try-catch to prevent crash on invalid response
- Admin tests updated from NOT_IMPLEMENTED stubs to real connection tests with input validation

### Changed
- feat: add TypeScript generic types for message values
- fix: handle reconnection in consumer group (2026-03-06)
- test: add e2e tests for batch producer (2026-03-06)
- refactor: improve TypeScript type exports (2026-03-06)
- **Fixed**: handle ECONNRESET in broker connection
- **Changed**: update tsup build configuration
- **Changed**: consolidate CJS and ESM entry points
- **Testing**: add vitest suite for producer serialization
- **Fixed**: resolve ESM import path resolution
- **Added**: add typed event emitter for consumer messages

### Fixed
- Resolve type inference for consumer options

### Changed
- Update tsup configuration for tree shaking
- Consolidate error handling in producer


## [0.2.0] - 2026-02-18

### Added
- `StreamlineClient` with auto-reconnection and exponential backoff
- `Producer` with batching, linger timer, and key-based partitioning
- `Consumer` with `AsyncIterable<Message>` support (`for await...of`)
- `Admin` client for topic, consumer group, and ACL management
- Strict TypeScript with all advanced checks enabled
- Clean error hierarchy with retryable flags
- Dual CJS/ESM output via tsup
- SASL and TLS connection support
- 100+ unit tests across 5 test suites

### Infrastructure
- CI pipeline with vitest, coverage reporting, and Node.js matrix (18, 20, 22)
- CodeQL security scanning
- Release workflow with npm publishing
- Release drafter for automated release notes
- Dependabot for dependency updates
- CONTRIBUTING.md with development setup guide
- Security policy (SECURITY.md)
- EditorConfig for consistent formatting
- ESLint with TypeScript strict rules
- Issue templates for bug reports and feature requests

## [0.1.0] - 2026-02-18

### Added
- Initial release of Streamline Node.js/TypeScript SDK
- Dual CJS + ESM output via tsup
- Full TypeScript type definitions
- Apache 2.0 license
- test: add config schema validation test suite
- test: add metrics reporting and collection tests
