# Library integration (in-process ranker)

You do not need the MCP proxy if your agent already holds the tool manifest in
memory. Vendor or copy [`packages/core/src/index.ts`](../packages/core/src/index.ts)
(~330 lines, zero dependencies) and rank in-process.

```ts
import { createRouter } from '@quartermaster/core'; // or copy src/index.ts

const tools = manifest.tools.map((t) => ({
  name: t.name,
  description: t.description,
  category: t.serverId,
}));

const router = createRouter(tools, {
  synonyms: { bug: ['issue', 'defect'] },
  expansionWeight: 0.5,
  hintBoost: 0.1,
});

const { candidates, confidence, guidance } = router.route(userMessage, 8, {
  includeDescription: true,
});

// Inject into your prompt:
// "Relevant tools (ranked): ... Guidance: ..."
// Let your LLM pick and invoke the tool handler directly.
```

## When to use the proxy instead

- Your host loads MCP `tools/list` automatically and you cannot intercept.
- You need federation across separate MCP server processes.
- You want `call_tool` forwarding without custom execution glue.

See [choosing.md](choosing.md) and [hosts.md](hosts.md).
