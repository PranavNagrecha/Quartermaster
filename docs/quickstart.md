# Quickstart

> Quartermaster is a **single package** — `quartermaster-mcp`, on npm. The BM25
> ranker is bundled in, so there is nothing else to install.

## Run the proxy

Put `quartermaster-mcp` in front of N MCP servers; the client loads two tools
(`retrieve_tools` + `call_tool`) instead of every downstream schema. Write a
`quartermaster.json`:

```json
{
  "servers": [
    { "id": "github", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" } }
  ]
}
```

```bash
npx quartermaster-mcp --config ./quartermaster.json
# or, from a source checkout:
node packages/proxy/bin/quartermaster-mcp.js --config ./quartermaster.json
```

Federated mode (config has `servers`) spawns + aggregates them; static mode
(config has `tools`) serves a fixed manifest, discovery only. See
[`packages/proxy`](../packages/proxy/) and the
[Cursor recipe](recipes/cursor.md).

## Next

- [Getting started](getting-started.md) (plain-language onboarding)
- [How it works](how-it-works.md)
- [Quartermaster vs Anthropic Tool Search](choosing.md)
- [Benchmarks](benchmarks.md)
