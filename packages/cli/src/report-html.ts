import type { AuditReportSummary } from '@quartermaster/telemetry';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toolTable(rows: readonly { tool: string; count: number }[], title: string): string {
  if (rows.length === 0) {
    return `<section><h2>${esc(title)}</h2><p class="muted">No data</p></section>`;
  }
  const body = rows
    .map((r) => `<tr><td>${esc(r.tool)}</td><td class="num">${r.count}</td></tr>`)
    .join('');
  return `<section><h2>${esc(title)}</h2><table><thead><tr><th>Tool</th><th>Count</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

function listSection(title: string, items: readonly string[]): string {
  if (items.length === 0) {
    return `<section><h2>${esc(title)}</h2><p class="muted">None</p></section>`;
  }
  const lis = items.map((i) => `<li>${esc(i)}</li>`).join('');
  return `<section><h2>${esc(title)}</h2><ul>${lis}</ul></section>`;
}

export function renderHtmlReport(summary: AuditReportSummary): string {
  const serverRows = summary.tokenSavingsPerServer
    .map((s) => `<tr><td>${esc(s.serverId)}</td><td class="num">${s.tokensSaved.toLocaleString()}</td></tr>`)
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Quartermaster Audit Report</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --card: #ffffff;
      --text: #1a1d21;
      --muted: #5c6570;
      --border: #d8dde3;
      --accent: #2563eb;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f1114;
        --card: #171a1f;
        --text: #e8eaed;
        --muted: #9aa3ad;
        --border: #2a3038;
        --accent: #60a5fa;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem 1rem 3rem;
    }
    .wrap { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 1.75rem; margin: 0 0 0.25rem; }
    .subtitle { color: var(--muted); margin: 0 0 2rem; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .metric {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem 1.1rem;
    }
    .metric .label { color: var(--muted); font-size: 0.85rem; }
    .metric .value { font-size: 1.5rem; font-weight: 600; margin-top: 0.25rem; }
    section {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1.25rem 1.35rem;
      margin-bottom: 1rem;
    }
    h2 { font-size: 1.05rem; margin: 0 0 0.75rem; color: var(--accent); }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    th, td { text-align: left; padding: 0.45rem 0.5rem; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 500; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    ul { margin: 0; padding-left: 1.25rem; }
    .muted { color: var(--muted); margin: 0; }
    footer { margin-top: 2rem; color: var(--muted); font-size: 0.8rem; text-align: center; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Quartermaster Audit Report</h1>
    <p class="subtitle">Routing traffic summary and token savings estimate</p>

    <div class="grid">
      <div class="metric"><div class="label">Retrieves</div><div class="value">${summary.totalRetrieves}</div></div>
      <div class="metric"><div class="label">Calls</div><div class="value">${summary.totalCalls}</div></div>
      <div class="metric"><div class="label">Conversion rate</div><div class="value">${(summary.conversionRate * 100).toFixed(1)}%</div></div>
      <div class="metric"><div class="label">Avg candidates</div><div class="value">${summary.avgCandidateCount}</div></div>
      <div class="metric"><div class="label">Low confidence rate</div><div class="value">${(summary.lowConfidenceRate * 100).toFixed(1)}%</div></div>
      <div class="metric"><div class="label">Call miss rate</div><div class="value">${(summary.callMissRate * 100).toFixed(1)}%</div></div>
      <div class="metric"><div class="label">Tokens saved / query</div><div class="value">${summary.tokenSavingsPerQuery.toLocaleString()}</div></div>
      <div class="metric"><div class="label">Est. dollar savings</div><div class="value">$${summary.estimatedDollarSavings.toFixed(4)}</div></div>
    </div>

    ${toolTable(summary.topSearchedTools, 'Top searched tools')}
    ${toolTable(summary.topCalledTools, 'Top called tools')}
    ${listSection('Tools retrieved but never called', summary.toolsNeverCalled)}
    ${listSection('Servers never used', summary.serversNeverUsed)}

    <section>
      <h2>Token savings by server</h2>
      ${
        summary.tokenSavingsPerServer.length === 0
          ? '<p class="muted">No server breakdown</p>'
          : `<table><thead><tr><th>Server</th><th>Tokens saved</th></tr></thead><tbody>${serverRows}</tbody></table>`
      }
    </section>

    <footer>Generated by quartermaster report</footer>
  </div>
</body>
</html>`;
}
