import { readAuditJsonl, aggregateSavingsReport } from '@quartermaster/telemetry';

export interface SavingsCliOptions {
  readonly auditPath: string;
  readonly json?: boolean;
}

export function runSavings(opts: SavingsCliOptions): void {
  const events = readAuditJsonl(opts.auditPath);
  const report = aggregateSavingsReport(events);
  console.log(JSON.stringify(report, null, 2));
}

export async function runSavingsCommand(argv: readonly string[]): Promise<void> {
  let auditPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--audit' && argv[i + 1] !== undefined) auditPath = argv[++i];
    else if (a?.startsWith('--audit=')) auditPath = a.slice('--audit='.length);
    else if (a === '--help') {
      console.log('usage: quartermaster savings --audit audit.jsonl [--json]');
      return;
    }
  }
  if (auditPath === undefined) {
    throw new Error('usage: quartermaster savings --audit <audit.jsonl> [--json]');
  }
  runSavings({ auditPath, json: true });
}
