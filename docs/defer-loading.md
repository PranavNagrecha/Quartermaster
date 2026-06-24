# Anthropic Tool Search vs Quartermaster (`defer_loading`)

Anthropic's API supports **deferred tool loading**: tools marked with
`defer_loading: true` are not sent in the initial request; the model can search
for them via a built-in `tool_search` mechanism (BM25/regex server-side).

Quartermaster solves a similar problem for **MCP hosts** that load full tool
schemas from every connected server.

## When to use which

| Situation | Recommendation |
|-----------|----------------|
| Anthropic API only, tools defined in API requests | Native `defer_loading` + Tool Search |
| MCP client (Cursor, Claude Desktop, etc.) with N stdio servers | `quartermaster-mcp` proxy |
| Custom agent, you hold the tool list in process | In-process `createRouter` (see [library-integration.md](library-integration.md)) |

## Mapping concepts

| Anthropic | Quartermaster |
|-----------|---------------|
| `defer_loading: true` on tools | Downstream tools hidden behind proxy meta-tools |
| `tool_search` / Tool Search | `retrieve_tools` |
| Model picks tool + args | Model picks from shortlist, calls `call_tool` |
| Server-side BM25 | Offline BM25 in proxy (configurable via `ranker` block) |

## Integration path (API + MCP)

If you use **both** Anthropic API tools and MCP downstream servers:

1. Put MCP servers behind `quartermaster-mcp` in your host config.
2. Expose only `retrieve_tools` + `call_tool` + `list_servers` to the model.
3. For first-party API tools, use `defer_loading` on rarely-used tools.
4. Keep domain synonyms in `quartermaster.json` for MCP vocabulary gaps.

Quartermaster does not replace Anthropic Tool Search — it extends the same funnel
pattern to MCP ecosystems where the API seam is unavailable.

See also [choosing.md](choosing.md).
