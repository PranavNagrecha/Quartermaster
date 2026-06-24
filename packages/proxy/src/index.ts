/**
 * quartermaster-mcp — a drop-in MCP proxy.
 *
 * Exposes ONE meta-tool, `retrieve_tools`, over MCP. It returns a ranked,
 * confidence-annotated shortlist (with descriptions) for a natural-language
 * query, built by the offline @quartermaster/core router — so the client loads
 * one tool instead of every downstream schema. It advises; the host LLM decides.
 *
 * P2-1: the manifest is supplied statically in the config. Downstream federation
 * (spawning real MCP servers, aggregating `tools/list`, forwarding `tools/call`)
 * lands in P2-3 / P2-4.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRouter, type Router, type Tool } from '@quartermaster/core';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { FederatedIndex } from './downstream.js';

export { loadConfig, parseConfig } from './config.js';
export { buildToolIndex, namespaceTools } from './downstream.js';
export type { FederatedIndex } from './downstream.js';

export interface DownstreamServer {
  /** Display id, used to namespace tool names (e.g. `github`). */
  readonly id: string;
  /** Command to launch the downstream MCP server (stdio transport). */
  readonly command: string;
  readonly args?: readonly string[];
}

export interface ProxyConfig {
  /** Static tool manifest (P2-1). Downstream `servers` federation lands in P2-3. */
  readonly tools?: readonly Tool[];
  readonly servers?: readonly DownstreamServer[];
  /** Optional query-expansion synonyms passed to the ranker. */
  readonly synonyms?: Readonly<Record<string, readonly string[]>>;
  /** Shortlist size returned by retrieve_tools. Default 8. */
  readonly k?: number;
}

/** Build the offline router from the config's static tool manifest. Fails LOUD on an empty manifest. */
export function buildStaticRouter(config: ProxyConfig): Router {
  const tools = config.tools ?? [];
  if (tools.length === 0) {
    throw new Error(
      'quartermaster: no tools to index — provide config.tools (static manifest) or config.servers (P2-3 downstream).',
    );
  }
  return createRouter(tools, { synonyms: config.synonyms });
}

/**
 * The `retrieve_tools` result: a confidence-annotated shortlist + guidance.
 * When a `schemas` map (namespaced tool name → JSON inputSchema) is supplied,
 * each candidate is HYDRATED with its `inputSchema` — so the host LLM gets the
 * full tool definition (name + description + schema) for just the shortlist, and
 * can form a `call_tool` request without loading every downstream schema. That
 * hydration is what makes the token win real. Advises, does not decide.
 */
export function retrieveTools(router: Router, query: string, k = 8, schemas?: ReadonlyMap<string, unknown>) {
  const { candidates, confidence, guidance } = router.route(query, k, { includeDescription: true });
  const hydrated = schemas
    ? candidates.map((c) => (schemas.has(c.tool) ? { ...c, inputSchema: schemas.get(c.tool) } : c))
    : candidates;
  return { confidence, guidance, candidates: hydrated };
}

/** Construct the MCP server exposing `retrieve_tools`. The transport is connected by `startServer` / the bin. */
export function createServer(config: ProxyConfig): Server {
  const router = buildStaticRouter(config);
  const defaultK = config.k ?? 8;
  const server = new Server({ name: 'quartermaster-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'retrieve_tools',
        description:
          'Find the most relevant tools for a natural-language task. Returns a ranked, ' +
          'confidence-annotated shortlist (with descriptions) — read it and call the tool you need, ' +
          'instead of loading every tool up front.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What you are trying to do, in natural language.' },
            k: { type: 'number', description: 'Max tools to return (default 8).' },
          },
          required: ['query'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== 'retrieve_tools') {
      throw new Error(`unknown tool: ${req.params.name}`);
    }
    const args = req.params.arguments ?? {};
    const query = (args as Record<string, unknown>).query;
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error('retrieve_tools: `query` (non-empty string) is required.');
    }
    const kRaw = (args as Record<string, unknown>).k;
    const k = typeof kRaw === 'number' && kRaw > 0 ? Math.floor(kRaw) : defaultK;
    const result = retrieveTools(router, query, k);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

/** Boot the proxy over stdio. Used by the bin (P2-5). */
export async function startServer(config: ProxyConfig): Promise<void> {
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
}

/** Resolve a namespaced tool name to its downstream client + bare tool name. Throws on an unknown tool. Pure. */
export function resolveCall(index: FederatedIndex, toolName: string): { client: Client; bareName: string } {
  const serverId = index.toolToServer.get(toolName);
  const client = serverId !== undefined ? index.clients.get(serverId) : undefined;
  if (serverId === undefined || client === undefined) {
    throw new Error(`call_tool: unknown tool "${toolName}". Use retrieve_tools to discover valid names.`);
  }
  return { client, bareName: toolName.slice(serverId.length + 1) };
}

/**
 * The FEDERATED MCP server: exposes `retrieve_tools` (discovery, with hydrated
 * schemas) AND `call_tool` (execution — forwards the chosen namespaced tool to
 * the right downstream client). Invocation model **A** (meta-executor):
 * host-agnostic, two static tools, no dynamic tool-list. Transport connected by
 * the bin (P2-5).
 */
export function createServerFromIndex(index: FederatedIndex, opts: { k?: number } = {}): Server {
  const defaultK = opts.k ?? 8;
  const server = new Server({ name: 'quartermaster-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'retrieve_tools',
        description:
          'Find the most relevant tools for a natural-language task. Returns a ranked, ' +
          'confidence-annotated shortlist with descriptions AND input schemas — read it, then call the ' +
          'tool you need via call_tool. Use this instead of loading every tool up front.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What you are trying to do, in natural language.' },
            k: { type: 'number', description: 'Max tools to return (default 8).' },
          },
          required: ['query'],
        },
      },
      {
        name: 'call_tool',
        description:
          'Invoke a tool discovered via retrieve_tools. Pass its full namespaced name (e.g. ' +
          '"github.create_issue") and its arguments; the call is forwarded to the right downstream server.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Namespaced tool name from retrieve_tools (server.tool).' },
            arguments: { type: 'object', description: "Arguments matching that tool's inputSchema." },
          },
          required: ['name'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = req.params.arguments ?? {};
    if (req.params.name === 'retrieve_tools') {
      const query = (args as Record<string, unknown>).query;
      if (typeof query !== 'string' || query.trim() === '') {
        throw new Error('retrieve_tools: `query` (non-empty string) is required.');
      }
      const kRaw = (args as Record<string, unknown>).k;
      const k = typeof kRaw === 'number' && kRaw > 0 ? Math.floor(kRaw) : defaultK;
      const result = retrieveTools(index.router, query, k, index.schemas);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
    if (req.params.name === 'call_tool') {
      const toolName = (args as Record<string, unknown>).name;
      if (typeof toolName !== 'string') {
        throw new Error('call_tool: `name` (the namespaced server.tool string) is required.');
      }
      const { client, bareName } = resolveCall(index, toolName);
      const toolArgs = (args as Record<string, unknown>).arguments;
      return client.callTool({ name: bareName, arguments: (toolArgs ?? {}) as Record<string, unknown> });
    }
    throw new Error(`unknown tool: ${req.params.name}`);
  });

  return server;
}
