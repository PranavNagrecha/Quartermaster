# Product smoke tests

End-to-end validation using **real public MCP servers** — a typical **dev workbench**
stack (no API keys, no Jira/Slack required). Config matches the per-team tuning
loop in the README: starter `synonymsFile` plus small org-specific inline synonyms.

## Dev workbench (default)

| Server | Package | Auth |
|--------|---------|------|
| filesystem | `@modelcontextprotocol/server-filesystem` | None |
| memory | `@modelcontextprotocol/server-memory` | None |
| everything | `@modelcontextprotocol/server-everything` | None |
| thinking | `@modelcontextprotocol/server-sequential-thinking` | None |
| git | `uvx mcp-server-git` | None (local repo) |

Git is included when `uvx` is on PATH.

## Per-team config

[`build-real-config.mjs`](build-real-config.mjs) writes a temp config with:

- `synonymsFile: "./business-to-dev.json"` — copied from [`examples/synonyms/business-to-dev.json`](../synonyms/business-to-dev.json)
- Inline org synonyms for dev-only terms (`remember`, `think`, …)
- `ranker.expansionWeight: 0.5` for terse queries

Static template for docs/Cursor: [`quartermaster-dev-workbench.json`](quartermaster-dev-workbench.json)
(place `business-to-dev.json` beside it).

## Scripts

| File | Purpose |
|------|---------|
| [`run-smoke.mjs`](run-smoke.mjs) | Full orchestrator: doctor, eval, MCP protocol, audit CLI |
| [`mcp-smoke.mjs`](mcp-smoke.mjs) | Protocol checklist over real federation |
| [`build-real-config.mjs`](build-real-config.mjs) | Writes multi-server config + synonymsFile |
| [`audit-cli-smoke.mjs`](audit-cli-smoke.mjs) | report, savings, inspect, eval --from-audit, dashboard |
| [`run-gjs-eval.mjs`](run-gjs-eval.mjs) | Optional GitHub+Slack eval (skips without tokens) |

## From repo root

```bash
pnpm smoke          # CI: npm pack → install → full smoke
pnpm smoke:local    # dev bins, no pack
pnpm smoke:npx      # npx quartermaster-mcp from npm registry
```

## Eval cases

- [`eval-cases-dev-workbench.jsonl`](../regression/eval-cases-dev-workbench.jsonl) — colloquial dev queries (folder→directory, history→log, save→commit, …)
- [`cursor-mcp.json.example`](cursor-mcp.json.example) — Cursor host wiring
- [`CURSOR-E2E.md`](CURSOR-E2E.md) — manual host scenarios

Echo fixtures (`eval-cases-echo.jsonl`) remain for proxy unit tests only.

See [docs/testing.md](../../docs/testing.md) for the full playbook.
