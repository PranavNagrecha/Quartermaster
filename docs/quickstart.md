# Quickstart

## As a library

```bash
npm install @quartermaster/core
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

Hand `shortlist` to your LLM as the candidate set; let it choose and call.

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

## As a proxy (scaffold)

See [`packages/proxy`](../packages/proxy/) — put one `retrieve_tools` in front of
many MCP servers.

## Next

- [How it works](how-it-works.md)
- [Benchmarks](benchmarks.md)
