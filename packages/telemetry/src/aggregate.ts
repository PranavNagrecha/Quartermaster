import type { AuditLine, LegacyAuditLine } from './read.js';
import { eventTraceId, eventTs } from './read.js';

function asLine(e: AuditLine): LegacyAuditLine {
  return e as LegacyAuditLine;
}

export interface AuditOverview {
  readonly retrieveCount: number;
  readonly callCount: number;
  readonly callMissCount: number;
  readonly lowConfidenceCount: number;
  readonly totalEstimatedTokenSavings: number;
  readonly totalEstimatedCostSavingsUsd: number;
  readonly avgLatencyMs: number;
}

export interface QueryChain {
  readonly traceId: string;
  readonly query: string;
  readonly confidence: string;
  readonly shortlisted: readonly string[];
  readonly calledTool?: string;
  readonly callOk?: boolean;
  readonly rank?: number;
}

export interface ToolStats {
  readonly tool: string;
  readonly searched: number;
  readonly called: number;
  readonly misses: number;
  readonly avgRank: number | null;
  readonly qualityScore: number;
}

export interface ServerStats {
  readonly id: string;
  readonly toolCount: number;
  readonly ok: boolean;
  readonly usage: number;
}

export interface Recommendation {
  readonly kind: 'synonym' | 'overlay';
  readonly token: string;
  readonly suggestion: string;
  readonly reason: string;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function asBool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function candidateTools(e: AuditLine): string[] {
  const row = asLine(e);
  if (Array.isArray(row.candidateTools)) return row.candidateTools.filter((t): t is string => typeof t === 'string');
  const legacy = row.candidates;
  if (Array.isArray(legacy)) {
    return legacy
      .map((c) => (typeof c === 'object' && c !== null && typeof (c as { tool?: string }).tool === 'string'
        ? (c as { tool: string }).tool
        : undefined))
      .filter((t): t is string => t !== undefined);
  }
  return [];
}

function toolQuality(searched: number, called: number, misses: number, avgRank: number | null): number {
  if (searched === 0 && called === 0) return 50;
  const hitRate = searched > 0 ? called / searched : called > 0 ? 1 : 0;
  const missPenalty = misses * 5;
  const rankBonus = avgRank !== null && avgRank > 0 ? Math.max(0, 30 - (avgRank - 1) * 5) : 0;
  return Math.round(Math.min(100, Math.max(0, hitRate * 70 + rankBonus - missPenalty)));
}

export function aggregateOverview(events: readonly AuditLine[]): AuditOverview {
  let retrieveCount = 0;
  let callCount = 0;
  let callMissCount = 0;
  let lowConfidenceCount = 0;
  let totalEstimatedTokenSavings = 0;
  let totalEstimatedCostSavingsUsd = 0;
  let latencySum = 0;
  let latencyN = 0;

  for (const e of events) {
    const row = asLine(e);
    if (e.event === 'retrieve') {
      retrieveCount += 1;
      if (row.confidence === 'low') lowConfidenceCount += 1;
      totalEstimatedTokenSavings += asNumber(row.estimatedTokenSavings) ?? 0;
      totalEstimatedCostSavingsUsd += asNumber(row.estimatedCostSavingsUsd) ?? 0;
      const lat = asNumber(row.latencyMs);
      if (lat !== undefined) { latencySum += lat; latencyN += 1; }
    } else if (e.event === 'call') {
      callCount += 1;
      const lat = asNumber(row.latencyMs);
      if (lat !== undefined) { latencySum += lat; latencyN += 1; }
    } else if (e.event === 'call_miss') {
      callMissCount += 1;
    }
  }

  return {
    retrieveCount,
    callCount,
    callMissCount,
    lowConfidenceCount,
    totalEstimatedTokenSavings,
    totalEstimatedCostSavingsUsd,
    avgLatencyMs: latencyN > 0 ? latencySum / latencyN : 0,
  };
}

export function aggregateQueryChains(events: readonly AuditLine[]): QueryChain[] {
  const byTrace = new Map<string, { retrieves: AuditLine[]; calls: AuditLine[] }>();
  const ordered: string[] = [];

  for (const e of events) {
    if (e.event !== 'retrieve' && e.event !== 'call') continue;
    const tid = eventTraceId(e) ?? `seq-${ordered.length}`;
    if (!byTrace.has(tid)) {
      byTrace.set(tid, { retrieves: [], calls: [] });
      ordered.push(tid);
    }
    const bucket = byTrace.get(tid)!;
    if (e.event === 'retrieve') bucket.retrieves.push(e);
    else bucket.calls.push(e);
  }

  const chains: QueryChain[] = [];
  for (const tid of ordered) {
    const { retrieves, calls } = byTrace.get(tid)!;
    const r = retrieves[0];
    if (r === undefined) continue;
    const shortlisted = candidateTools(r);
    const c = calls[0];
    const crow = c !== undefined ? asLine(c) : undefined;
    const rrow = asLine(r);
    const calledTool = crow !== undefined ? asString(crow.tool) : undefined;
    const rank = crow !== undefined ? asNumber(crow.rank) : undefined;
    chains.push({
      traceId: tid,
      query: asString(rrow.query) ?? '',
      confidence: asString(rrow.confidence) ?? 'unknown',
      shortlisted,
      calledTool,
      callOk: crow !== undefined ? asBool(crow.ok) : undefined,
      rank,
    });
  }
  return chains.sort((a, b) => eventTs(a as unknown as AuditLine) - eventTs(b as unknown as AuditLine));
}

export function aggregateToolStats(events: readonly AuditLine[]): ToolStats[] {
  const map = new Map<string, { searched: number; called: number; misses: number; ranks: number[] }>();

  const bump = (tool: string) => {
    if (!map.has(tool)) map.set(tool, { searched: 0, called: 0, misses: 0, ranks: [] });
    return map.get(tool)!;
  };

  for (const e of events) {
    if (e.event === 'retrieve') {
      for (const t of candidateTools(e)) bump(t).searched += 1;
    } else if (e.event === 'call') {
      const tool = asString(asLine(e).tool);
      if (tool !== undefined) {
        const rec = bump(tool);
        rec.called += 1;
        const rank = asNumber(asLine(e).rank);
        if (rank !== undefined && rank > 0) rec.ranks.push(rank);
      }
    } else if (e.event === 'call_miss') {
      const tool = asString(asLine(e).tool);
      if (tool !== undefined) bump(tool).misses += 1;
    }
  }

  const allShortlisted = new Set<string>();
  for (const e of events) {
    if (e.event === 'retrieve') for (const t of candidateTools(e)) allShortlisted.add(t);
  }

  const out: ToolStats[] = [];
  for (const [tool, s] of map) {
    const avgRank = s.ranks.length > 0 ? s.ranks.reduce((a, b) => a + b, 0) / s.ranks.length : null;
    out.push({
      tool,
      searched: s.searched,
      called: s.called,
      misses: s.misses,
      avgRank,
      qualityScore: toolQuality(s.searched, s.called, s.misses, avgRank),
    });
  }

  return out.sort((a, b) => b.called - a.called || a.tool.localeCompare(b.tool));
}

export function aggregateUnusedTools(events: readonly AuditLine[], catalogTools: readonly string[]): string[] {
  const called = new Set<string>();
  const searched = new Set<string>();
  for (const e of events) {
    if (e.event === 'call') {
      const t = asString(asLine(e).tool);
      if (t !== undefined) called.add(t);
    }
    if (e.event === 'retrieve') for (const t of candidateTools(e)) searched.add(t);
  }
  const known = catalogTools.length > 0 ? catalogTools : [...searched];
  return known.filter((t) => !called.has(t)).sort();
}

export function aggregateServers(events: readonly AuditLine[]): ServerStats[] {
  const latest = new Map<string, { toolCount: number; ok: boolean }>();
  const usage = new Map<string, number>();

  for (const e of events) {
    if (e.event === 'server_snapshot' && Array.isArray(asLine(e).servers)) {
      for (const s of asLine(e).servers as unknown[]) {
        if (typeof s === 'object' && s !== null && typeof (s as { id?: string }).id === 'string') {
          const row = s as { id: string; toolCount?: number; ok?: boolean };
          latest.set(row.id, {
            toolCount: asNumber(row.toolCount) ?? 0,
            ok: asBool(row.ok) ?? true,
          });
        }
      }
    }
    if (e.event === 'call') {
      const sid = asString(asLine(e).serverId);
      if (sid !== undefined) usage.set(sid, (usage.get(sid) ?? 0) + 1);
    }
  }

  return [...latest.entries()]
    .map(([id, s]) => ({ id, toolCount: s.toolCount, ok: s.ok, usage: usage.get(id) ?? 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function aggregateEvalRuns(events: readonly AuditLine[]): AuditLine[] {
  return events.filter((e) => e.event === 'eval_run');
}

export interface ToolCount {
  readonly tool: string;
  readonly count: number;
}

export interface ServerTokenSavings {
  readonly serverId: string;
  readonly tokensSaved: number;
}

export interface AuditReportSummary {
  readonly totalRetrieves: number;
  readonly totalCalls: number;
  readonly conversionRate: number;
  readonly topSearchedTools: readonly ToolCount[];
  readonly topCalledTools: readonly ToolCount[];
  readonly toolsNeverCalled: readonly string[];
  readonly serversNeverUsed: readonly string[];
  readonly avgCandidateCount: number;
  readonly lowConfidenceRate: number;
  readonly callMissRate: number;
  readonly tokenSavingsPerQuery: number;
  readonly tokenSavingsPerServer: readonly ServerTokenSavings[];
  readonly estimatedDollarSavings: number;
}

function serverFromTool(tool: string): string | undefined {
  const dot = tool.indexOf('.');
  return dot > 0 ? tool.slice(0, dot) : undefined;
}

function topCounts(counts: Map<string, number>, limit = 10): ToolCount[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([tool, count]) => ({ tool, count }));
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** High-level audit summary for CLI `report` output. */
export function aggregateAudit(events: readonly AuditLine[]): AuditReportSummary {
  const overview = aggregateOverview(events);
  const toolStats = aggregateToolStats(events);

  const searched = new Map<string, number>();
  const called = new Map<string, number>();
  for (const s of toolStats) {
    if (s.searched > 0) searched.set(s.tool, s.searched);
    if (s.called > 0) called.set(s.tool, s.called);
  }

  const retrievedTools = new Set<string>();
  const calledTools = new Set<string>();
  const retrievedServers = new Set<string>();
  const calledServers = new Set<string>();
  const serverSavings = new Map<string, number>();

  let candidateSum = 0;
  let lowConfidenceCount = 0;

  for (const e of events) {
    const row = asLine(e);
    if (e.event === 'retrieve') {
      const tools = candidateTools(e);
      candidateSum += tools.length;
      const conf = asString(row.confidence);
      if (conf === 'low' || conf === 'none') lowConfidenceCount += 1;
      const saved = asNumber(row.estimatedTokenSavings) ?? 0;
      const share = tools.length > 0 ? saved / tools.length : 0;
      for (const t of tools) {
        retrievedTools.add(t);
        const server = serverFromTool(t);
        if (server !== undefined) {
          retrievedServers.add(server);
          serverSavings.set(server, (serverSavings.get(server) ?? 0) + share);
        }
      }
    } else if (e.event === 'call' && asBool(row.ok)) {
      const tool = asString(row.tool);
      if (tool !== undefined) {
        calledTools.add(tool);
        const sid = asString(row.serverId) ?? serverFromTool(tool);
        if (sid !== undefined) calledServers.add(sid);
      }
    }
  }

  const toolsNeverCalled = [...retrievedTools].filter((t) => !calledTools.has(t)).sort();
  const serversNeverUsed = [...retrievedServers].filter((s) => !calledServers.has(s)).sort();

  const totalRetrieves = overview.retrieveCount;
  const totalCalls = overview.callCount;
  const callAttempts = overview.callCount + overview.callMissCount;

  return {
    totalRetrieves,
    totalCalls,
    conversionRate: round(totalRetrieves > 0 ? totalCalls / totalRetrieves : 0, 4),
    topSearchedTools: topCounts(searched),
    topCalledTools: topCounts(called),
    toolsNeverCalled,
    serversNeverUsed,
    avgCandidateCount: round(totalRetrieves > 0 ? candidateSum / totalRetrieves : 0, 2),
    lowConfidenceRate: round(totalRetrieves > 0 ? lowConfidenceCount / totalRetrieves : 0, 4),
    callMissRate: round(callAttempts > 0 ? overview.callMissCount / callAttempts : 0, 4),
    tokenSavingsPerQuery: round(
      totalRetrieves > 0 ? overview.totalEstimatedTokenSavings / totalRetrieves : 0,
      0,
    ),
    tokenSavingsPerServer: [...serverSavings.entries()]
      .map(([serverId, tokensSaved]) => ({ serverId, tokensSaved: round(tokensSaved, 0) }))
      .sort((a, b) => b.tokensSaved - a.tokensSaved || a.serverId.localeCompare(b.serverId)),
    estimatedDollarSavings: round(overview.totalEstimatedCostSavingsUsd, 6),
  };
}

export function aggregateRecommendations(events: readonly AuditLine[], weakQueries: readonly string[] = []): Recommendation[] {
  const recs: Recommendation[] = [];
  const tokenHits = new Map<string, number>();

  for (const e of events) {
    if (e.event !== 'retrieve') continue;
    const row = asLine(e);
    const query = asString(row.query) ?? '';
    const tools = candidateTools(e);
    const toks = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
    for (const tok of toks) {
      for (const tool of tools) {
        if (!tool.toLowerCase().includes(tok)) {
          tokenHits.set(tok, (tokenHits.get(tok) ?? 0) + 1);
        }
      }
    }
    if (row.confidence === 'low' || row.confidence === 'none') {
      const top = tools[0];
      if (top !== undefined && query.length > 0) {
        const words = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
        for (const w of words.slice(0, 3)) {
          recs.push({
            kind: 'overlay',
            token: w,
            suggestion: `Add "${w}" to keywords for ${top}`,
            reason: `Low-confidence retrieve for "${query}"`,
          });
        }
      }
    }
  }

  for (const [tok, count] of [...tokenHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    recs.push({
      kind: 'synonym',
      token: tok,
      suggestion: `Consider synonym expansion for "${tok}"`,
      reason: `Query term often absent from top shortlisted tools (${count} retrieves)`,
    });
  }

  for (const q of weakQueries.slice(0, 5)) {
    recs.push({
      kind: 'overlay',
      token: q.slice(0, 20),
      suggestion: 'Review weak eval case — tune synonyms or overlays',
      reason: `Weak eval case: "${q}"`,
    });
  }

  const seen = new Set<string>();
  return recs.filter((r) => {
    const key = `${r.kind}:${r.token}:${r.suggestion}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface SavingsBreakdown {
  readonly key: string;
  readonly fullCatalogSchemaTokens: number;
  readonly shortlistSchemaTokens: number;
  readonly estimatedTokensSaved: number;
  readonly estimatedCostSaved: number;
  readonly retrieveCount: number;
}

function accumulateSavings(
  events: readonly AuditLine[],
  keyFn: (e: AuditLine) => string | undefined,
): SavingsBreakdown[] {
  const map = new Map<string, { catalog: number; shortlist: number; saved: number; cost: number; n: number }>();
  for (const e of events) {
    if (e.event !== 'retrieve') continue;
    const key = keyFn(e);
    if (key === undefined || key === '') continue;
    const row = asLine(e);
    const rec = map.get(key) ?? { catalog: 0, shortlist: 0, saved: 0, cost: 0, n: 0 };
    rec.catalog += asNumber(row.totalSchemaTokens) ?? 0;
    rec.shortlist += asNumber(row.shortlistSchemaTokens) ?? 0;
    rec.saved += asNumber(row.estimatedTokenSavings) ?? 0;
    rec.cost += asNumber(row.estimatedCostSavingsUsd) ?? 0;
    rec.n += 1;
    map.set(key, rec);
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      fullCatalogSchemaTokens: Math.round(v.catalog),
      shortlistSchemaTokens: Math.round(v.shortlist),
      estimatedTokensSaved: Math.round(v.saved),
      estimatedCostSaved: Math.round(v.cost * 1_000_000) / 1_000_000,
      retrieveCount: v.n,
    }))
    .sort((a, b) => b.estimatedTokensSaved - a.estimatedTokensSaved || a.key.localeCompare(b.key));
}

export function aggregateSavingsByServer(events: readonly AuditLine[]): SavingsBreakdown[] {
  return accumulateSavings(events, (e) => {
    const tools = candidateTools(e);
    const servers = new Set(tools.map((t) => serverFromTool(t)).filter((s): s is string => s !== undefined));
    return servers.size === 1 ? [...servers][0] : 'mixed';
  });
}

export function aggregateSavingsByTool(events: readonly AuditLine[]): SavingsBreakdown[] {
  const map = new Map<string, { catalog: number; shortlist: number; saved: number; cost: number; n: number }>();
  for (const e of events) {
    if (e.event !== 'retrieve') continue;
    const row = asLine(e);
    const tools = candidateTools(e);
    const saved = asNumber(row.estimatedTokenSavings) ?? 0;
    const cost = asNumber(row.estimatedCostSavingsUsd) ?? 0;
    const catalog = asNumber(row.totalSchemaTokens) ?? 0;
    const shortlist = asNumber(row.shortlistSchemaTokens) ?? 0;
    const share = tools.length > 0 ? 1 / tools.length : 0;
    for (const tool of tools) {
      const rec = map.get(tool) ?? { catalog: 0, shortlist: 0, saved: 0, cost: 0, n: 0 };
      rec.catalog += catalog * share;
      rec.shortlist += shortlist * share;
      rec.saved += saved * share;
      rec.cost += cost * share;
      rec.n += share;
      map.set(tool, rec);
    }
  }
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      fullCatalogSchemaTokens: Math.round(v.catalog),
      shortlistSchemaTokens: Math.round(v.shortlist),
      estimatedTokensSaved: Math.round(v.saved),
      estimatedCostSaved: Math.round(v.cost * 1_000_000) / 1_000_000,
      retrieveCount: Math.round(v.n),
    }))
    .sort((a, b) => b.estimatedTokensSaved - a.estimatedTokensSaved || a.key.localeCompare(b.key));
}

export function aggregateSavingsByAgent(events: readonly AuditLine[]): SavingsBreakdown[] {
  return accumulateSavings(events, (e) => asString(asLine(e).agentId));
}

export function aggregateSavingsBySession(events: readonly AuditLine[]): SavingsBreakdown[] {
  return accumulateSavings(events, (e) => asString(asLine(e).sessionId));
}

export interface SavingsReport {
  readonly overview: AuditOverview;
  readonly byServer: readonly SavingsBreakdown[];
  readonly byTool: readonly SavingsBreakdown[];
  readonly byAgent: readonly SavingsBreakdown[];
  readonly bySession: readonly SavingsBreakdown[];
}

export function aggregateSavingsReport(events: readonly AuditLine[]): SavingsReport {
  return {
    overview: aggregateOverview(events),
    byServer: aggregateSavingsByServer(events),
    byTool: aggregateSavingsByTool(events),
    byAgent: aggregateSavingsByAgent(events),
    bySession: aggregateSavingsBySession(events),
  };
}
