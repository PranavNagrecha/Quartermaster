# Quickstart

> **Alpha — not yet on npm.** The `npm`/`npx` commands below use the reserved
> package names for the first release. **To try it today, run from source:**
> `git clone … && cd quartermaster && pnpm install && pnpm -r build`. Then import
> `packages/core/dist` or run the bin at `packages/proxy/bin/quartermaster-mcp.js`.

## As a library

```bash
npm install @quartermaster/core   # once published; until then build from source (above)
```

```ts
import { createRouter } from '@quartermaster/core';

const router = createRouter([
  { name: 'github.create_issue', description: 'Open a new issue in a repository' },
  { name: 'github.search_code',  description: 'Search code across repositories' },
  { name: 'slack.post_message',  description: 'Send a message to a Slack channel' },
]);

const shortlist = router.search('report a bug in the repo', 3);
// shortlist[0].tool === 'github.create_issue'
```

Hand `shortlist` to your LLM as the candidate set; let it choose and call. For
agents, prefer `route()` — it adds a `confidence` + `guidance` so the model knows
when *not* to trust the shortlist.

### Bridge vocabulary with synonyms (optional)

```ts
const router = createRouter(tools, {
  synonyms: { bug: ['issue', 'defect'], dm: ['message'] },
});
```

### Use TF-IDF cosine instead of BM25

```ts
createRouter(tools, { ranker: 'tfidf' });
```

## As a proxy

Put `quartermaster-mcp` in front of N MCP servers; the client loads two tools
(`retrieve_tools` + `call_tool`) instead of every downstream schema. Write a
`quartermaster.json`:

```json
{
  "servers": [
    { "id": "github", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" } }
  ]
}
```

```bash
# once published:
quartermaster-mcp --config ./quartermaster.json
# from source (while unpublished):
node packages/proxy/bin/quartermaster-mcp.js --config ./quartermaster.json
```

Federated mode (config has `servers`) spawns + aggregates them; static mode
(config has `tools`) serves a fixed manifest, discovery only. See
[`packages/proxy`](../packages/proxy/) and the
[Cursor recipe](recipes/cursor.md).

## Next

- [How it works](how-it-works.md)
- [Which one? (library vs proxy vs Tool Search)](choosing.md)
- [Benchmarks](benchmarks.md)
