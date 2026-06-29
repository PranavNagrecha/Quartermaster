import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SCHEMA_VERSION, type AuditEvent, type AuditEventInput } from './events.js';
import { redactAuditEvent } from './redact.js';

/** Short random session id (first 8 chars of a UUID). */
export function createSessionId(): string {
  return randomUUID().slice(0, 8);
}

export interface AuditSink {
  readonly sessionId: string;
  auditLog(event: AuditEventInput | Record<string, unknown>): void;
}

function auditEnabled(): boolean {
  return process.env.QM_AUDIT === '1';
}

function writeLine(line: string): void {
  console.error(line);
  const file = process.env.QM_AUDIT_FILE;
  if (file !== undefined && file !== '') {
    appendFileSync(file, `${line}\n`, 'utf8');
  }
}

/** Create a sink gated by QM_AUDIT=1; optional QM_AUDIT_FILE appends JSONL. */
export function createAuditSink(sessionId?: string): AuditSink {
  const sid = sessionId ?? createSessionId();
  return {
    sessionId: sid,
    auditLog(event) {
      if (!auditEnabled()) return;
      const payload = redactAuditEvent({
        schemaVersion: SCHEMA_VERSION,
        ts: Date.now(),
        sessionId: sid,
        ...event,
      });
      writeLine(JSON.stringify(payload));
    },
  };
}

let defaultSink: AuditSink = createAuditSink();

/** Module-default sink (replaced by initAuditSink in consumers). */
export function getDefaultSink(): AuditSink {
  return defaultSink;
}

export function setDefaultSink(sink: AuditSink): void {
  defaultSink = sink;
}

/** Write one audit event through the default sink. */
export function auditLog(event: AuditEventInput | Record<string, unknown>): void {
  defaultSink.auditLog(event);
}

export type { AuditEvent };
