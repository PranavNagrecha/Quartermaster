# Cursor host E2E scenarios

Manual validation that Quartermaster works as an MCP server inside Cursor.
The scripted smoke tests in this directory cover the same protocol path
programmatically; these scenarios validate agent behavior in the real host.

## Setup

1. Copy [`cursor-mcp.json.example`](cursor-mcp.json.example) into `~/.cursor/mcp.json`
   (or your project's `.cursor/mcp.json`).
2. Replace `/absolute/path/to/...` with real paths on your machine.
3. For filesystem-only testing, point `--config` at a copy of
   `quartermaster-filesystem.json` but change the allowed directory to
   `realpath` of your temp dir (see `run-smoke.mjs` — macOS resolves
   `/var/...` vs `/private/var/...`).
4. Restart Cursor and confirm the MCP panel shows **3 tools**:
   `retrieve_tools`, `call_tool`, `list_servers`.

Example `mcp.json` snippet (npm consumer path):

```json
{
  "mcpServers": {
    "quartermaster": {
      "command": "npx",
      "args": [
        "-y",
        "quartermaster-mcp",
        "--config",
        "/absolute/path/to/quartermaster.json"
      ],
      "env": {
        "QM_AUDIT": "1",
        "QM_AUDIT_FILE": "/absolute/path/to/audit.jsonl"
      }
    }
  }
}
```

## Scenarios

| # | Prompt | Success signal |
|---|--------|----------------|
| 1 | "List files in /tmp" (or your allowed directory) | Agent calls `retrieve_tools` → `filesystem.list_directory` → `call_tool` succeeds |
| 2 | "Read README.md from [project path]" | Correct file read via federated forward |
| 3 | "File a bug titled X" (GitHub token required) | `github.create_issue` in shortlist; issue created or clear API error |
| 4 | "Help me with the repo" (vague) | Reasonable shortlist; agent clarifies rather than picking a wrong tool |
| 5 | Denied action with policy enforce + `shell` preset | Blocked with policy message |

## Post-session CLI

After a Cursor session with `QM_AUDIT=1`:

```bash
npx -p quartermaster-mcp quartermaster report --audit audit.jsonl --out report.html
npx -p quartermaster-mcp quartermaster savings --audit audit.jsonl --json
npx -p quartermaster-mcp quartermaster inspect --config quartermaster.json --audit audit.jsonl
npx -p quartermaster-mcp quartermaster eval --from-audit audit.jsonl --draft-cases cases.jsonl --config quartermaster.json
npx -p quartermaster-mcp quartermaster dashboard --audit audit.jsonl
```

Or run the automated audit loop:

```bash
pnpm smoke:local   # includes audit-cli-smoke.mjs
```
