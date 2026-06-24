/**
 * quartermaster-mcp — a drop-in MCP proxy.
 *
 * Federates N downstream MCP servers behind two meta-tools: `retrieve_tools`
 * (a ranked, schema-hydrated, confidence-annotated shortlist for a natural-language
 * query, built by the offline @pranavnpm/core router) and `call_tool` (forwards
 * the chosen tool to the right downstream). The client loads two tools instead of
 * every downstream schema. It advises; the host LLM decides.
 *
 * Two modes: federated (config `servers` — spawn + aggregate `tools/list` +
 * forward `tools/call`) and static (config `tools` — a fixed manifest, discovery only).
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRouter, type Router, type Tool } from '@pranavnpm/core';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { loadConfig, parseConfig } from './config.js';
import { applyOverlays, buildToolIndex, interpolateEnv, namespaceTools } from './downstream.js';
import type { FederatedIndex } from './downstream.js';

export { loadConfig, parseConfig };
export { buildToolIndex, namespaceTools, interpolateEnv, applyOverlays };
export type { FederatedIndex } from './downstream.js';

export interface DownstreamServer {
  /** Display id, used to namespace tool names (e.g. `github`). */
  readonly id: string;
  /** Command to launch the downstream MCP server (stdio transport). */
  readonly command: string;
  readonly args?: readonly string[];
  /** Environment for the child process. Values may reference `${VAR}`, resolved from process.env at connect time. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ProxyConfig {
  /** Static tool manifest (P2-1). Downstream `servers` federation lands in P2-3. */
  readonly tools?: readonly Tool[];
  readonly servers?: readonly DownstreamServer[];
  /** Optional query-expansion synonyms passed to the ranker. */
  readonly synonyms?: Readonly<Record<string, readonly string[]>>;
  /** Optional per-tool keyword overlays (namespaced name → `{ keywords }`) to tune recall without touching downstream servers. */
  readonly overlays?: Readonly<Record<string, { readonly keywords?: string }>>;
  /** Path to an external JSON synonyms map, resolved relative to the config file; merged under inline `synonyms`. */
  readonly synonymsFile?: string;
  /** Path to an external JSON overlays map, resolved relative to the config file; merged under inline `overlays`. */
  readonly overlaysFile?: string;
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
  return createRouter(applyOverlays(tools, config.overlays), { synonyms: config.synonyms });
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
      return errorResult(`unknown tool: ${req.params.name}`);
    }
    const args = req.params.arguments ?? {};
    const query = (args as Record<string, unknown>).query;
    if (typeof query !== 'string' || query.trim() === '') {
      return errorResult('retrieve_tools: `query` (non-empty string) is required.');
    }
    const kRaw = (args as Record<string, unknown>).k;
    const k = typeof kRaw === 'number' && kRaw > 0 ? Math.floor(kRaw) : defaultK;
    const result = retrieveTools(router, query, k);
    return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

/** Boot the proxy over stdio. Used by the bin (P2-5). */
export async function startServer(config: ProxyConfig): Promise<void> {
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
}

/** Resolve a namespaced tool name to its downstream client + bare tool name (looked up, not derived). Throws on an unknown tool. Pure. */
export function resolveCall(index: FederatedIndex, toolName: string): { client: Client; bareName: string } {
  const serverId = index.toolToServer.get(toolName);
  const bareName = index.toolToBare.get(toolName);
  const client = serverId !== undefined ? index.clients.get(serverId) : undefined;
  if (serverId === undefined || client === undefined || bareName === undefined) {
    throw new Error(`call_tool: unknown tool "${toolName}". Use retrieve_tools to discover valid names.`);
  }
  return { client, bareName };
}

/** Per-server summary (connected id + tool count) for the `list_servers` meta-tool. Pure. */
export function serverSummary(index: FederatedIndex): { id: string; toolCount: number }[] {
  const counts = new Map<string, number>();
  for (const id of index.clients.keys()) counts.set(id, 0);
  for (const id of index.toolToServer.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, toolCount]) => ({ id, toolCount }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** An MCP tool-error result — the host sees a recoverable tool error, not a thrown protocol error. */
function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: `quartermaster: ${message}` }], isError: true };
}

