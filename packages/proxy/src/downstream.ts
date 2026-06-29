/**
 * Downstream federation (P2-3): connect each configured MCP server over stdio or
 * HTTP (streamable), read its `tools/list`, and aggregate every tool — namespaced
 * `${serverId}.${name}` — into one corpus the router ranks over. The per-tool →
 * server map lets the proxy forward a chosen tool back to the right downstream.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRouter, type Router, type Tool } from '@quartermaster/core';
import { estimateCatalogTokens, estimateToolSchemaTokens, resolveTokenEstimateMethod } from '@quartermaster/telemetry';
import type { PolicyConfig } from '@quartermaster/policy';
import type { TokenEstimateMethod } from '@quartermaster/telemetry';
import type { ValidateFunction } from 'ajv';
import type { DownstreamServer, ProxyConfig } from './index.js';
import { buildRouterOptions } from './config.js';
import { CircuitBreaker, Semaphore, withTimeout } from './reliability.js';
import { auditLog } from './audit.js';
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

/** A downstream that failed to connect at boot. */
export interface SkippedServer {
  readonly id: string;
  readonly reason: string;
}

/** Report from `refreshToolIndex`. */
export interface RefreshReport {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly errors: readonly string[];
}

/** Report from `retrySkippedServers`. */
export interface RetryReport {
  readonly connected: readonly string[];
  readonly errors: readonly string[];
}

/** The result of federating downstream servers: the router plus the maps needed to forward calls + manage lifecycle. */
export interface FederatedIndex {
  router: Router;
  /** server id → connected client (for forwarding in P2-4 + shutdown in P2-7). */
  readonly clients: Map<string, Client>;
  /** namespaced tool name → owning server id (for call routing). */
  readonly toolToServer: Map<string, string>;
  /** namespaced tool name → bare downstream tool name (captured at index time, not derived). */
  readonly toolToBare: Map<string, string>;
  /** namespaced tool name → JSON inputSchema (for schema hydration in retrieve_tools). */
  readonly schemas: Map<string, unknown>;
  /** Last known good Tool[] per server — used to carry forward on a failed tools/list poll. */
  readonly lastKnownTools: Map<string, Tool[]>;
  /** Servers configured but not connected (mutable — retry may clear entries). */
  skippedServers: SkippedServer[];
  /** Total servers in config (connected + skipped). */
  readonly configuredServerCount: number;
  /** Per-call timeout for downstream tools/call (ms). */
  readonly callTimeoutMs: number;
  /** Max shortlist size for retrieve_tools. */
  readonly maxK: number;
  /** Full catalog passed to the router (overlays applied). */
  catalogTools: Tool[];
  /** retrieve_tools traces keyed by traceId — for call_tool attribution. */
  retrieveByTraceId: Map<string, { readonly query: string; readonly tools: readonly string[]; readonly traceId: string }>;
  /** Last retrieve_tools shortlist — for audit call_miss detection and trace linking. */
  lastRetrieve?: { readonly query: string; readonly tools: readonly string[]; readonly traceId: string };
  /** Resolved policy config for call_tool enforcement. */
  readonly policy?: PolicyConfig;
  /** Cached JSON Schema validators per tool (mutable). */
  schemaValidators?: Map<string, ValidateFunction>;
  /** Server config by id (for per-server timeouts/limits). */
  readonly serverById: Map<string, DownstreamServer>;
  /** Per-server circuit breakers (mutable). */
  circuitBreakers: Map<string, CircuitBreaker>;
  /** Per-server concurrency semaphores. */
  readonly semaphores: Map<string, Semaphore>;
  /** Pricing config for token savings. */
  readonly pricing?: ProxyConfig['pricing'];
}

function serverPrefix(toolName: string): string {
  const dot = toolName.indexOf('.');
  return dot > 0 ? toolName.slice(0, dot) : 'unknown';
}

