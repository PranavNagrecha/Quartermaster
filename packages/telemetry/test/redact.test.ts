import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactAuditEvent } from '../dist/redact.js';

test('redactAuditEvent masks secret keys in arguments', () => {
  const out = redactAuditEvent({
    event: 'call',
    arguments: { title: 'hello', apiKey: 'sk-secret123', token: 'abc' },
  });
  const args = out.arguments as Record<string, unknown>;
  assert.equal(args.title, 'hello');
  assert.equal(args.apiKey, '[REDACTED]');
  assert.equal(args.token, '[REDACTED]');
});

test('redactAuditEvent masks bearer tokens in error strings', () => {
  const out = redactAuditEvent({
    event: 'server_error',
    reason: 'auth failed Bearer eyJhbGciOiJIUzI1NiJ9',
  });
  assert.match(String(out.reason), /Bearer \[REDACTED\]/);
});
