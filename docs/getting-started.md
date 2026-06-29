# Getting started

Quartermaster is **one npm package** — [`quartermaster-mcp`](https://www.npmjs.com/package/quartermaster-mcp).
It is a single MCP gateway that sits in front of your MCP servers and narrows
hundreds of tools down to a shortlist the AI can actually choose from. It is not
an MCP registry or marketplace.

## Pick your path

| You are… | Start here |
|---|---|
| **Curious / non-technical** | [`examples/static-demo/`](../examples/static-demo/) — run `demo.mjs`, read the output |
| **Using Cursor or Claude Desktop** | [Cursor recipe](recipes/cursor.md) |
| **Running a gateway with policy/audit** | [gateway.md](gateway.md) |
| **Choosing vs Anthropic Tool Search** | [choosing.md](choosing.md) |
| **Building your own agent (no proxy)** | [library-integration.md](library-integration.md) |
| **Host matrix (Cursor, Desktop, …)** | [hosts.md](hosts.md) |
| **Contributing / forking the repo** | [CONTRIBUTING.md](../CONTRIBUTING.md) |

## How it knows your tools

Quartermaster does **not** know every tool on the internet. At startup it reads
**your** `quartermaster.json`:

- **`servers`** — launches each MCP server you list, asks “what tools do you
  offer?”, merges them (maybe 50, maybe 200).
- **`tools`** — a fixed list you write yourself (good for demos).

Different users → different config → different tool catalog. Routing improves
per **team** via audit + eval (see [Closing the gap](../README.md#closing-the-gap-per-team-not-per-developer)),
not via a global model trained on every developer.

## Improve routing for your team

1. Enable `QM_AUDIT=1` in your MCP host (see [gateway](gateway.md)).
2. After real usage: `quartermaster eval --from-audit audit.jsonl --draft-cases cases.jsonl --config quartermaster.json`
3. Fix weak queries: add `synonyms` or `overlays`, or fix upstream tool descriptions (`quartermaster doctor`).
4. Optional starter map: [`examples/synonyms/business-to-dev.json`](../examples/synonyms/business-to-dev.json)
5. Gate your pipeline: [eval CI example](../examples/ci/eval-gate.yml) · [testing](testing.md)

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
