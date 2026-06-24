# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [Unreleased]

### Changed
- **Docs reflect the published packages** — README, quickstart, and the Cursor
  recipe now show the real `npm install @pranavnpm/core` / `npx quartermaster-mcp`
  commands instead of the pre-release "not yet on npm, build from source" notes.

## [0.1.0] - 2026-06-24

First public alpha. Published to npm: **`@pranavnpm/core`** (library) and
**`quartermaster-mcp`** (proxy).

### Added
- `@pranavnpm/core` — offline, zero-dependency tool ranker (BM25 default,
  TF-IDF cosine alternative) with configurable synonym query-expansion. Extracted
  and generalized from sf-intelligence's semantic funnel.
- `quartermaster-mcp` — drop-in MCP proxy: federates N downstream MCP servers
  behind `retrieve_tools` (ranked, schema-hydrated shortlist) + `call_tool`
  (forwards to the right downstream); runnable via `--config`.
- Claude Code plugin manifest + marketplace listing.
- `bench/` recall@K + MRR harness (`bench/run.mjs`): runs BM25 / BM25+expansion /
  TF-IDF over fixture manifests, reports recall@1/3/5/8 and MRR, optional JSON output.
- `bench/generate.mjs` — deterministic synthetic fixture generator (federated
  manifests at 50/200/500/1000 tools with colloquial, vocabulary-gap gold queries
  and a general business→dev synonym overlay). `pnpm bench` now generates then runs.
- `bench/cases/heritage-sfi.json` — real 171-tool sf-intelligence manifest (tool
  names + descriptions only, leak-scanned; generic product surface, not org data)
  with 47 hand-authored colloquial gold queries, as a production-credibility corpus.
- Substring/keyword baseline (mcp-funnel-style) in the bench — the honest "no
  relevance model" floor for comparison. Consistently lowest recall across corpora.
- `docs/benchmarks.md` now carries **real, reproducible numbers** — recall@1/3/5/8
  + MRR for all four rankers across the heritage corpus and synthetic 50–1000-tool
  manifests, plus token-reduction (~95–99%) and the two-regime interpretation.

- **Corpus-aware expansion default** — when `expansionWeight` isn't set, it now
  auto-defaults from the corpus: `0` (off) on rich descriptions (avg >200 chars,
  where expansion adds noise), `0.5` on terse ones. Makes the opt-in toggle
  automatic for operators who won't tune; explicit values still win. Zero-dep, no ML.
- **`route()` low-confidence signal** — `router.route(query, k)` returns the
  shortlist plus `confidence` (`none` / `low` / `high`) and a `guidance` string,
  so the host LLM knows when not to trust the result (nothing matched, or a
  near-tie). Uses a relative margin (BM25 scores are unbounded). Configurable via
  `marginThreshold` / `minTopScore`.
- **External synonym / overlay files (P1-10)** — config `synonymsFile` /
  `overlaysFile` point to external JSON (resolved relative to the config; inline
  values override per key), so domain tuning lives in its own file. Ships a
  starter pack `examples/synonyms/business-to-dev.json` (also seeds P3-9). +2 tests.
- **Per-tool keyword overlays (P2-10)** — config `overlays: { "server.tool": { keywords } }`
  injects extra keywords into a tool's index entry so operators can tune recall
  (e.g. add "bug defect" to `create_issue`) without touching downstream servers.
  `applyOverlays` exposed (pure); validated in `parseConfig`. +4 tests.
- **Downstream `env` interpolation (P2-11)** — config `servers[].env` values may
  reference `${VAR}`, resolved from `process.env` at connect time (unset → fail
  fast with a clear error), merged over the safe default environment. Unblocks
  token-gated downstream servers (GitHub/Slack). `interpolateEnv` exposed (pure);
  validated in `parseConfig`. +4 tests.
- **Graceful partial failure (P2-15)** — a downstream server that fails to start
  is now skipped with a stderr warning (listing which and why) and the proxy runs
  degraded on the rest, instead of the whole proxy failing. Still fails loud only
  if *every* server fails / zero tools result. +1 integration test (real spawn).
- **Clean shutdown (P2-7)** — `closeIndex(index)` closes every downstream client
  (terminating their child processes), and the federated bin now closes them on
  SIGINT/SIGTERM — no leaked subprocesses. +2 tests.
