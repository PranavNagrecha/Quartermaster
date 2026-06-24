# Getting started

Quartermaster is **one npm package** — [`quartermaster-mcp`](https://www.npmjs.com/package/quartermaster-mcp).
It sits in front of your MCP servers and narrows hundreds of tools down to a
shortlist the AI can actually choose from.

## Pick your path

| You are… | Start here |
|---|---|
| **Curious / non-technical** | [`examples/static-demo/`](../examples/static-demo/) — run `demo.mjs`, read the output |
| **Using Cursor or Claude Desktop** | [Cursor recipe](recipes/cursor.md) |
| **Choosing vs Anthropic Tool Search** | [choosing.md](choosing.md) |
| **Contributing / forking the repo** | [CONTRIBUTING.md](../CONTRIBUTING.md) |

## How it knows your tools

Quartermaster does **not** know every tool on the internet. At startup it reads
**your** `quartermaster.json`:

- **`servers`** — launches each MCP server you list, asks “what tools do you
  offer?”, merges them (maybe 50, maybe 200).
- **`tools`** — a fixed list you write yourself (good for demos).

Different users → different config → different tool catalog. No learning, no
cloud — just name + description matching.

## Federated vs static

| Mode | Config key | What the client gets |
|---|---|---|
| **Federated** | `servers` | `retrieve_tools` + `call_tool` + `list_servers` |
| **Static** | `tools` | `retrieve_tools` only (discovery / demos) |

## Quick run

```bash
npx quartermaster-mcp --config ./quartermaster.json
```

See [quickstart.md](quickstart.md) for a full config example.
