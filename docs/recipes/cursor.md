# Use Quartermaster in Cursor

Quartermaster federates several MCP servers behind **one**. Cursor then loads two
tools — `retrieve_tools` and `call_tool` — instead of every tool from every
server, which keeps the model's context small and its tool choice sharp.

## 1. Write a `quartermaster.json`

List the downstream servers you want behind the funnel. `${VAR}` is resolved from
the environment at launch (and fails fast if unset). Full example:
[`examples/cursor/quartermaster.json`](../../examples/cursor/quartermaster.json).

```json
{
  "servers": [
    { "id": "filesystem", "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/projects"] },
    { "id": "github", "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" } }
  ],
  "synonyms": { "bug": ["issue"], "folder": ["directory"] },
  "k": 8
}
```

> `synonyms` are optional but recommended for a fixed server set — they bridge
> the vocabulary gap (e.g. "folder" → "directory") that BM25 alone misses on
> terse tool descriptions. See [benchmarks](../benchmarks.md).

## 2. Point Cursor at `quartermaster-mcp`

Edit `~/.cursor/mcp.json` (or the project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "quartermaster": {
      "command": "npx",
      "args": ["-y", "quartermaster-mcp", "--config", "/absolute/path/to/quartermaster.json"]
    }
  }
}
```

Use an **absolute** path to the config. Restart Cursor.

> **While unpublished (alpha):** `npx quartermaster-mcp` won't resolve until the
> package is on npm. Until then, build from source (`pnpm install && pnpm -r build`)
> and point Cursor at the local bin instead:
> ```json
> { "command": "node",
>   "args": ["/abs/path/to/quartermaster/packages/proxy/bin/quartermaster-mcp.js",
>            "--config", "/abs/path/to/quartermaster.json"] }
> ```

## 3. Use it

Cursor now sees just `retrieve_tools` + `call_tool`. When you ask it to do
something, it calls `retrieve_tools("…your task…")`, gets a ranked shortlist
(with each tool's description **and** input schema), and invokes the chosen tool
through `call_tool(name, arguments)` — which Quartermaster forwards to the right
downstream server.

Same config works for any MCP client that launches stdio servers (Claude
Desktop's `claude_desktop_config.json` uses the identical `mcpServers` shape).