- **Server protocol round-trip test** — a real MCP `Client` now drives the
  federated server *through the protocol* (over an in-memory transport linked to
  the real spawned downstream): `tools/list` returns the three meta-tools, and
  `retrieve_tools` (hydrated), `call_tool` (forwarded), `list_servers`, and the
  `isError` path all verified over the wire — not via helper calls. +5 tests.
- **End-to-end integration test (P2-6)** — a real fake downstream MCP server
  (`test/fixtures/echo-mcp-server.mjs`) is spawned over stdio and federated via
  `buildToolIndex`; tests assert namespaced aggregation + schema capture, that the
  router ranks the right downstream tool, and that `forwardCall` actually executes
  it and returns its content. **Completes the proxy MVP** — `quartermaster-mcp` is
  now runnable end-to-end. +4 tests (real spawn).
- **CLI / bin wiring (P2-5)** — `quartermaster-mcp --config <path>` now actually
  boots the proxy over stdio (federated mode when the config has `servers`, static
  when it has `tools`); the scaffold error stub is gone. `parseCliArgs`,
  `startFromConfig`, `runCli` exposed. +5 tests.
- **Forwarding hardening (P2-4)** — `forwardCall` (and the federated server's
  handlers) now return MCP `isError` tool results on any failure (unknown tool,
  downstream throwing, bad args) instead of throwing a protocol error, so one bad
  call never takes down the proxy session. +3 tests.
- **`list_servers` meta-tool (P2-16)** — the federated server exposes a third
  tool, `list_servers`, returning the connected downstream servers + per-server
  tool counts + total, for model/operator routing debug. `serverSummary` exposed
  (pure). +1 test.
- **Federated server + `call_tool` (P2-9, invocation model A)** —
  `createServerFromIndex(index)` exposes two static tools: `retrieve_tools`
  (discovery, hydrated schemas) and `call_tool(name, arguments)` (execution —
  forwards the chosen namespaced tool to the right downstream client). Meta-executor
  model: host-agnostic, no dynamic tool-list. `resolveCall` (pure) maps a
  namespaced name → client + bare name. +3 tests.
- **Schema hydration (P2-8)** — `retrieveTools(..., schemas)` now hydrates each
  shortlisted candidate with its full `inputSchema`, and `buildToolIndex` captures
  a namespaced-name → inputSchema map from downstream `tools/list`. The host LLM
  gets the full tool definition (name + description + schema) for just the
  shortlist — the token win without losing callability. +2 tests.
- **Decision doc (P3-5)** — [`docs/choosing.md`](docs/choosing.md): when to use the
  `@pranavnpm/core` library vs the `quartermaster-mcp` proxy vs Anthropic's
  native Tool Search, with a comparison table. Linked from the README nav.
- **Cursor host recipe (P3-3)** — [`docs/recipes/cursor.md`](docs/recipes/cursor.md)
  + a committed example proxy config (`examples/cursor/quartermaster.json`): a
  copy-paste `~/.cursor/mcp.json` that runs `quartermaster-mcp` federating
  filesystem + github behind one tool (same `mcpServers` shape works for Claude
  Desktop). A test parses the example config so the recipe can't drift. +1 test.
- **Unweighted-expansion bench row (P1-18)** — the bench now runs a
  `bm25+exp(w=1)` variant alongside the weighted `0.5` one, so `docs/benchmarks.md`
  visibly shows weighting recovering ~6pts of heritage recall@8 (83.0% → 89.4%) —
  the proof of why P1-1 exists.
- **Blind real-MCP corpus (P1-15)** — `bench/cases/real-mcp-blind.json`: tool
  surfaces from real public MCP servers (filesystem/github/git/fetch) + 30
  user-intent queries (not from synonym tables), scored BM25-only. Honest
  external-validity floor — ~37% R@1 / ~73% R@8 untuned — published in
  `docs/benchmarks.md` with the warts (substring edges R@1 on short descriptions).
- **Name-collision policy (P2-14)** — `parseConfig` rejects duplicate server ids
  (they namespace tool names, so a collision would shadow tools); cross-server
  same-named tools stay distinct via `server.tool` namespacing. +2 tests.
