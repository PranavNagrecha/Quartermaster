import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyOverlays, buildToolIndex, carryForwardServerSnapshot, interpolateEnv, namespaceTools } from '../dist/index.js'; // built dist — see proxy.test.ts note
import { buildStaticRouter } from '../dist/index.js';

test('applyOverlays merges keyword overlays into the matching tool only', () => {
  const tools = [
    { name: 'gh.create_issue', description: 'Open a new issue' },
    { name: 'gh.search_code', description: 'Search code' },
  ];
  const out = applyOverlays(tools, { 'gh.create_issue': { keywords: 'bug defect' } });
  assert.match(out[0]?.keywords ?? '', /bug defect/);
  assert.equal(out[1]?.keywords, undefined);
});

test('interpolateEnv resolves ${VAR} from the source env', () => {
  const out = interpolateEnv({ TOKEN: '${GH}', LITERAL: 'plain' }, { GH: 'secret123' });
  assert.deepEqual(out, { TOKEN: 'secret123', LITERAL: 'plain' });
});

test('interpolateEnv throws a clear error when a referenced var is unset', () => {
  assert.throws(() => interpolateEnv({ TOKEN: '${MISSING}' }, {}), /env var "MISSING".*not set/);
});

test('namespacing keeps same-bare-name tools from different servers distinct (collision policy)', () => {
  const a = namespaceTools('github', [{ name: 'create_issue', description: 'x' }]);
  const b = namespaceTools('gitlab', [{ name: 'create_issue', description: 'y' }]);
  assert.equal(a[0]?.name, 'github.create_issue');
  assert.equal(b[0]?.name, 'gitlab.create_issue');
  assert.notEqual(a[0]?.name, b[0]?.name); // no collision — distinct namespaced names
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

test('carryForwardServerSnapshot preserves a failed server tools in a rebuild buffer', () => {
  const tools = namespaceTools('alpha', [{ name: 'tool_a', description: 'A' }]);
  const index = {
    router: buildStaticRouter({ tools }),
    clients: new Map(),
    toolToServer: new Map([['alpha.tool_a', 'alpha']]),
    toolToBare: new Map([['alpha.tool_a', 'tool_a']]),
    schemas: new Map([['alpha.tool_a', { type: 'object' }]]),
    lastKnownTools: new Map([['alpha', tools]]),
    skippedServers: [],
    configuredServerCount: 1,
    callTimeoutMs: 30_000,
    maxK: 50,
  };
  const allTools: typeof tools = [];
  const toolToServer = new Map<string, string>();
  const toolToBare = new Map<string, string>();
  const schemas = new Map<string, unknown>();
  carryForwardServerSnapshot(index, 'alpha', allTools, toolToServer, toolToBare, schemas);
  assert.equal(allTools[0]?.name, 'alpha.tool_a');
  assert.equal(toolToServer.get('alpha.tool_a'), 'alpha');
  assert.equal(toolToBare.get('alpha.tool_a'), 'tool_a');
  assert.ok(schemas.has('alpha.tool_a'));
});
