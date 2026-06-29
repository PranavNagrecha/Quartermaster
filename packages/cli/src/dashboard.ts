import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import {
  aggregateEvalRuns,
  readAuditJsonl,
  type AuditLine,
} from '@quartermaster/telemetry';
import { renderDashboardPage } from './report.js';
import { draftCasesFromAudit, weakCaseQueries } from './draft-cases.js';
import type { Tool } from '@quartermaster/core';

export interface DashboardOptions {
  readonly auditPath: string;
  readonly port?: number;
  readonly catalogTools?: readonly Tool[];
}

export interface DashboardServer {
  readonly server: Server;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

export function loadAuditEvents(auditPath: string): AuditLine[] {
  return readAuditJsonl(auditPath);
}

export function startDashboard(opts: DashboardOptions): Promise<DashboardServer> {
  const events = loadAuditEvents(opts.auditPath);
  const weakQueries = weakCaseQueries(draftCasesFromAudit(events));
  const evalEvents = aggregateEvalRuns(events);
  const catalogTools = opts.catalogTools ?? [];

  const server = createServer((req, res) => {
    const route = req.url?.split('?')[0] ?? '/';
    const html = renderDashboardPage(route, events, evalEvents, weakQueries, catalogTools.map((t) => t.name));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  const port = opts.port ?? 3847;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${port}/`;
      resolve({
        server,
        port,
        url,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

export async function runDashboard(argv: readonly string[]): Promise<void> {
  let auditPath: string | undefined;
  let port = 3847;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--audit' && argv[i + 1] !== undefined) {
      auditPath = argv[++i];
    } else if (a === '--port' && argv[i + 1] !== undefined) {
      port = Number(argv[++i]);
    } else if (a === '--help') {
      printDashboardHelp();
      return;
    }
  }

  if (auditPath === undefined) {
    throw new Error('usage: quartermaster dashboard --audit <audit.jsonl> [--port 3847]');
  }

  // Validate readable
  readFileSync(auditPath, 'utf8');

  const dash = await startDashboard({ auditPath, port });
  console.log(`Quartermaster dashboard at ${dash.url}`);
  console.log('Press Ctrl+C to stop.');

  await new Promise<void>((resolve) => {
    const onSignal = () => {
      void dash.close().then(resolve);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });
}

function printDashboardHelp(): void {
  console.log(`quartermaster dashboard — local HTML telemetry dashboard

Usage:
  quartermaster dashboard --audit audit.jsonl [--port 3847]

Routes:
  /                 Overview (cost savings, calls, misses)
  /queries          Retrieve/call chains by traceId
  /tools            Tool usage and quality scores
  /servers          Server health from server_snapshot events
  /evals            Eval run history
  /recommendations  Synonym/overlay suggestions
`);
}
