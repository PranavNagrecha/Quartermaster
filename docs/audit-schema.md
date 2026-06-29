# Audit log JSONL schema (v2)

Quartermaster writes structured audit events when `QM_AUDIT=1`. Optional append to a file via `QM_AUDIT_FILE=path`.

## Common fields

Every event includes:

| Field | Type | Description |
|-------|------|-------------|
| `schemaVersion` | `2` | Schema version |
| `ts` | number | Unix ms timestamp |
| `sessionId` | string | Proxy session id |
| `event` | string | Event type |

## Event types

### `retrieve`

Emitted on every `retrieve_tools` call.

Key fields: `traceId`, `agentId`, `query`, `k`, `confidence`, `candidateTools`, `candidateScores`, `totalSchemaTokens`, `shortlistSchemaTokens`, `estimatedTokenSavings`, `estimatedCostSavingsUsd`, `latencyMs`, `status`.

### `call`

Emitted on every `call_tool` forward attempt.

Key fields: `traceId`, `tool`, `serverId`, `wasShortlisted`, `rank`, `ok`, `latencyMs`, `error`, `errorCategory`.

`errorCategory`: `policy_denied` | `validation_error` | `timeout` | `downstream_error` | `unknown_tool` | `circuit_open`

### `call_miss`

Tool called outside its linked shortlist.

### `policy_decision`

Policy evaluation before forward. Fields: `allowed`, `shadow`, `mode`, `reason`, `matchedPreset`.

### `validation_error`

Schema validation failure. Fields: `errors[]`.

### `server_snapshot`

Connected/skipped servers with `health`: `ok` | `degraded` | `circuit_open`.

### `server_error`

Boot/refresh/call failures per server.

### `tool_catalog_snapshot`

Catalog token breakdown at boot/refresh.

### `eval_run`

CLI eval benchmark runs.

## Redaction

Before write, keys matching `token`, `secret`, `password`, `api_key`, `authorization`, `bearer` in argument objects are replaced with `[REDACTED]`. Bearer tokens in error strings are masked.

## Example

```json
{"schemaVersion":2,"ts":1710000000000,"sessionId":"a1b2c3d4","event":"retrieve","traceId":"uuid","agentId":"cursor","query":"open issue","k":8,"confidence":"high","candidateTools":["github.create_issue"],"candidateScores":[12.4],"totalSchemaTokens":42000,"shortlistSchemaTokens":800,"estimatedTokenSavings":41200,"tokenEstimateMethod":"chars/4","estimatedCostSavingsUsd":0.1236,"latencyMs":3,"status":"ok"}
```

## v1 compatibility

Readers accept legacy v1 lines and older `candidates: [{tool, score}]` retrieve format.
