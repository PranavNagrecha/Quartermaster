# Quickstart

> Quartermaster is a **single package** — `quartermaster-mcp`, on npm. The
> ranker, policy engine, audit helpers, validation, and CLI are bundled into the
> gateway.

## Run the proxy

Put `quartermaster-mcp` in front of N MCP servers; the client loads three meta-tools
(`retrieve_tools`, `call_tool`, `list_servers`) instead of every downstream schema.
Use `list_servers` to inspect connected downstreams and tool counts. Write a
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
[`packages/proxy`](../packages/proxy/), the [gateway guide](gateway.md), and the
[Cursor recipe](recipes/cursor.md).

## Optional controls

Add policy, pricing, and reliability controls as needed:

```json
{
  "policy": {
    "mode": "shadow",
    "presets": ["shell", "filesystem_write"]
  },
  "pricing": {
    "costPer1kTokensUsd": 0.003,
    "tokenEstimateMethod": "chars/4"
  }
}
```

```bash
quartermaster doctor --config quartermaster.json
quartermaster policy test --config quartermaster.json --tool github.create_issue
quartermaster savings --audit audit.jsonl --json
```

Optional: `synonymsFile` pointing at
[`examples/synonyms/business-to-dev.json`](../examples/synonyms/business-to-dev.json)
bridges colloquial vocabulary (`bug`→`issue`, `folder`→`directory`). Per-team
tuning loop: [README § Closing the gap](../README.md#closing-the-gap-per-team-not-per-developer).

## Next

- [Getting started](getting-started.md) (plain-language onboarding)
- [How it works](how-it-works.md)
- [Quartermaster vs Anthropic Tool Search](choosing.md)
- [Benchmarks](benchmarks.md)
