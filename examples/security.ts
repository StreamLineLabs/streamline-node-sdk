/**
 * Demonstrates TLS and SASL authentication configuration.
 *
 * Shows how to connect to a Streamline server with:
 * - TLS encryption (SSL/mTLS)
 * - SASL authentication (PLAIN, SCRAM-SHA-256, SCRAM-SHA-512)
 *
 * Run with:
 *   npx tsx examples/security.ts
 */

import { Streamline } from 'streamline';

async function main() {
  const servers = process.env.STREAMLINE_BOOTSTRAP_SERVERS || 'localhost:9092';

  // =========================================================================
  // Example 1: TLS only (server certificate validation)
  // =========================================================================
  console.log('=== TLS Connection ===');
  try {
    const client = new Streamline(servers, {
      httpEndpoint: 'https://localhost:9094',
      tls: {
        ca: '/path/to/ca-cert.pem',
        // For mutual TLS (mTLS), also set:
        // cert: '/path/to/client-cert.pem',
        // key: '/path/to/client-key.pem',
        rejectUnauthorized: true,  // set false only for self-signed certs in dev
      },
    });

    await client.connect();
    await client.produce('secure-topic', { message: 'Hello over TLS!' });
    console.log('Message sent over TLS');
    await client.close();
  } catch (error) {
    console.log('TLS example:', (error as Error).message);
    console.log('(Expected if server is not configured for TLS)');
  }

  // =========================================================================
  // Example 2: SASL PLAIN authentication
  // =========================================================================
  console.log('\n=== SASL PLAIN Authentication ===');
  try {
    const client = new Streamline(servers, {
      httpEndpoint: 'http://localhost:9094',
      sasl: {
        mechanism: 'PLAIN',
        username: 'my-user',
        password: 'my-password',
      },
    });

    await client.connect();
    await client.produce('auth-topic', { message: 'Hello with SASL PLAIN!' });
    console.log('Message sent with SASL PLAIN');
    await client.close();
  } catch (error) {
    console.log('SASL PLAIN example:', (error as Error).message);
    console.log('(Expected if server is not configured for SASL)');
  }

  // =========================================================================
  // Example 3: SASL SCRAM-SHA-256 with TLS (most secure)
  // =========================================================================
  console.log('\n=== SASL SCRAM-SHA-256 + TLS ===');
  try {
    const client = new Streamline(servers, {
      httpEndpoint: 'https://localhost:9094',
      tls: {
        ca: '/path/to/ca-cert.pem',
      },
      sasl: {
        mechanism: 'SCRAM-SHA-256',
        username: 'my-user',
        password: 'my-password',
      },
    });

    await client.connect();
    await client.produce('secure-auth-topic', { message: 'Hello with SCRAM + TLS!' });
    console.log('Message sent with SCRAM-SHA-256 + TLS');
    await client.close();
  } catch (error) {
    console.log('SCRAM + TLS example:', (error as Error).message);
    console.log('(Expected if server is not configured for SASL+TLS)');
  }

  console.log('\nDone! Adjust paths and credentials for your environment.');
}

main().catch(console.error);
