# Quartermaster MCP Gateway

Quartermaster is a **single MCP gateway** — not a registry, marketplace, or hosted SaaS. Configure one MCP server in your client (`quartermaster-mcp`); Quartermaster connects to downstream MCP servers from `quartermaster.json`, routes tool discovery, enforces policy, audits usage, and reports token savings.

## One-server setup

```json
{
  "mcpServers": {
    "quartermaster": {
      "command": "npx",
      "args": ["-y", "quartermaster-mcp", "--config", "/path/to/quartermaster.json"],
      "env": {
        "QM_AUDIT": "1",
        "QM_AUDIT_FILE": "/path/to/audit.jsonl"
      }
    }
  }
}
```

## MCP surface

| Meta-tool | Purpose |
|-----------|---------|
| `retrieve_tools` | Ranked shortlist with schemas for a natural-language query |
| `call_tool` | Forward `server.tool` to the correct downstream |
| `list_servers` | Debug: connected servers and tool counts |

Downstream tools are namespaced as `server.tool`. The client does not load every downstream schema directly.

## Policy

Configure inline or via `policyFile`:

```json
{
  "policy": {
    "defaultMode": "allow",
    "mode": "enforce",
    "presets": ["shell", "filesystem_write"],
    "rules": [{ "effect": "deny", "serverId": "prod" }]
  }
}
```

- `mode: shadow` logs denials without blocking (safe rollout)
- Test: `quartermaster policy test --config quartermaster.json --tool github.create_issue`

Presets: `filesystem_write`, `shell`, `deploy`, `delete`, `network_exfiltration`

## Schema validation

`call_tool` validates arguments against the downstream `inputSchema` before forward. Invalid calls return an MCP tool error and log `validation_error`.

## Audit

Enable with `QM_AUDIT=1`. See [audit-schema.md](./audit-schema.md) for the v2 JSONL format. Secrets in arguments are redacted before write.

## Savings

```bash
quartermaster savings --audit audit.jsonl --json
quartermaster report --audit audit.jsonl --out report.html
```

Configure pricing in `quartermaster.json`:

```json
{
  "pricing": {
    "costPer1kTokensUsd": 0.003,
    "tokenEstimateMethod": "chars/4"
  }
}
```

## Reliability

Per-server options in `servers[]`:

- `callTimeoutMs`, `connectTimeoutMs`
- `maxConcurrency`
- `circuitBreaker: { failureThreshold, resetMs }`

Health snapshots appear in audit `server_snapshot` events.

## Diagnostics

```bash
quartermaster doctor --config quartermaster.json
quartermaster inspect --config quartermaster.json --audit audit.jsonl
```

## Eval from traffic

```bash
quartermaster eval --from-audit audit.jsonl --draft-cases cases.jsonl
quartermaster eval --config quartermaster.json --cases cases.jsonl --weak-only
```

See [examples/ci/eval-gate.yml](../examples/ci/eval-gate.yml) for a CI gate pattern.

## What Quartermaster is not

- Web UI
- MCP registry or marketplace
- Account or billing system
- Network service (stdio-first; see SECURITY.md before exposing over HTTP)
