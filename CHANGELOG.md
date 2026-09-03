# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

### Breaking

- APIs the HTTP/GraphQL transport cannot honour now fail loudly instead of
  silently doing nothing. All of them throw the new `UnsupportedOperationError`
  (code `UNSUPPORTED_OPERATION`, exported from the package root):
  - `Consumer.onRebalance()` — the client never joins the Kafka group protocol,
    so a registered handler could never fire.
  - `Consumer.seek()`, `seekToBeginning()` and `seekToEnd()` — Streamline 0.3
    exposes no HTTP consumer-offset reset operation.
  - `ConsumeOptions.group` and group-backed `Consumer.poll()`/`messages()` —
    Streamline 0.3's GraphQL messages query has no group argument, so these are
    rejected instead of silently consuming without group semantics.
  - `ConsumerConfig.sessionTimeoutMs`, `ConsumerConfig.heartbeatIntervalMs` and
    `autoOffsetReset: 'none'` — rejected at construction time.
  - `ConsumerConfig.autoCommit: true` and `autoCommitIntervalMs` — rejected
    because the HTTP API cannot commit group offsets. `autoCommit` now defaults
    to `false`.
  - `ProducerConfig.idempotent: true` — the HTTP produce API carries no producer
    id or sequence number, so duplicate suppression is impossible. The default is
    now `false` (previously `true`, which claimed a guarantee that never existed);
    delivery is at-least-once.
  - `ProducerConfig.compression` values other than `none`, plus unsupported
    topic configuration and admin operations (`alterTopicConfig`,
    `createPartitions`, `deleteConsumerGroup`, `describeBrokerConfig`), now fail
    explicitly instead of accepting values the server ignores.
  - `auth.mechanism`/`sasl.mechanism` `'SCRAM-SHA-256'`/`'SCRAM-SHA-512'` —
    rejected at `Streamline` construction time. This HTTP/GraphQL transport
    sends one auth header per request and cannot perform a real SCRAM
    challenge-response handshake; accepting the mechanism previously downgraded
    silently to plaintext HTTP Basic auth, identical to `PLAIN`. Use `PLAIN`
    over an `https://` endpoint, `OAUTHBEARER`, or the Kafka protocol.
  - `TlsConfig`/legacy `tls` customization (`ca`, `cert`, `key`, `passphrase`,
    `servername`, `rejectUnauthorized: false`) — rejected at construction time.
    None of these were ever applied to the `fetch()` calls this transport
    makes, so accepting them silently misrepresented custom CA pinning, mTLS,
    and relaxed certificate verification as active. A bare `{ enabled: true }`
    (or the legacy `tls: true` boolean) is unaffected. Use an `https://`
    `httpEndpoint` for transport encryption, or build your own `fetch`
    dispatcher from `tlsConfig` via `createTlsOptions()`.
  - `Consumer` on a topic with more than one partition, when no `partition` is
    given — rejected on the first `poll()`/iteration instead of silently
    reading only partition `0` forever and dropping every record on every
    other partition. `ConsumerConfig.partition` selects a single partition
    explicitly; single-partition topics are unaffected.
- `Consumer.commit()` now propagates broker failures instead of swallowing them,
  only records an offset after broker acceptance, and serializes overlapping
  commits so an older request cannot overwrite a newer offset. Against
  Streamline 0.3 it fails explicitly because no HTTP commit mutation exists.
- `new Streamline('')` now throws a `CONFIG_ERROR` `StreamlineError` instead of
  silently constructing a client with no bootstrap address.

### Fixed

- **`StreamlineVerifier` did not actually bind the attestation to the message
  being verified.** `verify()` accepted the envelope's own self-reported
  `payload_sha256`, `topic`, `partition`, and `offset` at face value instead of
  checking them against the message actually being verified, and trusted
  whatever `key_id` the envelope claimed — so a header captured from one valid
  record could be replayed onto any other message (different content,
  different topic/partition/offset, or under a different key_id) and still
  report `verified: true`. `verify()` now recomputes the payload hash from
  `Message.rawValue`, compares the envelope's topic/partition/offset against
  the message's actual values, and only checks the signature against a public
  key registered for the envelope's claimed `key_id`; the constructor now
  requires binding a `keyId` to a single key, or a map of trusted `key_id ->
  publicKey` pairs. `Message.rawValue` is a new field, populated by
  `Streamline.consume()`/`consumeBatch()` with the exact wire bytes (not a
  reserialized copy of the parsed `value`) so the hash check is exact;
  verification fails closed when it is absent.
