# Contributing to Quartermaster

Thanks for your interest! Quartermaster is small on purpose.

## The one rule

**`@pranavnpm/core` stays zero-dependency and has no embedding model.** That
constraint *is* the product. Accuracy improvements must come from better lexical
ranking, query expansion, or light offline techniques — not by adding a model.
If you want an embedding-backed ranker, that belongs in a separate optional
package, never in `core`.

## Setup

```bash
pnpm install
pnpm -r build
pnpm -r test
```

## Before you open a PR

- `pnpm -r build && pnpm -r test` pass.
- If you touched ranking, run `pnpm bench` and put the recall@K before→after in
  the PR. We don't merge ranking changes on vibes.
- Keep new public API documented in the package README.

## Where things are

- `packages/core` — the ranker (the heart): BM25/TF-IDF, weighted + corpus-aware
  expansion, `route()`.
- `packages/proxy` — the MCP proxy server: federation, `retrieve_tools` +
  `call_tool` + `list_servers`, config loader, env interpolation.
- `bench` — recall@K harness + fixtures (synthetic, heritage, blind real-MCP).
- `docs` — quickstart, how-it-works, choosing, benchmarks, recipes.

## Good first issues

- **P1-6** API-docs pass — JSDoc on every export; keep the package READMEs in sync.
- **P3-1** a Claude Code plugin skill that drives the proxy's `retrieve_tools`.
- **P3-2** document Anthropic's `defer_loading` / `tool_reference` integration path.
- **P2-13** opt-in debug logging (`QM_DEBUG=1` → stderr: query / top-K / matched server).
- An `examples/static-demo/` a non-technical reader can run to see the funnel work.
