# @quartermaster/core

The offline, zero-dependency ranker behind [Quartermaster](../../README.md).
No embedding model, no network, no runtime dependencies.

```bash
npm install @quartermaster/core
```

```ts
import { createRouter } from '@quartermaster/core';

const router = createRouter(tools, {
  ranker: 'bm25',          // 'bm25' (default) | 'tfidf'
  synonyms: { bug: ['issue'] }, // optional query expansion; omit for pure lexical
});

const shortlist = router.search('how do I file a bug?', 8);
```

## API

### `createRouter(tools, config?) => { search }`

- `tools: Tool[]` — `{ name, description?, keywords?, category? }`. Only `name` required.
- `config: RouterConfig` — `ranker`, `synonyms`, `stopwords`, `nameWeight`, `k1`, `b`.
- `search(query, k = 8): ToolCandidate[]` — `{ tool, score, category }[]`, highest score first.

### Why these defaults

- **BM25** (`k1=1.5`, `b=0.75`) is the default — it beats plain TF-IDF on tool
  retrieval and is what Anthropic's native Tool Search and mcpproxy-go also use.
- The tool **name is weighted** (`nameWeight=2`) because the name encodes intent
  (`create_issue`) even when the prose description doesn't echo the query.
- **Synonyms** are off by default. Supply a map to bridge domain vocabulary.

See [how it works](../../docs/how-it-works.md).