/**
 * Forward a chosen namespaced tool to its downstream client. Any failure (unknown
 * tool, or the downstream throwing) is returned as an `isError` tool result
 * rather than thrown, so one bad call never takes down the proxy session.
 */
export async function forwardCall(index: FederatedIndex, toolName: string, args: Record<string, unknown>) {
  let target: { client: Client; bareName: string };
  try {
    target = resolveCall(index, toolName);
  } catch (e) {
    return errorResult((e as Error).message);
  }
  try {
    return await target.client.callTool({ name: target.bareName, arguments: args });
  } catch (e) {
    return errorResult(`call to "${toolName}" failed: ${(e as Error).message}`);
  }
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
      {
        name: 'list_servers',
        description:
          'List the connected downstream MCP servers and how many tools each contributes — for debugging routing. Takes no arguments.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = req.params.arguments ?? {};
    if (req.params.name === 'retrieve_tools') {
      const query = (args as Record<string, unknown>).query;
      if (typeof query !== 'string' || query.trim() === '') {
        return errorResult('retrieve_tools: `query` (non-empty string) is required.');
      }
      const kRaw = (args as Record<string, unknown>).k;
      const k = typeof kRaw === 'number' && kRaw > 0 ? Math.floor(kRaw) : defaultK;
      const result = retrieveTools(index.router, query, k, index.schemas);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
    if (req.params.name === 'call_tool') {
      const toolName = (args as Record<string, unknown>).name;
      if (typeof toolName !== 'string') {
        return errorResult('call_tool: `name` (the namespaced server.tool string) is required.');
      }
      const toolArgs = (args as Record<string, unknown>).arguments;
      return forwardCall(index, toolName, (toolArgs ?? {}) as Record<string, unknown>);
    }
    if (req.params.name === 'list_servers') {
      const payload = { servers: serverSummary(index), totalTools: index.toolToServer.size };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    }
    return errorResult(`unknown tool: ${req.params.name}`);
  });

  return server;
}

/** Parse the CLI args. Returns the config path or throws a usage error. Pure. */
export function parseCliArgs(argv: readonly string[]): { config: string } {
  let config: string | undefined;
  for (const [i, a] of argv.entries()) {
    if (a === '--config') config = argv[i + 1];
    else if (a.startsWith('--config=')) config = a.slice('--config='.length);
  }
  if (config === undefined || config === '') {
    throw new Error('usage: quartermaster-mcp --config <path-to-quartermaster.json>');
  }
  return { config };
}

/** Close every downstream client (terminates their child processes). Never rejects. */
export async function closeIndex(index: FederatedIndex): Promise<void> {
  await Promise.allSettled([...index.clients.values()].map((client) => client.close()));
}

/**
 * Load a config and boot the proxy over stdio. Federated mode when the config has
 * `servers` (spawns + aggregates them, and closes them cleanly on SIGINT/SIGTERM);
 * static mode when it has `tools`.
 */
export async function startFromConfig(configPath: string): Promise<void> {
  const config = loadConfig(configPath);
  const federated = (config.servers?.length ?? 0) > 0;
  let server: Server;
  if (federated) {
    const index = await buildToolIndex(config);
    server = createServerFromIndex(index, { k: config.k });
    const shutdown = (): void => {
      void closeIndex(index).finally(() => process.exit(0));
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } else {
    server = createServer(config);
  }
  await server.connect(new StdioServerTransport());
  console.error(`quartermaster-mcp: ready (${federated ? 'federated' : 'static'} mode).`);
}

/** CLI entry: parse args, boot the server, and on failure log to stderr + set a non-zero exit code (never throws). */
export async function runCli(argv: readonly string[]): Promise<void> {
  try {
    const { config } = parseCliArgs(argv);
    await startFromConfig(config);
  } catch (e) {
    console.error(`quartermaster-mcp: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
