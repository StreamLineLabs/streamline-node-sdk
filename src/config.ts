/**
 * Streamline client configuration with first-class auth and TLS support.
 *
 * @module
 */

import type { AuthConfig } from './auth';
import type { TlsConfig } from './tls';
import { StreamlineError } from './types';

/**
 * Complete client configuration for connecting to a Streamline cluster.
 *
 * @example
 * ```typescript
 * import { StreamlineClientConfig, validateConfig } from 'streamline';
 *
 * const config: StreamlineClientConfig = {
 *   bootstrapServers: 'broker1:9092,broker2:9092',
 *   auth: {
 *     mechanism: 'SCRAM-SHA-256',
 *     username: 'admin',
 *     password: 'secret',
 *   },
 *   tls: {
 *     enabled: true,
 *     ca: caCert,
 *   },
 * };
 *
 * validateConfig(config);
 * ```
 */
export interface StreamlineClientConfig {
  /** Comma-separated list of broker addresses (e.g. "broker1:9092,broker2:9092"). */
  bootstrapServers: string;

  /** HTTP endpoint for REST/GraphQL API (default: "http://localhost:9094"). */
  httpEndpoint?: string | undefined;

  /** Client identifier sent to the broker. */
  clientId?: string | undefined;

  /** API key for Streamline Cloud authentication. */
  apiKey?: string | undefined;

  /** SASL authentication configuration. */
  auth?: AuthConfig | undefined;

  /** TLS configuration. Pass `{ enabled: true }` for defaults. */
  tls?: TlsConfig | undefined;

  /** Request timeout in milliseconds (default: 30000). */
  timeout?: number | undefined;

  /** Auto-reconnect on connection loss (default: true). */
  autoReconnect?: boolean | undefined;

  /** Maximum reconnect attempts (default: 10). */
  maxReconnectAttempts?: number | undefined;

  /** Initial reconnect delay in milliseconds (default: 1000). */
  reconnectDelay?: number | undefined;

  /** Maximum reconnect delay in milliseconds with exponential backoff (default: 30000). */
  maxReconnectDelay?: number | undefined;
}

/**
 * Validate a {@link StreamlineClientConfig} eagerly.
 *
 * Checks structural correctness of bootstrap servers, auth, and TLS
 * configuration so that problems surface at construction time rather
 * than at first connection attempt.
 *
 * @param config - The client configuration to validate.
 * @throws {StreamlineError} If the configuration is invalid.
 *
 * @example
 * ```typescript
 * validateConfig({
 *   bootstrapServers: 'localhost:9092',
 *   auth: { mechanism: 'PLAIN', username: 'admin', password: 'secret' },
 * });
 * ```
 */
export function validateConfig(config: StreamlineClientConfig): void {
  // --- bootstrap servers ---
  if (typeof config.bootstrapServers !== 'string' || config.bootstrapServers.trim().length === 0) {
    throw new StreamlineError(
      'bootstrapServers is required and must be a non-empty string',
      'CONFIG_ERROR',
      false,
      undefined,
      'Provide at least one broker address, e.g. "localhost:9092"',
    );
  }

  const brokers = config.bootstrapServers
    .split(',')
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  if (brokers.length === 0) {
    throw new StreamlineError(
      'bootstrapServers must contain at least one broker address',
      'CONFIG_ERROR',
      false,
      undefined,
      'Provide at least one broker address, e.g. "localhost:9092"',
    );
  }

  // --- timeout ---
  if (config.timeout !== undefined) {
    if (typeof config.timeout !== 'number' || config.timeout <= 0) {
      throw new StreamlineError(
        'timeout must be a positive number',
        'CONFIG_ERROR',
        false,
        undefined,
        'Set timeout to a value in milliseconds, e.g. 30000',
      );
    }
  }

  // --- auth ---
  if (config.auth !== undefined) {
    // Auth validation is handled by createSaslAuthenticator / validateAuthConfig,
    // but we perform a basic structural check here for early feedback.
    const { auth } = config;

    if (!auth || typeof auth !== 'object') {
      throw new StreamlineError(
        'auth must be a valid AuthConfig object',
        'CONFIG_ERROR',
        false,
        undefined,
        'Provide a valid AuthConfig with a mechanism field',
      );
    }

    if (!('mechanism' in auth)) {
      throw new StreamlineError(
        'auth.mechanism is required',
        'CONFIG_ERROR',
        false,
        undefined,
        'Set mechanism to PLAIN, SCRAM-SHA-256, SCRAM-SHA-512, or OAUTHBEARER',
      );
    }
  }

  // --- tls ---
  if (config.tls !== undefined) {
    const { tls } = config;

    if (!tls || typeof tls !== 'object') {
      throw new StreamlineError(
        'tls must be a valid TlsConfig object',
        'CONFIG_ERROR',
        false,
        undefined,
        'Provide a valid TlsConfig with at least { enabled: true }',
      );
    }

    if (typeof tls.enabled !== 'boolean') {
      throw new StreamlineError(
        'tls.enabled is required and must be a boolean',
        'CONFIG_ERROR',
        false,
        undefined,
        'Set tls.enabled to true or false',
      );
    }
  }

  // --- auth + tls consistency ---
  if (config.auth !== undefined && config.tls === undefined) {
    // SASL without TLS is technically possible but risky — emit no error,
    // but downstream code may log a warning.
  }
}
