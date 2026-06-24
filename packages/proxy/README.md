# quartermaster-mcp

A drop-in MCP proxy that federates N downstream MCP servers behind one offline
`retrieve_tools` function. **Scaffold** — the ranker is real
([`@quartermaster/core`](../core/)); the server wiring is in progress.

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

## Config (planned)

```json
{
  "servers": [
    { "id": "github", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
    { "id": "jira",   "command": "npx", "args": ["-y", "jira-mcp"] }
  ],
  "synonyms": { "bug": ["issue"] },
  "k": 8
}
```

```bash
quartermaster-mcp --config ./quartermaster.json
```

See [src/index.ts](src/index.ts) for the intended shape and the TODOs.
