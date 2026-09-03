/**
 * Guards against SASL/TLS configuration this HTTP/GraphQL transport cannot
 * genuinely honour.
 *
 * `Streamline` authenticates with a single `fetch()` call per request and
 * wires up no custom TLS agent/dispatcher. Some configuration shapes
 * validate and construct without error, but are silently ignored or
 * downgraded at request time — which misrepresents the security guarantee
 * the caller asked for:
 *
 *  - `SCRAM-SHA-256` / `SCRAM-SHA-512` are not implemented as a real
 *    salted challenge-response handshake; without rejection they would
 *    silently fall back to sending the raw username/password as HTTP Basic
 *    auth, identical to `PLAIN`.
 *  - a custom CA, client certificate/key (mTLS), private-key passphrase,
 *    SNI override, or `rejectUnauthorized: false` are never applied to the
 *    underlying `fetch()` call, so honouring them would be a silent no-op
 *    that leaves every request on plain system-default TLS verification
 *    (or, for mTLS, without ever presenting a client certificate).
 *
 * These are rejected eagerly (before any I/O) with
 * {@link UnsupportedOperationError} rather than accepted and quietly
 * ignored.
 *
 * @internal
 */

import { UnsupportedOperationError } from '../types';
import type { TlsConfig } from '../tls';

const SASL_MECHANISM_HINT =
  'Use mechanism: "PLAIN" over an https:// endpoint, "OAUTHBEARER" with a real token provider, ' +
  'or use the Kafka protocol with a Kafka client for real SCRAM support';

/**
 * Reject SASL mechanisms this transport cannot genuinely perform.
 *
 * @param mechanism - `AuthConfig.mechanism` or the legacy `SaslOptions.mechanism`.
 * @param source - Human-readable name of the option that carried `mechanism`,
 *   used in the thrown error (e.g. `"auth.mechanism"` or `"sasl.mechanism"`).
 */
export function assertAuthTransportSupported(
  mechanism: string | undefined,
  source: string,
): void {
  if (mechanism === 'SCRAM-SHA-256' || mechanism === 'SCRAM-SHA-512') {
    throw new UnsupportedOperationError(
      `${source}: '${mechanism}'`,
      'the Streamline HTTP/GraphQL transport sends a single bearer/basic-auth header per ' +
        'request and cannot perform a real SCRAM challenge-response handshake; honouring this ' +
        'would silently send the raw password as HTTP Basic auth instead',
      SASL_MECHANISM_HINT,
    );
  }
}

const TLS_UNSUPPORTED_HINT =
  "Use an https:// httpEndpoint for transport encryption (validated against the system's " +
  'default trust store); custom CA pinning, mutual TLS, passphrase-protected keys, SNI ' +
  "overrides and rejectUnauthorized overrides are not applied to this transport's fetch() " +
  'requests';

/** Fields of {@link TlsConfig} that are validated but never wired into `fetch()`. */
function unsupportedTlsFields(tls: {
  ca?: unknown;
  cert?: unknown;
  key?: unknown;
  passphrase?: unknown;
  servername?: unknown;
  rejectUnauthorized?: boolean | undefined;
}): string[] {
  return (
    [
      ['ca', tls.ca !== undefined],
      ['cert', tls.cert !== undefined],
      ['key', tls.key !== undefined],
      ['passphrase', tls.passphrase !== undefined],
      ['servername', tls.servername !== undefined],
      ['rejectUnauthorized: false', tls.rejectUnauthorized === false],
    ] as const
  )
    .filter(([, present]) => present)
    .map(([name]) => name);
}

/**
 * Reject first-class {@link TlsConfig} customization that is validated but
 * never applied to this transport's HTTP requests.
 *
 * A bare `{ enabled: true }` (or `undefined`/`{ enabled: false }`) is left
 * alone: it asks for nothing this transport does not already provide when
 * `httpEndpoint` is `https://`.
 */
export function assertTlsTransportSupported(tls: TlsConfig | undefined): void {
  if (!tls || tls.enabled !== true) {
    return;
  }
  const unsupported = unsupportedTlsFields(tls);
  if (unsupported.length > 0) {
    throw new UnsupportedOperationError(
      `tlsConfig.{${unsupported.join(', ')}}`,
      'these TLS options are validated but never applied to the HTTP requests this transport ' +
        'makes (no custom fetch agent/dispatcher is wired up), so honouring them would silently ' +
        'fall back to plain system-default TLS verification',
      TLS_UNSUPPORTED_HINT,
    );
  }
}

/**
 * Reject the deprecated `tls` (legacy `TlsOptions`) customization for the
 * same reason as {@link assertTlsTransportSupported}. A bare boolean is left
 * alone — it carries no customization to misrepresent.
 */
export function assertLegacyTlsTransportSupported(
  tls:
    | boolean
    | { ca?: unknown; cert?: unknown; key?: unknown; rejectUnauthorized?: boolean | undefined }
    | undefined,
): void {
  if (!tls || typeof tls !== 'object') {
    return;
  }
  const unsupported = unsupportedTlsFields(tls);
  if (unsupported.length > 0) {
    throw new UnsupportedOperationError(
      `tls.{${unsupported.join(', ')}}`,
      'the deprecated tls option is validated but never applied to the HTTP requests this ' +
        'transport makes',
      'Use an https:// httpEndpoint for transport security, or build your own fetch ' +
        'dispatcher from tlsConfig via createTlsOptions()',
    );
  }
}
