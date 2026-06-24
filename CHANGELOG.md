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
