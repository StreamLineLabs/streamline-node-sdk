import { describe, it, expect } from 'vitest';
import {
  assertAuthTransportSupported,
  assertTlsTransportSupported,
  assertLegacyTlsTransportSupported,
} from '../internal/transport-support';
import { UnsupportedOperationError } from '../types';

describe('assertAuthTransportSupported', () => {
  it('rejects SCRAM-SHA-256', () => {
    expect(() => assertAuthTransportSupported('SCRAM-SHA-256', 'auth.mechanism')).toThrow(
      UnsupportedOperationError,
    );
  });

  it('rejects SCRAM-SHA-512', () => {
    expect(() => assertAuthTransportSupported('SCRAM-SHA-512', 'sasl.mechanism')).toThrow(
      UnsupportedOperationError,
    );
  });

  it('includes the source label and mechanism in the error', () => {
    try {
      assertAuthTransportSupported('SCRAM-SHA-256', 'sasl.mechanism');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedOperationError);
      expect((err as UnsupportedOperationError).message).toContain('sasl.mechanism');
      expect((err as UnsupportedOperationError).message).toContain('SCRAM-SHA-256');
    }
  });

  it('allows PLAIN', () => {
    expect(() => assertAuthTransportSupported('PLAIN', 'auth.mechanism')).not.toThrow();
  });

  it('allows OAUTHBEARER', () => {
    expect(() => assertAuthTransportSupported('OAUTHBEARER', 'auth.mechanism')).not.toThrow();
  });

  it('allows undefined (no auth configured)', () => {
    expect(() => assertAuthTransportSupported(undefined, 'auth.mechanism')).not.toThrow();
  });
});

describe('assertTlsTransportSupported', () => {
  it('allows undefined', () => {
    expect(() => assertTlsTransportSupported(undefined)).not.toThrow();
  });

  it('allows { enabled: false }', () => {
    expect(() => assertTlsTransportSupported({ enabled: false })).not.toThrow();
  });

  it('allows a bare { enabled: true } with no customization', () => {
    expect(() => assertTlsTransportSupported({ enabled: true })).not.toThrow();
  });

  it('rejects a custom CA', () => {
    expect(() => assertTlsTransportSupported({ enabled: true, ca: 'ca-pem' })).toThrow(
      UnsupportedOperationError,
    );
  });

  it('rejects a client cert without a key the same way (already invalid, but transport-unsupported either way)', () => {
    expect(() =>
      assertTlsTransportSupported({ enabled: true, cert: 'cert-pem', key: 'key-pem' }),
    ).toThrow(UnsupportedOperationError);
  });

  it('rejects a passphrase', () => {
    expect(() =>
      assertTlsTransportSupported({ enabled: true, cert: 'c', key: 'k', passphrase: 'secret' }),
    ).toThrow(UnsupportedOperationError);
  });

  it('rejects a servername override', () => {
    expect(() =>
      assertTlsTransportSupported({ enabled: true, servername: 'broker.internal' }),
    ).toThrow(UnsupportedOperationError);
  });

  it('rejects rejectUnauthorized: false', () => {
    expect(() =>
      assertTlsTransportSupported({ enabled: true, rejectUnauthorized: false }),
    ).toThrow(UnsupportedOperationError);
  });

  it('allows rejectUnauthorized: true explicitly', () => {
    expect(() =>
      assertTlsTransportSupported({ enabled: true, rejectUnauthorized: true }),
    ).not.toThrow();
  });

  it('lists every unsupported field in the error message', () => {
    try {
      assertTlsTransportSupported({ enabled: true, ca: 'ca', cert: 'c', key: 'k' });
      expect.unreachable('should have thrown');
    } catch (err) {
      const message = (err as UnsupportedOperationError).message;
      expect(message).toContain('ca');
      expect(message).toContain('cert');
      expect(message).toContain('key');
    }
  });
});

describe('assertLegacyTlsTransportSupported', () => {
  it('allows undefined', () => {
    expect(() => assertLegacyTlsTransportSupported(undefined)).not.toThrow();
  });

  it('allows the boolean true shorthand', () => {
    expect(() => assertLegacyTlsTransportSupported(true)).not.toThrow();
  });

  it('allows the boolean false shorthand', () => {
    expect(() => assertLegacyTlsTransportSupported(false)).not.toThrow();
  });

  it('rejects an object with ca/cert/key', () => {
    expect(() =>
      assertLegacyTlsTransportSupported({ ca: 'ca', cert: 'c', key: 'k' }),
    ).toThrow(UnsupportedOperationError);
  });

  it('rejects rejectUnauthorized: false', () => {
    expect(() => assertLegacyTlsTransportSupported({ rejectUnauthorized: false })).toThrow(
      UnsupportedOperationError,
    );
  });
});
