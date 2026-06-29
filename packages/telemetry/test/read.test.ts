import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readAuditJsonl } from '../dist/read.js';

test('readAuditJsonl parses retrieve and call lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qm-audit-'));
  const path = join(dir, 'audit.jsonl');
  writeFileSync(
    path,
    [
      '{"event":"retrieve","traceId":"t1","query":"file bug","confidence":"high","candidates":[{"tool":"gh.create_issue","score":1.2}]}',
      '{"event":"call","traceId":"t1","tool":"gh.create_issue","ok":true,"rank":1}',
      '',
      '# comment',
    ].join('\n'),
  );
  const events = readAuditJsonl(path);
  assert.equal(events.length, 2);
  assert.equal(events[0]?.event, 'retrieve');
  assert.equal(events[1]?.event, 'call');
});
