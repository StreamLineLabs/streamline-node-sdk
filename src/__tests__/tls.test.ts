import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTlsOptions, loadCertificateFromFile, type TlsConfig } from '../tls';
import { StreamlineError } from '../types';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('createTlsOptions', () => {
  describe('basic configuration', () => {
    it('returns empty options when TLS is disabled', () => {
      const options = createTlsOptions({ enabled: false });
      expect(options).toEqual({});
    });

    it('returns default options when TLS is enabled with no extras', () => {
      const options = createTlsOptions({ enabled: true });
      expect(options.rejectUnauthorized).toBe(true);
    });

    it('sets rejectUnauthorized to false when specified', () => {
      const options = createTlsOptions({
        enabled: true,
        rejectUnauthorized: false,
      });
      expect(options.rejectUnauthorized).toBe(false);
    });
  });

  describe('CA certificates', () => {
    it('passes through a string CA', () => {
      const ca = '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----';
      const options = createTlsOptions({ enabled: true, ca });
      expect(options.ca).toBe(ca);
    });

    it('passes through a Buffer CA', () => {
      const ca = Buffer.from('cert-data');
      const options = createTlsOptions({ enabled: true, ca });
      expect(options.ca).toBe(ca);
    });

    it('passes through an array of CA certs', () => {
      const ca = [
        '-----BEGIN CERTIFICATE-----\ncert1\n-----END CERTIFICATE-----',
        Buffer.from('cert2'),
      ];
      const options = createTlsOptions({ enabled: true, ca });
      expect(options.ca).toEqual(ca);
    });
  });

  describe('mutual TLS', () => {
    const cert = '-----BEGIN CERTIFICATE-----\nclient-cert\n-----END CERTIFICATE-----';
    const key = '-----BEGIN PRIVATE KEY-----\nclient-key\n-----END PRIVATE KEY-----';

    it('accepts cert and key together', () => {
      const options = createTlsOptions({ enabled: true, cert, key });
      expect(options.cert).toBe(cert);
      expect(options.key).toBe(key);
    });

    it('rejects cert without key', () => {
      expect(() =>
        createTlsOptions({ enabled: true, cert }),
      ).toThrow(StreamlineError);

      try {
        createTlsOptions({ enabled: true, cert });
      } catch (err) {
        expect((err as StreamlineError).code).toBe('TLS_CONFIG_ERROR');
        expect((err as StreamlineError).message).toContain('private key');
      }
    });

    it('rejects key without cert', () => {
      expect(() =>
        createTlsOptions({ enabled: true, key }),
      ).toThrow(StreamlineError);

      try {
        createTlsOptions({ enabled: true, key });
      } catch (err) {
        expect((err as StreamlineError).code).toBe('TLS_CONFIG_ERROR');
        expect((err as StreamlineError).message).toContain('client certificate');
      }
    });

    it('accepts passphrase with cert and key', () => {
      const options = createTlsOptions({
        enabled: true,
        cert,
        key,
        passphrase: 'my-passphrase',
      });
      expect(options.passphrase).toBe('my-passphrase');
    });

    it('rejects passphrase without key', () => {
      expect(() =>
        createTlsOptions({
          enabled: true,
          passphrase: 'orphan-passphrase',
        }),
      ).toThrow(StreamlineError);
    });
  });

  describe('SNI servername', () => {
    it('passes through servername', () => {
      const options = createTlsOptions({
        enabled: true,
        servername: 'broker.streamline.dev',
      });
      expect(options.servername).toBe('broker.streamline.dev');
    });

    it('omits servername when not provided', () => {
      const options = createTlsOptions({ enabled: true });
      expect(options.servername).toBeUndefined();
    });
  });

  describe('default values', () => {
    it('defaults rejectUnauthorized to true', () => {
      const options = createTlsOptions({ enabled: true });
      expect(options.rejectUnauthorized).toBe(true);
    });

    it('does not include optional fields when unset', () => {
      const options = createTlsOptions({ enabled: true });
      expect(options.ca).toBeUndefined();
      expect(options.cert).toBeUndefined();
      expect(options.key).toBeUndefined();
      expect(options.passphrase).toBeUndefined();
      expect(options.servername).toBeUndefined();
    });
  });

  describe('validation', () => {
    it('rejects null config', () => {
      expect(() =>
        createTlsOptions(null as unknown as TlsConfig),
      ).toThrow(StreamlineError);
    });

    it('rejects config without enabled field', () => {
      expect(() =>
        createTlsOptions({} as TlsConfig),
      ).toThrow(StreamlineError);
    });

    it('skips cert/key validation when disabled', () => {
      // Should not throw even with mismatched cert/key
      const options = createTlsOptions({
        enabled: false,
        cert: 'orphan-cert',
      } as TlsConfig);
      expect(options).toEqual({});
    });
  });
});

describe('loadCertificateFromFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'streamline-tls-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads a PEM file as a UTF-8 string', async () => {
    const certContent = '-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----\n';
    const certPath = path.join(tmpDir, 'ca.pem');
    await fs.writeFile(certPath, certContent, 'utf-8');

    const loaded = await loadCertificateFromFile(certPath);
    expect(loaded).toBe(certContent);
  });

  it('throws StreamlineError for missing file', async () => {
    await expect(
      loadCertificateFromFile('/nonexistent/path/cert.pem'),
    ).rejects.toThrow(StreamlineError);

    try {
      await loadCertificateFromFile('/nonexistent/path/cert.pem');
    } catch (err) {
      expect((err as StreamlineError).code).toBe('TLS_CERT_ERROR');
      expect((err as StreamlineError).cause).toBeInstanceOf(Error);
    }
  });

  it('error message includes the file path', async () => {
    try {
      await loadCertificateFromFile('/missing/cert.pem');
    } catch (err) {
      expect((err as StreamlineError).message).toContain('/missing/cert.pem');
    }
  });
});
