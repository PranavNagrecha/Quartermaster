# Regression testing

Runs **smoke + stress twice** and compares metrics between rounds — the way a
dev team would re-run the suite before a release to check for flakiness.

## What runs (each round)

1. **Smoke** — dev workbench federation (filesystem, memory, everything, thinking, git)
2. **Stress** — ranker scale, static MCP, federation load, chaos
3. **Dev workbench eval** — real downstream tools, colloquial dev queries
4. **Blind manifest eval** — `bench/cases/real-mcp-blind.json` corpus (filesystem + git queries, no synonym tuning)

## Commands

```bash
pnpm -r build
pnpm regression           # 2× full smoke (npm pack) + 2× stress
pnpm regression:local     # 2× with repo bins (faster locally)
pnpm regression:ci        # 2× CI-sized smoke/stress (GitHub Actions)
```

## Stability gates

Between round 1 and round 2:

- Both rounds must pass
- **R@8 must be identical** on eval suites (deterministic ranker)
- Duration / p99 drift is **reported** (logged, not failed unless rounds disagree on pass/fail)

Latest report: [`results/latest.json`](results/latest.json) (written each run).

## Dev workbench (no API keys)

| Server | Package |
|--------|---------|
| filesystem | `@modelcontextprotocol/server-filesystem` |
| memory | `@modelcontextprotocol/server-memory` |
| everything | `@modelcontextprotocol/server-everything` |
| thinking | `@modelcontextprotocol/server-sequential-thinking` |
| git | `uvx mcp-server-git` (when `uvx` on PATH) |

Optional with tokens: `node examples/smoke/run-gjs-eval.mjs` (GitHub + Slack).
