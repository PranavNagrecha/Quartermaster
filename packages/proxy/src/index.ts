/**
 * quartermaster-mcp — a drop-in MCP proxy.
 *
 * Federates N downstream MCP servers behind three meta-tools: `retrieve_tools`
 * (a ranked, schema-hydrated, confidence-annotated shortlist for a natural-language
 * query, built by the offline @quartermaster/core router), `call_tool` (forwards
 * the chosen tool to the right downstream), and `list_servers` (connected
 * downstreams + tool counts). Federated mode exposes all three; static mode
 * (`config.tools`) exposes `retrieve_tools` only (discovery, no execution).
 * It advises; the host LLM decides.
 *
 * Two modes: federated (config `servers` — spawn + aggregate `tools/list` +
 * forward `tools/call`) and static (config `tools` — a fixed manifest, discovery only).
 */
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRouter, type Router, type Tool } from '@quartermaster/core';
import { evaluatePolicy, type PolicyConfig } from '@quartermaster/policy';
import {
  estimateCatalogTokens,
  estimateCostSavingsUsd,
  estimateToolSchemaTokens,
  resolveTokenEstimateMethod,
} from '@quartermaster/telemetry';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { loadConfig, parseConfig, buildRouterOptions } from './config.js';
import {
  applyOverlays,
  buildToolIndex,
  interpolateEnv,
  maintainToolIndex,
  namespaceTools,
  refreshToolIndex,
  retrySkippedServers,
  emitToolCatalogSnapshot,
  emitServerSnapshot,
} from './downstream.js';
import type { FederatedIndex } from './downstream.js';
import { auditLog, initAudit } from './audit.js';
import { validateToolArguments } from './validate.js';
import { CircuitBreaker, Semaphore, withTimeout } from './reliability.js';
import { PACKAGE_VERSION } from './version.js';

export { assertWithinConfigDir, buildRouterOptions, loadConfig, parseConfig } from './config.js';
export {
  buildToolIndex,
  namespaceTools,
  interpolateEnv,
  applyOverlays,
  refreshToolIndex,
  retrySkippedServers,
  maintainToolIndex,
  carryForwardServerSnapshot,
  emitToolCatalogSnapshot,
  emitServerSnapshot,
} from './downstream.js';
export type { FederatedIndex, SkippedServer, RefreshReport, RetryReport } from './downstream.js';
export { auditLog, initAudit, getSessionId, createSessionId } from './audit.js';
export { CircuitBreaker, Semaphore, withTimeout } from './reliability.js';
export { validateToolArguments } from './validate.js';

/** Stdio downstream: spawn a child MCP server process. */
export interface StdioDownstreamServer {
  readonly id: string;
  readonly transport?: 'stdio';
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly callTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly maxConcurrency?: number;
  readonly circuitBreaker?: { readonly failureThreshold?: number; readonly resetMs?: number };
}

/** HTTP downstream: connect to a remote streamable-HTTP MCP endpoint. */
export interface HttpDownstreamServer {
  readonly id: string;
  readonly transport: 'http';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly callTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
  readonly maxConcurrency?: number;
  readonly circuitBreaker?: { readonly failureThreshold?: number; readonly resetMs?: number };
}

export type DownstreamServer = StdioDownstreamServer | HttpDownstreamServer;

