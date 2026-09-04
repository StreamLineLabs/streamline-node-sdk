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
  /**
   * The exact raw bytes of the message value as received on the wire, prior
   * to JSON parsing. Populated by {@link Streamline.consume} and
   * {@link Streamline.consumeBatch}; absent on hand-constructed `Message`
   * objects (e.g. in tests).
   *
   * Integrity checks such as {@link StreamlineVerifier} hash this field
   * rather than re-serializing {@link Message.value}, because
   * `JSON.stringify(JSON.parse(x))` is not guaranteed to reproduce `x`
   * byte-for-byte (key order, whitespace, number formatting) and hashing a
   * reserialized copy would verify the wrong bytes.
   */
  rawValue?: Buffer;
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
  /**
   * Number of partitions using the current field name.
   *
   * Optional for source compatibility with SDK releases whose public shape
   * exposed only {@link TopicInfo.partitionCount}.
   */
  partitions?: number | undefined;
  /**
   * Number of partitions.
   *
   * @deprecated Use {@link TopicInfo.partitions}. Retained as a compatibility
   * alias for earlier SDK releases.
   */
  partitionCount: number;
  /** Replication factor */
  replicationFactor: number;
  /** Total message count across all partitions */
  messageCount: number;
  /** Retention time in milliseconds, when configured */
  retentionMs?: number | undefined;
  /**
   * ISO 8601 topic creation timestamp reported by the server.
   *
   * Optional because this field was introduced after the original public
   * TopicInfo shape.
   */
  createdAt?: string | undefined;
  /**
   * Total size in bytes.
   *
   * @deprecated Streamline 0.3's topic query does not report a per-topic
   * byte size, so the HTTP/GraphQL transport returns the compatibility
   * sentinel `0`. Do not interpret it as a measured size.
   */
  sizeBytes: number;
  /**
   * Topic configuration.
   *
   * @deprecated Streamline 0.3's topic query does not expose the topic's
   * live configuration map, so the HTTP/GraphQL transport returns an empty
   * compatibility object. Do not interpret it as authoritative configuration.
   */
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
  /**
   * Number of active group members.
   *
   * Optional because earlier SDK releases exposed only the members array.
   */
  memberCount?: number | undefined;
  /**
   * Partition assignment protocol.
   *
   * @deprecated Streamline 0.3's consumerGroups query does not report the
   * partition-assignment protocol, so the HTTP/GraphQL transport returns the
   * compatibility sentinel `""`.
   */
  protocol: string;
  /**
   * Group members.
   *
   * @deprecated Streamline 0.3's consumerGroups query does not report
   * individual members, only {@link ConsumerGroupInfo.memberCount}, so this
   * is an empty compatibility list.
   */
  members: ConsumerGroupMember[];
}

/**
 * Cluster information.
 */
export interface ClusterInfo {
  /** Node/broker ID, when reported by current servers */
  nodeId?: number | undefined;
  /** Streamline server version, when reported */
  version?: string | undefined;
  /** Server uptime in seconds, when reported */
  uptime?: number | undefined;
  /** Number of topics, when reported */
  topicCount?: number | undefined;
  /**
   * Cluster ID.
   *
   * @deprecated Streamline 0.3's clusterInfo query exposes no cluster
   * identifier, so this is the compatibility sentinel `""`.
   */
  clusterId: string;
  /**
   * Controller broker ID.
   *
   * @deprecated Streamline 0.3's clusterInfo query does not identify a
   * controller broker, so this is the compatibility sentinel `-1`. Do not
   * assume it equals {@link ClusterInfo.nodeId}.
   */
  controller: number;
  /**
   * Broker information.
   *
   * @deprecated Streamline 0.3's clusterInfo query reports no per-broker
   * host/port list, so this is an empty compatibility list.
   */
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
 * Raised when an API surface exists for Kafka compatibility but the operation
 * cannot be honoured by the Streamline HTTP/GraphQL transport.
 *
 * The SDK throws this instead of silently accepting a request it cannot
 * fulfil, so that callers never observe a success that did not happen.
 */
export class UnsupportedOperationError extends StreamlineError {
  /** The operation that is not supported (e.g. `Consumer.onRebalance`). */
  operation: string;

  constructor(operation: string, reason: string, hint?: string) {
    super(
      `${operation} is not supported by this client: ${reason}`,
      'UNSUPPORTED_OPERATION',
      false,
      undefined,
      hint,
    );
    this.name = 'UnsupportedOperationError';
    this.operation = operation;
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
 * Validate a Kafka topic name according to the Kafka specification.
 *
 * Rules: non-empty, max 249 characters, alphanumeric plus '.', '_', '-',
 * and cannot be exactly "." or "..".
 *
 * @param topic - Topic name to validate
 * @throws {StreamlineError} If the topic name is invalid
 */
export function validateTopicName(topic: string): void {
  if (!topic || topic.length === 0) {
    throw new StreamlineError(
      'Topic name cannot be empty',
      'INVALID_TOPIC',
      false,
      undefined,
      'Provide a non-empty topic name',
    );
  }

  if (topic.length > 249) {
    throw new StreamlineError(
      `Topic name exceeds maximum length of 249 characters`,
      'INVALID_TOPIC',
      false,
      undefined,
      'Use a shorter topic name (max 249 characters)',
    );
  }

  if (topic === '.' || topic === '..') {
    throw new StreamlineError(
      `Topic name cannot be "${topic}"`,
      'INVALID_TOPIC',
      false,
      undefined,
      'Use a descriptive topic name with alphanumeric characters',
    );
  }

  if (!/^[a-zA-Z0-9._-]+$/.test(topic)) {
    throw new StreamlineError(
      `Topic name contains invalid characters: "${topic}"`,
      'INVALID_TOPIC',
      false,
      undefined,
      'Topic names may only contain alphanumeric characters, dots, underscores, and hyphens',
    );
  }
}

/**
 * Calculate exponential backoff with jitter.
 *
 * Uses the formula: min(maxMs, baseMs * 2^attempt) * (0.5 + random * 0.5)
 * The jitter prevents thundering herd problems when many clients retry simultaneously.
 *
 * @param baseMs - Base backoff in milliseconds
 * @param attempt - Zero-based attempt number
 * @param maxMs - Maximum backoff in milliseconds
 * @returns Backoff duration in milliseconds
 */
export function calculateExponentialBackoff(
  baseMs: number,
  attempt: number,
  maxMs: number,
): number {
  const exponential = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = 0.5 + Math.random() * 0.5;
  return exponential * jitter;
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
