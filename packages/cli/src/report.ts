import { writeFileSync } from 'node:fs';
import {
  aggregateOverview,
  aggregateQueryChains,
  aggregateRecommendations,
  aggregateServers,
  aggregateToolStats,
  aggregateUnusedTools,
  readAuditJsonl,
  type AuditLine,
} from '@quartermaster/telemetry';
import type { EvalResult } from './eval.js';
import { escapeHtml, htmlPage, navLinks, pct } from './html.js';
import { KS } from './eval.js';

export function renderEvalReport(
  result: EvalResult,
  auditPath?: string,
): string {
  const auditSection = auditPath !== undefined ? renderAuditSummary(readAuditJsonl(auditPath)) : '';
  const tableRows = result.rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.variant)}</td>
        ${KS.map((k) => `<td>${pct(row.recall[k] ?? 0)}</td>`).join('')}
        <td>${pct(row.mrr)}</td>
      </tr>`,
    )
    .join('\n');

  const body = `<header>
    <h1>Quartermaster Eval Report</h1>
  </header>
  <main>
    <div class="grid">
      <div class="card"><div class="label">Tools</div><div class="value">${result.toolCount}</div></div>
      <div class="card"><div class="label">Cases</div><div class="value">${result.caseCount}</div></div>
    </div>
    <div class="card">
      <h2>Recall @ K</h2>
      <table>
        <thead><tr><th>Variant</th>${KS.map((k) => `<th>R@${k}</th>`).join('')}<th>MRR</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>
    ${auditSection}
  </main>`;

  return htmlPage('Quartermaster Eval Report', body);
}

function renderAuditSummary(events: readonly AuditLine[]): string {
  const o = aggregateOverview(events);
  const stats = aggregateToolStats(events);
  const topTools = stats.slice(0, 10)
    .map((t) => `<tr><td>${escapeHtml(t.tool)}</td><td>${t.called}</td><td>${t.qualityScore}</td></tr>`)
    .join('\n');

  return `<div class="card" style="margin-top:1.5rem">
    <h2>Audit Summary</h2>
    <div class="grid">
      <div class="card"><div class="label">Retrieves</div><div class="value">${o.retrieveCount}</div></div>
      <div class="card"><div class="label">Calls</div><div class="value">${o.callCount}</div></div>
      <div class="card"><div class="label">Misses</div><div class="value">${o.callMissCount}</div></div>
      <div class="card"><div class="label">Token savings</div><div class="value">${Math.round(o.totalEstimatedTokenSavings)}</div></div>
    </div>
    <h3>Top tools</h3>
    <table><thead><tr><th>Tool</th><th>Calls</th><th>Quality</th></tr></thead><tbody>${topTools}</tbody></table>
  </div>`;
}

export function writeEvalReport(path: string, result: EvalResult, auditPath?: string): void {
  writeFileSync(path, renderEvalReport(result, auditPath), 'utf8');
}

export function renderDashboardPage(
  route: string,
  events: readonly AuditLine[],
  evalEvents: readonly AuditLine[],
  weakQueries: readonly string[],
  catalogTools: readonly string[],
): string {
  switch (route) {
    case '/':
      return renderOverview(events);
    case '/queries':
      return renderQueries(events);
    case '/tools':
      return renderTools(events, catalogTools);
    case '/servers':
      return renderServers(events);
    case '/evals':
      return renderEvals(evalEvents);
    case '/recommendations':
      return renderRecommendations(events, weakQueries);
    default:
      return renderOverview(events);
  }
}

function pageShell(title: string, content: string): string {
  return htmlPage(title, `<header><h1>Quartermaster Dashboard</h1>${navLinks()}</header><main>${content}</main>`);
}

function renderOverview(events: readonly AuditLine[]): string {
  const o = aggregateOverview(events);
  const lowRate = o.retrieveCount > 0 ? o.lowConfidenceCount / o.retrieveCount : 0;
  return pageShell(
    'Overview',
    `<div class="grid">
      <div class="card"><div class="label">Est. cost savings</div><div class="value">$${o.totalEstimatedCostSavingsUsd.toFixed(4)}</div></div>
      <div class="card"><div class="label">Token savings</div><div class="value">${Math.round(o.totalEstimatedTokenSavings)}</div></div>
      <div class="card"><div class="label">Calls</div><div class="value">${o.callCount}</div></div>
      <div class="card"><div class="label">Misses</div><div class="value ${o.callMissCount > 0 ? 'bad' : 'ok'}">${o.callMissCount}</div></div>
      <div class="card"><div class="label">Low-confidence rate</div><div class="value ${lowRate > 0.2 ? 'warn' : 'ok'}">${pct(lowRate)}</div></div>
      <div class="card"><div class="label">Avg latency</div><div class="value">${o.avgLatencyMs.toFixed(0)}ms</div></div>
    </div>`,
  );
}

function renderQueries(events: readonly AuditLine[]): string {
  const chains = aggregateQueryChains(events);
  const rows = chains
    .map(
      (c) => `<tr>
        <td>${escapeHtml(c.query)}</td>
        <td>${escapeHtml(c.confidence)}</td>
        <td>${escapeHtml(c.calledTool ?? '—')}</td>
        <td>${c.callOk === false ? '<span class="bad">fail</span>' : c.callOk ? '<span class="ok">ok</span>' : '—'}</td>
        <td>${c.rank ?? '—'}</td>
      </tr>`,
    )
    .join('\n');
  return pageShell(
    'Queries',
    `<div class="card"><table>
      <thead><tr><th>Query</th><th>Confidence</th><th>Called</th><th>Status</th><th>Rank</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`,
  );
}

function renderTools(events: readonly AuditLine[], catalogTools: readonly string[]): string {
  const stats = aggregateToolStats(events);
  const unused = aggregateUnusedTools(events, catalogTools);
  const rows = stats
    .map(
      (t) => `<tr>
        <td>${escapeHtml(t.tool)}</td>
        <td>${t.searched}</td>
        <td>${t.called}</td>
        <td>${t.misses}</td>
        <td>${t.avgRank !== null ? t.avgRank.toFixed(1) : '—'}</td>
        <td>${t.qualityScore}</td>
      </tr>`,
    )
    .join('\n');
  const unusedList = unused.length > 0
    ? `<h3>Unused (${unused.length})</h3><pre>${escapeHtml(unused.slice(0, 50).join('\n'))}</pre>`
    : '';
  return pageShell(
    'Tools',
    `<div class="card"><table>
      <thead><tr><th>Tool</th><th>Searched</th><th>Called</th><th>Misses</th><th>Avg rank</th><th>Quality</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>${unusedList}`,
  );
}

function renderServers(events: readonly AuditLine[]): string {
  const servers = aggregateServers(events);
  const rows = servers
    .map(
      (s) => `<tr>
        <td>${escapeHtml(s.id)}</td>
        <td>${s.toolCount}</td>
        <td>${s.ok ? '<span class="ok">ok</span>' : '<span class="bad">degraded</span>'}</td>
        <td>${s.usage}</td>
      </tr>`,
    )
    .join('\n');
  return pageShell(
    'Servers',
    `<div class="card"><table>
      <thead><tr><th>Server</th><th>Tools</th><th>Health</th><th>Usage</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No server_snapshot events</td></tr>'}</tbody>
    </table></div>`,
  );
}

function renderEvals(evalEvents: readonly AuditLine[]): string {
  if (evalEvents.length === 0) {
    return pageShell('Evals', '<div class="card"><p>No eval_run events yet. Run <code>quartermaster eval</code> to generate metrics.</p></div>');
  }
  const pre = escapeHtml(JSON.stringify(evalEvents, null, 2));
  return pageShell('Evals', `<div class="card"><pre>${pre}</pre></div>`);
}

function renderRecommendations(events: readonly AuditLine[], weakQueries: readonly string[]): string {
  const recs = aggregateRecommendations(events, weakQueries);
  const rows = recs
    .map(
      (r) => `<tr>
        <td>${escapeHtml(r.kind)}</td>
        <td>${escapeHtml(r.token)}</td>
        <td>${escapeHtml(r.suggestion)}</td>
        <td>${escapeHtml(r.reason)}</td>
      </tr>`,
    )
    .join('\n');
  return pageShell(
    'Recommendations',
    `<div class="card"><table>
      <thead><tr><th>Kind</th><th>Token</th><th>Suggestion</th><th>Reason</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">No recommendations yet</td></tr>'}</tbody>
    </table></div>`,
  );
}
