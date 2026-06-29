import { writeFileSync } from 'node:fs';
import { aggregateAudit, aggregateSavingsReport, readAuditJsonl } from '@quartermaster/telemetry';
import { renderHtmlReport } from './report-html.js';

export interface ReportOptions {
  readonly auditPath: string;
  readonly json?: boolean;
  readonly out?: string;
}

export function runReport(opts: ReportOptions): void {
  const events = readAuditJsonl(opts.auditPath);
  const summary = aggregateAudit(events);
  const savings = aggregateSavingsReport(events);

  if (opts.out !== undefined) {
    writeFileSync(opts.out, renderHtmlReport(summary), 'utf8');
    console.error(`quartermaster: wrote report to ${opts.out}`);
  }

  if (opts.json || opts.out === undefined) {
    console.log(
      JSON.stringify(
        {
          ...summary,
          fullCatalogTokenSavings: savings.overview.totalEstimatedTokenSavings,
          savingsByServer: savings.byServer,
          savingsByTool: savings.byTool.slice(0, 20),
          savingsByAgent: savings.byAgent,
        },
        null,
        2,
      ),
    );
  }
}
