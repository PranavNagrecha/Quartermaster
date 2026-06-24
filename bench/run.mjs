// Recall@K bench runner for Quartermaster.
//
// Loads one or more fixture files (bench/cases/*.json), runs each ranker variant
// over each fixture, and reports recall@K + MRR. Falls back to a small built-in
// sample when no fixtures exist yet, so the harness is runnable on its own.
//
// Fixture shape:
//   { "name": "...", "synonyms": { "bug": ["issue"] },
//     "tools": [{ "name": "github.create_issue", "description": "..." }, ...],
//     "cases": [{ "query": "file a bug", "expectedTool": "github.create_issue" }, ...] }
//
// Usage:  node bench/run.mjs            (all fixtures, or the built-in sample)
//         node bench/run.mjs --json     (also write bench/results/<ts>.json)
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouter } from '../packages/core/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KS = [1, 3, 5, 8];

/** A tiny built-in fixture so the harness runs before bench/cases/ is populated. */
const SAMPLE = {
  name: 'builtin-sample',
  synonyms: { bug: ['issue'], file: ['create', 'open'], dm: ['message'], repo: ['repository'] },
  tools: [
    { name: 'github.create_issue', description: 'Open a new issue in a repository' },
    { name: 'github.search_code', description: 'Search source code across repositories' },
    { name: 'github.list_pull_requests', description: 'List open pull requests for a repo' },
    { name: 'slack.post_message', description: 'Send a message to a Slack channel' },
    { name: 'slack.list_channels', description: 'List channels in the workspace' },
    { name: 'calendar.create_event', description: 'Add an event to the calendar' },
    { name: 'jira.create_ticket', description: 'Create a Jira ticket' },
    { name: 'drive.upload_file', description: 'Upload a file to cloud storage' },
  ],
  cases: [
    { query: 'file a bug on the repo', expectedTool: 'github.create_issue' },
    { query: 'find a function in the codebase', expectedTool: 'github.search_code' },
    { query: 'what PRs are open', expectedTool: 'github.list_pull_requests' },
    { query: 'dm the team', expectedTool: 'slack.post_message' },
    { query: 'schedule a meeting', expectedTool: 'calendar.create_event' },
    { query: 'log a ticket', expectedTool: 'jira.create_ticket' },
  ],
};

/** The ranker variants under comparison. (substring baseline lands in P0-3.) */
/**
 * Substring/keyword baseline (mcp-funnel-style): no relevance model — a tool
 * matches if any query token appears as a substring of its text. Charitably
 * ranked by count of matched tokens (mcp-funnel itself does not rank), so this
 * is an upper bound on what pure substring filtering achieves.
 */
function substringRouter(tools) {
  const docs = tools.map((t) => ({
    name: t.name,
    category: t.category ?? null,
    text: `${t.name} ${t.description ?? ''} ${t.keywords ?? ''}`.toLowerCase(),
  }));
  return {
    search(query, k = 8) {
      const toks = [...new Set(query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((t) => t.length > 1))];
      const scored = [];
      for (const d of docs) {
        let c = 0;
        for (const t of toks) if (d.text.includes(t)) c++;
        if (c > 0) scored.push({ tool: d.name, score: c, category: d.category });
      }
      scored.sort((a, b) => b.score - a.score || a.tool.localeCompare(b.tool));
      return scored.slice(0, k);
    },
  };
}

const VARIANTS = [
  { id: 'bm25', build: (f) => createRouter(f.tools) },
  { id: 'bm25+expansion', build: (f) => createRouter(f.tools, { synonyms: f.synonyms ?? {} }) },
  { id: 'tfidf', build: (f) => createRouter(f.tools, { ranker: 'tfidf' }) },
  { id: 'substring', build: (f) => substringRouter(f.tools) },
];

function loadFixtures() {
  const dir = join(HERE, 'cases');
  if (existsSync(dir)) {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (files.length > 0) return files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
  }
  console.log('(no bench/cases/*.json yet — using built-in sample)\n');
  return [SAMPLE];
}

/** rank position (1-based) of expectedTool in the search results, or 0 if absent. */
function rankOf(router, query, expectedTool, k) {
  const results = router.search(query, k);
  const idx = results.findIndex((c) => c.tool === expectedTool);
  return idx === -1 ? 0 : idx + 1;
}

function scoreVariant(build, fixture) {
  const router = build(fixture);
  const recall = Object.fromEntries(KS.map((k) => [k, 0]));
  let mrrSum = 0;
  for (const c of fixture.cases) {
    const rank = rankOf(router, c.query, c.expectedTool, Math.max(...KS));
    if (rank > 0) mrrSum += 1 / rank;
    for (const k of KS) if (rank > 0 && rank <= k) recall[k] += 1;
  }
  const n = fixture.cases.length || 1;
  return {
    recall: Object.fromEntries(KS.map((k) => [k, recall[k] / n])),
    mrr: mrrSum / n,
  };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`.padStart(7);

function main() {
  const fixtures = loadFixtures();
  const out = { generatedAt: new Date().toISOString(), fixtures: [] };

  for (const fixture of fixtures) {
    console.log(`### ${fixture.name}  (${fixture.tools.length} tools, ${fixture.cases.length} cases)`);
    console.log(['variant'.padEnd(16), ...KS.map((k) => `R@${k}`.padStart(7)), 'MRR'.padStart(7)].join(' '));
    const rows = [];
    for (const v of VARIANTS) {
      const s = scoreVariant(v.build, fixture);
      rows.push({ variant: v.id, ...s });
      console.log([v.id.padEnd(16), ...KS.map((k) => pct(s.recall[k])), pct(s.mrr)].join(' '));
    }
    out.fixtures.push({ name: fixture.name, tools: fixture.tools.length, cases: fixture.cases.length, rows });
    console.log('');
  }

  if (process.argv.includes('--json')) {
    const dir = join(HERE, 'results');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${out.generatedAt.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`wrote ${file}`);
  }
}

main();
