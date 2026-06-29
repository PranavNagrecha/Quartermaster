# Testing Quartermaster

Layered playbook for validating the product end-to-end. The **npm consumer path**
(`npx quartermaster-mcp`) is the priority; source checkout is for development.

## Quick commands

| Goal | Command |
|------|---------|
| Unit + integration tests | `pnpm -r build && pnpm -r test` |
| Benchmark smoke | `pnpm bench -- --ci` |
| Full product smoke (CI) | `pnpm smoke` |
| Local bins (dev) | `pnpm smoke:local` |
| Published npm (consumer) | `pnpm smoke:npx` |
| Stress test (full) | `pnpm stress` |
| Stress test (quick) | `pnpm stress:quick` |
| Optional GitHub+Slack eval | `node examples/smoke/run-gjs-eval.mjs` |

Automated smoke federates **real public MCP servers** (filesystem, memory,
everything, optional git): doctor, eval, MCP protocol, and the audit CLI loop.

---

## Layer 1: Automated baseline (~5 min)

Floor for every change — same as CI.

```bash
pnpm install --frozen-lockfile
pnpm -r build
pnpm -r lint
pnpm -r test
pnpm bench -- --ci
```

**Proves:** ranker, config, policy, validation, federation with echo fixtures,
MCP protocol over in-memory transport.

**Does not prove:** published tarball, real downstream servers, host agent behavior.

---

## Layer 2: npm consumer smoke (~10 min)

Validates the **published package** from a clean environment.

```bash
mkdir -p /tmp/qm-smoke && cd /tmp/qm-smoke
pnpm smoke:npx   # from repo root, or:
node /path/to/quartermaster/examples/smoke/run-smoke.mjs --npx
```

From CI / pre-publish, use the pack path (installs `npm pack` tarball):

```bash
pnpm smoke
```

**Pass criteria:**
- `--version` prints a semver
- `--validate --config` succeeds
- `quartermaster doctor` reports downstreams connected
- `quartermaster eval --ci --min-r8 0.5` passes on echo cases

Fixtures live in [`examples/smoke/`](../examples/smoke/).

---

## Layer 3: Ranker quality (~15 min)

### Static demo (no MCP host)

```bash
pnpm -r build
node examples/static-demo/demo.mjs
```

### Eval gate with labeled cases

```bash
pnpm quartermaster eval \
  --ci --min-r8 0.5 \
  --config examples/smoke/quartermaster-echo-generated.json \
  --cases examples/smoke/eval-cases-echo.jsonl
```

For GitHub + Slack (requires tokens):

```bash
export GITHUB_TOKEN=...
export SLACK_TOKEN=...
node examples/smoke/run-gjs-eval.mjs
```

### Full benchmarks

```bash
pnpm bench
```

Required before ranker/synonym changes — see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Layer 4: MCP protocol E2E without an LLM (~15 min)

Scripted five-step checklist via stdio:

```bash
# Echo fixture (no API keys)
QM_SMOKE_MODE=echo pnpm smoke:local

# Filesystem downstream (uses os.tmpdir(), realpath-safe on macOS)
QM_SMOKE_MODE=filesystem QM_FILESYSTEM_CONFIG=... QM_FILESYSTEM_ROOT=... \
  node examples/smoke/mcp-smoke.mjs
```

Or run the full orchestrator: `pnpm smoke`.

| Step | Call | Expected |
|------|------|----------|
| 1 | `listTools()` | `retrieve_tools`, `call_tool`, `list_servers` only |
| 2 | `retrieve_tools({ query })` | Right tool ranked; `inputSchema` hydrated |
| 3 | `call_tool({ name, arguments })` | Downstream result returned |
| 4 | `list_servers` | Connected server; `degraded: false` |
| 5 | Bad tool name | `isError: true`, no crash |

