# Clean Code and SRP Audit

## Summary

- **Highest-leverage future split:** isolate producer batching state from
  transaction buffering, but only with dedicated timing/order
  characterization; it is not safe as a drive-by extraction.
- The 898-line `Streamline` class is a broad but coherent public client facade;
  moving admin methods behind another collaborator would create
  `Admin -> Streamline -> collaborator` indirection without removing a public
  actor.
- `Admin` is intentionally a compatibility facade over `Streamline` plus
  experimental branch operations; another service layer would worsen tracing.
- The baseline repair already extracted real reusable decisions into typed
  guards, async-contract, and optional-module units.
- Cross-repo route and query-response divergence is higher priority than local
  file length and remains contract-gated.

## Findings

| ID | Location | Category | Severity | Actors in conflict | Cost | Size | Behavior risk |
|---|---|---|---|---|---|---|---|
| NODE-SRP-1 | `src/producer.ts:61-333` | State partition | P2 | batching/throughput; retry reliability; transactions | Batch/timer state and transaction-buffer state change for different producer actors but share send ordering and flush behavior. | M | High |
| NODE-SRP-2 | `src/consumer.ts:55-379` | State partition | P2 | group consumption; offset management; semantic HTTP search | Search transport changes edit the Kafka consumer lifecycle and offset state. | M | Medium |
| NODE-CC-1 | `src/admin.ts:65-232`; `src/client.ts:397-672` | Compatibility duplication | P2 | direct-client consumers; Admin facade consumers | Public admin methods exist on two surfaces; deduplicating through another class would add indirection, while changing either surface is breaking. | M | High |
| NODE-D-1 | HTTP/query methods across `client.ts`, SDKs, and core | Cross-repo contract | P1 | core API owner; SDK consumers | Route and response-shape drift can compile and unit-test cleanly while failing integration. | L | High |

## State Partition

### `Producer`

| Partition | Fields/methods | Actor |
|---|---|---|
| Batch throughput | `batch`, `flushTimer`, `flushing`, `flushNow`, `flushBatch` | performance |
| Transactions | `inTransaction`, `transactionBuffer`, begin/commit/abort | transactional semantics |
| Reliability | `circuitBreaker`, retry/backoff, `sendWithRetry` | reliability |
| Lifecycle | `closed`, start/close | resource lifecycle |

A future split may introduce a `PendingBatch` value owning queue/timer/flush
decisions and a `TransactionBuffer` value owning transaction state. Do not add
producer interfaces or forwarding services.

## Ordered Refactor Sequence

1. Add fake-timer tests for batching order, concurrent flush, close, and retry.
2. Add transaction tests proving visibility/order across begin/commit/abort.
3. Move batch state unchanged into one value object.
4. Modify the batch object only after the move is green.
5. Reassess transaction extraction; stop if it would duplicate send ordering.
6. Run tests, lint, typecheck, and dual CJS/ESM build after every commit.

## Deferred

- Producer state extraction is deferred because existing tests do not pin
  timer/concurrency interleavings strongly enough for the requested risk level.
- Consumer semantic search cannot reuse another SDK surface until route and
  response contracts are approved.
- Direct `Streamline` and `Admin` methods remain duplicated for public
  compatibility.

## Out of Scope

- `Streamline`: public facade with one client actor despite many methods.
- `Admin`: compatibility facade; splitting adds indirection.
- `telemetry.ts`: one observability actor.
- `types.ts`: public contract definitions.
- New `internal/guards.ts`, `internal/async.ts`, and
  `internal/optional-module.ts`: cohesive decisions already independently
  tested.
