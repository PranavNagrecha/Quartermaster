---
name: quartermaster-retrieve-tools
description: Route MCP tool discovery through quartermaster-mcp retrieve_tools instead of loading every downstream schema. Use when the user has many MCP tools federated behind Quartermaster.
---

# Quartermaster tool discovery

When `quartermaster-mcp` is configured as an MCP server, use its meta-tools instead of loading all downstream tools.

## Workflow

1. Call `retrieve_tools` with a natural-language `query` describing what the user wants to do.
2. Read the JSON response: `candidates` (ranked tools with descriptions and `inputSchema`), `confidence`, and `guidance`.
3. If `confidence` is `low` or `none`, ask the user to clarify or rephrase before calling a tool.
4. Call `call_tool` with the chosen namespaced tool name (e.g. `github.create_issue`) and its `arguments`.
5. Use `list_servers` when debugging — check `degraded` and `skipped` if routing seems incomplete.

## Example

```
retrieve_tools({ query: "open a bug on the repository", k: 8 })
→ read candidates[0] (likely github.create_issue)
call_tool({ name: "github.create_issue", arguments: { ... } })
```

## Notes

- Do not assume tools exist without checking `retrieve_tools` first — downstream manifests change.
- Prefer `guidance` in the response when confidence is not `high`.
- Set `QM_DEBUG=1` on the proxy process to log scores to stderr when tuning synonyms.
