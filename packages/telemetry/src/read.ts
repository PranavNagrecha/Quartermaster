import { readFileSync } from 'node:fs';
import type { AuditEvent } from './events.js';

/** Parsed audit line — may be legacy (proxy) or schema-versioned. */
export type AuditLine = AuditEvent | LegacyAuditLine;

export interface LegacyAuditLine {
  readonly ts?: number;
  readonly event: string;
  readonly traceId?: string;
  readonly sessionId?: string;
  readonly schemaVersion?: number;
  readonly [key: string]: unknown;
}

export function parseAuditLine(line: string, lineNo: number, source: string): AuditLine | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  try {
    const obj = JSON.parse(trimmed) as LegacyAuditLine;
    if (typeof obj.event !== 'string') {
      throw new Error(`missing event field`);
    }
    return obj;
  } catch (e) {
    throw new Error(`${source}:${lineNo}: invalid JSON — ${(e as Error).message}`);
  }
}

/** Read a JSONL audit file into parsed event objects. */
export function readAuditJsonl(path: string): AuditLine[] {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const out: AuditLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseAuditLine(lines[i] ?? '', i + 1, path);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

export function eventTraceId(e: AuditLine): string | undefined {
  const tid = (e as LegacyAuditLine).traceId;
  if (typeof tid === 'string' && tid !== '') return tid;
  return undefined;
}

export function eventTs(e: AuditLine): number {
  if (typeof e.ts === 'number' && Number.isFinite(e.ts)) return e.ts;
  return 0;
}
