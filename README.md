<div align="center">

# 🧭 Quartermaster

[![CI](https://github.com/PranavNagrecha/quartermaster/actions/workflows/ci.yml/badge.svg)](https://github.com/PranavNagrecha/quartermaster/actions/workflows/ci.yml)

**Issues your agent exactly the tools the mission needs — nothing more.**

An offline MCP **gateway**: configure one server (`quartermaster-mcp`) in your client; Quartermaster federates downstream MCP servers, ranks tools for each query, enforces policy, validates calls, and audits token savings. Not a registry, marketplace, or hosted SaaS.

[Gateway guide](docs/gateway.md) · [Quick start](docs/quickstart.md) · [Testing](docs/testing.md) · [Audit schema](docs/audit-schema.md) · [How it works](docs/how-it-works.md)

</div>

---

> **Status: alpha — on npm (`npx quartermaster-mcp`).** The ranker is extracted
> from a production system (see [Heritage](#heritage)); the proxy
> (`quartermaster-mcp`) is **built, published, and runnable end-to-end**
> (federation + `retrieve_tools` + `call_tool`); the Claude Code plugin is still
> scaffolded.
>
> **Verdict — GO.** Zero-dependency BM25 is a genuinely good router on rich real
> descriptions: **91.5% recall@8** on a 171-tool heritage manifest (substring:
> 61.7% R@8). On a smaller **blind** real-MCP corpus with no synonym tuning,
> recall@1 is modest (~37%) and substring can edge BM25 at R@1 — the funnel still
> lands the right tool in the **top-8 ~73%** of the time. Optional offline synonym
> expansion is a **large** win on terse/vocabulary-poor manifests (the common case
> — **5–9× recall@1** at 500–1000 tools) and, with weighting, only marginally
> trails BM25 at recall@8 on rich descriptions while leading on MRR — so it ships
> **opt-in and corpus-tuned**. We do **not** claim to beat hybrid embeddings —
> we claim competitive routing with **no model dependency at all**. Numbers:
> [benchmarks](docs/benchmarks.md).

## The problem

Give a model 200 tools and two things break: every tool's schema is loaded into
context on *every* turn (token tax), and the model has to pick the right one
from 200 lookalikes (accuracy drops as the count grows). This is well-documented
prior art — [RAG-MCP](https://arxiv.org/abs/2505.03275) names "prompt bloat and
selection complexity," and [ToolRet (ACL 2025)](https://arxiv.org/abs/2503.01763)
shows generic retrievers do poorly on tool selection specifically.

## The shape: funnel advises, model decides

```
  query                 query
    │                     │
    ▼                     ▼
┌────────┐         ┌──────────────┐  offline BM25 over
│  LLM   │◄ 200    │ Quartermaster│  tool descriptions
└───┬────┘ schemas └──────┬───────┘  (zero deps, no model)
    │  picks wrong,        │ top-8 shortlist + guidance
    │  huge context        ▼
    ▼                ┌──────────────┐
 a tool              │     LLM      │ reads a small,
                     └──────┬───────┘ relevant set → picks
                            ▼
                       right tool(s)
```

Quartermaster doesn't *decide*. It returns a scored shortlist; the host LLM —
already in the loop, free — makes the final call. So we optimize for
**recall@K** ("is the right tool in the top K?"), not top-1.

## What makes it different

The MCP-router space is crowded (Anthropic's native Tool Search, mcpproxy-go,
mcp-funnel, MCPJungle, …). We are honest about that — see the
[comparison](docs/how-it-works.md#how-quartermaster-differs). The seam
Quartermaster fills:

- **Zero embedding model.** No torch, no model download, nothing to warm up. The
  whole ranker is a few hundred lines of dependency-free TypeScript.
- **Host-agnostic.** Works outside the Anthropic API — any MCP client, any model.
- **Advises, doesn't decide.** Returns a shortlist + guidance, never a forced pick.
- **Offline & private.** Nothing phones home; suitable for air-gapped / regulated environments.

We do **not** claim best-in-class retrieval accuracy. The
[benchmarks](docs/benchmarks.md) show the honest picture: zero-dependency BM25 is
a strong router, and offline query expansion adds a large recall boost on terse
manifests (where the vocabulary gap bites) while adding noise on rich ones — so
expansion is an opt-in toggle, not a silver bullet. The bet that paid off: you
can get competitive tool routing with **no embedding model at all**.

## Closing the gap (per team, not per developer)

Quartermaster does **not** ship tuned routing for every MCP server on npm — and
shouldn't try to. The model is three layers:

| Layer | Who | What |
|-------|-----|------|
| **Global** | Everyone | Same BM25 ranker and tokenization |
| **Org / project** | One team | One `quartermaster.json` — their MCP servers, optional `synonyms` |
| **Traffic** | Automatic | Audit captures real queries; eval turns them into labeled cases |

**Out of the box:** strong default lexical routing (~73% recall@8 on the blind
real-MCP corpus, ~91% on rich heritage manifests — see
[benchmarks](docs/benchmarks.md)). The funnel optimizes **recall@K**, not top-1;
the host LLM picks from the shortlist.

**Per org:** enable audit, run the closed loop, gate CI on *your* cases — not
hand-tuning for every developer in the world:

```bash
# In your MCP host env:
# QM_AUDIT=1  QM_AUDIT_FILE=/path/to/audit.jsonl

quartermaster eval --from-audit audit.jsonl --draft-cases cases.jsonl --config quartermaster.json
quartermaster eval --config quartermaster.json --cases cases.jsonl --weak-only
quartermaster inspect --config quartermaster.json --audit audit.jsonl
```

Optional starter vocabulary: [`examples/synonyms/business-to-dev.json`](examples/synonyms/business-to-dev.json)
(`bug→issue`, `folder→directory`, …). Run `quartermaster doctor` to catch empty
descriptions and schema gaps in your downstream manifests. Full playbook:
[testing](docs/testing.md) · [gateway eval](docs/gateway.md#eval-from-traffic).

## Quick start

Quartermaster is a single package — `quartermaster-mcp`. It installs both the
MCP gateway (`quartermaster-mcp`) and the product CLI (`quartermaster`) for
reports, inspection, evals, policy tests, savings reports, diagnostics, and the
local dashboard. Put it in front of N MCP servers; agents load `retrieve_tools`
+ `call_tool` instead of every downstream schema. Point it at a
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
```

```bash
npx -p quartermaster-mcp quartermaster report --audit audit.jsonl --out report.html
npx -p quartermaster-mcp quartermaster eval --config quartermaster.json --cases eval.jsonl
npx -p quartermaster-mcp quartermaster doctor --config quartermaster.json
npx -p quartermaster-mcp quartermaster savings --audit audit.jsonl --json
```

It spawns the downstream servers, aggregates their tools, serves a ranked,
schema-hydrated shortlist via `retrieve_tools`, and forwards selected calls via
`call_tool` after policy evaluation and input-schema validation. See
[`packages/proxy`](packages/proxy/) and the [gateway guide](docs/gateway.md).

**Host recipe:** [Use Quartermaster in Cursor](docs/recipes/cursor.md) (the same
`mcpServers` config works for Claude Desktop).

## What ships

One package — **[`quartermaster-mcp`](packages/proxy/)** — the drop-in MCP proxy
that federates downstream servers behind `retrieve_tools`, `call_tool`, and
`list_servers`, plus the `quartermaster` CLI for `report`, `inspect`, `eval`,
`policy test`, `savings`, `doctor`, and `dashboard`. The BM25/TF-IDF ranker,
policy engine, telemetry helpers, validation, and CLI are **bundled into the
proxy package**; they are not published separately, so the install is
self-contained. Runtime dependencies are the MCP SDK and Ajv for JSON Schema
validation. A [`.claude-plugin/`](.claude-plugin/) manifest is also included for
the Claude Code tool-search seam.

## Heritage

Extracted and generalized from the semantic funnel in
[sf-intelligence](https://github.com/PranavNagrecha/Salesforce-Intelligence),
a read-only intelligence layer that routes ~170 tools for one Salesforce org.
The fork makes the tool corpus and synonyms injectable, and upgrades the default
ranker from TF-IDF cosine to BM25.

## License

MIT © 2026 Pranav Nagrecha. See [LICENSE](LICENSE).

## Security

See [SECURITY.md](SECURITY.md) for the trust model, config safety, and how to
report vulnerabilities.
