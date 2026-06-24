# Benchmarks

> **Honest status:** the harness is scaffolded; numbers below are placeholders to
> be filled by `pnpm bench`. We publish whatever it says, including losses.

## What we measure

**recall@K** — for a labeled set of (query → correct tool) pairs over a large
tool manifest, how often is the correct tool in the top K? This is the metric
that matters because the host LLM makes the final pick from the shortlist.

We also track **MRR** and **token reduction** (schemas avoided vs. loading all).

## The thesis we're testing

The literature and the incumbents agree pure lexical ranking degrades at scale —
mcpproxy-go's own benchmark reports **BM25 alone ≈ 14% top-1 past a few hundred
tools, vs ≈ 94% for hybrid** (BM25 + embeddings). Quartermaster refuses the
embedding-model dependency, so the open question is:

> Can a **zero-dependency hybrid** — BM25 + offline query expansion (synonyms,
> light stemming) — recover enough of that gap to be the right *default* for
> users who don't want a model?

If yes, that's the novel, publishable result. If no, Quartermaster is still a
clean, honest, host-agnostic BM25 router for small-to-mid manifests — and the
benchmark says so plainly.

## Datasets

- A synthetic manifest grown to 50 / 200 / 500 / 1000 tools.
- Real public MCP server manifests (GitHub, Slack, filesystem, …) concatenated.
- The sf-intelligence 170-tool manifest (the heritage corpus) with its
  router-recall@K labels.

## Comparisons

- Quartermaster BM25 (default)
- Quartermaster BM25 + synonym expansion ("zero-dep hybrid")
- Quartermaster TF-IDF (heritage)
- Baseline: substring filter (mcp-funnel-style)

| Manifest size | BM25 | BM25 + expansion | TF-IDF | substring |
|---|---|---|---|---|
| 50 | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| 200 | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| 500 | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
| 1000 | _tbd_ | _tbd_ | _tbd_ | _tbd_ |
