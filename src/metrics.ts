/**
 * Client-side metrics for monitoring Streamline SDK health and performance.
 */

/**
 * Snapshot of current client metrics.
 */
export interface MetricsSnapshot {
  /** Total messages produced */
  messagesProduced: number;
  /** Total messages consumed */
  messagesConsumed: number;
  /** Total bytes sent */
  bytesSent: number;
  /** Total bytes received */
  bytesReceived: number;
  /** Total errors encountered */
  errorsTotal: number;
  /** Average produce latency in milliseconds */
  produceLatencyAvgMs: number;
  /** Average consume latency in milliseconds */
  consumeLatencyAvgMs: number;
  /** Number of active connections */
  activeConnections: number;
  /** Whether the client is healthy */
  isHealthy: boolean;
  /** Uptime in milliseconds */
  uptimeMs: number;
}

/**
 * Client metrics collector.
 *
 * Tracks production, consumption, and error metrics for observability.
 * Thread-safe via atomic-style counters (single-threaded JS, but safe for async).
 *
 * @example
 * ```typescript
 * const metrics = new ClientMetrics();
 * metrics.recordProduce(1, 256, 5.2);
 * metrics.recordConsume(10, 4096, 12.1);
 * console.log(metrics.snapshot());
 * ```
 */
export class ClientMetrics {
  private _messagesProduced = 0;
  private _messagesConsumed = 0;
  private _bytesSent = 0;
  private _bytesReceived = 0;
  private _errorsTotal = 0;
  private _produceLatencySum = 0;
  private _produceLatencyCount = 0;
  private _consumeLatencySum = 0;
  private _consumeLatencyCount = 0;
  private _activeConnections = 0;
  private _healthy = true;
  private _startTime = Date.now();

  /**
   * Record a successful produce operation.
   *
   * @param messageCount - Number of messages produced
   * @param bytes - Total bytes sent
   * @param latencyMs - Latency in milliseconds
   */
  recordProduce(messageCount: number, bytes: number, latencyMs: number): void {
    this._messagesProduced += messageCount;
    this._bytesSent += bytes;
    this._produceLatencySum += latencyMs;
    this._produceLatencyCount += 1;
  }

  /**
   * Record a successful consume operation.
   *
   * @param messageCount - Number of messages consumed
   * @param bytes - Total bytes received
   * @param latencyMs - Latency in milliseconds
   */
  recordConsume(messageCount: number, bytes: number, latencyMs: number): void {
    this._messagesConsumed += messageCount;
    this._bytesReceived += bytes;
    this._consumeLatencySum += latencyMs;
    this._consumeLatencyCount += 1;
  }

  /**
   * Record an error.
   */
  recordError(): void {
    this._errorsTotal += 1;
  }

  /**
   * Update connection count.
   */
  setActiveConnections(count: number): void {
    this._activeConnections = count;
  }

  /**
   * Update health status.
   */
  setHealthy(healthy: boolean): void {
    this._healthy = healthy;
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this._messagesProduced = 0;
    this._messagesConsumed = 0;
    this._bytesSent = 0;
    this._bytesReceived = 0;
    this._errorsTotal = 0;
    this._produceLatencySum = 0;
    this._produceLatencyCount = 0;
    this._consumeLatencySum = 0;
    this._consumeLatencyCount = 0;
    this._activeConnections = 0;
    this._healthy = true;
    this._startTime = Date.now();
  }

  /**
   * Get a snapshot of current metrics.
   */
  snapshot(): MetricsSnapshot {
    return {
      messagesProduced: this._messagesProduced,
      messagesConsumed: this._messagesConsumed,
      bytesSent: this._bytesSent,
      bytesReceived: this._bytesReceived,
      errorsTotal: this._errorsTotal,
      produceLatencyAvgMs: this._produceLatencyCount > 0
        ? this._produceLatencySum / this._produceLatencyCount
        : 0,
      consumeLatencyAvgMs: this._consumeLatencyCount > 0
        ? this._consumeLatencySum / this._consumeLatencyCount
        : 0,
      activeConnections: this._activeConnections,
      isHealthy: this._healthy,
      uptimeMs: Date.now() - this._startTime,
    };
  }
}
