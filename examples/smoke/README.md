# Product smoke tests

End-to-end validation using **real public MCP servers** — no fake echo fixtures, no API keys.

## Federated downstreams (default)

| Server | Package | Auth |
|--------|---------|------|
| filesystem | `@modelcontextprotocol/server-filesystem` | None |
| memory | `@modelcontextprotocol/server-memory` | None |
| everything | `@modelcontextprotocol/server-everything` | None |
| git (optional) | `uvx mcp-server-git` | None (local repo) |

Git is included when `uvx` is on PATH (CI/Linux may skip it).

## Scripts

| File | Purpose |
|------|---------|
| [`run-smoke.mjs`](run-smoke.mjs) | Full orchestrator: doctor, eval, MCP protocol, audit CLI |
| [`mcp-smoke.mjs`](mcp-smoke.mjs) | Protocol checklist over real federation |
| [`build-real-config.mjs`](build-real-config.mjs) | Writes multi-server `quartermaster.json` |
| [`audit-cli-smoke.mjs`](audit-cli-smoke.mjs) | report, savings, inspect, eval --from-audit, dashboard |
| [`run-gjs-eval.mjs`](run-gjs-eval.mjs) | Optional GitHub+Slack eval (skips without tokens) |

## From repo root

```bash
pnpm smoke          # CI: npm pack → install → full smoke
pnpm smoke:local    # dev bins, no pack
pnpm smoke:npx      # npx quartermaster-mcp from npm registry
```

## Fixtures

- [`eval-cases-real-servers.jsonl`](eval-cases-real-servers.jsonl) — labeled queries across filesystem, memory, everything, git
- [`cursor-mcp.json.example`](cursor-mcp.json.example) — Cursor host wiring
- [`CURSOR-E2E.md`](CURSOR-E2E.md) — manual host scenarios

See [docs/testing.md](../../docs/testing.md) for the full playbook.
