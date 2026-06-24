import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/index.js';

const CONFIG = {
  tools: [
    { name: 'github.create_issue', description: 'Open a new issue in a repository' },
    { name: 'slack.post_message', description: 'Send a message to a Slack channel' },
  ],
  synonyms: { bug: ['issue'] },
};

const textOf = (res: { content?: { type: string; text?: string }[] }): string => res.content?.[0]?.text ?? '';

test('static e2e: client sees only retrieve_tools over MCP', async () => {
  const server = createServer(CONFIG);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'qm-static-e2e', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.deepEqual(names, ['retrieve_tools']);
  await client.close();
});

test('static e2e: retrieve_tools returns ranked shortlist without call_tool', async () => {
  const server = createServer(CONFIG);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'qm-static-e2e', version: '0.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  const res = await client.callTool({ name: 'retrieve_tools', arguments: { query: 'file a bug' } });
  const payload = JSON.parse(textOf(res));
  assert.equal(payload.candidates[0]?.tool, 'github.create_issue');
  await client.close();
});
