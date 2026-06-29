import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseCliArgs, runReport } from '../dist/index.js';
import { renderHtmlReport } from '../dist/report-html.js';
import { aggregateAudit, readAuditJsonl } from '@quartermaster/telemetry';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'sample-audit.jsonl');

test('parseCliArgs report command', () => {
  assert.deepEqual(parseCliArgs(['report', '--audit', '/a.jsonl', '--json']), {
    command: 'report',
    audit: '/a.jsonl',
    json: true,
    out: undefined,
  });
});

test('parseCliArgs inspect command', () => {
  assert.deepEqual(parseCliArgs(['inspect', '--config', '/c.json']), {
    command: 'inspect',
    config: '/c.json',
    audit: undefined,
  });
});

test('parseCliArgs help', () => {
  assert.deepEqual(parseCliArgs(['--help']), { command: 'help' });
});

test('readAuditJsonl parses fixture', () => {
  const events = readAuditJsonl(FIXTURE);
  assert.equal(events.length, 6);
  assert.equal(events[0]?.event, 'retrieve');
});

test('aggregateAudit computes expected metrics', () => {
  const events = readAuditJsonl(FIXTURE);
  const summary = aggregateAudit(events);
  assert.equal(summary.totalRetrieves, 3);
  assert.equal(summary.totalCalls, 2);
  assert.ok(summary.topSearchedTools.some((t) => t.tool === 'github.create_issue'));
  assert.ok(summary.toolsNeverCalled.includes('calendar.create_event') || summary.toolsNeverCalled.includes('github.search_code'));
  assert.ok(summary.avgCandidateCount > 0);
});

test('renderHtmlReport is self-contained HTML', () => {
  const summary = aggregateAudit(readAuditJsonl(FIXTURE));
  const html = renderHtmlReport(summary);
  assert.match(html, /<html/);
  assert.match(html, /Quartermaster Audit Report/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('runReport writes HTML and prints JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qm-report-'));
  const out = join(dir, 'report.html');
  const logs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (msg: string) => logs.push(msg);
  console.error = () => {};
  try {
    runReport({ auditPath: FIXTURE, json: true, out });
    const html = readFileSync(out, 'utf8');
    assert.match(html, /<html/);
    assert.equal(logs.length, 1);
    const parsed = JSON.parse(logs[0] ?? '{}') as { totalRetrieves: number };
    assert.equal(parsed.totalRetrieves, 3);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
});
