/**
 * Streamline Admin Client Usage Example
 *
 * Demonstrates topic management, consumer group inspection,
 * and cluster diagnostics.
 *
 * Run with:
 *   npx tsx examples/admin-usage.ts
 */

import { Streamline } from 'streamline';

async function main() {
  const client = new Streamline(
    process.env.STREAMLINE_BOOTSTRAP_SERVERS || 'localhost:9092',
    {
      httpEndpoint: 'http://localhost:9094',
      clientId: 'node-admin-example',
    },
  );

  await client.connect();
  console.log('Connected to Streamline');

  try {
    // --- Topic Management ---
    console.log('\n=== Topic Management ===');
    await client.createTopic('events', { partitions: 3, replicationFactor: 1 });
    console.log('Created topic "events" with 3 partitions');

    const topics = await client.listTopics();
    console.log('Topics:', topics.map(t => t.name));

    const details = await client.describeTopic('events');
    console.log('Topic details:', details);

    // --- Consumer Groups ---
    console.log('\n=== Consumer Groups ===');
    const groups = await client.listConsumerGroups();
    console.log('Consumer groups:', groups);

    // --- Cluster Info ---
    console.log('\n=== Cluster Info ===');
    const cluster = await client.clusterInfo();
    console.log('Cluster ID:', cluster.clusterId);
    console.log('Brokers:', cluster.brokers);

    // --- Cleanup ---
    await client.deleteTopic('events');
    console.log('\nCleaned up topic "events"');
  } finally {
    await client.close();
  }
}

main().catch(console.error);
