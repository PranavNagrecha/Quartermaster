# Benchmarks

> **Real numbers, reproducible.** Everything below is produced by `pnpm bench`
> (deterministic — seeded synthetic fixtures + the committed heritage corpus).
> We publish whatever it says, including losses. Re-run to reproduce.

## What we measure

**recall@K** — for a labeled set of (query → correct tool) pairs over a tool
manifest, how often is the correct tool in the top K? This is the metric that
matters, because the host LLM makes the final pick from the shortlist. We also
report **MRR** and **token reduction**.

Four rankers: **bm25** (default), **bm25+expansion** (the zero-dep "hybrid":
BM25 + offline synonym query-expansion), **tfidf** (heritage cosine), and a
**substring** baseline (mcp-funnel-style, no relevance model — the floor).

## Heritage corpus — the credibility test (171 real tools, 47 queries)

Real sf-intelligence tool manifest (names + descriptions), independent
hand-authored colloquial queries.

| ranker | R@1 | R@3 | R@5 | R@8 | MRR |
|---|---|---|---|---|---|
| bm25 | 57.4% | 74.5% | 83.0% | 91.5% | 68.5% |
| bm25+expansion | 61.7% | 74.5% | 83.0% | 89.4% | **70.6%** |
| tfidf | 55.3% | 78.7% | 85.1% | **93.6%** | 68.8% |
| substring | 29.8% | 48.9% | 51.1% | 61.7% | 40.7% |

On **rich** real descriptions, plain BM25 is already strong (91.5% R@8). With
**weighted** expansion (P1-1, `expansionWeight=0.5`) the synonym variant now
leads on R@1 (+4.3pts) and on MRR (70.6%, best here) and trails BM25 only
marginally at R@8 (89.4% vs 91.5%) — the earlier unweighted regression (83.0%)
is largely recovered. TF-IDF still edges out at R@8. Substring is far behind.

## Blind real-MCP corpus — external validity (38 real tools, 30 queries)

Tool surfaces from real public MCP servers
(`@modelcontextprotocol/server-{filesystem,github,git,fetch}`), with queries
phrased the way a user describes the task — **not** derived from any synonym
table — scored **BM25-only (no synonym tuning)**. This is the "unknown products,
no tuning" floor that answers "did you just grade your own homework?".

| ranker | R@1 | R@3 | R@5 | R@8 | MRR |
|---|---|---|---|---|---|
| bm25 | 36.7% | 53.3% | 70.0% | 73.3% | 47.0% |
| bm25+expansion | 36.7% | 53.3% | 70.0% | 73.3% | 47.0% |
| tfidf | 30.0% | 53.3% | 63.3% | 73.3% | 43.9% |
| substring | 43.3% | 53.3% | 63.3% | 66.7% | 50.0% |

(`bm25` == `bm25+expansion` because this corpus ships **no synonyms** — the
honest untuned baseline.)

Honest reading: with **no domain tuning**, R@1 is modest (~37%) — vocabulary gaps
("save my work" → `git_commit`, "folder" → `directory`) bite without synonyms —
but the right tool lands in the **top-8 ~73%** of the time, which is what the
funnel needs (the host LLM picks from the shortlist, not the top-1). Two humbling
notes, published as-is: (1) the raw substring baseline actually edges BM25 at
**R@1** here (43% vs 37%) on these short descriptions, though BM25 wins by R@8;
(2) this is exactly where a small domain `synonyms` overlay earns its keep — the
corpus-aware default leaves expansion off for descriptions like these, but an
operator can opt in. Caveat: manifest + queries authored by the project from
public docs, not an independent third party; the anti-gaming properties (real
descriptions, intent-phrased queries, zero synonym tuning) hold.

## Synthetic corpora — scaling behavior (vocab-gap queries)

Federated manifests with **terse** descriptions and deliberately colloquial
queries (stress the vocabulary gap).

**recall@1** (the hardest metric):

| tools | bm25 | bm25+expansion | tfidf | substring |
|---|---|---|---|---|
| 50 | 50.0% | **87.5%** | 50.0% | 31.3% |
| 200 | 40.0% | **75.0%** | 37.5% | 37.5% |
| 500 | 5.0% | **45.0%** | 7.5% | 10.0% |
| 1000 | 7.5% | **35.0%** | 5.0% | 2.5% |

**recall@8**:

| tools | bm25 | bm25+expansion | tfidf | substring |
|---|---|---|---|---|
| 50 | 68.8% | **100%** | 68.8% | 68.8% |
| 200 | 67.5% | **92.5%** | 67.5% | 60.0% |
| 500 | 65.0% | **80.0%** | 62.5% | 57.5% |
| 1000 | 57.5% | **77.5%** | 57.5% | 37.5% |

On terse descriptions, plain BM25 R@1 collapses at scale (5–7.5% at 500–1000,
matching the literature's ~14% claim) — and here expansion is a decisive win
(5–9× R@1, +20pts R@8). This is the regime most real-world MCP servers (short
tool descriptions) actually live in.

## Token reduction

Returning the top-K instead of every tool definition is the whole point. With
roughly uniform descriptions, the tool-description payload shrinks by `1 − K/N`:

| corpus | tools (N) | top-K | payload reduction |
|---|---|---|---|
| heritage-sfi | 171 | 8 | ~95% |
| synthetic-1000 | 990 | 8 | ~99% |

(Heritage descriptions average ~930 bytes each; ~159 KB of tool text all-in vs
~7.5 KB for a top-8 shortlist.)

## Reading the two regimes

The expansion result **flips with description richness**:

- **Terse descriptions** (synthetic; most real MCP servers): expansion is a big,
  clear win — it bridges the vocabulary gap the lexical match can't.
- **Rich descriptions** (heritage): plain BM25 already captures the vocabulary;
  *weighted* expansion (default `expansionWeight=0.5`) trails BM25 only marginally
  at R@8 and leads on MRR. (Unweighted expansion noticeably lowered recall@8 —
  this is why expansion weighting exists.)

So the honest headline is **not** "beats hybrid embeddings" — it's "competitive,
zero-dependency routing whose expansion earns its place as a *toggle*, tuned to
the corpus." See the verdict in the README status.

## Reproduce

```bash
pnpm bench    # generates synthetic fixtures + runs all rankers over every corpus
```

Numbers above are deterministic for a given core + generator; they will move as
the ranker evolves (e.g. P1-1 weighted expansion). Re-run to get current values.
