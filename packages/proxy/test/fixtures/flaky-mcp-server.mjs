#!/usr/bin/env node
// Downstream that fails tools/list after QM_FLAKY_AFTER successful polls (default: never fail).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const TOOLS = [
  {
    name: 'create_issue',
    description: 'Open a new issue in a repository',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
];

let listCount = 0;
const failAfter = Number(process.env.QM_FLAKY_AFTER ?? '0');

const server = new Server({ name: 'flaky', version: '0.0.1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => {
  listCount += 1;
  if (failAfter > 0 && listCount > failAfter) {
    throw new Error('simulated tools/list failure');
  }
  return { tools: TOOLS };
});
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: 'text', text: `flaky:${req.params.name}` }],
}));

await server.connect(new StdioServerTransport());
