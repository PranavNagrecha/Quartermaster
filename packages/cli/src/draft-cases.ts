import { writeFileSync } from 'node:fs';
import { type AuditLine, type LegacyAuditLine } from '@quartermaster/telemetry';
import type { EvalCase } from './config-tools.js';

const DEFAULT_K = 8;
const REPEATED_NO_MATCH_THRESHOLD = 2;

function asLine(e: AuditLine): LegacyAuditLine {
  return e as LegacyAuditLine;
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

function rankInShortlist(tool: string, shortlisted: readonly string[]): number {
  const idx = shortlisted.indexOf(tool);
  return idx === -1 ? 0 : idx + 1;
}

function countRepeatedNoMatch(events: readonly AuditLine[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.event !== 'retrieve') continue;
    const row = asLine(e);
    if (row.confidence !== 'none') continue;
    const query = asString(row.query);
    if (query === undefined || query === '') continue;
    counts.set(query, (counts.get(query) ?? 0) + 1);
  }
  return counts;
}

/**
 * Pair retrieve events with subsequent call events (same traceId) and emit draft eval cases.
 */
export function draftCasesFromAudit(events: readonly AuditLine[], k = DEFAULT_K): EvalCase[] {
  const repeatedNoMatch = countRepeatedNoMatch(events);
  const byTrace = new Map<string, { retrieves: AuditLine[]; calls: AuditLine[]; misses: AuditLine[] }>();

  for (const e of events) {
    const tid = asString(asLine(e).traceId) ?? `orphan-${byTrace.size}`;
    if (!byTrace.has(tid)) byTrace.set(tid, { retrieves: [], calls: [], misses: [] });
    const bucket = byTrace.get(tid)!;
    if (e.event === 'retrieve') bucket.retrieves.push(e);
    else if (e.event === 'call') bucket.calls.push(e);
    else if (e.event === 'call_miss') bucket.misses.push(e);
  }

  const cases: EvalCase[] = [];

  for (const [, bucket] of byTrace) {
    for (let i = 0; i < bucket.retrieves.length; i++) {
      const r = bucket.retrieves[i]!;
      const rrow = asLine(r);
      const query = asString(rrow.query) ?? '';
      const shortlisted = candidateTools(r);
      const call = bucket.calls[i] ?? bucket.calls[0];
      const miss = bucket.misses[i] ?? bucket.misses[0];

      let expectedTool: string | undefined;
      const weakReasons: string[] = [];

      if (call !== undefined) {
        const crow = asLine(call);
        expectedTool = asString(crow.tool);
        const rank = asNumber(crow.rank) ?? rankInShortlist(expectedTool ?? '', shortlisted);
        if (asBool(crow.ok) === false) weakReasons.push('failed_call');
        if (rank > k) weakReasons.push('rank_outside_shortlist');
        if (asBool(crow.wasShortlisted) === false) weakReasons.push('call_outside_shortlist');
        if (rrow.confidence === 'low' || rrow.confidence === 'none') weakReasons.push('low_confidence');
      } else if (miss !== undefined) {
        expectedTool = asString(asLine(miss).tool);
        weakReasons.push('call_miss');
      }

      if (rrow.confidence === 'none' && (repeatedNoMatch.get(query) ?? 0) >= REPEATED_NO_MATCH_THRESHOLD) {
        weakReasons.push('repeated_no_match');
      }

      if (expectedTool === undefined || query === '') continue;

      cases.push({
        query,
        expectedTool,
        source: 'audit',
        confidence: weakReasons.length > 0 ? 'weak' : 'strong',
        weakReasons: weakReasons.length > 0 ? [...new Set(weakReasons)] : undefined,
      });
    }
  }

  return cases;
}

export function writeDraftCases(path: string, cases: readonly EvalCase[]): void {
  const lines = cases.map((c) => JSON.stringify(c));
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}

export function weakCaseQueries(cases: readonly EvalCase[]): string[] {
  return cases.filter((c) => c.confidence === 'weak').map((c) => c.query);
}

export function filterWeakCases(cases: readonly EvalCase[]): EvalCase[] {
  return cases.filter((c) => c.confidence === 'weak');
}

export function summarizeWeakCases(cases: readonly EvalCase[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of cases) {
    if (c.confidence !== 'weak') continue;
    for (const r of c.weakReasons ?? ['unspecified']) {
      counts[r] = (counts[r] ?? 0) + 1;
    }
  }
  return counts;
}
