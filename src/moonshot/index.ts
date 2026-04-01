/**
 * Public re-exports for moonshot HTTP clients (M1, M2, M4, M5).
 *
 * All clients here are **Experimental** — they wrap the broker's
 * `/api/v1/*` admin/AI endpoints and may change shape until the
 * underlying broker features reach Beta.
 */

export type { MoonshotClientOptions } from './http';

export {
  BranchAdminClient,
  BranchAdminError,
} from './branches-admin';
export type {
  BranchView,
  BranchMessage,
  CreateBranchOptions,
} from './branches-admin';

export { ContractsClient, ContractsError } from './contracts';
export type {
  ContractValidationFailure,
  ContractValidationResult,
  ContractValue,
} from './contracts';

export {
  Attestor,
  AttestationError,
  ATTEST_HEADER,
} from './attestation';
export type {
  AttestorOptions,
  SignedAttestation,
  SignParams,
  VerifyParams,
} from './attestation';

export {
  SemanticSearchClient,
  SemanticSearchError,
} from './search';
export type {
  SemanticSearchHit,
  SemanticSearchResult,
  SemanticSearchOptions,
} from './search';

export { MemoryClient, MemoryError } from './memory';
export type {
  MemoryKind,
  WrittenEntry,
  RecalledMemory,
  RememberParams,
  RecallParams,
} from './memory';
