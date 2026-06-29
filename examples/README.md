# examples/

Runnable configs and demos. Start here if you forked the repo and want to see
the funnel work.

## Try first

- [`static-demo/`](static-demo/) — **start here.** A tiny manifest + `demo.mjs`
  that prints ranked shortlists in seconds (no MCP host needed). Also shows how
  to run the proxy in static (discovery-only) mode.
- [`cursor/quartermaster.json`](cursor/quartermaster.json) — federates filesystem
  + GitHub MCP servers. Used by the [Cursor recipe](../docs/recipes/cursor.md)
  (same `mcpServers` shape works for Claude Desktop). Validated by a test.
- [`synonyms/business-to-dev.json`](synonyms/business-to-dev.json) — starter
  synonym overlay (`bug`→`issue`, `folder`→`directory`, …) for `synonymsFile`.

Reproduce the published benchmark numbers: [`docs/benchmarks.md`](../docs/benchmarks.md)
(`pnpm bench` from the repo root; `pnpm bench:regen` to rewrite synthetic fixtures).

- [`github-jira-slack/`](github-jira-slack/) — multi-server config + query → shortlist transcript.
- [`smoke/`](smoke/) — product smoke tests (`pnpm smoke`); see [docs/testing.md](../docs/testing.md).
- [`stress/`](stress/) — load and chaos tests (`pnpm stress`).
