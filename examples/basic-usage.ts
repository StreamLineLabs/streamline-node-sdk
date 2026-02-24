/**
 * Basic example demonstrating Streamline Node.js SDK usage.
 *
 * Ensure a Streamline server is running at localhost:9092 before running:
 *   streamline --playground
 *
 * Run with:
 *   npx tsx examples/basic-usage.ts
 */

import { Streamline, Producer, Consumer } from 'streamline';

async function main() {
  // Create a client
  const client = new Streamline(process.env.STREAMLINE_BOOTSTRAP_SERVERS || 'localhost:9092', {
    httpEndpoint: 'http://localhost:9094',
    clientId: 'node-example',
  });

  await client.connect();
  console.log('Connected to Streamline');

  // --- Produce Messages ---
  console.log('\n=== Producing Messages ===');

  // Simple produce
  const result = await client.produce('my-topic', { event: 'hello', source: 'nodejs' });
  console.log(`Produced at partition=${result.partition}, offset=${result.offset}`);

  // Produce with key and headers
  const result2 = await client.produce('my-topic', { user: 'alice', action: 'signup' }, {
    key: 'user-alice',
    headers: { 'trace-id': 'abc-123' },
  });
  console.log(`Produced with key at offset=${result2.offset}`);

  // --- Batch Produce ---
  console.log('\n=== Batch Producing ===');
  const producer = new Producer(client, 'my-topic', {
    batchSize: 100,
    lingerMs: 10,
    compression: 'none',
  });
  await producer.start();

  for (let i = 0; i < 5; i++) {
    await producer.send({ value: { index: i, timestamp: Date.now() } });
  }
  await producer.flush();
  await producer.close();
  console.log('Produced 5 messages in batch');

  // --- Consume Messages ---
  console.log('\n=== Consuming Messages ===');
  const messages = await client.consumeBatch('my-topic', {
    fromBeginning: true,
    maxMessages: 10,
  });

  for (const msg of messages) {
    console.log(`Received: partition=${msg.partition}, offset=${msg.offset}, value=${JSON.stringify(msg.value)}`);
  }

  // --- List Topics ---
  console.log('\n=== Listing Topics ===');
  const topics = await client.listTopics();
  console.log('Topics:', topics);

  await client.close();
  console.log('\nDone!');
}

main().catch(console.error);
