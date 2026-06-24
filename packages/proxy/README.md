# quartermaster-mcp

A drop-in, offline MCP proxy that federates N downstream MCP servers behind two
tools — `retrieve_tools` (a ranked, schema-hydrated shortlist for a query) and
`call_tool` (forwards the chosen tool to the right downstream). The client loads
two tools instead of every downstream schema.

**Self-contained:** the BM25/TF-IDF ranker is bundled in, so the only runtime
dependency is the MCP SDK — no embedding model, no network, no API key.

```bash
npx quartermaster-mcp --config ./quartermaster.json
```

## Idea

```
client ──► quartermaster-mcp ──► github-mcp
                  │         └──► jira-mcp
                  │         └──► slack-mcp
                  ▼
          exposes ONE tool: retrieve_tools(query) → ranked shortlist
```

The client loads a single tool instead of every downstream schema. On a query,
`retrieve_tools` returns the top-K relevant tools (offline BM25, no model), and
the host LLM picks from them.

## Config

Federate live downstream servers (`${VAR}` is resolved from the environment at
launch; an unset var fails fast):

```json
{
  "servers": [
    {
      "id": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    }
  ]
}
```

A static manifest also works for discovery-only use — give `tools` (a fixed
`{ name, description }[]`) instead of `servers`, optional `synonyms`, and `k`.

Run it:

```bash
npx quartermaster-mcp --config ./quartermaster.json
```

Federated mode when the config has `servers` (spawns + aggregates them); static
mode when it has `tools`. Serves `retrieve_tools` + `call_tool` over MCP stdio.
