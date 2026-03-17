import { describe, it, expect } from 'vitest';
import { validateConfig } from '../config';
import type { StreamlineClientConfig } from '../config';

describe('validateConfig', () => {
  const validConfig: StreamlineClientConfig = {
    bootstrapServers: 'localhost:9092',
  };

  it('should accept a minimal valid config', () => {
    expect(() => validateConfig(validConfig)).not.toThrow();
  });

  it('should accept config with multiple brokers', () => {
    expect(() =>
      validateConfig({ bootstrapServers: 'broker1:9092,broker2:9092,broker3:9092' }),
    ).not.toThrow();
  });

  it('should accept config with optional fields', () => {
    expect(() =>
      validateConfig({
        bootstrapServers: 'localhost:9092',
        clientId: 'my-app',
        timeout: 30000,
        auth: { mechanism: 'PLAIN', username: 'admin', password: 'secret' } as any,
        tls: { enabled: true },
      }),
    ).not.toThrow();
  });

  describe('bootstrapServers validation', () => {
    it('should reject empty string', () => {
      expect(() => validateConfig({ bootstrapServers: '' })).toThrow(/bootstrapServers/);
    });

    it('should reject whitespace-only string', () => {
      expect(() => validateConfig({ bootstrapServers: '   ' })).toThrow(/bootstrapServers/);
    });

    it('should reject config with commas only', () => {
      expect(() => validateConfig({ bootstrapServers: ',,,' })).toThrow(/bootstrapServers/);
    });

    it('should trim whitespace in broker addresses', () => {
      expect(() =>
        validateConfig({ bootstrapServers: '  broker1:9092 , broker2:9092  ' }),
      ).not.toThrow();
    });
  });

  describe('timeout validation', () => {
    it('should accept undefined timeout', () => {
      expect(() => validateConfig({ bootstrapServers: 'localhost:9092' })).not.toThrow();
    });

    it('should accept valid timeout', () => {
      expect(() =>
        validateConfig({ bootstrapServers: 'localhost:9092', timeout: 5000 }),
      ).not.toThrow();
    });

    it('should reject zero timeout', () => {
      expect(() =>
        validateConfig({ bootstrapServers: 'localhost:9092', timeout: 0 }),
      ).toThrow(/timeout/);
    });

    it('should reject negative timeout', () => {
      expect(() =>
        validateConfig({ bootstrapServers: 'localhost:9092', timeout: -100 }),
      ).toThrow(/timeout/);
    });
  });

  describe('auth validation', () => {
    it('should accept valid auth config', () => {
      expect(() =>
        validateConfig({
          bootstrapServers: 'localhost:9092',
          auth: { mechanism: 'SCRAM-SHA-256', username: 'user', password: 'pass' } as any,
        }),
      ).not.toThrow();
    });

    it('should reject auth without mechanism', () => {
      expect(() =>
        validateConfig({
          bootstrapServers: 'localhost:9092',
          auth: { username: 'user', password: 'pass' } as any,
        }),
      ).toThrow(/mechanism/);
    });
  });

  describe('tls validation', () => {
    it('should accept valid TLS config', () => {
      expect(() =>
        validateConfig({
          bootstrapServers: 'localhost:9092',
          tls: { enabled: true },
        }),
      ).not.toThrow();
    });

    it('should accept TLS disabled', () => {
      expect(() =>
        validateConfig({
          bootstrapServers: 'localhost:9092',
          tls: { enabled: false },
        }),
      ).not.toThrow();
    });

    it('should reject TLS without enabled field', () => {
      expect(() =>
        validateConfig({
          bootstrapServers: 'localhost:9092',
          tls: {} as any,
        }),
      ).toThrow(/tls\.enabled/);
    });
  });

  describe('error quality', () => {
    it('should include hint in config errors', () => {
      try {
        validateConfig({ bootstrapServers: '' });
        expect.unreachable('should have thrown');
      } catch (e: any) {
        expect(e.hint || e.message).toBeTruthy();
      }
    });

    it('should mark config errors as non-retryable', () => {
      try {
        validateConfig({ bootstrapServers: '' });
        expect.unreachable('should have thrown');
      } catch (e: any) {
        expect(e.retryable).toBe(false);
      }
    });
  });
});
