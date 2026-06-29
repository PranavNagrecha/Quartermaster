/** Shared inline HTML shell for report + dashboard pages. */
export function htmlPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --bg: #0f1419; --card: #1a2332; --text: #e7ecf3; --muted: #8b9cb3; --accent: #3d8bfd; --ok: #3dd68c; --warn: #f5a524; --bad: #f2555a; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
    header { padding: 1.25rem 1.5rem; border-bottom: 1px solid #2a3548; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    header h1 { margin: 0; font-size: 1.25rem; }
    nav a { color: var(--accent); margin-right: 1rem; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    main { padding: 1.5rem; max-width: 1100px; margin: 0 auto; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .card { background: var(--card); border-radius: 8px; padding: 1rem 1.25rem; border: 1px solid #2a3548; }
    .card .label { color: var(--muted); font-size: 0.85rem; }
    .card .value { font-size: 1.5rem; font-weight: 600; margin-top: 0.25rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #2a3548; }
    th { color: var(--muted); font-weight: 500; }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }
    pre { background: #111820; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function navLinks(): string {
  return `<nav>
    <a href="/">Overview</a>
    <a href="/queries">Queries</a>
    <a href="/tools">Tools</a>
    <a href="/servers">Servers</a>
    <a href="/evals">Evals</a>
    <a href="/recommendations">Recommendations</a>
  </nav>`;
}
