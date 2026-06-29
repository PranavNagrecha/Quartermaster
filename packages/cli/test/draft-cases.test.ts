import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readAuditJsonl } from '@quartermaster/telemetry';
import { draftCasesFromAudit } from '../dist/draft-cases.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('draftCasesFromAudit pairs retrieve with call by traceId', () => {
  const events = readAuditJsonl(join(HERE, 'fixtures', 'sample-audit.jsonl'));
  const cases = draftCasesFromAudit(events);
  assert.equal(cases.length, 3);
  const strong = cases.find((c) => c.query === 'file a bug');
  assert.equal(strong?.expectedTool, 'github.create_issue');
  assert.equal(strong?.confidence, 'strong');
  const weak = cases.find((c) => c.query === 'dm sales');
  assert.equal(weak?.expectedTool, 'slack.post_message');
  assert.equal(weak?.confidence, 'weak');
  assert.ok((weak?.weakReasons?.length ?? 0) > 0);
  const cal = cases.find((c) => c.query === 'schedule meeting');
  assert.equal(cal?.expectedTool, 'calendar.create_event');
  assert.equal(cal?.confidence, 'strong');
});
