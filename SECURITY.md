# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Trust model

Quartermaster is designed for **local MCP use** over stdio. The operator who
writes `quartermaster.json` and runs `quartermaster-mcp` is fully trusted.

### Arbitrary process execution

In federated mode, each `servers[]` entry spawns a child process via `command` +
`args` with a merged environment. Anyone who can edit the config (or control the
config path passed to `--config`) can execute arbitrary commands as the user
running the proxy. This is standard for MCP proxy patterns — treat config files
like shell scripts.

### Environment variable interpolation

`servers[].env` values may reference `${VAR}`, resolved from `process.env` at
connect time. Unset variables fail fast. Resolved secrets (e.g. `GITHUB_TOKEN`)
are passed to downstream child processes — understand the blast radius before
federating token-gated servers.

### External config files

`synonymsFile` and `overlaysFile` are resolved relative to the config file and
**must stay within the config directory**. Paths that escape via `../` are
rejected at load time.

### MCP-layer authentication

Stdio transport relies on the host process boundary (Cursor, Claude Desktop, etc.).
There is no network authentication or encryption for the stdio MCP boundary
itself. Quartermaster does provide a local policy engine for `call_tool`
authorization decisions, but it is not a substitute for network auth. **Do not
expose `quartermaster-mcp` as a network service** without additional hardening.

### `call_tool` policy and validation

Before forwarding a `call_tool` request, Quartermaster evaluates configured
policy rules and validates arguments against the captured downstream
`inputSchema` when one is available. Invalid calls return an MCP tool error and
log a `validation_error`. Downstream servers should still validate their own
inputs; schemas can be missing, incomplete, or intentionally permissive.

### Resource controls

Quartermaster supports per-server `callTimeoutMs`, `connectTimeoutMs`,
`maxConcurrency`, and circuit breaker settings. These controls reduce blast
radius but are not a full rate-limiting or sandboxing system. Downstream tools
still run with the permissions of their configured process or remote endpoint.

### Audit redaction

When `QM_AUDIT=1`, audit events are written to stderr and optionally
`QM_AUDIT_FILE`. Quartermaster redacts likely secret keys and bearer tokens
before writing audit events, but operators should still choose audit file
locations and retention policies carefully.

## Reporting a vulnerability

Please report security issues privately via [GitHub Security Advisories](https://github.com/PranavNagrecha/quartermaster/security/advisories/new)
or email the repository owner. Do not open public issues for undisclosed
vulnerabilities.

We aim to acknowledge reports within 72 hours.
