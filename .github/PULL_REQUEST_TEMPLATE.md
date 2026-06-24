<!-- Thanks for contributing to Quartermaster! -->

## What & why

<!-- What does this change and why? Link any issue. -->

## Checklist

- [ ] `pnpm -r build && pnpm -r test` pass
- [ ] The ranker (`@quartermaster/core`) stays **zero-dependency** (no new runtime deps); the published `quartermaster-mcp` keeps the MCP SDK as its only runtime dep
- [ ] If this touches ranking, I ran `pnpm bench` and noted the recall@K impact below

## Recall@K impact (if ranking changed)

<!-- before → after -->