- **Bare tool name stored at index time (P2-18)** — `FederatedIndex` now carries
  a `toolToBare` map captured during aggregation; `resolveCall` looks the bare
  downstream name up instead of deriving it by slicing the namespaced name —
  robust to dotted names, no assumption about the prefix. +1 test.
- **Downstream federation (P2-3)** — `buildToolIndex(config)` spawns each
  configured downstream MCP server over stdio, reads its `tools/list`, and
  aggregates every tool (namespaced `${serverId}.${name}`) into one router, with
  a per-tool→server map for call routing. Fails loud on no servers / zero
  aggregated tools. `namespaceTools` exposed (pure). +3 tests (real-spawn test in P2-6).
- **Proxy config loader (P2-2)** — `loadConfig(path)` / `parseConfig(text)` read
  and validate `quartermaster.json` (tools / servers / synonyms / k) with
  zero extra deps and actionable error messages (which field, which index, what's
  wrong). +9 tests.
- **Proxy MCP server (P2-1)** — `quartermaster-mcp` now exposes a real
  `retrieve_tools` tool over MCP (low-level `Server`), returning a
  confidence-annotated shortlist *with descriptions* from a static config
  manifest via `@pranavnpm/core`'s `route()`. `buildStaticRouter` fails loud
  on an empty manifest. Real smoke tests added; the proxy `test` script no longer
  swallows failures (`|| true` removed). Downstream federation + bin wiring follow.
- **Rich candidates** — `search(query, k, { includeDescription: true })` echoes
  each tool's `description` into its candidate, so the host LLM (and the proxy)
  can choose/call from more than the name. Off by default.
- **Perf budget test (P1-4)** — a CI test asserts a 1000-tool index builds +
  serves 200 searches within a generous time budget (real: ~20 ms build / ~2 ms
  per search), so an accidental O(N²) regression fails the build. `docs/benchmarks.md`
  gains a Performance section documenting the O(N)-scan design + ~1–2k tool sweet spot.
- **Core edge-case tests (P1-3)** — empty manifest, single tool, duplicate names,
  all-stopword query, very long descriptions, and the documented CJK/non-Latin
  tokenizer limitation (queries run safely, just don't match). +6 tests; core
  README now lists the Latin-only + O(N)-scan limits.
- **Explain mode** — `search(query, k, { explain: true })` adds a `matches`
  per-term `{ term, contribution }[]` breakdown (sorted, summing to the score) to
  each candidate, for tuning. Off by default (no field added).

### Changed

- **Core package renamed `@quartermaster/core` → `@pranavnpm/core`** for the
  initial npm release (the `@quartermaster` org doesn't exist; published under the
  author's username scope). The proxy and all imports/docs updated; library API unchanged.
- **Docs truth pass** — fixed stale docs that still called the proxy a "scaffold"
  and listed already-done "good first issues": `docs/quickstart.md` (real proxy
  section), `CONTRIBUTING.md` (current layout + real open issues), `examples/README.md`
  (lists the example configs that actually exist). Added explicit "alpha — not yet
  on npm, build from source" notes to the README, quickstart, and Cursor recipe
  (so `npm`/`npx` instructions don't mislead while the packages are unpublished).
- **Docs sync (P2-17)** — root README, the proxy package README, and the
  `index.ts` header no longer call the proxy "scaffolded" (it's built + runnable):
  real proxy quick-start (config + `quartermaster-mcp --config`) and a `route()` /
  `expansionWeight` note in the library quick-start. Static `createServer` handler
  now returns `isError` results (matching the federated path) instead of throwing.
- **Weighted synonym expansion** (`expansionWeight`, default `0.5`, `0` disables):
  synonym-expanded query terms now contribute less than originals, so expansion
  nudges ranking without washing out exact-term matches. Recovers the heritage
  recall@8 regression (83.0% → 89.4%, best MRR) while preserving the large
  terse-corpus win. Benchmarks doc updated to the new numbers.
- README status now carries the **P0 benchmark verdict (GO)**: zero-dependency
  BM25 is a strong router (91.5% recall@8 on a real 171-tool manifest); synonym
  expansion is an opt-in, corpus-tuned win (big on terse manifests, can hurt on
  rich ones). Positioning sharpened to "competitive routing, no model" — not
  "beats hybrid embeddings".
