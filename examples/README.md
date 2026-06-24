# examples/

## Available now

- [`cursor/quartermaster.json`](cursor/quartermaster.json) — a proxy config that
  federates the filesystem + GitHub MCP servers behind one `retrieve_tools`.
  Used by the [Cursor recipe](../docs/recipes/cursor.md) (same config works for
  Claude Desktop). Validated by a test, so it can't drift.
- [`synonyms/business-to-dev.json`](synonyms/business-to-dev.json) — a starter
  synonym overlay (bug→issue, folder→directory, …) you can point a config's
  `synonymsFile` at.

The funnel's real numbers on real/ synthetic manifests live in
[`docs/benchmarks.md`](../docs/benchmarks.md) (reproduce with `pnpm bench`).

## Planned

- `static-demo/` — a runnable hello-world (a tiny manifest + a few queries) so a
  non-technical reader can see the ranking work in a few seconds.
- `github-jira-slack/` — a multi-server transcript of queries → shortlists.
