#!/usr/bin/env node
// Minimal fake downstream MCP server for the P2-6 integration test. Speaks MCP
// over stdio: answers tools/list with a few tools and tools/call with an echo.
// No network. Spawned by buildToolIndex via StdioClientTransport.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const TOOLS = [
  {
    name: 'create_issue',
    description: 'Open a new issue in a repository',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'search_code',
    description: 'Search source code across repositories',
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
  },
  {
    name: 'send_message',
    description: 'Send a message to a chat channel',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  },
];

const server = new Server({ name: 'echo', version: '0.0.1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => ({
  content: [{ type: 'text', text: `echo:${req.params.name}:${JSON.stringify(req.params.arguments ?? {})}` }],
}));

await server.connect(new StdioServerTransport());
