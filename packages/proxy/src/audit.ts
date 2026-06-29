/** Thin proxy wrapper around @quartermaster/telemetry audit sink. */
import { createAuditSink, setDefaultSink, type AuditEventInput } from '@quartermaster/telemetry';

let activeSink = createAuditSink();
setDefaultSink(activeSink);

/** Initialize audit session at proxy boot; returns sessionId. */
export function initAudit(sessionId?: string): string {
  activeSink = createAuditSink(sessionId);
  setDefaultSink(activeSink);
  return activeSink.sessionId;
}

export function getSessionId(): string {
  return activeSink.sessionId;
}

export function auditLog(event: AuditEventInput | Record<string, unknown>): void {
  activeSink.auditLog(event);
}

export { createSessionId } from '@quartermaster/telemetry';
