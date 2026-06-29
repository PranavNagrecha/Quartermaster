import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSION } from '@quartermaster/telemetry';
import type { EvalResult } from './eval.js';

export interface EvalRunMeta {
  readonly evalId?: string;
  readonly configPath?: string;
}

/** Append one eval_run line to a JSONL audit file. */
export function appendEvalRun(path: string, result: EvalResult, meta: EvalRunMeta = {}): void {
  const evalId = meta.evalId ?? randomUUID();
  const payload: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    ts: Date.now(),
    event: 'eval_run',
    evalId,
    variants: result.rows.map((r) => ({
      id: r.variant,
      recall: r.recall,
      mrr: r.mrr,
    })),
    caseCount: result.caseCount,
    toolCount: result.toolCount,
  };
  if (meta.configPath !== undefined) payload.configPath = meta.configPath;
  appendFileSync(path, `${JSON.stringify(payload)}\n`, 'utf8');
}
