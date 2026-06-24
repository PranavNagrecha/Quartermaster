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
import { PACKAGE_VERSION } from './version.js';

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

/**
 * Merge per-tool keyword overlays into the matching tools' `keywords`, so an
 * operator can tune recall (e.g. add "bug defect" to `create_issue`) from config
 * without touching the downstream servers. Keyed by namespaced tool name. Pure.
 */
export function applyOverlays(
  tools: readonly Tool[],
  overlays?: Readonly<Record<string, { readonly keywords?: string }>>,
): Tool[] {
  if (overlays === undefined) return [...tools];
  return tools.map((t) => {
    const extra = overlays[t.name]?.keywords;
    if (extra === undefined || extra === '') return t;
    return { ...t, keywords: [t.keywords, extra].filter(Boolean).join(' ') };
  });
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
  const client = new Client({ name: 'quartermaster-mcp', version: PACKAGE_VERSION }, { capabilities: {} });
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
 * the router over the union. **Partial failure is non-fatal** (P2-15): a server
 * that fails to start is skipped with a stderr warning and the proxy runs
 * degraded on the rest. Fails LOUD only if no servers are configured, or if
 * EVERY server failed / they collectively expose zero tools.
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
  const failures: string[] = [];

  for (const server of servers) {
    let conn;
    try {
      conn = await connectDownstream(server);
    } catch (e) {
      failures.push(`${server.id} (${(e as Error).message})`);
      continue;
    }
    clients.set(server.id, conn.client);
    for (const tool of conn.tools) {
      allTools.push(tool);
      toolToServer.set(tool.name, server.id);
    }
    for (const [name, b] of conn.bare) toolToBare.set(name, b);
    for (const [name, schema] of conn.schemas) schemas.set(name, schema);
  }

  if (failures.length > 0) {
    console.error(
      `quartermaster: ${failures.length} of ${servers.length} downstream server(s) failed to start and were skipped — ${failures.join('; ')}`,
    );
  }

  if (allTools.length === 0) {
    throw new Error(
      'quartermaster: no usable downstream tools — every configured server failed to start or exposed no tools/list.',
    );
  }

  const router = createRouter(applyOverlays(allTools, config.overlays), { synonyms: config.synonyms });
  return { router, clients, toolToServer, toolToBare, schemas };
}