Optional: connect an [MCP inspector](https://modelcontextprotocol.io) to the
stdio process for interactive `retrieve_tools` tuning.

---

## Layer 5: Policy, validation, reliability (~10 min)

```bash
npx -p quartermaster-mcp quartermaster policy test \
  --config quartermaster.json --tool github.create_issue
```

- **Shadow mode:** denials logged, calls still forward
- **Enforce mode:** denied tools return `isError` with policy message
- **Invalid args:** `validation_error` in audit, no downstream crash
- **Bad downstream:** `list_servers` shows `degraded: true`

Integration tests: `packages/proxy/test/policy.integration.test.ts`,
`packages/proxy/test/reliability.test.ts`.

---

## Layer 6: Cursor host integration (~30 min)

The user-facing proof. See [`examples/smoke/CURSOR-E2E.md`](../examples/smoke/CURSOR-E2E.md)
and [`docs/recipes/cursor.md`](recipes/cursor.md).

1. Copy [`examples/smoke/cursor-mcp.json.example`](../examples/smoke/cursor-mcp.json.example)
   into `~/.cursor/mcp.json` with absolute paths.
2. Set `QM_AUDIT=1` and `QM_AUDIT_FILE`.
3. Restart Cursor — confirm **3 meta-tools** in the MCP panel.
4. Run the five scenarios in CURSOR-E2E.md.

---

## Layer 7: Audit CLI loop

After a session with audit enabled:

```bash
npx -p quartermaster-mcp quartermaster report --audit audit.jsonl --out report.html
npx -p quartermaster-mcp quartermaster savings --audit audit.jsonl --json
npx -p quartermaster-mcp quartermaster inspect --config quartermaster.json --audit audit.jsonl
npx -p quartermaster-mcp quartermaster eval \
  --from-audit audit.jsonl --draft-cases cases.jsonl --config quartermaster.json
npx -p quartermaster-mcp quartermaster dashboard --audit audit.jsonl
```

Automated: `examples/smoke/audit-cli-smoke.mjs` (run via `pnpm smoke`).

---

## Layer 8: Docker (optional)

```bash
docker build -t quartermaster .
docker run -v /path/to/quartermaster.json:/config/quartermaster.json quartermaster
```

---

## Stress test

Hammer ranker scale, MCP federation, concurrency, and chaos. See
[`examples/stress/README.md`](../examples/stress/README.md).

```bash
pnpm stress           # full (~7s): 2000 ranker ops, 1000-tool static MCP, real federation
pnpm stress:quick     # dev subset
pnpm stress:ci        # CI gates (runs in GitHub Actions)
```

| Scenario | Load |
|----------|------|
| Ranker @ 171 / 500 / 1000 tools | 2000 in-process routes, latency p99 gates |
| Static MCP @ 1000 tools | 150 concurrent `retrieve_tools` over stdio |
| Real federation | 4 public servers, 150 parallel retrieves + 60 `call_tool` forwards |
| Chaos | echo + flaky downstream, circuit breaker, 80 mixed calls |
| Memory | 1000 routes, heap growth &lt; 80MB |

---

## CI coverage

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs:

1. build, lint, test, bench
2. `pnpm smoke` (real MCP servers + pack consumer path)
3. `pnpm stress:ci`
4. eval gate on CLI fixtures (`--min-r8 0.5`)

---

## Release checklist

- [ ] `pnpm -r build && pnpm -r test && pnpm bench -- --ci` green
- [ ] `cd packages/proxy && pnpm publish --dry-run`
- [ ] `pnpm smoke` and `pnpm smoke:npx` pass
- [ ] `pnpm stress` passes
- [ ] `quartermaster doctor` clean on example configs
- [ ] `quartermaster eval --ci --min-r8 0.5` passes
- [ ] Cursor E2E: 3 meta-tools visible, retrieve+call round-trip
- [ ] `quartermaster report` + `savings` on sample audit traffic
- [ ] Update Dockerfile pinned version if applicable
- [ ] Optional: `node examples/smoke/run-gjs-eval.mjs` with live tokens
