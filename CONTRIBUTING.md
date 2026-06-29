# Contributing to Quartermaster

Thanks for your interest! Quartermaster is small on purpose.

## The one rule

**The ranker (`@quartermaster/core`) stays zero-dependency and has no embedding
model.** That constraint *is* the product — and it's why the published
`quartermaster-mcp` can bundle the ranker and ship with only the MCP SDK as a
runtime dependency. Accuracy improvements must come from better lexical ranking,
query expansion, or light offline techniques — not by adding a model. If you want
an embedding-backed ranker, that belongs in a separate optional package, never in
`core`.

## Setup

```bash
pnpm install
pnpm -r build
pnpm -r test
pnpm smoke    # product smoke (npm pack consumer path)
```

## Before you open a PR

- `pnpm -r build && pnpm -r test` pass.
- `pnpm smoke` passes (product smoke — see [docs/testing.md](docs/testing.md)).
- If you touched ranking, run `pnpm bench` (or `pnpm bench:regen` to rewrite synthetic fixtures) and put recall@K before→after in the PR.
- Keep new public API documented in the package README.

## Where things are

- `packages/core` — the ranker (the heart): BM25/TF-IDF, weighted + corpus-aware
  expansion, `route()`. Internal/private; **bundled into the proxy** at build time.
- `packages/proxy` — the published package `quartermaster-mcp`: the MCP proxy
  server (federation, `retrieve_tools` + `call_tool` + `list_servers`, config
  loader, env interpolation). Built with esbuild, which inlines `core`.
- `bench` — recall@K harness + fixtures (synthetic, heritage, blind real-MCP).
- `docs` — quickstart, how-it-works, choosing, benchmarks, recipes.

## Good first issues

- **P3-6** Plugin marketplace submission — validate install flow end-to-end.
- Enable GitHub Discussions on the repo (Settings → General → Features).

Completed recently: API-docs pass, Claude plugin skill, `defer_loading` doc,
`QM_DEBUG`, CLI `--help`/`--version`/`--validate`, bench CI smoke, ranker config
in JSON, tools/list refresh.

## Publish dry-run

Maintainers can verify the npm tarball without publishing:

```bash
pnpm -r build
cd packages/proxy && pnpm publish --dry-run
```
