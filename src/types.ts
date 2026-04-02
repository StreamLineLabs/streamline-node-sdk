/**
 * Core types for the Streamline Node.js SDK
 */

/**
 * Message header key-value pair.
 */
export interface Header {
  key: string;
  value: string;
}

/**
 * A message from a Streamline topic.
 */
export interface Message {
  /** Topic name */
  topic: string;
  /** Partition number */
  partition: number;
  /** Offset within the partition */
  offset: number;
  /** Message key (optional) */
  key?: string;
  /** Message value (parsed JSON or raw string) */
  value: unknown;
  /** Message timestamp in milliseconds */
  timestamp: number;
  /** Message headers */
  headers: Header[];
}

/**
 * Record to produce to a topic.
 */
export interface ProduceRecord {
  /** Message value (will be JSON serialized if object) */
  value: unknown;
  /** Message key (optional) */
  key?: string;
  /** Target partition (optional, uses partitioner if not set) */
  partition?: number;
  /** Message headers (optional) */
  headers?: Record<string, string>;
}

/**
 * Result of a produce operation.
 */
export interface ProduceResult {
  /** Topic name */
  topic: string;
  /** Partition the message was written to */
  partition: number;
  /** Offset of the written message */
  offset: number;
  /** Timestamp of the written message */
  timestamp: number;
}

/**
 * Options for topic search.
 */
export interface SearchOptions {
  /** Maximum number of results (default: 10) */
  k?: number;
}

/**
 * A single search result from a topic.
 */
export interface SearchResult {
  /** Partition the hit came from */
  partition: number;
  /** Offset of the matching record */
  offset: number;
  /** Similarity score (higher = more relevant) */
  score: number;
  /** Record value, if returned by the server */
  value: unknown;
}

/**
 * Topic information.
 */
export interface TopicInfo {
  /** Topic name */
  name: string;
  /** Number of partitions */
  partitionCount: number;
  /** Replication factor */
  replicationFactor: number;
  /** Total message count across all partitions */
  messageCount: number;
  /** Total size in bytes */
  sizeBytes: number;
  /** Topic configuration */
  config: Record<string, string>;
}

/**
 * Partition information.
 */
export interface PartitionInfo {
  /** Partition number */
  partition: number;
  /** Leader broker ID */
  leader: number;
  /** Replica broker IDs */
  replicas: number[];
  /** In-sync replica broker IDs */
  isr: number[];
  /** Earliest available offset */
  earliestOffset: number;
  /** Latest offset (next to be written) */
  latestOffset: number;
}

/**
 * Consumer group member information.
 */
export interface ConsumerGroupMember {
  /** Member ID */
  memberId: string;
  /** Client ID */
  clientId: string;
  /** Client host */
  clientHost: string;
  /** Assigned partitions */
  partitions: number[];
}

/**
 * Consumer group information.
 */
export interface ConsumerGroupInfo {
  /** Group ID */
  groupId: string;
  /** Group state (Stable, PreparingRebalance, etc.) */
  state: string;
  /** Protocol type (consumer, connect) */
  protocolType: string;
  /** Partition assignment protocol */
  protocol: string;
  /** Group members */
  members: ConsumerGroupMember[];
}

/**
 * Cluster information.
 */
export interface ClusterInfo {
  /** Cluster ID */
  clusterId: string;
  /** Controller broker ID */
  controller: number;
  /** Broker information */
  brokers: BrokerInfo[];
}

/**
 * Broker information.
 */
export interface BrokerInfo {
  /** Broker ID */
  id: number;
  /** Host address */
  host: string;
  /** Port number */
  port: number;
  /** Rack (optional) */
  rack?: string;
}

/**
 * Information about a copy-on-write topic branch (M5).
 */
export interface BranchInfo {
  /** Branch name */
  name: string;
  /** The base topic this branch forks from */
  baseTopic: string;
  /** Branch state (active, discarded, merged) */
  state: string;
  /** Creation timestamp (epoch milliseconds) */
  createdAt: number;
}

/**
 * Query result row.
 */
export interface QueryRow {
  [column: string]: unknown;
}

/**
 * Streamline error with additional context.
 */
