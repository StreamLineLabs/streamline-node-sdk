/**
 * Streamline Agent Memory Example.
 *
 * Demonstrates the memory MCP tools (remember, recall) for building
 * agents with persistent, semantically searchable memory. Shows both
 * single-agent memory and multi-agent shared memory via namespaces.
 *
 * Ensure a Streamline server is running with memory features enabled:
 *   streamline --playground
 *
 * Run with:
 *   npx tsx examples/agent-memory.ts
 */

import { Streamline } from 'streamline';

async function singleAgentMemory(client: Streamline): Promise<void> {
  console.log('=== Single Agent Memory ===');

  // Store architectural decisions
  await client.memoryRemember({
    agentId: 'demo-agent',
    content: 'We chose PostgreSQL for its JSONB support and mature ecosystem',
    kind: 'fact',
    importance: 0.8,
    tags: ['architecture', 'database'],
  });

  await client.memoryRemember({
    agentId: 'demo-agent',
    content: 'Redis is used as a caching layer with a 15-minute TTL',
    kind: 'fact',
    importance: 0.7,
    tags: ['architecture', 'caching'],
  });

  await client.memoryRemember({
    agentId: 'demo-agent',
    content: 'User requested dark mode support in the dashboard',
    kind: 'preference',
    importance: 0.6,
    tags: ['ui', 'user-request'],
  });

  console.log('Stored 3 memories\n');

  // Recall by semantic similarity
  console.log("--- Recall: 'why did we pick our database?' ---");
  const dbResults = await client.memoryRecall({
    agentId: 'demo-agent',
    query: 'why did we pick our database?',
    k: 5,
  });
  for (const hit of dbResults) {
    console.log(`  [${hit.tier}] score=${hit.score.toFixed(2)}: ${hit.content}`);
  }

  console.log("\n--- Recall: 'caching strategy' ---");
  const cacheResults = await client.memoryRecall({
    agentId: 'demo-agent',
    query: 'caching strategy',
    k: 5,
  });
  for (const hit of cacheResults) {
    console.log(`  [${hit.tier}] score=${hit.score.toFixed(2)}: ${hit.content}`);
  }
}

async function multiAgentSharedMemory(client: Streamline): Promise<void> {
  console.log('\n=== Multi-Agent Shared Memory ===');

  // Agent A stores a decision in the shared namespace
  await client.memoryRemember({
    agentId: 'agent-a',
    namespace: 'team-shared',
    content: 'Deploy target is Kubernetes on AWS EKS',
    kind: 'fact',
    importance: 0.9,
    tags: ['infra', 'deployment'],
  });
  console.log('Agent A stored deployment decision');

  // Agent B stores related context in the same namespace
  await client.memoryRemember({
    agentId: 'agent-b',
    namespace: 'team-shared',
    content: 'CI/CD pipeline uses GitHub Actions with OIDC auth to AWS',
    kind: 'fact',
    importance: 0.8,
    tags: ['infra', 'ci-cd'],
  });
  console.log('Agent B stored CI/CD context');

  // Agent C recalls shared memories from the team namespace
  console.log("\n--- Agent C recalls 'deployment infrastructure' from shared namespace ---");
  const results = await client.memoryRecall({
    agentId: 'agent-c',
    namespace: 'team-shared',
    query: 'deployment infrastructure',
    k: 5,
  });
  for (const hit of results) {
    console.log(`  [${hit.tier}] score=${hit.score.toFixed(2)}: ${hit.content}`);
  }
}

async function main(): Promise<void> {
  const client = new Streamline(
    process.env.STREAMLINE_BOOTSTRAP_SERVERS || 'localhost:9092',
    {
      httpEndpoint: process.env.STREAMLINE_HTTP || 'http://localhost:9094',
      clientId: 'agent-memory-example',
    },
  );

  await client.connect();
  console.log('Connected to Streamline\n');

  await singleAgentMemory(client);
  await multiAgentSharedMemory(client);

  await client.close();
  console.log('\nDone!');
}

main().catch(console.error);
