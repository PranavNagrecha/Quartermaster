#!/usr/bin/env node
// Exits unless QM_DELAYED_READY=1 — simulates a downstream unavailable at boot.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

if (process.env.QM_DELAYED_READY !== '1') {
  console.error('delayed-start: not ready');
  process.exit(1);
}

const TOOLS = [
  {
    name: 'ping',
    description: 'Respond to a ping',
    inputSchema: { type: 'object', properties: {} },
  },
];

const server = new Server({ name: 'delayed', version: '0.0.1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: 'delayed:pong' }],
}));

await server.connect(new StdioServerTransport());
