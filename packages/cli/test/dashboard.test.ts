import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { startDashboard } from '../dist/dashboard.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('dashboard serves GET / with 200', async () => {
  const auditPath = join(HERE, 'fixtures', 'sample-audit.jsonl');
  const dash = await startDashboard({ auditPath, port: 0 });
  const addr = dash.server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : dash.port;

  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Quartermaster Dashboard/);
  await dash.close();
});
