import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'echo-mcp-server.mjs');
const BIN = join(HERE, '..', 'bin', 'quartermaster-mcp.js');

test('SIGTERM shuts down federated proxy and exits cleanly', { timeout: 25000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qm-shutdown-'));
  const configPath = join(dir, 'quartermaster.json');
  const template = readFileSync(join(HERE, 'fixtures', 'federated-echo.json'), 'utf8');
  writeFileSync(configPath, template.replace('ECHO_PATH', FIXTURE));

  const proc = spawn(process.execPath, [BIN, '--config', configPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    await Promise.race([
      once(proc.stderr, 'data').then(([chunk]) => {
        assert.match(chunk.toString(), /ready \(federated mode\)/);
      }),
      once(proc, 'exit').then(([code]) => {
        throw new Error(`proxy exited early with code ${code}`);
      }),
    ]);
    proc.kill('SIGTERM');
    const [code] = await once(proc, 'exit');
    assert.equal(code, 0);
  } finally {
    if (!proc.killed) proc.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  }
});