export interface ProxyRankerConfig {
  readonly ranker?: 'bm25' | 'tfidf';
  readonly nameWeight?: number;
  readonly k1?: number;
  readonly b?: number;
  readonly expansionWeight?: number;
  readonly marginThreshold?: number;
  readonly minTopScore?: number;
  /** Boost when a query token matches the tool's server prefix or category. Default 0.1 in core. */
  readonly hintBoost?: number;
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
  /** Optional ranker tuning (BM25/TF-IDF params, expansion, confidence thresholds). */
  readonly ranker?: ProxyRankerConfig;
  /** Re-poll downstream `tools/list` on this interval (ms). Federated mode only. Min 1000. */
  readonly refreshIntervalMs?: number;
  /** Timeout for downstream tools/call forwarded via call_tool (ms). Default 30000. */
  readonly callTimeoutMs?: number;
  /** Upper bound on retrieve_tools shortlist size. Default 50. */
  readonly maxK?: number;
  /** Optional tool-call policy (allow/deny rules, presets, shadow mode). */
  readonly policy?: PolicyConfig;
  /** Path to external policy JSON, resolved relative to the config file. */
  readonly policyFile?: string;
  /** Token/cost pricing for savings estimates. */
  readonly pricing?: {
    readonly costPer1kTokensUsd?: number;
    readonly tokenEstimateMethod?: 'chars/4' | 'words*1.3';
  };
}

const DEFAULT_MAX_K = 50;

/** Clamp a retrieve_tools `k` to (0, maxK]. */
export function clampK(requested: unknown, defaultK: number, maxK: number): number {
  const k = typeof requested === 'number' && requested > 0 ? Math.floor(requested) : defaultK;
  return Math.min(k, maxK);
}

