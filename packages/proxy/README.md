# quartermaster-mcp

A drop-in, offline MCP proxy that federates N downstream MCP servers behind a
small set of meta-tools. The client loads **three** tools instead of every
downstream schema.

| Meta-tool | Federated (`servers`) | Static (`tools`) |
|---|---|---|
| `retrieve_tools` | ranked shortlist + schemas + confidence | ranked shortlist + confidence |
| `call_tool` | forwards to the right downstream | not available (discovery only) |
| `list_servers` | connected servers + tool counts | not available |

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
     retrieve_tools / call_tool / list_servers  (federated)
     retrieve_tools only                        (static manifest)
```

On a query, `retrieve_tools` returns the top-K relevant tools (offline BM25, no
model). The host LLM picks one and invokes it through `call_tool` (federated
mode).

## Config

### Federated (recommended)

Spawn live downstream servers. `${VAR}` is resolved from the environment at
launch; an unset var fails fast:

```json
{
  "servers": [
    {
      "id": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    }
  ],
  "synonyms": { "bug": ["issue"] },
  "k": 8
}
```

Optional ranker tuning (`ranker` block):

```json
{
  "ranker": {
    "ranker": "bm25",
    "expansionWeight": 0.5,
    "marginThreshold": 0.15,
    "hintBoost": 0.1
  }
}
```

Federated deployments can re-poll downstream manifests:

```json
{ "refreshIntervalMs": 300000 }
```

Exposes `retrieve_tools`, `call_tool`, and `list_servers`.

### Static (discovery only)

A fixed tool manifest — useful for demos and ranking experiments. **No**
`call_tool` (nothing to forward to):

```json
{
  "tools": [
    { "name": "github.create_issue", "description": "Open a new issue in a repository" },
    { "name": "slack.post_message", "description": "Send a message to a Slack channel" }
  ],
  "synonyms": { "bug": ["issue"] },
  "k": 8
}
```

See [`examples/static-demo`](../../examples/static-demo/) for a runnable static example.

## Run

```bash
npx quartermaster-mcp --config ./quartermaster.json
```

From a source checkout (after `pnpm -r build`):

```bash
node packages/proxy/bin/quartermaster-mcp.js --config ./quartermaster.json
```

## Security

See [SECURITY.md](../../SECURITY.md) for the trust model and vulnerability reporting.
