import { createRouter, type Router, type Tool } from '@quartermaster/core';
import type { RouterConfig } from '@quartermaster/core';
import type { EvalCase } from './config-tools.js';

export const KS = [1, 3, 5, 8] as const;
export const DEFAULT_K = 8;

export interface VariantRow {
  readonly variant: string;
  readonly recall: Record<number, number>;
  readonly mrr: number;
}

export interface EvalResult {
  readonly rows: VariantRow[];
  readonly caseCount: number;
  readonly toolCount: number;
}

/** Substring/keyword baseline — token overlap count ranking. */
export function substringRouter(tools: readonly Tool[]): Router {
  const docs = tools.map((t) => ({
    name: t.name,
    category: t.category ?? null,
    text: `${t.name} ${t.description ?? ''} ${t.keywords ?? ''}`.toLowerCase(),
  }));
  return {
    search(query, k = 8) {
      const toks = [...new Set(query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((t) => t.length > 1))];
      const scored: { tool: string; score: number; category: string | null }[] = [];
      for (const d of docs) {
        let c = 0;
        for (const t of toks) if (d.text.includes(t)) c++;
        if (c > 0) scored.push({ tool: d.name, score: c, category: d.category });
      }
      scored.sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool));
      return scored.slice(0, k);
    },
    route(query, k = 8) {
      const candidates = this.search(query, k);
      const top = candidates[0];
      if (top === undefined) {
        return { candidates: [], confidence: 'none' as const, guidance: '' };
      }
      return { candidates, confidence: 'high' as const, guidance: '' };
    },
  };
}

export function buildVariants(
  tools: readonly Tool[],
  synonyms: Readonly<Record<string, readonly string[]>>,
  routerOpts: RouterConfig,
): { id: string; build: () => Router }[] {
  const { synonyms: _synonyms, expansionWeight: _expansionWeight, ...baseOpts } = routerOpts;
  return [
    { id: 'bm25', build: () => createRouter(tools, baseOpts) },
    {
      id: 'bm25+synonyms',
      build: () => createRouter(tools, { ...baseOpts, synonyms, expansionWeight: 0.5 }),
    },
    {
      id: 'bm25+exp(w=1)',
      build: () => createRouter(tools, { ...baseOpts, synonyms, expansionWeight: 1.0 }),
    },
    { id: 'tfidf', build: () => createRouter(tools, { ...baseOpts, ranker: 'tfidf' }) },
    { id: 'substring', build: () => substringRouter(tools) },
  ];
}

function rankOf(router: Router, query: string, expectedTool: string, k: number): number {
  const results = router.search(query, k);
  const idx = results.findIndex((c) => c.tool === expectedTool);
  return idx === -1 ? 0 : idx + 1;
}

function scoreVariant(build: () => Router, cases: readonly EvalCase[]): VariantRow {
  const router = build();
  const recall: Record<number, number> = Object.fromEntries(KS.map((k) => [k, 0]));
  let mrrSum = 0;
  const maxK = Math.max(...KS);
  for (const c of cases) {
    const rank = rankOf(router, c.query, c.expectedTool, maxK);
    if (rank > 0) mrrSum += 1 / rank;
    for (const k of KS) if (rank > 0 && rank <= k) recall[k] = (recall[k] ?? 0) + 1;
  }
  const n = cases.length || 1;
  const recallPct: Record<number, number> = {};
  for (const k of KS) recallPct[k] = (recall[k] ?? 0) / n;
  return { variant: '', recall: recallPct, mrr: mrrSum / n };
}

export function runEval(
  tools: readonly Tool[],
  cases: readonly EvalCase[],
  synonyms: Readonly<Record<string, readonly string[]>>,
  routerOpts: RouterConfig,
): EvalResult {
  const variants = buildVariants(tools, synonyms, routerOpts);
  const rows = variants.map((v) => {
    const s = scoreVariant(v.build, cases);
    return { ...s, variant: v.id };
  });
  return { rows, caseCount: cases.length, toolCount: tools.length };
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`.padStart(6);

export function formatEvalTable(result: EvalResult): string {
  const lines = [
    ['Variant'.padEnd(18), ...KS.map((k) => `R@${k}`.padStart(7)), 'MRR'.padStart(7)].join(' '),
  ];
  for (const row of result.rows) {
    lines.push(
      [
        row.variant.padEnd(18),
        ...KS.map((k) => pct(row.recall[k] ?? 0)),
        pct(row.mrr),
      ].join(' '),
    );
  }
  return lines.join('\n');
}

export function checkCiGate(result: EvalResult, minR8: number): { ok: boolean; message?: string } {
  const bm25 = result.rows.find((r) => r.variant === 'bm25');
  if (bm25 === undefined) return { ok: false, message: 'eval --ci: bm25 variant not found' };
  const r8 = bm25.recall[8] ?? 0;
  if (r8 < minR8) {
    return {
      ok: false,
      message: `eval --ci: bm25 R@8 ${(r8 * 100).toFixed(1)}% below floor ${(minR8 * 100).toFixed(0)}%`,
    };
  }
  return { ok: true };
}
