# Contributing to Quartermaster

Thanks for your interest! Quartermaster is small on purpose.

## The one rule

**`@quartermaster/core` stays zero-dependency and has no embedding model.** That
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

- `packages/core` — the ranker (the heart).
- `packages/proxy` — the MCP proxy server (scaffold; help wanted).
- `bench` — recall@K harness.
- `docs` — quickstart, how-it-works, benchmarks.

## Good first issues

- Wire the proxy's downstream `tools/list` aggregation (`packages/proxy`).
- Add bench fixtures at 200 / 500 / 1000 tools.
- Test the zero-dependency-hybrid thesis (BM25 + expansion) and report numbers.
