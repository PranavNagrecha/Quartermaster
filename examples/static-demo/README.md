# Static demo

See Quartermaster rank tools **without** Cursor, Claude, or any MCP host.

## 1. Ranker only (fastest)

From the repo root:

```bash
pnpm -r build
node examples/static-demo/demo.mjs
```

You’ll see four example queries → confidence + ranked tool names.

## 2. Full proxy (static / discovery-only mode)

Still from the repo root, after `pnpm -r build`:

```bash
node packages/proxy/bin/quartermaster-mcp.js --config examples/static-demo/quartermaster.json
```

This boots the MCP server over stdio with **only** `retrieve_tools` (static mode has
no downstream servers, so there is no `call_tool`). Point an MCP client at it, or
use an MCP inspector, to call `retrieve_tools` with a natural-language query.
