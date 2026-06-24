import assert from 'node:assert/strict';
import { test } from 'node:test';
// Import the built dist (the package as consumed): index re-exports across files
// with NodeNext `.js` specifiers, which raw type-stripping of src can't resolve.
// CI builds before testing; the loop's local flow does too.
import { buildStaticRouter, createServer, createServerFromIndex, forwardCall, resolveCall, retrieveTools } from '../dist/index.js';

/** A minimal fake FederatedIndex (no real downstream — exercises routing only). */
function fakeIndex() {
  return {
    router: buildStaticRouter(CONFIG),
    clients: new Map([['github', { callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }]]),
    toolToServer: new Map([['github.create_issue', 'github']]),
    schemas: new Map([['github.create_issue', { type: 'object' }]]),
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

test('createServerFromIndex builds a federated server without throwing', () => {
  assert.doesNotThrow(() => createServerFromIndex(fakeIndex()));
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
