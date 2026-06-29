import { readAuditJsonl } from '@quartermaster/telemetry';
import { runReport } from './audit-report.js';
import {
  loadCasesJsonl,
  loadSynonymsFromConfig,
  loadToolsFromConfig,
  routerOptionsFromConfig,
} from './config-tools.js';
import { draftCasesFromAudit, filterWeakCases, summarizeWeakCases, writeDraftCases } from './draft-cases.js';
import { runDashboard } from './dashboard.js';
import { checkCiGate, formatEvalTable, runEval } from './eval.js';
import { appendEvalRun } from './eval-audit.js';
import { writeEvalReport } from './report.js';
import { runInspect } from './inspect.js';
import { runPolicyTestCommand } from './policy-test.js';
import { runSavingsCommand } from './savings.js';
import { runDoctorCommand } from './doctor.js';

const VERSION = '0.1.0';

export async function main(argv: readonly string[]): Promise<void> {
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (cmd === undefined || cmd === '--help' || cmd === '-h') {
    printRootHelp();
    return;
  }
  if (cmd === '--version' || cmd === '-v') {
    console.log(VERSION);
    return;
  }

  switch (cmd) {
    case 'eval':
      await runEvalCommand(rest);
      break;
    case 'dashboard':
      await runDashboard(rest);
      break;
    case 'report':
      await runReportCommand(rest);
      break;
    case 'inspect':
      await runInspectCommand(rest);
      break;
    case 'policy':
      await runPolicyCommand(rest);
      break;
    case 'savings':
      await runSavingsCommand(rest);
      break;
    case 'doctor':
      await runDoctorCommand(rest);
      break;
    default:
      throw new Error(`unknown command: ${cmd} (try quartermaster --help)`);
  }
}

async function runEvalCommand(argv: readonly string[]): Promise<void> {
  let configPath: string | undefined;
  let casesPath: string | undefined;
  let auditPath: string | undefined;
  let draftCasesPath: string | undefined;
  let reportPath: string | undefined;
  let reportAuditPath: string | undefined;
  let auditOutPath: string | undefined;
  let ci = false;
  let minR8 = 0.72;
  let weakOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' && argv[i + 1] !== undefined) configPath = argv[++i];
    else if (a?.startsWith('--config=')) configPath = a.slice('--config='.length);
    else if (a === '--cases' && argv[i + 1] !== undefined) casesPath = argv[++i];
    else if (a === '--from-audit' && argv[i + 1] !== undefined) auditPath = argv[++i];
    else if (a === '--draft-cases' && argv[i + 1] !== undefined) draftCasesPath = argv[++i];
    else if (a === '--report' && argv[i + 1] !== undefined) reportPath = argv[++i];
    else if (a === '--audit' && argv[i + 1] !== undefined) reportAuditPath = argv[++i];
    else if (a === '--audit-out' && argv[i + 1] !== undefined) auditOutPath = argv[++i];
    else if (a?.startsWith('--audit-out=')) auditOutPath = a.slice('--audit-out='.length);
    else if (a === '--ci') ci = true;
    else if (a === '--weak-only') weakOnly = true;
    else if (a === '--min-r8' && argv[i + 1] !== undefined) minR8 = Number(argv[++i]);
    else if (a === '--help') {
      printEvalHelp();
      return;
    }
  }

  // Draft-only mode
  if (auditPath !== undefined && draftCasesPath !== undefined && configPath === undefined && casesPath === undefined) {
    const events = readAuditJsonl(auditPath);
    const drafted = draftCasesFromAudit(events);
    writeDraftCases(draftCasesPath, drafted);
    console.log(`Wrote ${drafted.length} draft cases to ${draftCasesPath}`);
    return;
  }

  let cases = casesPath !== undefined ? loadCasesJsonl(casesPath) : [];

  if (auditPath !== undefined) {
    const events = readAuditJsonl(auditPath);
    const drafted = draftCasesFromAudit(events);
    if (draftCasesPath !== undefined) writeDraftCases(draftCasesPath, drafted);
    if (cases.length === 0) cases = drafted;
    if (reportAuditPath === undefined) reportAuditPath = auditPath;
  }

  if (cases.length === 0) {
    throw new Error('eval: provide --cases <eval.jsonl> and/or --from-audit <audit.jsonl>');
  }

  if (auditPath !== undefined) {
    const summary = summarizeWeakCases(cases);
    const weakN = cases.filter((c) => c.confidence === 'weak').length;
    if (weakN > 0) {
      console.error(`eval: ${weakN} weak case(s) from audit — ${JSON.stringify(summary)}`);
    }
  }

  if (weakOnly) {
    cases = filterWeakCases(cases);
    if (cases.length === 0) {
      throw new Error('eval: --weak-only found no weak cases');
    }
  }

  let tools;
  let config;
  if (configPath !== undefined) {
    ({ tools, config } = await loadToolsFromConfig(configPath));
  } else if (casesPath !== undefined) {
    throw new Error('eval: --config is required when running metrics (unless cases embed tools — not supported)');
  } else {
    throw new Error('eval: --config is required to load tools for ranking');
  }

  const synonyms = loadSynonymsFromConfig(config);
  const routerOpts = routerOptionsFromConfig(config);
  const result = runEval(tools, cases, synonyms, routerOpts);

  console.log(formatEvalTable(result));

  const evalAuditPath = auditOutPath ?? reportAuditPath ?? auditPath;
  if (evalAuditPath !== undefined) {
    appendEvalRun(evalAuditPath, result, { configPath });
    console.log(`Appended eval_run to ${evalAuditPath}`);
  }

  if (reportPath !== undefined) {
    writeEvalReport(reportPath, result, reportAuditPath);
    console.log(`Wrote report to ${reportPath}`);
  }

  if (ci) {
    const gate = checkCiGate(result, minR8);
    if (!gate.ok) {
      console.error(gate.message);
      process.exitCode = 1;
    }
  }
}