export class StreamlineError extends Error {
  /** Error code */
  code: string;
  /** Whether the error is retryable */
  retryable: boolean;
  /** Optional hint for resolving the error */
  hint?: string | undefined;
  /** Original cause if any */
  override cause?: Error | undefined;

  constructor(message: string, code: string = 'UNKNOWN', retryable: boolean = false, cause?: Error, hint?: string) {
    super(hint ? `${message} (hint: ${hint})` : message);
    this.name = 'StreamlineError';
    this.code = code;
    this.retryable = retryable;
    this.cause = cause;
    this.hint = hint;
  }
}

/**
 * Connection error.
 */
export class ConnectionError extends StreamlineError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONNECTION_ERROR', true, cause, 'Check that Streamline server is running and accessible');
    this.name = 'ConnectionError';
  }
}

/**
 * Authentication error.
 */
export class AuthenticationError extends StreamlineError {
  constructor(message: string, cause?: Error) {
    super(message, 'AUTH_ERROR', false, cause, 'Verify your SASL credentials and mechanism');
    this.name = 'AuthenticationError';
  }
}

/**
 * Topic not found error.
 */
export class TopicNotFoundError extends StreamlineError {
  topic: string;

  constructor(topic: string) {
    super(`Topic not found: ${topic}`, 'TOPIC_NOT_FOUND', false, undefined, 'Use admin client to create the topic first, or enable auto-creation');
    this.name = 'TopicNotFoundError';
    this.topic = topic;
  }
}

/**
 * Timeout error.
 */
export class TimeoutError extends StreamlineError {
  constructor(message: string) {
    super(message, 'TIMEOUT', true, undefined, 'Consider increasing timeout settings or checking server load');
    this.name = 'TimeoutError';
  }
}

/**
 * Raised when a record violates a topic's data contract.
 */
export class ContractViolationError extends StreamlineError {
  constructor(topic: string, details: string) {
    super(`Contract violation on topic '${topic}': ${details}`, 'CONTRACT_VIOLATION', false, undefined, 'Validate the record against the topic\'s registered schema');
    this.name = 'ContractViolationError';
  }
}

/**
 * Raised when attestation signature verification fails.
 */
export class AttestationVerificationError extends StreamlineError {
  constructor(message: string) {
    super(message, 'ATTESTATION_VERIFICATION_FAILED', false, undefined, 'Check the signing key and attestation configuration');
    this.name = 'AttestationVerificationError';
  }
}

/**
 * Raised when an agent lacks permission to access memory.
 */
export class MemoryAccessDeniedError extends StreamlineError {
  constructor(agent: string) {
    super(`Memory access denied for agent: ${agent}`, 'MEMORY_ACCESS_DENIED', false, undefined, 'Verify agent permissions for memory operations');
    this.name = 'MemoryAccessDeniedError';
  }
}

/**
 * Raised when a branch exceeds its storage or lifetime quota.
 */
export class BranchQuotaExceededError extends StreamlineError {
  constructor(branch: string, details: string) {
    super(`Branch quota exceeded for '${branch}': ${details}`, 'BRANCH_QUOTA_EXCEEDED', false, undefined, 'Increase branch quotas or clean up unused branches');
    this.name = 'BranchQuotaExceededError';
  }
}

/**
 * Raised when semantic search is unavailable (embedding provider down).
 */
export class SemanticSearchUnavailableError extends StreamlineError {
  constructor(message: string) {
    super(message, 'SEMANTIC_SEARCH_UNAVAILABLE', true, undefined, 'Check embedding provider connectivity and configuration');
    this.name = 'SemanticSearchUnavailableError';
  }
}

/**
 * TLS verification modes for connection security.
 */
export enum TlsVerificationMode {
  /** Full certificate verification (recommended for production). */
  Full = 'full',
  /** Skip hostname verification only. */
  SkipHostname = 'skip-hostname',
  /** No verification (development only, NOT for production). */
  None = 'none',
}

/**
 * Extended TLS options with verification mode control.
 */
export interface ExtendedTlsOptions {
  /** CA certificate for server verification */
  ca?: string | Buffer;
  /** Client certificate for mutual TLS */
  cert?: string | Buffer;
  /** Client private key */
  key?: string | Buffer;
  /** Verification mode */
  verification?: TlsVerificationMode;
}