function catalogServerBreakdown(
  tools: readonly Tool[],
  toolToServer: ReadonlyMap<string, string>,
  schemas: ReadonlyMap<string, unknown>,
  method: TokenEstimateMethod = 'chars/4',
): { id: string; toolCount: number; schemaTokens: number }[] {
  const byServer = new Map<string, Tool[]>();
  for (const tool of tools) {
    const id = toolToServer.get(tool.name) ?? tool.category ?? serverPrefix(tool.name);
    const list = byServer.get(id) ?? [];
    list.push(tool);
    byServer.set(id, list);
  }
  return [...byServer.entries()]
    .map(([id, serverTools]) => ({
      id,
      toolCount: serverTools.length,
      schemaTokens: serverTools.reduce(
        (sum, t) => sum + estimateToolSchemaTokens({ ...t, inputSchema: schemas.get(t.name) }, method),
        0,
      ),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function emitToolCatalogSnapshot(index: FederatedIndex): void {
  const tools: Tool[] = [];
  for (const serverTools of index.lastKnownTools.values()) tools.push(...serverTools);
  const method = resolveTokenEstimateMethod(index.pricing);
  const est = estimateCatalogTokens(tools, index.schemas, method);
  auditLog({
    event: 'tool_catalog_snapshot',
    totalTools: est.totalTools,
    totalSchemaTokens: est.totalSchemaTokens,
    tokenEstimateMethod: method,
    serverBreakdown: catalogServerBreakdown(tools, index.toolToServer, index.schemas, method),
  });
}

export function emitServerSnapshot(index: FederatedIndex): void {
  const connected = serverSummary(index);
  const connectedIds = new Set(connected.map((s) => s.id));
  const servers = [
    ...connected.map((s) => {
      const cb = index.circuitBreakers.get(s.id);
      const circuitOpen = cb?.isOpen() ?? false;
      return {
        id: s.id,
        toolCount: s.toolCount,
        ok: !circuitOpen,
        health: circuitOpen ? ('circuit_open' as const) : ('ok' as const),
        circuitOpen,
      };
    }),
    ...index.skippedServers
      .filter((s) => !connectedIds.has(s.id))
      .map((s) => ({ id: s.id, toolCount: 0, ok: false, health: 'degraded' as const })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  auditLog({
    event: 'server_snapshot',
    servers,
    totalTools: index.toolToServer.size,
    degraded:
      index.skippedServers.length > 0 ||
      index.clients.size < (index.configuredServerCount ?? index.clients.size),
  });
}

function serverSummary(index: FederatedIndex): { id: string; toolCount: number }[] {
  const counts = new Map<string, number>();
  for (const id of index.clients.keys()) counts.set(id, 0);
  for (const id of index.toolToServer.values()) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, toolCount]) => ({ id, toolCount }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function isHttpServer(server: DownstreamServer): server is Extract<DownstreamServer, { url: string }> {
  return 'url' in server && typeof server.url === 'string' && server.url.trim() !== '';
}

function mergeServerTools(
  serverId: string,
  raw: ReadonlyArray<{ name: string; description?: string; inputSchema?: unknown }>,
  allTools: Tool[],
  toolToServer: Map<string, string>,
  toolToBare: Map<string, string>,
  schemas: Map<string, unknown>,
  lastKnownTools: Map<string, Tool[]>,
): void {
  const namespaced = namespaceTools(serverId, raw);
  lastKnownTools.set(serverId, namespaced);
  for (const t of raw) {
    const ns = `${serverId}.${t.name}`;
    toolToBare.set(ns, t.name);
    if (t.inputSchema !== undefined) schemas.set(ns, t.inputSchema);
  }
  for (const tool of namespaced) {
    allTools.push(tool);
    toolToServer.set(tool.name, serverId);
  }
}

/**
 * Copy a server's last-known tools and routing maps into a rebuild buffer when
 * tools/list fails but the client is still connected. Pure aside from pushing
 * into the output maps.
 */
export function carryForwardServerSnapshot(
  index: FederatedIndex,
  serverId: string,
  allTools: Tool[],
  toolToServer: Map<string, string>,
  toolToBare: Map<string, string>,
  schemas: Map<string, unknown>,
): void {
  const tools = index.lastKnownTools.get(serverId);
  if (tools !== undefined) {
    for (const tool of tools) {
      allTools.push(tool);
      toolToServer.set(tool.name, serverId);
    }
  }
  for (const [name, sid] of index.toolToServer) {
    if (sid !== serverId) continue;
    const bare = index.toolToBare.get(name);
    if (bare !== undefined) toolToBare.set(name, bare);
    const schema = index.schemas.get(name);
    if (schema !== undefined) schemas.set(name, schema);
  }
}

async function listServerTools(
  client: Client,
  serverId: string,
): Promise<ReadonlyArray<{ name: string; description?: string; inputSchema?: unknown }>> {
  const raw = (await client.listTools()).tools ?? [];
  return raw.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

async function connectDownstream(
  server: DownstreamServer,
): Promise<{ client: Client; tools: Tool[]; schemas: Map<string, unknown>; bare: Map<string, string> }> {
  const client = new Client({ name: 'quartermaster-mcp', version: PACKAGE_VERSION }, { capabilities: {} });
  const connectTimeoutMs = server.connectTimeoutMs ?? 30_000;
  const connectTask = (async () => {
    if (isHttpServer(server)) {
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: server.headers !== undefined ? { headers: { ...server.headers } } : undefined,
      });
      await client.connect(transport);
    } else {
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args ? [...server.args] : [],
        env: { ...getDefaultEnvironment(), ...(server.env ? interpolateEnv(server.env) : {}) },
      });
      await client.connect(transport);
    }
  })();
  await withTimeout(connectTask, connectTimeoutMs, `connect to "${server.id}" timed out after ${connectTimeoutMs}ms`);
  const raw = await listServerTools(client, server.id);
  const schemas = new Map<string, unknown>();
  const bare = new Map<string, string>();
  for (const t of raw) {
    const namespaced = `${server.id}.${t.name}`;
    bare.set(namespaced, t.name);
    if (t.inputSchema !== undefined) schemas.set(namespaced, t.inputSchema);
  }
  return { client, tools: namespaceTools(server.id, raw), schemas, bare };
}

function applyIndexMaps(
  index: FederatedIndex,
  config: ProxyConfig,
  allTools: Tool[],
  toolToServer: Map<string, string>,
  toolToBare: Map<string, string>,
  schemas: Map<string, unknown>,
): void {
  const nextToolToServer = new Map(toolToServer);
  const nextToolToBare = new Map(toolToBare);
  const nextSchemas = new Map(schemas);
  index.toolToServer.clear();
  for (const [k, v] of nextToolToServer) index.toolToServer.set(k, v);
  index.toolToBare.clear();
  for (const [k, v] of nextToolToBare) index.toolToBare.set(k, v);
  index.schemas.clear();
  for (const [k, v] of nextSchemas) index.schemas.set(k, v);
  index.catalogTools = applyOverlays(allTools, config.overlays);
  index.router = createRouter(index.catalogTools, buildRouterOptions(config));
}

function mergeConnection(
  index: FederatedIndex,
  serverId: string,
  conn: Awaited<ReturnType<typeof connectDownstream>>,
): void {
  index.clients.set(serverId, conn.client);
  index.lastKnownTools.set(serverId, conn.tools);
  for (const tool of conn.tools) {
    index.toolToServer.set(tool.name, serverId);
  }
  for (const [name, b] of conn.bare) index.toolToBare.set(name, b);
  for (const [name, schema] of conn.schemas) index.schemas.set(name, schema);
}

/**
 * Re-poll every connected downstream and rebuild the router. On per-server
 * tools/list failure, carries forward that server's previous snapshot.
 */
async function rebuildToolIndex(index: FederatedIndex, config: ProxyConfig): Promise<RefreshReport> {
  const previousTools = new Set(index.toolToServer.keys());
  const allTools: Tool[] = [];
  const toolToServer = new Map<string, string>();
  const toolToBare = new Map<string, string>();
  const schemas = new Map<string, unknown>();
  const errors: string[] = [];

  for (const [serverId, client] of index.clients) {
    try {
      const raw = await listServerTools(client, serverId);
      mergeServerTools(serverId, raw, allTools, toolToServer, toolToBare, schemas, index.lastKnownTools);
    } catch (e) {
      const reason = (e as Error).message;
      errors.push(`${serverId}: ${reason}`);
      auditLog({ event: 'server_error', serverId, reason, phase: 'refresh' });
      carryForwardServerSnapshot(index, serverId, allTools, toolToServer, toolToBare, schemas);
    }
  }

  if (allTools.length === 0) {
    return { added: [], removed: [], errors: [...errors, 'refresh kept previous index (zero tools from all servers)'] };
  }

  const added = [...toolToServer.keys()].filter((t) => !previousTools.has(t));
  const removed = [...previousTools].filter((t) => !toolToServer.has(t));
  applyIndexMaps(index, config, allTools, toolToServer, toolToBare, schemas);
  return { added, removed, errors };
}

/**
 * Connect every configured downstream server in parallel, aggregate their tools,
 * and build the router over the union. **Partial failure is non-fatal**: a server
 * that fails to start is skipped with a stderr warning and the proxy runs
 * degraded on the rest.
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
  const lastKnownTools = new Map<string, Tool[]>();
  const skippedServers: SkippedServer[] = [];
  const callTimeoutMs = config.callTimeoutMs ?? 30_000;
  const maxK = config.maxK ?? 50;

  const outcomes = await Promise.all(
    servers.map(async (server) => {
      try {
        const conn = await connectDownstream(server);
        return { server, conn };
      } catch (e) {
        return { server, error: (e as Error).message };
      }
    }),
  );

  for (const o of outcomes) {
    if ('conn' in o && o.conn !== undefined) {
      clients.set(o.server.id, o.conn.client);
      lastKnownTools.set(o.server.id, o.conn.tools);
      for (const tool of o.conn.tools) toolToServer.set(tool.name, o.server.id);
      for (const [name, b] of o.conn.bare) toolToBare.set(name, b);
      for (const [name, schema] of o.conn.schemas) schemas.set(name, schema);
    } else if ('error' in o) {
      skippedServers.push({ id: o.server.id, reason: o.error });
      auditLog({ event: 'server_error', serverId: o.server.id, reason: o.error, phase: 'boot' });
    }
  }

  const allTools: Tool[] = [];
  for (const tools of lastKnownTools.values()) allTools.push(...tools);

  if (skippedServers.length > 0) {
    console.error(
      `quartermaster: ${skippedServers.length} of ${servers.length} downstream server(s) failed to start and were skipped — ${skippedServers.map((s) => `${s.id} (${s.reason})`).join('; ')}`,
    );
  }

  if (allTools.length === 0) {
    throw new Error(
      'quartermaster: no usable downstream tools — every configured server failed to start or exposed no tools/list.',
    );
  }

  const catalogTools = applyOverlays(allTools, config.overlays);
  const router = createRouter(catalogTools, buildRouterOptions(config));
  const serverById = new Map(servers.map((s) => [s.id, s]));
  const circuitBreakers = new Map<string, CircuitBreaker>();
  const semaphores = new Map<string, Semaphore>();
  for (const s of servers) {
    if (clients.has(s.id)) {
      if (s.circuitBreaker !== undefined) circuitBreakers.set(s.id, new CircuitBreaker(s.circuitBreaker));
      if (s.maxConcurrency !== undefined) semaphores.set(s.id, new Semaphore(s.maxConcurrency));
    }
  }
  const index: FederatedIndex = {
    router,
    clients,
    toolToServer,
    toolToBare,
    schemas,
    lastKnownTools,
    skippedServers,
    configuredServerCount: servers.length,
    callTimeoutMs,
    maxK,
    catalogTools,
    retrieveByTraceId: new Map(),
    policy: config.policy,
    serverById,
    circuitBreakers,
    semaphores,
    pricing: config.pricing,
  };
  emitToolCatalogSnapshot(index);
  emitServerSnapshot(index);
  return index;
}

/**
 * Re-poll `tools/list` on connected downstreams and rebuild the router in place.
 * Does not re-spawn servers. Per-server failures carry forward the prior snapshot.
 * If every server fails, the previous index is kept.
 */
export async function refreshToolIndex(index: FederatedIndex, config: ProxyConfig): Promise<RefreshReport> {
  return rebuildToolIndex(index, config);
}

/**
 * Attempt to connect servers that were skipped at boot. On success, merges
 * tools and rebuilds the router.
 */
export async function retrySkippedServers(index: FederatedIndex, config: ProxyConfig): Promise<RetryReport> {
  const servers = config.servers ?? [];
  const byId = new Map(servers.map((s) => [s.id, s]));
  const connected: string[] = [];
  const errors: string[] = [];
  const stillSkipped: SkippedServer[] = [];

  for (const skipped of index.skippedServers) {
    const server = byId.get(skipped.id);
    if (server === undefined) {
      stillSkipped.push(skipped);
      continue;
    }
    try {
      const conn = await connectDownstream(server);
      mergeConnection(index, server.id, conn);
      connected.push(server.id);
    } catch (e) {
      const reason = (e as Error).message;
      errors.push(`${skipped.id}: ${reason}`);
      auditLog({ event: 'server_error', serverId: skipped.id, reason, phase: 'refresh' });
      stillSkipped.push({ id: skipped.id, reason });
    }
  }

  index.skippedServers = stillSkipped;

  if (connected.length > 0) {
    const allTools: Tool[] = [];
    for (const tools of index.lastKnownTools.values()) allTools.push(...tools);
    applyIndexMaps(index, config, allTools, index.toolToServer, index.toolToBare, index.schemas);
  }

  return { connected, errors };
}

/** Retry skipped servers, then refresh connected ones. Used by the refresh timer. */
export async function maintainToolIndex(
  index: FederatedIndex,
  config: ProxyConfig,
): Promise<{ retry: RetryReport; refresh: RefreshReport }> {
  const retry = await retrySkippedServers(index, config);
  const refresh = await refreshToolIndex(index, config);
  if (retry.connected.length > 0 || refresh.added.length > 0 || refresh.removed.length > 0) {
    emitToolCatalogSnapshot(index);
  }
  emitServerSnapshot(index);
  return { retry, refresh };
}