/** Build the offline router from the config's static tool manifest. Fails LOUD on an empty manifest. */
export function buildStaticRouter(config: ProxyConfig): Router {
  const tools = config.tools ?? [];
  if (tools.length === 0) {
    throw new Error(
      'quartermaster: no tools to index — provide config.tools (static manifest) or config.servers (P2-3 downstream).',
    );
  }
  return createRouter(applyOverlays(tools, config.overlays), buildRouterOptions(config));
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

/** Log retrieve_tools routing details when QM_DEBUG=1. */
function debugRetrieve(router: Router, query: string, k: number, result: ReturnType<typeof retrieveTools>): void {
  if (process.env.QM_DEBUG !== '1') return;
  const explained = router.search(query, k, { explain: true, includeDescription: true });
  console.error(`quartermaster[debug] query=${JSON.stringify(query)} k=${k} confidence=${result.confidence}`);
  for (const c of explained) {
    const matches = c.matches?.slice(0, 5).map((m) => `${m.term}:${m.contribution}`).join(', ');
    console.error(`  ${c.tool} score=${c.score}${matches ? ` [${matches}]` : ''}`);
  }
}

function agentId(): string {
  return process.env.QM_AGENT_ID ?? 'unknown';
}

function policyEnvironment(): string {
  return process.env.QM_ENV ?? 'default';
}

function computeRetrieveTokenStats(
  candidates: readonly { readonly tool: string; readonly description?: string }[],
  catalogTools: readonly Tool[],
  schemas: ReadonlyMap<string, unknown>,
  pricing?: ProxyConfig['pricing'],
): {
  totalSchemaTokens: number;
  shortlistSchemaTokens: number;
  estimatedTokenSavings: number;
  estimatedCostSavingsUsd: number;
  tokenEstimateMethod: string;
} {
  const tokenEstimateMethod = resolveTokenEstimateMethod(pricing);
  const catalog = estimateCatalogTokens(catalogTools, schemas, tokenEstimateMethod);
  const toolByName = new Map(catalogTools.map((t) => [t.name, t]));
  let shortlistSchemaTokens = 0;
  for (const c of candidates) {
    const meta = toolByName.get(c.tool);
    shortlistSchemaTokens += estimateToolSchemaTokens({
      name: c.tool,
      description: c.description ?? meta?.description,
      keywords: meta?.keywords,
      inputSchema: schemas.get(c.tool),
    }, tokenEstimateMethod);
  }
  const estimatedTokenSavings = Math.max(0, catalog.totalSchemaTokens - shortlistSchemaTokens);
  return {
    totalSchemaTokens: catalog.totalSchemaTokens,
    shortlistSchemaTokens,
    estimatedTokenSavings,
    estimatedCostSavingsUsd: estimateCostSavingsUsd(estimatedTokenSavings, pricing),
    tokenEstimateMethod,
  };
}

function auditRetrieve(
  traceId: string,
  query: string,
  k: number,
  result: ReturnType<typeof retrieveTools>,
  ctx: {
    totalTools: number;
    catalogTools: readonly Tool[];
    schemas: ReadonlyMap<string, unknown>;
    pricing?: ProxyConfig['pricing'];
  },
  startedAt: number,
): void {
  const tokenStats = computeRetrieveTokenStats(result.candidates, ctx.catalogTools, ctx.schemas, ctx.pricing);
  auditLog({
    event: 'retrieve',
    traceId,
    agentId: agentId(),
    query,
    k,
    confidence: result.confidence,
    candidateTools: result.candidates.map((c) => c.tool),
    candidateScores: result.candidates.map((c) => c.score),
    totalTools: ctx.totalTools,
    totalSchemaTokens: tokenStats.totalSchemaTokens,
    shortlistSchemaTokens: tokenStats.shortlistSchemaTokens,
    estimatedTokenSavings: tokenStats.estimatedTokenSavings,
    tokenEstimateMethod: tokenStats.tokenEstimateMethod,
    estimatedCostSavingsUsd: tokenStats.estimatedCostSavingsUsd,
    latencyMs: Math.round(performance.now() - startedAt),
    status: 'ok',
  });
}

const MAX_RETRIEVE_TRACES = 64;

/** Store a retrieve_tools trace for later call_tool attribution (FIFO cap). */
export function storeRetrieveTrace(
  index: FederatedIndex,
  ctx: { readonly query: string; readonly tools: readonly string[]; readonly traceId: string },
): void {
  index.lastRetrieve = ctx;
  index.retrieveByTraceId.set(ctx.traceId, ctx);
  while (index.retrieveByTraceId.size > MAX_RETRIEVE_TRACES) {
    const oldest = index.retrieveByTraceId.keys().next().value;
    if (oldest === undefined) break;
    index.retrieveByTraceId.delete(oldest);
  }
}

/**
 * Resolve which retrieve_tools trace a call_tool belongs to.
 * Order: explicit traceId → most recent trace containing toolName → lastRetrieve.
 */
export function resolveRetrieveForCall(
  index: FederatedIndex,
  toolName: string,
  explicitTraceId?: string,
): { readonly query: string; readonly tools: readonly string[]; readonly traceId: string } | undefined {
  if (explicitTraceId !== undefined && explicitTraceId !== '') {
    const hit = index.retrieveByTraceId.get(explicitTraceId);
    if (hit !== undefined) return hit;
  }
  for (const entry of [...index.retrieveByTraceId.values()].reverse()) {
    if (entry.tools.includes(toolName)) return entry;
  }
  return index.lastRetrieve;
}

/** Construct the MCP server exposing `retrieve_tools`. The transport is connected by `startServer` / the bin. */
export function createServer(config: ProxyConfig): Server {
  const catalogTools = applyOverlays(config.tools ?? [], config.overlays);
  const router = createRouter(catalogTools, buildRouterOptions(config));
  const defaultK = config.k ?? 8;
  const maxK = config.maxK ?? DEFAULT_MAX_K;
  const server = new Server({ name: 'quartermaster-mcp', version: PACKAGE_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'retrieve_tools',
        description:
          'REQUIRED first step: find the most relevant tools for a natural-language task. Returns a ranked, ' +
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
    const k = clampK(kRaw, defaultK, maxK);
    const startedAt = performance.now();
    const traceId = randomUUID();
    const result = retrieveTools(router, query, k);
    debugRetrieve(router, query, k, result);
    auditRetrieve(
      traceId,
      query,
      k,
      result,
      { totalTools: catalogTools.length, catalogTools, schemas: new Map(), pricing: config.pricing },
      startedAt,
    );
    return { content: [{ type: 'text' as const, text: JSON.stringify({ ...result, traceId }, null, 2) }] };
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

/** Full `list_servers` payload including degraded state when boot was partial. */
export function listServersPayload(index: FederatedIndex): {
  degraded: boolean;
  servers: ReturnType<typeof serverSummary>;
  skipped: readonly { id: string; reason: string }[];
  totalTools: number;
} {
  const skipped = index.skippedServers ?? [];
  return {
    degraded: skipped.length > 0 || index.clients.size < (index.configuredServerCount ?? index.clients.size),
    servers: serverSummary(index),
    skipped,
    totalTools: index.toolToServer.size,
  };
}

/** An MCP tool-error result — the host sees a recoverable tool error, not a thrown protocol error. */
function errorResult(message: string) {
  return { content: [{ type: 'text' as const, text: `quartermaster: ${message}` }], isError: true };
}

/**
 * Forward a chosen namespaced tool to its downstream client. Any failure (unknown
 * tool, timeout, or the downstream throwing) is returned as an `isError` tool result
 * rather than thrown, so one bad call never takes down the proxy session.
 */
export async function forwardCall(
  index: FederatedIndex,
  toolName: string,
  args: Record<string, unknown>,
  opts: { callTimeoutMs?: number; traceId?: string } = {},
) {
  let target: { client: Client; bareName: string };
  try {
    target = resolveCall(index, toolName);
  } catch (e) {
    return errorResult((e as Error).message);
  }
  const serverId = index.toolToServer.get(toolName) ?? '';
  const retrieve = resolveRetrieveForCall(index, toolName, opts.traceId);
  const traceId = retrieve?.traceId ?? opts.traceId ?? '';
  const timeoutMs =
    index.serverById.get(serverId)?.callTimeoutMs ?? opts.callTimeoutMs ?? index.callTimeoutMs ?? 30_000;
  const circuit = index.circuitBreakers.get(serverId);
  if (circuit?.isOpen()) {
    auditLog({
      event: 'call',
      traceId,
      tool: toolName,
      serverId,
      wasShortlisted: false,
      rank: 0,
      ok: false,
      latencyMs: 0,
      error: `circuit open for server "${serverId}"`,
      errorCategory: 'circuit_open',
    });
    return errorResult(`circuit open for server "${serverId}" — too many recent failures`);
  }
  const policyDecision = evaluatePolicy(index.policy, {
    toolName,
    bareName: target.bareName,
    serverId,
    agentId: agentId(),
    environment: policyEnvironment(),
  });
  auditLog({
    event: 'policy_decision',
    traceId,
    tool: toolName,
    serverId,
    allowed: policyDecision.allowed,
    shadow: policyDecision.shadow,
    mode: policyDecision.mode,
    reason: policyDecision.reason,
    matchedPreset: policyDecision.matchedPreset,
  });
  if (!policyDecision.allowed && !policyDecision.shadow) {
    auditLog({
      event: 'call',
      traceId,
      tool: toolName,
      serverId,
      wasShortlisted: false,
      rank: 0,
      ok: false,
      latencyMs: 0,
      error: policyDecision.reason,
      errorCategory: 'policy_denied',
    });
    return errorResult(`policy denied call to "${toolName}": ${policyDecision.reason}`);
  }
  const inputSchema = index.schemas.get(toolName);
  const validation = validateToolArguments(index, toolName, args, inputSchema);
  if (!validation.ok) {
    auditLog({
      event: 'validation_error',
      traceId,
      tool: toolName,
      serverId,
      errors: [...validation.errors],
    });
    auditLog({
      event: 'call',
      traceId,
      tool: toolName,
      serverId,
      wasShortlisted: false,
      rank: 0,
      ok: false,
      latencyMs: 0,
      error: validation.errors.join('; '),
      errorCategory: 'validation_error',
    });
    return errorResult(`invalid arguments for "${toolName}": ${validation.errors.join('; ')}`);
  }
  const rankIdx = retrieve?.tools.indexOf(toolName) ?? -1;
  const wasShortlisted = rankIdx >= 0;
  const rank = wasShortlisted ? rankIdx + 1 : 0;
  if (retrieve !== undefined && !wasShortlisted) {
    auditLog({
      event: 'call_miss',
      traceId,
      query: retrieve.query,
      tool: toolName,
      shortlisted: [...retrieve.tools],
    });
  }
  const startedAt = performance.now();
  const semaphore = index.semaphores.get(serverId);
  if (semaphore !== undefined) await semaphore.acquire();
  try {
    const result = await withTimeout(
      target.client.callTool({ name: target.bareName, arguments: args }),
      timeoutMs,
      `call to "${toolName}" timed out after ${timeoutMs}ms`,
    );
    circuit?.recordSuccess();
    auditLog({
      event: 'call',
      traceId,
      tool: toolName,
      serverId,
      wasShortlisted,
      rank,
      ok: true,
      latencyMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (e) {
    circuit?.recordFailure();
    auditLog({
      event: 'call',
      traceId,
      tool: toolName,
      serverId,
      wasShortlisted,
      rank,
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: (e as Error).message,
      errorCategory: (e as Error).message.includes('timed out') ? 'timeout' : 'downstream_error',
    });
    return errorResult((e as Error).message.startsWith('call to ') ? (e as Error).message : `call to "${toolName}" failed: ${(e as Error).message}`);
  } finally {
    semaphore?.release();
  }
}

/**
 * The FEDERATED MCP server: exposes `retrieve_tools` (discovery, with hydrated
 * schemas) AND `call_tool` (execution — forwards the chosen namespaced tool to
 * the right downstream client). Invocation model **A** (meta-executor):
 * host-agnostic, two static tools, no dynamic tool-list. Transport connected by
 * the bin (P2-5).
 */
export function createServerFromIndex(index: FederatedIndex, opts: { k?: number; maxK?: number } = {}): Server {
  const defaultK = opts.k ?? 8;
  const maxK = opts.maxK ?? index.maxK ?? DEFAULT_MAX_K;
  const server = new Server({ name: 'quartermaster-mcp', version: PACKAGE_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'retrieve_tools',
        description:
          'REQUIRED first step: find the most relevant tools for a natural-language task. Returns a ranked, ' +
          'confidence-annotated shortlist with descriptions AND input schemas — read it, then call the ' +
          'tool you need via call_tool. Always call this before call_tool.',
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
            traceId: { type: 'string', description: 'traceId from retrieve_tools — links this call to the correct shortlist.' },
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
      const k = clampK(kRaw, defaultK, maxK);
      const startedAt = performance.now();
      const traceId = randomUUID();
      const result = retrieveTools(index.router, query, k, index.schemas);
      storeRetrieveTrace(index, { query, tools: result.candidates.map((c) => c.tool), traceId });
      debugRetrieve(index.router, query, k, result);
      auditRetrieve(
        traceId,
        query,
        k,
        result,
        {
          totalTools: index.toolToServer.size,
          catalogTools: index.catalogTools,
          schemas: index.schemas,
          pricing: index.pricing,
        },
        startedAt,
      );
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ...result, traceId }, null, 2) }] };
    }
    if (req.params.name === 'call_tool') {
      const toolName = (args as Record<string, unknown>).name;
      if (typeof toolName !== 'string') {
        return errorResult('call_tool: `name` (the namespaced server.tool string) is required.');
      }
      const toolArgs = (args as Record<string, unknown>).arguments;
      const explicitTraceId = (args as Record<string, unknown>).traceId;
      return forwardCall(index, toolName, (toolArgs ?? {}) as Record<string, unknown>, {
        traceId: typeof explicitTraceId === 'string' ? explicitTraceId : undefined,
      });
    }
    if (req.params.name === 'list_servers') {
      const payload = listServersPayload(index);
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    }
    return errorResult(`unknown tool: ${req.params.name}`);
  });

  return server;
}

export type CliArgs =
  | { action: 'run'; config: string }
  | { action: 'validate'; config: string }
  | { action: 'help' }
  | { action: 'version' };

const CLI_USAGE = `usage: quartermaster-mcp --config <path-to-quartermaster.json> [options]

options:
  --config <path>   Path to quartermaster.json (required for run/validate)
  --validate        Parse config and exit (no server boot)
  --help, -h        Show this help
  --version, -V     Print package version

docs: https://github.com/PranavNagrecha/quartermaster/blob/main/docs/quickstart.md`;

/** Parse CLI args. Pure. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  if (argv.includes('--help') || argv.includes('-h')) return { action: 'help' };
  if (argv.includes('--version') || argv.includes('-V')) return { action: 'version' };
  const validate = argv.includes('--validate');
  let config: string | undefined;
  for (const [i, a] of argv.entries()) {
    if (a === '--config') config = argv[i + 1];
    else if (a.startsWith('--config=')) config = a.slice('--config='.length);
  }
  if (config === undefined || config === '') {
    throw new Error(CLI_USAGE);
  }
  return validate ? { action: 'validate', config } : { action: 'run', config };
}

/** Validate a config file without booting the server. */
export async function validateConfig(configPath: string): Promise<void> {
  const config = loadConfig(configPath);
  const tools = config.tools?.length ?? 0;
  const servers = config.servers?.length ?? 0;
  console.error(`quartermaster-mcp: config ok (${tools} static tools, ${servers} servers).`);
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
  initAudit();
  const config = loadConfig(configPath);
  const federated = (config.servers?.length ?? 0) > 0;
  let server: Server;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  const shutdown = (index?: FederatedIndex): void => {
    if (refreshTimer !== undefined) clearInterval(refreshTimer);
    if (index !== undefined) {
      void closeIndex(index).finally(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };
  if (federated) {
    const index = await buildToolIndex(config);
    server = createServerFromIndex(index, { k: config.k, maxK: config.maxK });
    process.once('SIGINT', () => shutdown(index));
    process.once('SIGTERM', () => shutdown(index));
    if (config.refreshIntervalMs !== undefined) {
      refreshTimer = setInterval(() => {
        void maintainToolIndex(index, config).then(({ retry, refresh }) => {
          if (retry.connected.length > 0) {
            console.error(`quartermaster: reconnected skipped server(s) — ${retry.connected.join(', ')}`);
          }
          if (retry.errors.length > 0) {
            console.error(`quartermaster: reconnect errors — ${retry.errors.join('; ')}`);
          }
          if (refresh.errors.length > 0) {
            console.error(`quartermaster: tools/list refresh errors — ${refresh.errors.join('; ')}`);
          }
          if (refresh.added.length > 0 || refresh.removed.length > 0) {
            console.error(
              `quartermaster: index refreshed (+${refresh.added.length} -${refresh.removed.length} tools)`,
            );
          }
        });
      }, config.refreshIntervalMs);
    }
  } else {
    server = createServer(config);
    process.once('SIGINT', () => shutdown());
    process.once('SIGTERM', () => shutdown());
  }
  await server.connect(new StdioServerTransport());
  console.error(`quartermaster-mcp: ready (${federated ? 'federated' : 'static'} mode).`);
}

/** CLI entry: parse args, boot the server, and on failure log to stderr + set a non-zero exit code (never throws). */
export async function runCli(argv: readonly string[]): Promise<void> {
  try {
    const args = parseCliArgs(argv);
    if (args.action === 'help') {
      console.error(CLI_USAGE);
      return;
    }
    if (args.action === 'version') {
      console.error(PACKAGE_VERSION);
      return;
    }
    if (args.action === 'validate') {
      await validateConfig(args.config);
      return;
    }
    await startFromConfig(args.config);
  } catch (e) {
    console.error(`quartermaster-mcp: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
