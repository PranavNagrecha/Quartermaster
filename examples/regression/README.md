# Regression testing

Runs **smoke + stress twice** and compares metrics between rounds — the way a
dev team would re-run the suite before a release to check for flakiness.

## What runs

**Once per suite:**

- **Audit loop** — `eval --from-audit` on `packages/cli/test/fixtures/sample-audit.jsonl` (draft + replay against dev config)

**Each round (×2):**

1. **Smoke** — dev workbench federation (filesystem, memory, everything, thinking, git)
2. **Stress** — ranker scale, static MCP, federation load, chaos
3. **Dev workbench eval** — live downstreams, `synonymsFile` + org synonyms, colloquial queries
4. **Blind manifest eval** — `bench/cases/real-mcp-blind.json` corpus (no synonyms — honest untuned floor)

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

## Per-team tuning (dev workbench)

Config is built by [`build-real-config.mjs`](../smoke/build-real-config.mjs):

| Piece | Source |
|-------|--------|
| `synonymsFile` | `examples/synonyms/business-to-dev.json` |
| Org synonyms | Inline in generated config (`remember`, `think`, …) |
| Eval cases | [`eval-cases-dev-workbench.jsonl`](eval-cases-dev-workbench.jsonl) |

Blind eval intentionally **omits** synonyms — it measures the untuned floor on a static manifest.

Optional with tokens: `node examples/smoke/run-gjs-eval.mjs` (GitHub + Slack).
