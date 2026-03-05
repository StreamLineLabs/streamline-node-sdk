/**
 * Schema Registry example demonstrating Avro schema management and
 * validated produce/consume with the Streamline Node.js SDK.
 *
 * Ensure a Streamline server is running at localhost:9092 with the
 * schema registry enabled on port 9094 before running:
 *   streamline --playground
 *
 * Run with:
 *   npx tsx examples/schema-registry.ts
 */

import { Streamline, SchemaRegistry } from 'streamline';

// Avro schema for a User record
const USER_SCHEMA = JSON.stringify({
  type: 'record',
  name: 'User',
  namespace: 'com.streamline.examples',
  fields: [
    { name: 'id', type: 'int' },
    { name: 'name', type: 'string' },
    { name: 'email', type: 'string' },
    { name: 'created_at', type: 'string' },
  ],
});

const SUBJECT = 'users-value';
const TOPIC = 'users';

interface User {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

async function main() {
  // === 1. Create the Streamline client and schema registry ===
  const client = new Streamline(
    process.env.STREAMLINE_BOOTSTRAP_SERVERS || 'localhost:9092',
    {
      httpEndpoint: 'http://localhost:9094',
      clientId: 'node-schema-example',
    },
  );

  const registry = new SchemaRegistry(
    process.env.STREAMLINE_SCHEMA_REGISTRY_URL || 'http://localhost:9094',
  );

  await client.connect();
  console.log('Connected to Streamline');

  // === 2. Register an Avro schema ===
  console.log('\n=== Registering Schema ===');
  const schemaId = await registry.register(SUBJECT, USER_SCHEMA, 'AVRO');
  console.log(`Registered schema with id=${schemaId} for subject=${SUBJECT}`);

  // Retrieve the schema back by id
  const retrieved = await registry.getSchema(schemaId);
  console.log(`Retrieved schema: ${retrieved}`);

  // === 3. Check schema compatibility ===
  console.log('\n=== Checking Compatibility ===');
  const compatible = await registry.checkCompatibility(SUBJECT, USER_SCHEMA, 'AVRO');
  console.log(`Schema compatible: ${compatible}`);

  // === 4. Produce messages with schema validation ===
  console.log('\n=== Producing Messages with Schema ===');
  for (let i = 0; i < 5; i++) {
    const user: User = {
      id: i,
      name: `user-${i}`,
      email: `user${i}@example.com`,
      created_at: '2025-01-15T10:00:00Z',
    };

    const result = await client.produce(TOPIC, user, {
      key: `user-${i}`,
      schemaId,
    });
    console.log(
      `Produced user-${i} at partition=${result.partition}, offset=${result.offset}`,
    );
  }

  // === 5. Consume and deserialize with schema ===
  console.log('\n=== Consuming Messages with Schema ===');
  const messages = await client.consumeBatch(TOPIC, {
    fromBeginning: true,
    maxMessages: 10,
    schemaRegistry: registry,
  });

  for (const msg of messages) {
    const user = msg.value as User;
    console.log(
      `Received: partition=${msg.partition}, offset=${msg.offset}, ` +
        `user={id:${user.id}, name:${user.name}, email:${user.email}}`,
    );
  }

  await client.close();
  console.log('\nDone!');
}

main().catch(console.error);
