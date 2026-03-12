/**
 * Streamline-native authentication configuration.
 *
 * Provides first-class SASL authentication support with compile-time
 * type safety and runtime validation for PLAIN, SCRAM, and OAUTHBEARER
 * mechanisms.
 *
 * @example
 * ```typescript
 * import { createSaslAuthenticator } from 'streamline';
 *
 * // PLAIN auth
 * const auth = createSaslAuthenticator({
 *   mechanism: 'PLAIN',
 *   username: 'admin',
 *   password: 'secret',
 * });
 *
 * // OAuth Bearer
 * const oauth = createSaslAuthenticator({
 *   mechanism: 'OAUTHBEARER',
 *   oauthBearerProvider: async () => ({
 *     value: await fetchToken(),
 *     expiresAt: Date.now() + 3600_000,
 *   }),
 * });
 * ```
 *
 * @module
 */

import { StreamlineError } from './types';

/**
 * OAuth Bearer token returned by the provider callback.
 */
export interface OAuthBearerToken {
  /** The token string (e.g. a JWT). */
  value: string;
  /** Token expiration time in milliseconds since epoch. */
  expiresAt: number;
  /** Principal name associated with the token (optional). */
  principalName?: string | undefined;
}

/**
 * PLAIN SASL authentication.
 */
export interface PlainAuth {
  /** SASL mechanism identifier. */
  mechanism: 'PLAIN';
  /** Username for authentication. */
  username: string;
  /** Password for authentication. */
  password: string;
}

/**
 * SCRAM SASL authentication (SHA-256 or SHA-512).
 */
export interface ScramAuth {
  /** SASL mechanism identifier. */
  mechanism: 'SCRAM-SHA-256' | 'SCRAM-SHA-512';
  /** Username for authentication. */
  username: string;
  /** Password for authentication. */
  password: string;
}

/**
 * OAuth Bearer SASL authentication.
 */
export interface OAuthBearerAuth {
  /** SASL mechanism identifier. */
  mechanism: 'OAUTHBEARER';
  /** Async callback that provides a fresh OAuth Bearer token. */
  oauthBearerProvider: () => Promise<OAuthBearerToken>;
}

/**
 * Union of all supported SASL authentication configurations.
 */
export type AuthConfig = PlainAuth | ScramAuth | OAuthBearerAuth;

/**
 * All supported SASL mechanism names.
 */
export type SaslMechanism = AuthConfig['mechanism'];

/** @internal Valid SASL mechanisms for runtime validation. */
const VALID_MECHANISMS: ReadonlySet<string> = new Set<SaslMechanism>([
  'PLAIN',
  'SCRAM-SHA-256',
  'SCRAM-SHA-512',
  'OAUTHBEARER',
]);

/**
 * Validate the authentication configuration at construction time.
 *
 * @throws {StreamlineError} If the configuration is invalid.
 * @internal
 */
function validateAuthConfig(config: AuthConfig): void {
  if (!config || typeof config !== 'object') {
    throw new StreamlineError(
      'Auth configuration must be an object',
      'AUTH_CONFIG_ERROR',
      false,
      undefined,
      'Provide a valid AuthConfig with a mechanism field',
    );
  }

  if (!VALID_MECHANISMS.has(config.mechanism)) {
    throw new StreamlineError(
      `Unsupported SASL mechanism: ${String(config.mechanism)}`,
      'AUTH_CONFIG_ERROR',
      false,
      undefined,
      `Supported mechanisms: ${[...VALID_MECHANISMS].join(', ')}`,
    );
  }

  if (config.mechanism === 'OAUTHBEARER') {
    if (typeof config.oauthBearerProvider !== 'function') {
      throw new StreamlineError(
        'OAUTHBEARER mechanism requires an oauthBearerProvider function',
        'AUTH_CONFIG_ERROR',
        false,
        undefined,
        'Provide an async function that returns an OAuthBearerToken',
      );
    }
    return;
  }

  // PLAIN and SCRAM share the same credential shape
  if (typeof config.username !== 'string' || config.username.length === 0) {
    throw new StreamlineError(
      'SASL username is required and must be a non-empty string',
      'AUTH_CONFIG_ERROR',
      false,
      undefined,
      'Set the username field in your auth configuration',
    );
  }

  if (typeof config.password !== 'string' || config.password.length === 0) {
    throw new StreamlineError(
      'SASL password is required and must be a non-empty string',
      'AUTH_CONFIG_ERROR',
      false,
      undefined,
      'Set the password field in your auth configuration',
    );
  }
}

/**
 * Validated SASL authenticator returned by {@link createSaslAuthenticator}.
 *
 * The authenticator wraps a validated {@link AuthConfig} and exposes a
 * uniform interface for the client connection layer.
 */
export interface SaslAuthenticator {
  /** The validated authentication configuration. */
  readonly config: Readonly<AuthConfig>;
  /** The SASL mechanism in use. */
  readonly mechanism: SaslMechanism;
}

/**
 * Create a validated SASL authenticator from the given configuration.
 *
 * Performs eager validation so configuration errors surface immediately
 * rather than at first connection attempt.
 *
 * @param config - SASL authentication configuration.
 * @returns A validated {@link SaslAuthenticator}.
 * @throws {StreamlineError} If the configuration is invalid.
 *
 * @example
 * ```typescript
 * const auth = createSaslAuthenticator({
 *   mechanism: 'SCRAM-SHA-256',
 *   username: 'admin',
 *   password: 'secret',
 * });
 * console.log(auth.mechanism); // 'SCRAM-SHA-256'
 * ```
 */
export function createSaslAuthenticator(config: AuthConfig): SaslAuthenticator {
  validateAuthConfig(config);

  return Object.freeze({
    config: Object.freeze({ ...config }),
    mechanism: config.mechanism,
  });
}
