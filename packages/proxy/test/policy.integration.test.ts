import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildToolIndex, closeIndex, forwardCall } from '../dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'echo-mcp-server.mjs');

async function echoIndex(policy: Record<string, unknown> | undefined) {
  return buildToolIndex({
    servers: [{ id: 'echo', command: process.execPath, args: [FIXTURE] }],
    policy,
  });
}

test('policy enforce mode blocks denied server calls', async () => {
  const index = await echoIndex({ mode: 'enforce', rules: [{ effect: 'deny', serverId: 'echo' }] });
  try {
    const res = await forwardCall(index, 'echo.create_issue', { title: 'blocked' });
    assert.equal(res.isError, true);
    assert.match(res.content[0]?.text ?? '', /policy denied/);
  } finally {
    await closeIndex(index);
  }
});

test('policy shadow mode logs deny but forwards the call', async () => {
  const index = await echoIndex({ mode: 'shadow', rules: [{ effect: 'deny', serverId: 'echo' }] });
  try {
    const res = await forwardCall(index, 'echo.create_issue', { title: 'allowed' });
    assert.ok(!res.isError);
    assert.match(res.content[0]?.text ?? '', /allowed/);
  } finally {
    await closeIndex(index);
  }
});

test('policy allow rule permits call under default deny', async () => {
  const index = await echoIndex({
    defaultMode: 'deny',
    mode: 'enforce',
    rules: [{ effect: 'allow', toolPattern: 'echo.*' }],
  });
  try {
    const res = await forwardCall(index, 'echo.create_issue', { title: 'ok' });
    assert.ok(!res.isError);
  } finally {
    await closeIndex(index);
  }
});
