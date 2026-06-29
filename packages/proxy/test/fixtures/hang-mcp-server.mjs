#!/usr/bin/env node
// Downstream whose tools/call never resolves — for timeout tests.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const TOOLS = [
  {
    name: 'slow_tool',
    description: 'A tool that hangs forever',
    inputSchema: { type: 'object', properties: {} },
  },
];

const server = new Server({ name: 'hang', version: '0.0.1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async () => new Promise(() => {}));

await server.connect(new StdioServerTransport());
