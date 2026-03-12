import { describe, it, expect, vi } from 'vitest';
import {
  createSaslAuthenticator,
  type AuthConfig,
  type PlainAuth,
  type ScramAuth,
  type OAuthBearerAuth,
  type OAuthBearerToken,
} from '../auth';
import { StreamlineError } from '../types';

describe('createSaslAuthenticator', () => {
  describe('PLAIN mechanism', () => {
    it('creates a valid PLAIN authenticator', () => {
      const config: PlainAuth = {
        mechanism: 'PLAIN',
        username: 'admin',
        password: 'secret',
      };

      const auth = createSaslAuthenticator(config);

      expect(auth.mechanism).toBe('PLAIN');
      expect(auth.config).toEqual(config);
    });

    it('returns a frozen authenticator', () => {
      const auth = createSaslAuthenticator({
        mechanism: 'PLAIN',
        username: 'admin',
        password: 'secret',
      });

      expect(Object.isFrozen(auth)).toBe(true);
      expect(Object.isFrozen(auth.config)).toBe(true);
    });

    it('rejects empty username', () => {
      expect(() =>
        createSaslAuthenticator({
          mechanism: 'PLAIN',
          username: '',
          password: 'secret',
        }),
      ).toThrow(StreamlineError);
    });

    it('rejects empty password', () => {
      expect(() =>
        createSaslAuthenticator({
          mechanism: 'PLAIN',
          username: 'admin',
          password: '',
        }),
      ).toThrow(StreamlineError);
    });

    it('error includes AUTH_CONFIG_ERROR code', () => {
      try {
        createSaslAuthenticator({
          mechanism: 'PLAIN',
          username: '',
          password: 'secret',
        });
      } catch (err) {
        expect(err).toBeInstanceOf(StreamlineError);
        expect((err as StreamlineError).code).toBe('AUTH_CONFIG_ERROR');
        expect((err as StreamlineError).retryable).toBe(false);
      }
    });
  });

  describe('SCRAM-SHA-256 mechanism', () => {
    it('creates a valid SCRAM-SHA-256 authenticator', () => {
      const config: ScramAuth = {
        mechanism: 'SCRAM-SHA-256',
        username: 'admin',
        password: 'secret',
      };

      const auth = createSaslAuthenticator(config);

      expect(auth.mechanism).toBe('SCRAM-SHA-256');
      expect(auth.config).toEqual(config);
    });

    it('rejects missing username', () => {
      expect(() =>
        createSaslAuthenticator({
          mechanism: 'SCRAM-SHA-256',
          username: '',
          password: 'secret',
        }),
      ).toThrow(StreamlineError);
    });

    it('rejects missing password', () => {
      expect(() =>
        createSaslAuthenticator({
          mechanism: 'SCRAM-SHA-256',
          username: 'admin',
          password: '',
        }),
      ).toThrow(StreamlineError);
    });
  });

  describe('SCRAM-SHA-512 mechanism', () => {
    it('creates a valid SCRAM-SHA-512 authenticator', () => {
      const config: ScramAuth = {
        mechanism: 'SCRAM-SHA-512',
        username: 'user',
        password: 'p@ssw0rd',
      };

      const auth = createSaslAuthenticator(config);

      expect(auth.mechanism).toBe('SCRAM-SHA-512');
      expect(auth.config).toEqual(config);
    });
  });

  describe('OAUTHBEARER mechanism', () => {
    it('creates a valid OAUTHBEARER authenticator', () => {
      const provider = vi.fn(async (): Promise<OAuthBearerToken> => ({
        value: 'jwt-token',
        expiresAt: Date.now() + 3600_000,
      }));

      const config: OAuthBearerAuth = {
        mechanism: 'OAUTHBEARER',
        oauthBearerProvider: provider,
      };

      const auth = createSaslAuthenticator(config);

      expect(auth.mechanism).toBe('OAUTHBEARER');
    });

    it('provides access to the token provider', async () => {
      const provider = vi.fn(async (): Promise<OAuthBearerToken> => ({
        value: 'jwt-token',
        expiresAt: Date.now() + 3600_000,
        principalName: 'user@example.com',
      }));

      const auth = createSaslAuthenticator({
        mechanism: 'OAUTHBEARER',
        oauthBearerProvider: provider,
      });

      // The provider should be callable through the config
      const token = await (auth.config as OAuthBearerAuth).oauthBearerProvider();
      expect(token.value).toBe('jwt-token');
      expect(token.principalName).toBe('user@example.com');
      expect(provider).toHaveBeenCalledOnce();
    });

    it('rejects missing oauthBearerProvider', () => {
      expect(() =>
        createSaslAuthenticator({
          mechanism: 'OAUTHBEARER',
          oauthBearerProvider: undefined as unknown as () => Promise<OAuthBearerToken>,
        }),
      ).toThrow(StreamlineError);
    });

    it('rejects non-function oauthBearerProvider', () => {
      expect(() =>
        createSaslAuthenticator({
          mechanism: 'OAUTHBEARER',
          oauthBearerProvider: 'not-a-function' as unknown as () => Promise<OAuthBearerToken>,
        }),
      ).toThrow(StreamlineError);
    });
  });

  describe('invalid configurations', () => {
    it('rejects unsupported mechanism', () => {
      expect(() =>
        createSaslAuthenticator({
          mechanism: 'GSSAPI' as AuthConfig['mechanism'],
          username: 'admin',
          password: 'secret',
        } as AuthConfig),
      ).toThrow(StreamlineError);
    });

    it('rejects null config', () => {
      expect(() =>
        createSaslAuthenticator(null as unknown as AuthConfig),
      ).toThrow(StreamlineError);
    });

    it('rejects undefined config', () => {
      expect(() =>
        createSaslAuthenticator(undefined as unknown as AuthConfig),
      ).toThrow(StreamlineError);
    });

    it('error message mentions supported mechanisms for invalid mechanism', () => {
      try {
        createSaslAuthenticator({
          mechanism: 'UNKNOWN' as AuthConfig['mechanism'],
        } as AuthConfig);
      } catch (err) {
        expect(err).toBeInstanceOf(StreamlineError);
        expect((err as StreamlineError).hint).toContain('PLAIN');
        expect((err as StreamlineError).hint).toContain('SCRAM-SHA-256');
        expect((err as StreamlineError).hint).toContain('OAUTHBEARER');
      }
    });
  });
});
