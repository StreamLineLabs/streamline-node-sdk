/**
 * Demonstrates the circuit breaker pattern for resilient message production.
 *
 * The circuit breaker prevents your application from repeatedly attempting
 * operations against a failing server. After consecutive failures it "opens"
 * and rejects requests immediately, giving the server time to recover.
 *
 * Run with:
 *   npx tsx examples/circuit-breaker.ts
 */

import { Streamline, CircuitBreaker, CircuitState } from 'streamline';
import { StreamlineError } from 'streamline';

async function main() {
  const client = new Streamline(process.env.STREAMLINE_BOOTSTRAP_SERVERS || 'localhost:9092', {
    httpEndpoint: 'http://localhost:9094',
  });

  // Configure the circuit breaker
  const breaker = new CircuitBreaker({
    failureThreshold: 5,       // Open after 5 consecutive failures
    successThreshold: 2,       // Close after 2 successes in half-open
    openTimeout: 30000,        // Wait 30s before probing
    halfOpenMaxRequests: 3,    // Allow 3 probe requests in half-open
    onStateChange: (from, to) =>
      console.log(`[Circuit Breaker] ${from} → ${to}`),
  });

  await client.connect();
  console.log('Connected to Streamline');

  // Send messages through the circuit breaker
  for (let i = 0; i < 20; i++) {
    try {
      const result = await breaker.execute(async () =>
        client.produce('events', { event: 'click', i }, { key: `key-${i}` })
      );
      console.log(`Sent message ${i}: partition=${result.partition}, offset=${result.offset}`);
    } catch (error) {
      if (error instanceof StreamlineError && error.retryable) {
        console.log(`Retryable error (circuit: ${breaker.getState()}): ${error.message}`);
        await new Promise(r => setTimeout(r, 1000)); // back off
      } else {
        console.error(`Non-retryable error: ${error}`);
        break;
      }
    }
  }

  // Check final state
  console.log(`\nFinal circuit state: ${breaker.getState()}`);

  // You can also manually reset the circuit
  if (breaker.getState() === CircuitState.Open) {
    breaker.reset();
    console.log('Circuit reset to:', breaker.getState());
  }

  await client.close();
}

main().catch(console.error);
