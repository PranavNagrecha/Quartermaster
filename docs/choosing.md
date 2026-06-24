# Quartermaster vs Anthropic Tool Search (vs rolling your own)

Three ways to tackle "too many tools." Pick by **which host you're on** and how
much you want to build yourself.

## Quick decision

- **Using an MCP client** (Claude Code, Cursor, Claude Desktop, Continue, Cline)
  with **several MCP servers** and the tool list is bloating context → use the
  **`quartermaster-mcp` proxy**. Drop it in front; the client sees three meta-tools
  (`retrieve_tools`, `call_tool`, `list_servers`) instead of hundreds. Offline, host-agnostic,
  self-contained (one npm package, no embedding model).
- **On the Anthropic API specifically** and happy to be Anthropic-only → consider
  **Anthropic's native Tool Search** (server-side, `defer_loading`). It's first-
  party and needs nothing extra — but it only works through the Anthropic API.
- **Building your own agent / app** (you call an LLM yourself, you hold the tool
  list in process) → you don't need a proxy at all. Rank the manifest in-process
  and hand the shortlist to your prompt. Quartermaster's ranker isn't published as
  a standalone library, but it's ~a few hundred lines of dependency-free
  TypeScript in [`packages/core`](../packages/core/) — copy it or vendor it.

## Comparison

| | `quartermaster-mcp` (proxy) | Anthropic Tool Search |
|---|---|---|
| Form | MCP stdio proxy (run) | host/API feature |
| You provide | downstream MCP servers | tools w/ `defer_loading` |
| Host-agnostic | ✅ any MCP client | ❌ Anthropic API only |
| Offline / no model | ✅ (only dep: the MCP SDK) | n/a (server-side) |
| Ranking | BM25 + offline expansion | BM25 / regex (built-in) |
| Executes tools | ✅ forwards `call_tool` | ✅ (the API) |
| Best when | a fixed set of MCP servers | already all-in on Anthropic |

## Notes

- Quartermaster's niche vs Tool Search: **host-agnostic + no model dependency +
  advises-not-decides**. If you're Anthropic-only, Tool Search is the lower-effort
  path; if you need to work across clients/models or stay offline, use Quartermaster.
- The proxy is self-contained: the ranker is bundled in, so `npx quartermaster-mcp`
  pulls one package (plus the MCP SDK) — same numbers as the bench
  ([benchmarks](benchmarks.md)).