- **`Consumer` silently read only partition 0.** `poll()` and `messages()`
  always fetched partition `0` regardless of how many partitions the topic
  actually had, so records on every other partition were silently never
  delivered. The consumer now resolves a partition on first use — an explicit
  `ConsumerConfig.partition`, or discovery via `topicInfo()` that accepts a
  single-partition topic and rejects (see Breaking) a multi-partition one.
  Failed topic discovery now throws `TopicNotFoundError` instead of guessing
  that the missing metadata meant partition `0`.
- **An explicit `Streamline.close()` did not cancel an in-progress
  auto-reconnect.** `consume()`'s `pollTimeout` idle wait and the exponential
  backoff inside the internal reconnect loop used a plain, uncancellable
  `setTimeout`, and the loop never checked whether the client had since been
  closed — so closing a client mid-reconnect let it keep sleeping out its full
  backoff and calling `connect()` again (even reviving `connected: true`) after
  the caller asked it to stop. `close()`'s abort now wakes both waits
  immediately, and the reconnect loop checks a dedicated `closed` flag before
  starting, after each backoff sleep, and before each retry, throwing a
  `ConnectionError` instead of reconnecting once closed.
- **A health check already in flight when `close()` ran could still revive
  `connected: true` after the close.** The `closed`/backoff checks above cover
  the reconnect loop's sleeps, but not a `connect()` call's own in-flight
  `/health` request: if it settled successfully after an explicit `close()` (or
  after a newer `connect()`/`reconnect()` attempt had already superseded it),
  it still unconditionally set `connected = true`. `Streamline` now tracks a
  monotonic lifecycle `generation`, bumped by every `connect()` and `close()`;
  a `connect()` attempt (direct or `reconnect()`-driven) captures its
  generation up front and discards its result quietly if that generation is no
  longer current by the time the health check settles, so it can no longer
  resurrect `connected` or interfere with the current abort controller. An
  explicit manual reopen (`close()` then `connect()`) is unaffected — it starts
  its own new, current generation and connects normally.
- **`TopicInfo.sizeBytes`/`config`, `ConsumerGroupInfo.protocol`/`members`, and
  `ClusterInfo.clusterId`/`controller`/`brokers` were silently removed** when
  these interfaces were narrowed to the fields Streamline 0.3 actually reports
  (see "Core GraphQL documents..." below), breaking source compatibility for
  code written against earlier SDK releases. They are restored as required,
  deprecated compatibility fields populated with explicit neutral sentinels
  (`0`, `""`, `-1`, `{}`, or `[]`, depending on the field), since Streamline
  0.3 cannot supply authoritative values. This preserves the old source shape
  without fabricating topology, size, configuration, or member data. Fields
  introduced by the newer HTTP metadata shape remain optional, so object
  literals using the exact earlier `TopicInfo`, `ConsumerGroupInfo`, and
  `ClusterInfo` shapes still compile.
- **Conformance suite was always skipped.** `describe.skipIf(!serverAvailable)`
  is evaluated at collection time, but the flag was assigned in `beforeAll`, so
  it was always `false` and every conformance test was skipped — including in CI
  with a healthy server. Availability is now resolved before collection, and
  `STREAMLINE_CONFORMANCE_REQUIRE=1` (defaulted on when `CI` is set) turns an
  unreachable server into a failing test instead of a silent skip. The CI and
  integration workflows set it.
- The conformance suite used `ConsumeOptions` fields that do not exist
  (`offset`, `fromTimestamp`, `maxWaitMs`) and the nonexistent server field
  `partitionCount`; it now prefers `TopicInfo.partitions`, falls back to the
  legacy `partitionCount` alias, and is type-checked.
