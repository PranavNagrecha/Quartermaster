/**
 * Downstream federation (P2-3): connect each configured MCP server over stdio,
 * read its `tools/list`, and aggregate every tool — namespaced `${serverId}.${name}`
 * — into one corpus the router ranks over. The per-tool → server map lets the
 * proxy forward a chosen tool back to the right downstream (call routing, P2-4).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRouter, type Router, type Tool } from '@quartermaster/core';
import type { DownstreamServer, ProxyConfig } from './index.js';

/**
 * Resolve `${VAR}` references in a config env map from `source` (default
 * `process.env`). Literal values pass through unchanged; an unset `${VAR}` throws
 * a clear error rather than silently launching a server without its token. Pure.
 */
export function interpolateEnv(
  env: Readonly<Record<string, string>>,
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(env)) {
    out[key] = raw.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      const value = source[name];
      if (value === undefined) {
        throw new Error(`quartermaster: env var "${name}" (referenced by env."${key}") is not set in the environment.`);
      }
      return value;
    });
  }
  return out;
}

/** Namespace a downstream server's tools as `${serverId}.${name}` and tag their category. Pure. */
export function namespaceTools(
  serverId: string,
  rawTools: ReadonlyArray<{ name: string; description?: string }>,
): Tool[] {
  return rawTools.map((t) => ({
    name: `${serverId}.${t.name}`,
    description: t.description,
    category: serverId,
  }));
}

/** The result of federating downstream servers: the router plus the maps needed to forward calls + manage lifecycle. */
export interface FederatedIndex {
  readonly router: Router;
  /** server id → connected client (for forwarding in P2-4 + shutdown in P2-7). */
  readonly clients: Map<string, Client>;
  /** namespaced tool name → owning server id (for call routing). */
  readonly toolToServer: Map<string, string>;
  /** namespaced tool name → bare downstream tool name (captured at index time, not derived). */
  readonly toolToBare: Map<string, string>;
  /** namespaced tool name → JSON inputSchema (for schema hydration in retrieve_tools). */
  readonly schemas: Map<string, unknown>;
}

async function connectDownstream(
  server: DownstreamServer,
): Promise<{ client: Client; tools: Tool[]; schemas: Map<string, unknown>; bare: Map<string, string> }> {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ? [...server.args] : [],
    env: { ...getDefaultEnvironment(), ...(server.env ? interpolateEnv(server.env) : {}) },
  });
  const client = new Client({ name: 'quartermaster-mcp', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  const raw = (await client.listTools()).tools ?? [];
  const schemas = new Map<string, unknown>();
  const bare = new Map<string, string>();
  for (const t of raw) {
    const namespaced = `${server.id}.${t.name}`;
    bare.set(namespaced, t.name);
    if (t.inputSchema !== undefined) schemas.set(namespaced, t.inputSchema);
  }
  return { client, tools: namespaceTools(server.id, raw), schemas, bare };
}

/**
 * Connect every configured downstream server, aggregate their tools, and build
 * the router over the union. Fails LOUD if no servers are configured or if the
 * connected servers expose zero tools (never returns an empty router silently).
 */
export async function buildToolIndex(config: ProxyConfig): Promise<FederatedIndex> {
  const servers = config.servers ?? [];
  if (servers.length === 0) {
    throw new Error(
      'quartermaster: no servers configured — set config.servers, or use buildStaticRouter for a static manifest.',
    );
  }

  const clients = new Map<string, Client>();
  const toolToServer = new Map<string, string>();
  const toolToBare = new Map<string, string>();
  const schemas = new Map<string, unknown>();
  const allTools: Tool[] = [];

  for (const server of servers) {
    const conn = await connectDownstream(server);
    clients.set(server.id, conn.client);
    for (const tool of conn.tools) {
      allTools.push(tool);
      toolToServer.set(tool.name, server.id);
    }
    for (const [name, b] of conn.bare) toolToBare.set(name, b);
    for (const [name, schema] of conn.schemas) schemas.set(name, schema);
  }

  if (allTools.length === 0) {
    throw new Error(
      'quartermaster: connected to downstream servers but aggregated ZERO tools — check that they answer tools/list.',
    );
  }

  return { router: createRouter(allTools, { synonyms: config.synonyms }), clients, toolToServer, toolToBare, schemas };
}
