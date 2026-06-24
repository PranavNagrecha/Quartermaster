#!/usr/bin/env node
// See the ranker work in ~5 seconds — no MCP host required.
// From the repo root:  pnpm -r build && node examples/static-demo/demo.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouter } from '../../packages/core/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, 'quartermaster.json'), 'utf8'));

const router = createRouter(config.tools, { synonyms: config.synonyms ?? {} });
const queries = [
  'file a bug on the repo',
  'send a dm to the team',
  'schedule a meeting tomorrow',
  'zzz totally unrelated nonsense',
];

console.log('Quartermaster static demo — route() shortlists\n');

for (const query of queries) {
  const { confidence, guidance, candidates } = router.route(query, config.k ?? 5, {
    includeDescription: true,
  });
  console.log(`Query: "${query}"`);
  console.log(`  confidence: ${confidence}`);
  if (candidates.length === 0) {
    console.log('  (no candidates)');
  } else {
    for (const c of candidates) {
      console.log(`  • ${c.tool}  (score ${c.score})`);
    }
  }
  console.log(`  guidance: ${guidance.slice(0, 80)}…\n`);
}
