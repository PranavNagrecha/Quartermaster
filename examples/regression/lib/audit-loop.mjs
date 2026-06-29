#!/usr/bin/env node
/** Verify eval --from-audit draft + weak-case replay (per-team tuning loop). */
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeDevWorkbenchConfig } from '../../smoke/build-real-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const CLI = join(REPO, 'packages', 'proxy', 'bin', 'quartermaster.js');
const SAMPLE_AUDIT = join(REPO, 'packages', 'cli', 'test', 'fixtures', 'sample-audit.jsonl');

export function runAuditLoopCheck(repoRoot = REPO) {
  const workDir = mkdtempSync(join(tmpdir(), 'qm-audit-loop-'));
  try {
    const { configPath } = writeDevWorkbenchConfig(workDir, { repoRoot });
    const auditCopy = join(workDir, 'sample-audit.jsonl');
    copyFileSync(SAMPLE_AUDIT, auditCopy);
    const draftPath = join(workDir, 'draft-cases.jsonl');

    let r = spawnSync(
      process.execPath,
      [CLI, 'eval', '--from-audit', auditCopy, '--draft-cases', draftPath],
      { encoding: 'utf8', cwd: repoRoot },
    );
    assert.equal(r.status, 0, `draft cases failed:\n${r.stderr || r.stdout}`);
    const drafted = readFileSync(draftPath, 'utf8').trim();
    assert.ok(drafted.length > 0, 'no draft cases written');

    r = spawnSync(
      process.execPath,
      [CLI, 'eval', '--from-audit', auditCopy, '--config', configPath, '--draft-cases', draftPath],
      { encoding: 'utf8', cwd: repoRoot },
    );
    assert.equal(r.status, 0, `replay eval failed:\n${r.stderr || r.stdout}`);

    return { draftCaseCount: drafted.split('\n').filter(Boolean).length };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runAuditLoopCheck();
  console.log(`audit-loop: ok (${result.draftCaseCount} draft cases)`);
}
