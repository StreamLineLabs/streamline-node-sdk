/**
 * Streamline SQL Query Example
 *
 * Demonstrates using Streamline's embedded analytics engine (DuckDB)
 * to run SQL queries on streaming data.
 *
 * Prerequisites:
 *   - Streamline server running
 *   - npm install streamline-client
 *
 * Run:
 *   npx tsx examples/query-usage.ts
 */
import { Streamline } from '../src';

async function main() {
  const bootstrap = process.env.STREAMLINE_BOOTSTRAP ?? 'localhost:9092';
  const httpUrl = process.env.STREAMLINE_HTTP ?? 'http://localhost:9094';

  const client = new Streamline(bootstrap, { httpEndpoint: httpUrl });
  await client.connect();

  // Produce sample data
  await client.createTopic('events', { partitions: 1 });
  for (let i = 0; i < 10; i++) {
    await client.produce('events', {
      user: `user-${i}`,
      action: 'click',
      value: i * 10,
    });
  }
  console.log('Produced 10 events');

  // Simple SELECT
  console.log('\n--- All events (limit 5) ---');
  const rows = await client.query("SELECT * FROM topic('events') LIMIT 5");
  console.log(`Rows: ${rows.length}`);
  for (const row of rows) {
    console.log(' ', row);
  }

  // Full query with metadata
  console.log('\n--- Count by action ---');
  const result = await client.queryFull(
    "SELECT action, COUNT(*) as cnt FROM topic('events') GROUP BY action",
  );
  console.log(`Columns: ${result.columns?.length}, Rows: ${result.rows?.length}`);

  // Query with options
  console.log('\n--- With custom timeout and limit ---');
  const limited = await client.queryFull(
    "SELECT * FROM topic('events') ORDER BY offset DESC",
    { timeoutMs: 5000, maxRows: 3 },
  );
  console.log(`Returned ${limited.rows?.length} rows`);

  await client.close();
}

main().catch(console.error);
