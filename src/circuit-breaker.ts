/**
 * Circuit breaker pattern for resilient Streamline operations.
 *
 * Tracks failures and temporarily stops requests to a failing service,
 * allowing it time to recover before retrying.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker({ failureThreshold: 5 });
 *
 * async function safeCall<T>(fn: () => Promise<T>): Promise<T> {
 *   return breaker.execute(fn);
 * }
 * ```
 */

import { StreamlineError } from './types';

/** Circuit breaker states. */
export enum CircuitState {
  /** Requests flow normally. */
  Closed = 'CLOSED',
  /** Requests are rejected immediately. */
  Open = 'OPEN',
  /** A limited number of probe requests are allowed. */
  HalfOpen = 'HALF_OPEN',
}

/** Circuit breaker configuration. */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit (default: 5). */
  failureThreshold?: number;
  /** Consecutive successes in half-open state to close the circuit (default: 2). */
  successThreshold?: number;
  /** How long to wait (ms) before transitioning from open to half-open (default: 30000). */
  openTimeout?: number;
  /** Max probe requests allowed in half-open state (default: 3). */
  halfOpenMaxRequests?: number;
  /** Called when the circuit state changes. */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

/**
 * Circuit breaker implementation following the standard closed → open → half-open pattern.
 *
 * Only retryable errors (where `error.retryable === true`) trip the circuit breaker.
 * Non-retryable errors (auth failures, not found, etc.) pass through without affecting
 * the circuit state.
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.Closed;
  private failureCount = 0;
  private successCount = 0;
  private halfOpenCount = 0;
  private lastFailureAt = 0;
  private readonly config: Required<Omit<CircuitBreakerConfig, 'onStateChange'>> & { onStateChange?: CircuitBreakerConfig['onStateChange'] };

  constructor(config: CircuitBreakerConfig = {}) {
    this.config = {
      failureThreshold: config.failureThreshold ?? 5,
      successThreshold: config.successThreshold ?? 2,
      openTimeout: config.openTimeout ?? 30000,
      halfOpenMaxRequests: config.halfOpenMaxRequests ?? 3,
      onStateChange: config.onStateChange,
    };
  }

  /** Returns the current circuit state. */
  getState(): CircuitState {
    this.checkOpenTimeout();
    return this.state;
  }

  /** Returns true if a request should be allowed through. */
  allow(): boolean {
    switch (this.state) {
      case CircuitState.Closed:
        return true;
      case CircuitState.Open:
        if (Date.now() - this.lastFailureAt >= this.config.openTimeout) {
          this.transition(CircuitState.HalfOpen);
          this.halfOpenCount = 1;
          return true;
        }
        return false;
      case CircuitState.HalfOpen:
        if (this.halfOpenCount < this.config.halfOpenMaxRequests) {
          this.halfOpenCount++;
          return true;
        }
        return false;
      default:
        return true;
    }
  }

  /** Record a successful operation. */
  recordSuccess(): void {
    switch (this.state) {
      case CircuitState.Closed:
        this.failureCount = 0;
        break;
      case CircuitState.HalfOpen:
        this.successCount++;
        if (this.successCount >= this.config.successThreshold) {
          this.transition(CircuitState.Closed);
        }
        break;
    }
  }

  /** Record a failed operation. Only retryable failures should be recorded. */
  recordFailure(): void {
    this.lastFailureAt = Date.now();

    switch (this.state) {
      case CircuitState.Closed:
        this.failureCount++;
        if (this.failureCount >= this.config.failureThreshold) {
          this.transition(CircuitState.Open);
        }
        break;
      case CircuitState.HalfOpen:
        this.transition(CircuitState.Open);
        break;
    }
  }

  /** Reset the circuit breaker to closed state. */
  reset(): void {
    this.transition(CircuitState.Closed);
  }

  /**
   * Execute an operation through the circuit breaker.
   *
   * @throws StreamlineError with code 'CIRCUIT_OPEN' if the circuit is open
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.allow()) {
      throw new StreamlineError(
        'Circuit breaker is open — too many recent failures',
        'CIRCUIT_OPEN',
        true,
      );
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      if (error instanceof StreamlineError && error.retryable) {
        this.recordFailure();
      }
      throw error;
    }
  }

  private checkOpenTimeout(): void {
    if (this.state === CircuitState.Open && Date.now() - this.lastFailureAt >= this.config.openTimeout) {
      this.transition(CircuitState.HalfOpen);
    }
  }

  private transition(to: CircuitState): void {
    const from = this.state;
    if (from === to) return;

    this.state = to;
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenCount = 0;

    this.config.onStateChange?.(from, to);
  }
}
