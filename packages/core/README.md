# @quartermaster/core

The offline, zero-dependency ranker behind [Quartermaster](../../README.md).
No embedding model, no network, no runtime dependencies.

> **Internal package — not published to npm.** It is **bundled into
> [`quartermaster-mcp`](../proxy/)** at build time, so installing the proxy is all
> you need. This is a workspace package used by the proxy, the benchmarks, and the
> tests. (Want it standalone? It's ~a few hundred lines of dependency-free
> TypeScript — copy or vendor `src/index.ts`.)

```ts
import { createRouter } from '@quartermaster/core';

const router = createRouter(tools, {
  ranker: 'bm25',          // 'bm25' (default) | 'tfidf'
  synonyms: { bug: ['issue'] }, // optional query expansion; omit for pure lexical
});

const shortlist = router.search('how do I file a bug?', 8);
```

## API

### `createRouter(tools, config?) => { search }`

- `tools: Tool[]` — `{ name, description?, keywords?, category? }`. Only `name` required.
- `config: RouterConfig` — `ranker`, `synonyms`, `stopwords`, `nameWeight`, `k1`, `b`, `expansionWeight`.
- `search(query, k = 8, opts?): ToolCandidate[]` — `{ tool, score, category }[]`, highest score first.
  - `{ includeDescription: true }` → adds each tool's `description` to its candidate (so the host LLM can choose from more than the name; the proxy uses this).
  - `{ explain: true }` → adds `matches`, a per-term `{ term, contribution }[]` breakdown (desc) for tuning.
- `route(query, k = 8, opts?): RouteResult` — `search` plus a `confidence`
  (`none` / `low` / `high`) and a `guidance` string for the host LLM, so it knows
  when *not* to trust the shortlist. `none` = nothing matched; `low` = top
  candidates near-tied (relative `marginThreshold`, default 0.15); `high` = clear winner.

### Why these defaults

- **BM25** (`k1=1.5`, `b=0.75`) is the default — it beats plain TF-IDF on tool
  retrieval and is what Anthropic's native Tool Search and mcpproxy-go also use.
- The tool **name is weighted** (`nameWeight=2`) because the name encodes intent
  (`create_issue`) even when the prose description doesn't echo the query.
- **Synonyms** are off by default. Supply a map to bridge domain vocabulary;
  expanded terms carry `expansionWeight` so they nudge ranking without washing
  out exact-term matches. `expansionWeight` **auto-defaults by corpus**: `0` (off)
  when average description length is rich (>200 chars, where expansion adds noise),
  `0.5` when terse. Set it explicitly to override.

### Limitations

- **Tokenizer is Latin/ASCII-only.** It splits on non-`[a-z0-9]` characters, so
  CJK and other non-Latin scripts produce no tokens and won't match (queries
  still run safely, just empty). Tool *names* are typically ASCII, so routing for
  ASCII-named tools with non-Latin descriptions still works via the name.
- **O(N) scan per query** — fine to ~1–2k tools (see the perf note in
  [benchmarks](../../docs/benchmarks.md)); not built for tens of thousands.

See [how it works](../../docs/how-it-works.md).
