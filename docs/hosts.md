# Host capability matrix

How Quartermaster fits common MCP hosts. Capabilities evolve — verify against
your host's docs.

| Host | MCP config | Tool bloat pain | Deferred / search tools | Quartermaster fit | Suggested `k` |
|------|------------|-----------------|-------------------------|-------------------|---------------|
| **Cursor** | `.cursor/mcp.json` or project config | High with 3+ servers | No native funnel | **Strong** — [Cursor recipe](recipes/cursor.md) | 8 |
| **Claude Desktop** | `claude_desktop_config.json` | High | No | **Strong** — same `mcpServers` shape as Cursor | 8 |
| **Claude Code** | MCP + plugins | High | Plugin skill available | **Strong** — use retrieve-tools skill | 8 |
| **Continue** | `config.json` mcpServers | Medium–high | No | Good — stdio proxy | 8 |
| **Cline** | MCP settings | Medium–high | No | Good — stdio proxy | 8 |

## Patterns

- **Federated (recommended):** `servers` in `quartermaster.json` — full
  `retrieve_tools` + `call_tool` + `list_servers`.
- **Static:** `tools` manifest only — discovery via `retrieve_tools`; no
  `call_tool` (use downstream servers directly for execution).

## Token win

With ~200 downstream tools and `k=8`, expect ~95–99% reduction in tool-schema
tokens loaded per turn (see [benchmarks.md](benchmarks.md)).
