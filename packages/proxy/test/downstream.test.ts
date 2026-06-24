import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildToolIndex, namespaceTools } from '../dist/index.js'; // built dist — see proxy.test.ts note

test('namespaceTools prefixes names with the server id and tags category', () => {
  const out = namespaceTools('github', [
    { name: 'create_issue', description: 'Open a new issue' },
    { name: 'search_code' },
  ]);
  assert.equal(out[0]?.name, 'github.create_issue');
  assert.equal(out[0]?.category, 'github');
  assert.equal(out[0]?.description, 'Open a new issue');
  assert.equal(out[1]?.name, 'github.search_code');
  assert.equal(out[1]?.description, undefined);
});

test('buildToolIndex fails loud when no servers are configured', async () => {
  await assert.rejects(() => buildToolIndex({ servers: [] }), /no servers configured/);
});

// A real spawn + tools/list aggregation test (with a fake downstream fixture)
// lands in P2-6 (integration). Here we cover the pure namespacing + the
// fail-loud guards.
