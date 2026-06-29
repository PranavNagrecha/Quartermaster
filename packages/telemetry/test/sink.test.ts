import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createAuditSink, createSessionId } from '../dist/sink.js';

test('createSessionId returns 8-char string', () => {
  const id = createSessionId();
  assert.equal(id.length, 8);
});

test('auditLog writes JSONL to stderr when QM_AUDIT=1', () => {
  const prev = process.env.QM_AUDIT;
  delete process.env.QM_AUDIT_FILE;
  process.env.QM_AUDIT = '1';
  const lines: string[] = [];
  const orig = console.error;
  console.error = (msg: string) => {
    lines.push(msg);
  };
  const sink = createAuditSink('sess-test');
  try {
    sink.auditLog({ event: 'retrieve', traceId: 't1', query: 'q', k: 1 } as Record<string, unknown>);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    assert.equal(parsed.schemaVersion, 2);
    assert.equal(parsed.sessionId, 'sess-test');
    assert.equal(parsed.event, 'retrieve');
    assert.equal(typeof parsed.ts, 'number');
  } finally {
    console.error = orig;
    if (prev === undefined) delete process.env.QM_AUDIT;
    else process.env.QM_AUDIT = prev;
  }
});

test('auditLog is silent when QM_AUDIT is unset', () => {
  const prev = process.env.QM_AUDIT;
  delete process.env.QM_AUDIT;
  const lines: string[] = [];
  const orig = console.error;
  console.error = (msg: string) => {
    lines.push(msg);
  };
  try {
    createAuditSink().auditLog({ event: 'test' });
    assert.equal(lines.length, 0);
  } finally {
    console.error = orig;
    if (prev === undefined) delete process.env.QM_AUDIT;
    else process.env.QM_AUDIT = prev;
  }
});

test('auditLog appends to QM_AUDIT_FILE when set', () => {
  const prevAudit = process.env.QM_AUDIT;
  const prevFile = process.env.QM_AUDIT_FILE;
  const dir = mkdtempSync(join(tmpdir(), 'qm-audit-'));
  const file = join(dir, 'audit.jsonl');
  process.env.QM_AUDIT = '1';
  process.env.QM_AUDIT_FILE = file;
  const orig = console.error;
  console.error = () => {};
  try {
    createAuditSink('file-sess').auditLog({ event: 'call', tool: 'x.y', ok: true } as Record<string, unknown>);
    const content = readFileSync(file, 'utf8');
    assert.match(content, /"event":"call"/);
    assert.match(content, /"sessionId":"file-sess"/);
  } finally {
    console.error = orig;
    rmSync(dir, { recursive: true, force: true });
    if (prevAudit === undefined) delete process.env.QM_AUDIT;
    else process.env.QM_AUDIT = prevAudit;
    if (prevFile === undefined) delete process.env.QM_AUDIT_FILE;
    else process.env.QM_AUDIT_FILE = prevFile;
  }
});
