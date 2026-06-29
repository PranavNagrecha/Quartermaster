#!/usr/bin/env node
// Stateless streamable-HTTP MCP server for federation tests. Prints QM_HTTP_PORT=<port> on stderr.
import http from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const TOOLS = [
  {
    name: 'create_issue',
    description: 'Open a new issue in a repository',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
  },
];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString();
      if (text === '') {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function createMcpServer() {
  const server = new Server({ name: 'http-echo', version: '0.0.1' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => ({
    content: [{ type: 'text', text: `http:${req.params.name}:${JSON.stringify(req.params.arguments ?? {})}` }],
  }));
  return server;
}

const httpServer = http.createServer(async (req, res) => {
  const path = req.url?.split('?')[0];
  if (path !== '/mcp') {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const parsedBody = req.method === 'POST' ? await readBody(req) : undefined;
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
  } catch (e) {
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(String(e));
    }
  }
});

httpServer.listen(0, '127.0.0.1', () => {
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  console.error(`QM_HTTP_PORT=${port}`);
});
