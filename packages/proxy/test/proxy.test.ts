import assert from 'node:assert/strict';
import { test } from 'node:test';
// Import the built dist (the package as consumed): index re-exports across files
// with NodeNext `.js` specifiers, which raw type-stripping of src can't resolve.
// CI builds before testing; the loop's local flow does too.
import { buildStaticRouter, clampK, closeIndex, createServer, createServerFromIndex, forwardCall, listServersPayload, resolveCall, retrieveTools, serverSummary } from '../dist/index.js';

/** A minimal fake FederatedIndex (no real downstream — exercises routing only). */
function fakeIndex(overrides: Record<string, unknown> = {}) {
  const tools = [{ name: 'github.create_issue', description: 'Open a new issue in a repository', category: 'github' }];
  return {
    router: buildStaticRouter(CONFIG),
    clients: new Map([['github', { callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }]]),
    toolToServer: new Map([['github.create_issue', 'github']]),
    toolToBare: new Map([['github.create_issue', 'create_issue']]),
    schemas: new Map([['github.create_issue', { type: 'object' }]]),
    lastKnownTools: new Map([['github', tools]]),
    catalogTools: tools,
    retrieveByTraceId: new Map(),
    skippedServers: [],
    configuredServerCount: 1,
    callTimeoutMs: 30_000,
    maxK: 50,
    serverById: new Map([['github', { id: 'github', command: 'noop', transport: 'stdio' as const }]]),
    circuitBreakers: new Map(),
    semaphores: new Map(),
    ...overrides,
  };
}

const CONFIG = {
  tools: [
    { name: 'github.create_issue', description: 'Open a new issue in a repository' },
    { name: 'slack.post_message', description: 'Send a message to a Slack channel' },
    { name: 'calendar.create_event', description: 'Add an event to the calendar' },
  ],
  synonyms: { bug: ['issue'] },
};

test('buildStaticRouter fails loud on an empty manifest', () => {
  assert.throws(() => buildStaticRouter({ tools: [] }), /no tools to index/);
});

test('config overlays let an operator tune recall (P2-10)', () => {
  const router = buildStaticRouter({
    tools: [{ name: 'gh.create_issue', description: 'Open a new issue' }],
    overlays: { 'gh.create_issue': { keywords: 'bug defect report' } },
  });
  // "bug" isn't in the description; the overlay keyword makes it match.
  assert.equal(router.search('file a bug', 5)[0]?.tool, 'gh.create_issue');
});

test('retrieveTools returns a confidence-annotated shortlist with descriptions', () => {
  const router = buildStaticRouter(CONFIG);
  const res = retrieveTools(router, 'file a bug', 5);
  assert.ok(['none', 'low', 'high'].includes(res.confidence));
  assert.equal(typeof res.guidance, 'string');
  assert.ok(res.candidates.length > 0);
  assert.equal(res.candidates[0]?.tool, 'github.create_issue');
  assert.equal(res.candidates[0]?.description, 'Open a new issue in a repository');
});

test('retrieveTools reports none when nothing matches', () => {
  const router = buildStaticRouter(CONFIG);
  assert.equal(retrieveTools(router, 'zzzqqq unrelated nonsense', 5).confidence, 'none');
});

test('createServer builds without throwing for a valid config', () => {
  assert.doesNotThrow(() => createServer(CONFIG));
});

test('retrieveTools hydrates candidates with inputSchema when a schemas map is given', () => {
  const router = buildStaticRouter(CONFIG);
  const schema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };
  const schemas = new Map([['github.create_issue', schema]]);
  const top = retrieveTools(router, 'file a bug', 5, schemas).candidates[0];
  assert.equal(top?.tool, 'github.create_issue');
  assert.deepEqual((top as { inputSchema?: unknown }).inputSchema, schema);
});

test('retrieveTools omits inputSchema when no schemas map is given', () => {
  const router = buildStaticRouter(CONFIG);
  const top = retrieveTools(router, 'file a bug', 5).candidates[0];
  assert.equal((top as { inputSchema?: unknown }).inputSchema, undefined);
});

// Invocation model A — call_tool routing (P2-9).
test('resolveCall maps a namespaced tool to its client + bare name', () => {
  const { bareName } = resolveCall(fakeIndex(), 'github.create_issue');
  assert.equal(bareName, 'create_issue');
});

test('resolveCall throws on an unknown tool', () => {
  assert.throws(() => resolveCall(fakeIndex(), 'nope.tool'), /unknown tool/);
});

