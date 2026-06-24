# quartermaster-mcp

A drop-in MCP proxy that federates N downstream MCP servers behind one offline
`retrieve_tools` function. **Status:** the MCP server + `retrieve_tools` tool are
real and tested over a **static** manifest (P2-1); downstream federation
(spawning servers, aggregating `tools/list`, forwarding calls) is in progress
(P2-3/P2-4). The ranker is [`@pranavnpm/core`](../core/).

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

Today (P2-1) — a static manifest:

```json
{
  "tools": [
    { "name": "github.create_issue", "description": "Open a new issue in a repository" },
    { "name": "slack.post_message",  "description": "Send a message to a Slack channel" }
  ],
  "synonyms": { "bug": ["issue"] },
  "k": 8
}
```

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

## API (programmatic)

```ts
import { createServer, retrieveTools, buildStaticRouter } from 'quartermaster-mcp';

const server = createServer(config);              // MCP Server exposing retrieve_tools
// await startServer(config)                       // boot over stdio (used by the bin, P2-5)

const router = buildStaticRouter(config);
retrieveTools(router, 'file a bug', 5);            // { confidence, guidance, candidates }
```

Run it:

```bash
quartermaster-mcp --config ./quartermaster.json
```

Federated mode when the config has `servers` (spawns + aggregates them); static
mode when it has `tools`. Serves `retrieve_tools` + `call_tool` over MCP stdio.