- Core GraphQL documents now match the pinned Streamline 0.3 schema:
  `produceMessage`/`ProduceInput`, selected `createTopic` results, actual topic
  fields, `consumerGroups`, and `clusterInfo`. `produceBatch()` is implemented
  as ordered single-message mutations because the server has no batch mutation.
- **`Consumer.pause()` discarded fetched records.** The message iterator dropped
  every record polled while paused. Records are now held until the partition is
  resumed, `pause()`/`resume()` honour a partition list, and `poll()` buffers
  records for paused partitions instead of dropping or refetching them.
  `Consumer.isPaused(partition?)` exposes the state.
- `Streamline.consumeBatch()` accepted `group` and `pollTimeout` and ignored
  both. `group` is now rejected explicitly; `pollTimeout` bounds the entire
  request, including OAuth token acquisition, and raises `TimeoutError`.
  `StreamlineOptions.timeout` is now the default deadline for all requests.
- `Admin.createBranch()`, `Admin.listBranches()` and `Admin.discardBranch()`
  called `fetch` directly, bypassing authentication headers, the client id, the
  abort signal and the circuit breaker. They now route through
  `Streamline.request()` like every other call.
- `@streamlinelabs/testcontainers` did not compile: `withEphemeral*()` called a
  `withEnvironment()` method that did not exist, and `StartedStreamlineContainer`
  declared `stop()` twice. Added the missing builder method, removed the
  duplicate, and made the consumer-group JSON parsing type-safe.

### Added

- `UnsupportedOperationError`, `Consumer.isPaused()`, and
  `Streamline.bootstrapServers`.
- `@streamlinelabs/testcontainers` is now a real npm workspace: it builds, type-checks
  and has unit tests (Docker-free, via a mocked `testcontainers` module), ships
  `LICENSE` and `NOTICE`, and is exercised in CI. Its `testcontainers` dependency
  was updated to `^12.1.0` to remove vulnerable `undici`/`dockerode` versions.
  The workspace and repository validation now require Node.js 22.22+, while the
  dependency-free core SDK continues to support Node.js 18+.
- Validation plumbing: `npm run validate` (runtime dependency audit, lint,
  source/test/example/workspace type-checks, unit tests, workspace tests, dual
  build, CJS/ESM import smoke tests, `npm pack --dry-run` for both packages) and `npm run verify:tag`
  (release tag must match `package.json` version). `prepublishOnly` runs the
  full validation.
- `tsconfig.test.json` and `tsconfig.examples.json` so tests and examples are
  type-checked in CI; examples resolve `streamline` to `src/index.ts`.

### Changed

- `NOTICE` is now published in the npm tarball (with `LICENSE`), and no longer
  claims a KafkaJS dependency — the SDK has no required runtime dependencies and
  speaks HTTP/GraphQL.
- Release workflow is fail-closed and ordered: verify tag ↔ version, run the full
  validation, generate **and verify** the CycloneDX SBOM with a pinned generator
  (`@cyclonedx/cyclonedx-npm@6.0.1`, no `|| true`), publish with
  `--provenance` (`id-token: write`), and only then create the GitHub release.
  All release/CI actions are pinned to commit SHAs.
- CI no longer masks the example type-check with `|| echo`, and now runs the
  workspace build/tests, smoke imports and packaging dry-runs.
- Documentation corrected: transport (HTTP/GraphQL, not the Kafka wire
  protocol), package identity (`streamline`, currently unpublished — install
  from a repository build), Node.js floor (18+), server requirement (0.4.0+),
  real configuration defaults, environment variables the SDK actually reads,
  TLS options not being applied to HTTP requests, transactions being client-side
  buffering, and the moonshot/examples snippets now use real APIs
  (`SemanticSearchClient`, `MemoryClient`, `SchemaProducer`/`SchemaConsumer`,
  `Streamline.topicInfo`/`describeCluster`).
- `SECURITY.md` supported-versions table now covers 0.4.x.

### Fixed (previously released work)
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
