import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildToolIndex, interpolateEnv, namespaceTools } from '../dist/index.js'; // built dist — see proxy.test.ts note

test('interpolateEnv resolves ${VAR} from the source env', () => {
  const out = interpolateEnv({ TOKEN: '${GH}', LITERAL: 'plain' }, { GH: 'secret123' });
  assert.deepEqual(out, { TOKEN: 'secret123', LITERAL: 'plain' });
});

test('interpolateEnv throws a clear error when a referenced var is unset', () => {
  assert.throws(() => interpolateEnv({ TOKEN: '${MISSING}' }, {}), /env var "MISSING".*not set/);
});

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
