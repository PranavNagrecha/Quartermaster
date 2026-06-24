import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildToolIndex, closeIndex, createServerFromIndex } from '../dist/index.js';

// The real proof: an MCP Client drives OUR federated server THROUGH the protocol
// (tools/list + tools/call over a transport), not via helper functions. Downstream
// is the real spawned echo fixture, linked to the client via an in-memory transport.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'echo-mcp-server.mjs');

let index: Awaited<ReturnType<typeof buildToolIndex>> | undefined;
let client: Client | undefined;

async function getClient(): Promise<Client> {
  if (client) return client;
  index = await buildToolIndex({ servers: [{ id: 'echo', command: process.execPath, args: [FIXTURE] }] });
  const server = createServerFromIndex(index);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'qm-e2e-test', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

const textOf = (res: { content?: { type: string; text?: string }[] }): string => res.content?.[0]?.text ?? '';

after(async () => {
  if (client) await client.close().catch(() => {});
  if (index) await closeIndex(index).catch(() => {});
});

test('e2e: client sees exactly the three meta-tools over MCP', { timeout: 20000 }, async () => {
  const names = (await (await getClient()).listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['call_tool', 'list_servers', 'retrieve_tools']);
});

test('e2e: retrieve_tools returns a hydrated, confidence-annotated shortlist over the wire', async () => {
  const res = await (await getClient()).callTool({ name: 'retrieve_tools', arguments: { query: 'open a new issue' } });
  const payload = JSON.parse(textOf(res));
  assert.equal(payload.candidates[0]?.tool, 'echo.create_issue');
  assert.ok(payload.candidates[0]?.inputSchema, 'inputSchema should be hydrated over the wire');
  assert.ok(['none', 'low', 'high'].includes(payload.confidence));
});

test('e2e: call_tool forwards to the downstream and returns its result over the wire', async () => {
  const res = await (await getClient()).callTool({
    name: 'call_tool',
    arguments: { name: 'echo.create_issue', arguments: { title: 'hi' } },
  });
  assert.match(textOf(res), /^echo:create_issue:/);
  assert.match(textOf(res), /hi/);
});

test('e2e: list_servers reports the connected downstream over the wire', async () => {
  const res = await (await getClient()).callTool({ name: 'list_servers', arguments: {} });
  const payload = JSON.parse(textOf(res));
  assert.ok(payload.servers.some((s: { id: string }) => s.id === 'echo'));
});

test('e2e: a bad call_tool returns isError (not a thrown protocol error)', async () => {
  const res = await (await getClient()).callTool({ name: 'call_tool', arguments: { name: 'echo.nope' } });
  assert.equal(res.isError, true);
});
