# Which Quartermaster do I use? (library vs proxy vs Anthropic Tool Search)

Three ways to tackle "too many tools." Pick by **what you're building** and
**which host you're on**.

## Quick decision

- **Building your own agent / app** (you call an LLM yourself, you hold the tool
  list in process) → use the **`@pranavnpm/core` library**. Rank the tools,
  hand the shortlist to your prompt. Zero dependencies, nothing to run.
- **Using an MCP client** (Claude Code, Cursor, Claude Desktop, Continue, Cline)
  with **several MCP servers** and the tool list is bloating context → use the
  **`quartermaster-mcp` proxy**. Drop it in front; the client sees two tools
  (`retrieve_tools` + `call_tool`) instead of hundreds.
- **On the Anthropic API specifically** and happy to be Anthropic-only → consider
  **Anthropic's native Tool Search** (server-side, `defer_loading`). It's first-
  party and needs nothing extra — but it only works through the Anthropic API.

## Comparison

| | `@pranavnpm/core` | `quartermaster-mcp` | Anthropic Tool Search |
|---|---|---|---|
| Form | library (import) | MCP stdio proxy (run) | host/API feature |
| You provide | the tool manifest | downstream MCP servers | tools w/ `defer_loading` |
| Host-agnostic | ✅ any LLM/app | ✅ any MCP client | ❌ Anthropic API only |
| Offline / zero-dep | ✅ | ✅ (deps: SDK only) | n/a (server-side) |
| Ranking | BM25 + offline expansion | same (via core) | BM25 / regex (built-in) |
| Executes tools | no (you do) | ✅ forwards `call_tool` | ✅ (the API) |
| Best when | custom agent code | a fixed set of MCP servers | already all-in on Anthropic |

## Notes

- The proxy **is** the library plus MCP plumbing — same ranker, same numbers
  ([benchmarks](benchmarks.md)).
- Quartermaster's niche vs Tool Search: **host-agnostic + no model dependency +
  advises-not-decides**. If you're Anthropic-only, Tool Search is the lower-effort
  path; if you need to work across clients/models or stay offline, use Quartermaster.
- Not sure between core and proxy? If you ever type `mcp.json` / `mcpServers`,
  you want the **proxy**. If you write `await llm.messages.create(...)` yourself,
  you want the **library**.