async function runReportCommand(argv: readonly string[]): Promise<void> {
  let auditPath: string | undefined;
  let outPath: string | undefined;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--audit' && argv[i + 1] !== undefined) auditPath = argv[++i];
    else if (a?.startsWith('--audit=')) auditPath = a.slice('--audit='.length);
    else if (a === '--out' && argv[i + 1] !== undefined) outPath = argv[++i];
    else if (a?.startsWith('--out=')) outPath = a.slice('--out='.length);
    else if (a === '--json') json = true;
    else if (a === '--help') {
      console.log('usage: quartermaster report --audit audit.jsonl [--json] [--out report.html]');
      return;
    }
  }

  if (auditPath === undefined) {
    throw new Error('usage: quartermaster report --audit <audit.jsonl> [--json] [--out report.html]');
  }

  runReport({ auditPath, json: json || outPath === undefined, out: outPath });
}

async function runInspectCommand(argv: readonly string[]): Promise<void> {
  let configPath: string | undefined;
  let auditPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' && argv[i + 1] !== undefined) configPath = argv[++i];
    else if (a?.startsWith('--config=')) configPath = a.slice('--config='.length);
    else if (a === '--audit' && argv[i + 1] !== undefined) auditPath = argv[++i];
    else if (a?.startsWith('--audit=')) auditPath = a.slice('--audit='.length);
    else if (a === '--help') {
      console.log('usage: quartermaster inspect --config quartermaster.json [--audit audit.jsonl]');
      return;
    }
  }

  if (configPath === undefined) {
    throw new Error('usage: quartermaster inspect --config <quartermaster.json> [--audit audit.jsonl]');
  }

  await runInspect({ configPath, auditPath });
}

async function runPolicyCommand(argv: readonly string[]): Promise<void> {
  const sub = argv[0];
  if (sub === 'test') {
    await runPolicyTestCommand(argv.slice(1));
    return;
  }
  throw new Error('usage: quartermaster policy test --config quartermaster.json --tool server.tool');
}

