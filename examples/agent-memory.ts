/**
 * Streamline Agent Memory Example.
 *
 * Demonstrates the memory HTTP API (`remember`, `recall`) for building agents
 * with persistent, semantically searchable memory, and how several agents can
 * write into the same memory store while recalling with their own agent id.
 *
 * Ensure a Streamline server is running with memory features enabled:
 *   streamline --playground
 *
 * Run with:
 *   npx tsx examples/agent-memory.ts
 */

import { MemoryClient } from '@streamlinelabs/sdk';

async function singleAgentMemory(memory: MemoryClient): Promise<void> {
  console.log('=== Single Agent Memory ===');

  // Store architectural decisions
  await memory.remember({
    agentId: 'demo-agent',
    content: 'We chose PostgreSQL for its JSONB support and mature ecosystem',
    kind: 'fact',
    importance: 0.8,
    tags: ['architecture', 'database'],
  });

  await memory.remember({
    agentId: 'demo-agent',
    content: 'Redis is used as a caching layer with a 15-minute TTL',
    kind: 'fact',
    importance: 0.7,
    tags: ['architecture', 'caching'],
  });

  await memory.remember({
    agentId: 'demo-agent',
    content: 'User requested dark mode support in the dashboard',
    kind: 'observation',
    importance: 0.6,
    tags: ['ui', 'user-request'],
  });

  console.log('Stored 3 memories\n');

  // Recall by semantic similarity
  console.log("--- Recall: 'why did we pick our database?' ---");
  const dbResults = await memory.recall({
    agentId: 'demo-agent',
    query: 'why did we pick our database?',
    k: 5,
  });
  for (const hit of dbResults) {
    console.log(`  [${hit.tier}] score=${hit.score.toFixed(2)}: ${hit.content}`);
  }

  console.log("\n--- Recall: 'caching strategy' ---");
  const cacheResults = await memory.recall({
    agentId: 'demo-agent',
    query: 'caching strategy',
    k: 5,
  });
  for (const hit of cacheResults) {
    console.log(`  [${hit.tier}] score=${hit.score.toFixed(2)}: ${hit.content}`);
  }
}

async function multiAgentMemory(memory: MemoryClient): Promise<void> {
  console.log('\n=== Multi-Agent Memory ===');

  // Each agent owns its memories; recall is scoped by agent id.
  await memory.remember({
    agentId: 'agent-a',
    content: 'Deploy target is Kubernetes on AWS EKS',
    kind: 'fact',
    importance: 0.9,
    tags: ['infra', 'deployment'],
  });
  console.log('Agent A stored deployment decision');

  await memory.remember({
    agentId: 'agent-b',
    content: 'CI/CD pipeline uses GitHub Actions with OIDC auth to AWS',
    kind: 'fact',
    importance: 0.8,
    tags: ['infra', 'ci-cd'],
  });
  console.log('Agent B stored CI/CD context');

  console.log("\n--- Agent A recalls 'deployment infrastructure' ---");
  const results = await memory.recall({
    agentId: 'agent-a',
    query: 'deployment infrastructure',
    k: 5,
  });
  for (const hit of results) {
    console.log(`  [${hit.tier}] score=${hit.score.toFixed(2)}: ${hit.content}`);
  }
}

async function main(): Promise<void> {
  const memory = new MemoryClient({
    httpUrl: process.env['STREAMLINE_HTTP'] ?? 'http://localhost:9094',
  });

  await singleAgentMemory(memory);
  await multiAgentMemory(memory);

  console.log('\nDone!');
}

main().catch(console.error);
