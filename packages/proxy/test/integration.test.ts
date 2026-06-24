import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildToolIndex, forwardCall } from '../dist/index.js'; // built dist — see proxy.test.ts note

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'echo-mcp-server.mjs');

// Real spawn: federate one fake downstream MCP server over stdio. Built once.
let index;
async function getIndex() {
  index ??= await buildToolIndex({ servers: [{ id: 'echo', command: process.execPath, args: [FIXTURE] }] });
  return index;
}

after(async () => {
  if (!index) return;
  for (const client of index.clients.values()) {
    if (typeof client.close === 'function') await client.close().catch(() => {});
  }
});

test('buildToolIndex spawns the downstream and aggregates namespaced tools + schemas', async () => {
  const idx = await getIndex();
  assert.equal(idx.toolToServer.get('echo.create_issue'), 'echo');
  assert.ok(idx.schemas.has('echo.create_issue'));
  const names = idx.router.search('issue', 8).map((c) => c.tool);
  assert.ok(names.includes('echo.create_issue'));
});

test('the router ranks the right downstream tool for a natural-language query', async () => {
  const idx = await getIndex();
  assert.equal(idx.router.route('open a new issue', 5).candidates[0]?.tool, 'echo.create_issue');
});

test('forwardCall executes the tool on the downstream and returns its content', async () => {
  const idx = await getIndex();
  const res = await forwardCall(idx, 'echo.create_issue', { title: 'hello' });
  assert.ok(!res.isError);
  assert.match(res.content[0]?.text ?? '', /^echo:create_issue:/);
  assert.match(res.content[0]?.text ?? '', /hello/);
});

test('forwardCall on an unknown tool returns an isError result (no crash)', async () => {
  const idx = await getIndex();
  const res = await forwardCall(idx, 'echo.does_not_exist', {});
  assert.equal(res.isError, true);
});