// P2-18: bare name is looked up from the index, not derived by slicing — robust to dotted names.
test('resolveCall returns the indexed bare name verbatim (handles dotted names)', () => {
  const idx = {
    router: buildStaticRouter(CONFIG),
    clients: new Map([['srv', { callTool: async () => ({ content: [] }) }]]),
    toolToServer: new Map([['srv.weird.tool.name', 'srv']]),
    toolToBare: new Map([['srv.weird.tool.name', 'weird.tool.name']]),
    schemas: new Map(),
    lastKnownTools: new Map(),
    catalogTools: [],
    retrieveByTraceId: new Map(),
    skippedServers: [],
    configuredServerCount: 1,
    callTimeoutMs: 30_000,
    maxK: 50,
  };
  assert.equal(resolveCall(idx, 'srv.weird.tool.name').bareName, 'weird.tool.name');
});

test('createServerFromIndex builds a federated server without throwing', () => {
  assert.doesNotThrow(() => createServerFromIndex(fakeIndex()));
});

test('serverSummary reports connected servers with tool counts (P2-16)', () => {
  assert.deepEqual(serverSummary(fakeIndex()), [{ id: 'github', toolCount: 1 }]);
});

test('listServersPayload reports degraded when servers were skipped at boot', () => {
  const idx = fakeIndex();
  idx.skippedServers.push({ id: 'jira', reason: 'connection refused' });
  idx.configuredServerCount = 2;
  const payload = listServersPayload(idx);
  assert.equal(payload.degraded, true);
  assert.equal(payload.skipped.length, 1);
  assert.equal(payload.totalTools, 1);
});

// Forwarding hardening (P2-4): failures come back as isError results, never thrown.
test('forwardCall returns the downstream result on success', async () => {
  const res = await forwardCall(fakeIndex(), 'github.create_issue', {});
  assert.ok(!res.isError);
  assert.equal(res.content[0]?.text, 'ok');
});

test('forwardCall returns an isError result when the downstream throws', async () => {
  const idx = fakeIndex();
  idx.clients.set('github', { callTool: async () => { throw new Error('boom'); } });
  const res = await forwardCall(idx, 'github.create_issue', {});
  assert.equal(res.isError, true);
  assert.match(res.content[0]?.text ?? '', /failed: boom/);
});

test('forwardCall returns an isError result for an unknown tool', async () => {
  const res = await forwardCall(fakeIndex(), 'nope.tool', {});
  assert.equal(res.isError, true);
  assert.match(res.content[0]?.text ?? '', /unknown tool/);
});

test('forwardCall times out when the downstream hangs', { timeout: 5000 }, async () => {
  const idx = fakeIndex({
    clients: new Map([['github', { callTool: async () => new Promise(() => {}) }]]),
    callTimeoutMs: 50,
  });
  const res = await forwardCall(idx, 'github.create_issue', {}, { callTimeoutMs: 50 });
  assert.equal(res.isError, true);
  assert.match(res.content[0]?.text ?? '', /timed out after 50ms/);
});

test('clampK caps oversized shortlist requests', () => {
  assert.equal(clampK(9999, 8, 50), 50);
  assert.equal(clampK(undefined, 8, 50), 8);
  assert.equal(clampK(3, 8, 50), 3);
});

// Clean shutdown (P2-7).
test('closeIndex closes every downstream client', async () => {
  let closed = 0;
  const idx = {
    router: buildStaticRouter(CONFIG),
    clients: new Map([
      ['a', { close: async () => { closed++; } }],
      ['b', { close: async () => { closed++; } }],
    ]),
    toolToServer: new Map(),
    toolToBare: new Map(),
    schemas: new Map(),
    lastKnownTools: new Map(),
    catalogTools: [],
    retrieveByTraceId: new Map(),
    skippedServers: [],
    configuredServerCount: 2,
    callTimeoutMs: 30_000,
    maxK: 50,
  };
  await closeIndex(idx);
  assert.equal(closed, 2);
});

test('closeIndex tolerates a client whose close rejects', async () => {
  const idx = {
    router: buildStaticRouter(CONFIG),
    clients: new Map([['a', { close: async () => { throw new Error('boom'); } }]]),
    toolToServer: new Map(),
    toolToBare: new Map(),
    schemas: new Map(),
    lastKnownTools: new Map(),
    catalogTools: [],
    retrieveByTraceId: new Map(),
    skippedServers: [],
    configuredServerCount: 1,
    callTimeoutMs: 30_000,
    maxK: 50,
  };
  await assert.doesNotReject(() => closeIndex(idx));
});
