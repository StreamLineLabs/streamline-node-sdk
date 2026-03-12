/**
 * Streamline-native TLS configuration.
 *
 * Provides first-class TLS/mTLS support with validation, certificate
 * loading helpers, and conversion to Node.js `tls.ConnectionOptions`.
 *
 * @example
 * ```typescript
 * import { createTlsOptions, loadCertificateFromFile } from 'streamline';
 *
 * const tls = createTlsOptions({
 *   enabled: true,
 *   ca: await loadCertificateFromFile('/certs/ca.pem'),
 *   cert: await loadCertificateFromFile('/certs/client.pem'),
 *   key: await loadCertificateFromFile('/certs/client-key.pem'),
 * });
 * ```
 *
 * @module
 */

import { readFile } from 'node:fs/promises';
import type { ConnectionOptions } from 'node:tls';

import { StreamlineError } from './types';

/**
 * TLS configuration for Streamline connections.
 */
export interface TlsConfig {
  /** Whether TLS is enabled. */
  enabled: boolean;

  /**
   * Reject connections when the server certificate cannot be verified.
   * Defaults to `true`. Set to `false` only for development.
   */
  rejectUnauthorized?: boolean | undefined;

  /** One or more CA certificates for server verification (PEM-encoded). */
  ca?: string | Buffer | Array<string | Buffer> | undefined;

  /** Client certificate for mutual TLS (PEM-encoded). */
  cert?: string | Buffer | undefined;

  /** Client private key for mutual TLS (PEM-encoded). */
  key?: string | Buffer | undefined;

  /** Passphrase for an encrypted client private key. */
  passphrase?: string | undefined;

  /** SNI server name override. */
  servername?: string | undefined;
}

/**
 * Validate the TLS configuration at construction time.
 *
 * @throws {StreamlineError} If the configuration is invalid.
 * @internal
 */
function validateTlsConfig(config: TlsConfig): void {
  if (!config || typeof config !== 'object') {
    throw new StreamlineError(
      'TLS configuration must be an object',
      'TLS_CONFIG_ERROR',
      false,
      undefined,
      'Provide a valid TlsConfig with at least { enabled: true }',
    );
  }

  if (typeof config.enabled !== 'boolean') {
    throw new StreamlineError(
      'TLS enabled field must be a boolean',
      'TLS_CONFIG_ERROR',
      false,
      undefined,
      'Set enabled to true or false',
    );
  }

  // When TLS is disabled, skip further validation
  if (!config.enabled) {
    return;
  }

  // Mutual TLS: cert and key must both be present or both absent
  const hasCert = config.cert !== undefined;
  const hasKey = config.key !== undefined;

  if (hasCert && !hasKey) {
    throw new StreamlineError(
      'TLS client certificate provided without a private key',
      'TLS_CONFIG_ERROR',
      false,
      undefined,
      'Provide both cert and key for mutual TLS, or omit both',
    );
  }

  if (hasKey && !hasCert) {
    throw new StreamlineError(
      'TLS private key provided without a client certificate',
      'TLS_CONFIG_ERROR',
      false,
      undefined,
      'Provide both cert and key for mutual TLS, or omit both',
    );
  }

  if (config.passphrase !== undefined && !hasKey) {
    throw new StreamlineError(
      'TLS passphrase provided without a private key',
      'TLS_CONFIG_ERROR',
      false,
      undefined,
      'Provide key alongside passphrase, or remove the passphrase',
    );
  }
}

/**
 * Convert a validated {@link TlsConfig} to Node.js `tls.ConnectionOptions`.
 *
 * @param config - TLS configuration to convert.
 * @returns Node.js connection options suitable for `tls.connect()` or HTTPS agents.
 * @throws {StreamlineError} If the configuration is invalid.
 *
 * @example
 * ```typescript
 * const options = createTlsOptions({
 *   enabled: true,
 *   rejectUnauthorized: true,
 *   ca: caCert,
 * });
 * ```
 */
export function createTlsOptions(config: TlsConfig): ConnectionOptions {
  validateTlsConfig(config);

  if (!config.enabled) {
    return {};
  }

  const options: ConnectionOptions = {
    rejectUnauthorized: config.rejectUnauthorized ?? true,
  };

  if (config.ca !== undefined) {
    options.ca = config.ca;
  }

  if (config.cert !== undefined) {
    options.cert = config.cert;
  }

  if (config.key !== undefined) {
    options.key = config.key;
  }

  if (config.passphrase !== undefined) {
    options.passphrase = config.passphrase;
  }

  if (config.servername !== undefined) {
    options.servername = config.servername;
  }

  return options;
}

/**
 * Load a PEM-encoded certificate or key from the filesystem.
 *
 * @param path - Absolute or relative path to the PEM file.
 * @returns The file contents as a UTF-8 string.
 * @throws {StreamlineError} If the file cannot be read.
 *
 * @example
 * ```typescript
 * const ca = await loadCertificateFromFile('/etc/ssl/certs/ca.pem');
 * ```
 */
export async function loadCertificateFromFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    throw new StreamlineError(
      `Failed to load certificate from ${path}`,
      'TLS_CERT_ERROR',
      false,
      error instanceof Error ? error : undefined,
      'Verify the file path exists and is readable',
    );
  }
}
