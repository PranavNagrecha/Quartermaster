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

### No MCP-layer authentication

Stdio transport relies on the host process boundary (Cursor, Claude Desktop, etc.).
There is no authentication, authorization, or encryption at the MCP layer.
**Do not expose `quartermaster-mcp` as a network service** without additional
hardening (not in scope for this project).

### `call_tool` argument forwarding

Arguments passed to `call_tool` are forwarded verbatim to downstream MCP servers
without validation against the captured `inputSchema`. Downstream servers must
validate their own inputs. A confused or malicious LLM could pass malformed args.

### No rate limiting or resource caps

`retrieve_tools` and `call_tool` have no built-in rate limits. Downstream
`callTool` timeouts follow MCP SDK defaults.

## Reporting a vulnerability

Please report security issues privately via [GitHub Security Advisories](https://github.com/PranavNagrecha/quartermaster/security/advisories/new)
or email the repository owner. Do not open public issues for undisclosed
vulnerabilities.

We aim to acknowledge reports within 72 hours.
