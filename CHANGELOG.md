# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [Unreleased]

### Added
- `@quartermaster/core` — offline, zero-dependency tool ranker (BM25 default,
  TF-IDF cosine alternative) with configurable synonym query-expansion. Extracted
  and generalized from sf-intelligence's semantic funnel.
- `quartermaster-mcp` — drop-in MCP proxy scaffold exposing a single
  `retrieve_tools` over N downstream servers.
- Claude Code plugin manifest + marketplace listing.
- `bench/` recall@K + MRR harness (`bench/run.mjs`): runs BM25 / BM25+expansion /
  TF-IDF over fixture manifests, reports recall@1/3/5/8 and MRR, optional JSON output.
- `bench/generate.mjs` — deterministic synthetic fixture generator (federated
  manifests at 50/200/500/1000 tools with colloquial, vocabulary-gap gold queries
  and a general business→dev synonym overlay). `pnpm bench` now generates then runs.
- `bench/cases/heritage-sfi.json` — real 171-tool sf-intelligence manifest (tool
  names + descriptions only, leak-scanned; generic product surface, not org data)
  with 47 hand-authored colloquial gold queries, as a production-credibility corpus.
