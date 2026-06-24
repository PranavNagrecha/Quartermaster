# How it works

## The funnel

1. Each tool becomes a small document: its **name** (weighted, because the name
   encodes intent), its **description**, and an optional **keyword overlay**.
2. At query time the query is tokenized, optionally **expanded with synonyms**,
   and scored against every tool document with **BM25** (default) or TF-IDF cosine.
3. The top-K tools are returned as a **shortlist + guidance**. The host LLM reads
   them and decides.

```
  query
    │  tokenize → expand(synonyms)
    ▼
┌──────────────┐   BM25 over per-tool docs (name·w + description + keywords)
│   ranker     │   offline · deterministic · no model
└──────┬───────┘
       │ top-K shortlist + guidance
       ▼
   host LLM picks
```

Because the LLM makes the final pick, the metric that matters is **recall@K**
(is the right tool in the top K?), not top-1 accuracy.

## Tokenization

Lowercase → fold apostrophes → split on non-word chars **and** underscores (so
`create_issue` → `create`, `issue`) → drop stopwords and 1-char tokens → keep a
light singular stem next to the plural (`issues` → `issues` + `issue`). Applied
identically to query and corpus so the two stay consistent.

## How Quartermaster differs

The "too many MCP tools" problem is well-trodden. Honest comparison:

| Project | Form | Technique | Host-agnostic | Embedding model? |
|---|---|---|---|---|
| Anthropic Tool Search | API/host feature | BM25 + regex | ❌ Anthropic-only | No (custom: yes) |
| mcpproxy-go | proxy (binary) | BM25 → hybrid | ✅ | No → adding |
| mcp-funnel | proxy (TS) | substring/glob filter | ✅ | No |
| tool-gating-mcp | proxy | embeddings (MiniLM) | ✅ | **Yes** |
| mcp-gateway-registry | enterprise gateway | embeddings + RRF | ✅ | **Yes** |
| MCPJungle | gateway | rule-based groups | ✅ | No |
| **Quartermaster** | **library + proxy** | **BM25 (+ offline expansion)** | **✅** | **No** |

What we lean on: **zero embedding model**, **host-agnostic**, **advises-not-decides**,
**offline/private**. What we do *not* claim: best-in-class accuracy at very large
tool counts — see [benchmarks](benchmarks.md) for the honest picture and the
zero-dependency-hybrid thesis.