function printRootHelp(): void {
  console.log(`quartermaster — eval, dashboard, and telemetry for MCP tool routing

Usage:
  quartermaster eval --config quartermaster.json --cases eval.jsonl
  quartermaster eval --from-audit audit.jsonl --draft-cases cases.jsonl
  quartermaster eval --config quartermaster.json --cases eval.jsonl --report report.html
  quartermaster eval --ci --min-r8 0.72 --config ... --cases ...
  quartermaster dashboard --audit audit.jsonl [--port 3847]
  quartermaster report --audit audit.jsonl [--json] [--out report.html]
  quartermaster inspect --config quartermaster.json [--audit audit.jsonl]
  quartermaster policy test --config quartermaster.json --tool server.tool [--agent-id id] [--env staging]
  quartermaster savings --audit audit.jsonl [--json]
  quartermaster doctor --config quartermaster.json [--json]

Run "quartermaster <command> --help" for command details.
`);
}

function printEvalHelp(): void {
  console.log(`quartermaster eval — recall@K benchmark over ranker variants

Usage:
  quartermaster eval --config quartermaster.json --cases eval.jsonl
  quartermaster eval --from-audit audit.jsonl --draft-cases cases.jsonl
  quartermaster eval --config quartermaster.json --from-audit audit.jsonl --report report.html
  quartermaster eval --config quartermaster.json --cases eval.jsonl --report report.html --audit audit.jsonl
  quartermaster eval --config quartermaster.json --cases eval.jsonl --audit-out audit.jsonl
  quartermaster eval --ci --min-r8 0.72 --config ... --cases ...

Variants: bm25, bm25+synonyms, bm25+exp(w=1), tfidf, substring
Metrics: R@1, R@3, R@5, R@8, MRR
`);
}

export { runEval, formatEvalTable, checkCiGate } from './eval.js';
export { draftCasesFromAudit, weakCaseQueries } from './draft-cases.js';
export { startDashboard } from './dashboard.js';
export { runReport } from './audit-report.js';
export { runInspect, inspectCatalog, formatInspectOutput } from './inspect.js';
export { scoreToolQuality, findOverlappingTools } from './quality.js';

export type CliArgs =
  | { command: 'report'; audit: string; json?: boolean; out?: string }
  | { command: 'inspect'; config: string; audit?: string }
  | { command: 'help' };

export function parseCliArgs(argv: readonly string[]): CliArgs {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help' };
  }
  const command = argv[0];
  if (command === 'report') {
    let audit: string | undefined;
    let json = false;
    let out: string | undefined;
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i]!;
      if (a === '--json') json = true;
      else if (a === '--audit') audit = argv[++i];
      else if (a.startsWith('--audit=')) audit = a.slice('--audit='.length);
      else if (a === '--out') out = argv[++i];
      else if (a.startsWith('--out=')) out = a.slice('--out='.length);
    }
    if (audit === undefined || audit === '') throw new Error('report: --audit <path> is required');
    return { command: 'report', audit, json, out };
  }
  if (command === 'inspect') {
    let config: string | undefined;
    let audit: string | undefined;
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i]!;
      if (a === '--config') config = argv[++i];
      else if (a.startsWith('--config=')) config = a.slice('--config='.length);
      else if (a === '--audit') audit = argv[++i];
      else if (a.startsWith('--audit=')) audit = a.slice('--audit='.length);
    }
    if (config === undefined || config === '') throw new Error('inspect: --config <path> is required');
    return { command: 'inspect', config, audit };
  }
  throw new Error(`unknown command: ${command}`);
}

export async function runCli(argv: readonly string[]): Promise<void> {
  try {
    const args = parseCliArgs(argv);
    if (args.command === 'help') {
      printRootHelp();
      return;
    }
    if (args.command === 'report') {
      runReport({ auditPath: args.audit, json: args.json, out: args.out });
      return;
    }
    if (args.command === 'inspect') {
      await runInspect({ configPath: args.config, auditPath: args.audit });
    }
  } catch (e) {
    console.error(`quartermaster: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
