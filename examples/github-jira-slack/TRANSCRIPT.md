# GitHub + Slack federation — example transcript

This example shows how `retrieve_tools` shortlists tools for colloquial queries
when federating GitHub and Slack MCP servers. Run with tokens set:

```bash
export GITHUB_TOKEN=...
export SLACK_TOKEN=...
npx quartermaster-mcp --config ./quartermaster.json
```

Then call `retrieve_tools` from your MCP host (or use `QM_DEBUG=1` to see scores
on stderr).

## Query → shortlist

### "file a bug on the repo"

```json
{
  "confidence": "high",
  "candidates": [
    { "tool": "github.create_issue", "score": 12.4, "description": "..." },
    { "tool": "github.search_code", "score": 4.1 },
    ...
  ],
  "guidance": "These are the most relevant tools, ranked. Read them and choose..."
}
```

The synonym map (`bug` → `issue`) and BM25 ranking surface `github.create_issue`
first despite the query not using the word "issue".

### "dm the team in #general"

`slack.post_message` ranks first; `hintBoost` gives a small edge when the query
mentions `slack` or matches the server category.

### "what PRs are open"

`github.list_pull_requests` wins via expansion (`pr` → `pull`, `request`) and
name/description overlap.

## Next steps

- Tune `synonyms` and `overlays` in `quartermaster.json` for your vocabulary.
- Use `list_servers` to verify both downstreams connected (`degraded: false`).
- See [Cursor recipe](../../docs/recipes/cursor.md) for host wiring.
