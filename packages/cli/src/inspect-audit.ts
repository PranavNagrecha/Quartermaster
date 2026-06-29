import { aggregateToolStats, type AuditLine } from '@quartermaster/telemetry';

export function scoreToolsFromAudit(events: readonly AuditLine[]) {
  return aggregateToolStats(events);
}
