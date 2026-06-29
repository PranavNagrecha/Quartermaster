#!/usr/bin/env node
/**
 * MCP protocol smoke — real public MCP servers federated behind quartermaster-mcp.
 *
 * Env:
 *   QM_SMOKE_COMMAND, QM_SMOKE_ARGS — how to launch quartermaster-mcp
 *   QM_SMOKE_MODE — "real" (default) | "filesystem" (single-server shortcut)
 *   QM_REAL_CONFIG — path to multi-server quartermaster.json
 *   QM_FILESYSTEM_ROOT — allowed dir for filesystem calls
 *   QM_REAL_SERVER_IDS — JSON array of expected downstream ids
 *   QM_AUDIT_FILE — optional audit path
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeRealServersConfig } from './build-real-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const requireFromProxy = createRequire(join(REPO, 'packages', 'proxy', 'package.json'));
const { Client } = await import(
  pathToFileURL(requireFromProxy.resolve('@modelcontextprotocol/sdk/client/index.js')).href
);
const { StdioClientTransport } = await import(
  pathToFileURL(requireFromProxy.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href
);
const LOCAL_BIN = join(REPO, 'packages', 'proxy', 'bin', 'quartermaster-mcp.js');

const mode = process.env.QM_SMOKE_MODE ?? 'real';
const auditFile = process.env.QM_AUDIT_FILE;
const realConfig = process.env.QM_REAL_CONFIG;
const realServerIds = process.env.QM_REAL_SERVER_IDS ? JSON.parse(process.env.QM_REAL_SERVER_IDS) : null;
const filesystemRoot = process.env.QM_FILESYSTEM_ROOT ?? realpathSync(tmpdir());
const filesystemConfig = process.env.QM_FILESYSTEM_CONFIG;

function writeFilesystemOnlyConfig(dir) {
  const configPath = join(dir, 'quartermaster-filesystem.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        servers: [
          {
            id: 'filesystem',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', filesystemRoot],
          },
        ],
        synonyms: { folder: ['directory'], file: ['read'] },
        k: 8,
      },
      null,
      2,
    ),
  );
  return configPath;
}

function resolveLaunch(configPath) {
  if (process.env.QM_SMOKE_COMMAND) {
    const extra = process.env.QM_SMOKE_ARGS ? JSON.parse(process.env.QM_SMOKE_ARGS) : [];
    return { command: process.env.QM_SMOKE_COMMAND, args: [...extra, '--config', configPath] };
  }
  return { command: process.execPath, args: [LOCAL_BIN, '--config', configPath] };
}

const textOf = (res) => res.content?.[0]?.text ?? '';

async function waitForFederation(client, serverIds, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload;
  while (Date.now() < deadline) {
    const servers = await client.callTool({ name: 'list_servers', arguments: {} });
    lastPayload = JSON.parse(textOf(servers));
    const ids = new Set((lastPayload.servers ?? []).map((s) => s.id));
    const ready =
      lastPayload.degraded === false && serverIds.every((id) => ids.has(id));
    if (ready) return lastPayload;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `federation not ready after ${timeoutMs}ms (want [${serverIds.join(', ')}], got ${JSON.stringify(lastPayload)})`,
  );
}

async function retrieveTopTools(client, query, k = 8) {
  const res = await client.callTool({ name: 'retrieve_tools', arguments: { query, k } });
  if (res.isError === true) {
    throw new Error(`retrieve_tools failed for "${query}": ${textOf(res)}`);
  }
  const payload = JSON.parse(textOf(res));
  const top = (payload.candidates ?? []).slice(0, k).map((c) => c.tool);
  if (top.length === 0) {
    throw new Error(
      `retrieve_tools returned no candidates for "${query}" (confidence=${payload.confidence ?? 'unknown'})`,
    );
  }
  return { payload, top };
}

async function runRealProtocolChecks(client, serverIds, fsRoot) {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['call_tool', 'list_servers', 'retrieve_tools'], 'meta-tools');

  await waitForFederation(client, serverIds);

  const { top: fsTop } = await retrieveTopTools(client, 'what files are in this folder');
  assert.ok(
    fsTop.some((t) => t === 'filesystem.list_directory' || t === 'filesystem.directory_tree'),
    `filesystem list tool in top-8: ${fsTop.join(', ')}`,
  );

  const listDir = await client.callTool({
    name: 'call_tool',
    arguments: { name: 'filesystem.list_directory', arguments: { path: fsRoot } },
  });
  assert.notEqual(listDir.isError, true, `list_directory: ${textOf(listDir)}`);

  const { top: memTop } = await retrieveTopTools(client, 'remember the API listens on port 3000');
  assert.ok(memTop.some((t) => t.startsWith('memory.')), `memory tool in top-8: ${memTop.join(', ')}`);

  const { payload: echoPayload } = await retrieveTopTools(client, 'echo a message back');
  assert.ok(
    echoPayload.candidates.some((c) => c.tool === 'everything.echo'),
    `everything.echo ranked: ${echoPayload.candidates.slice(0, 5).map((c) => c.tool).join(', ')}`,
  );

  if (serverIds.includes('thinking')) {
    const { payload: thinkPayload } = await retrieveTopTools(
      client,
      'think through this refactor step by step',
    );
    assert.ok(
      thinkPayload.candidates.some((c) => c.tool === 'thinking.sequentialthinking'),
      `thinking tool ranked: ${thinkPayload.candidates.slice(0, 5).map((c) => c.tool).join(', ')}`,
    );
  }

  const servers = await client.callTool({ name: 'list_servers', arguments: {} });
  const serverPayload = JSON.parse(textOf(servers));
  assert.equal(serverPayload.degraded, false, 'federation not degraded');
  for (const id of serverIds) {
    assert.ok(serverPayload.servers.some((s) => s.id === id), `downstream ${id} connected`);
  }

  const bad = await client.callTool({
    name: 'call_tool',
    arguments: { name: 'filesystem.this_tool_does_not_exist' },
  });
  assert.equal(bad.isError, true, 'unknown tool returns isError');
}

async function runFilesystemProtocolChecks(client, fsRoot) {
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['call_tool', 'list_servers', 'retrieve_tools'], 'meta-tools');

  const retrieve = await client.callTool({
    name: 'retrieve_tools',
    arguments: { query: 'read a file' },
  });
  const payload = JSON.parse(textOf(retrieve));
  const top3 = payload.candidates.slice(0, 3).map((c) => c.tool);
  assert.ok(
    top3.some((t) => t.startsWith('filesystem.read')),
    `read tool in top-3: ${top3.join(', ')}`,
  );

  const call = await client.callTool({
    name: 'call_tool',
    arguments: { name: 'filesystem.list_directory', arguments: { path: fsRoot } },
  });
  assert.notEqual(call.isError, true, `list_directory: ${textOf(call)}`);

  const servers = await client.callTool({ name: 'list_servers', arguments: {} });
  const serverPayload = JSON.parse(textOf(servers));
  assert.equal(serverPayload.degraded, false);
  assert.ok(serverPayload.servers.some((s) => s.id === 'filesystem'));
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'qm-mcp-smoke-'));
  let configPath;
  let serverIds;
  let fsRoot = filesystemRoot;

  if (mode === 'filesystem') {
    configPath = filesystemConfig ?? writeFilesystemOnlyConfig(workDir);
    serverIds = ['filesystem'];
  } else {
    if (realConfig) {
      configPath = realConfig;
      serverIds = realServerIds ?? ['filesystem', 'memory', 'everything'];
    } else {
      const built = writeRealServersConfig(workDir, { repoRoot: REPO });
      configPath = built.configPath;
      serverIds = built.serverIds;
      fsRoot = built.fsRoot;
    }
  }

  const launch = resolveLaunch(configPath);
  const env = { ...process.env };
  if (auditFile) {
    env.QM_AUDIT = '1';
    env.QM_AUDIT_FILE = auditFile;
  }

  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'qm-smoke', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);

  try {
    if (mode === 'filesystem') {
      await runFilesystemProtocolChecks(client, fsRoot);
    } else {
      await runRealProtocolChecks(client, serverIds, fsRoot);
    }
    console.log(`mcp-smoke (${mode}): all protocol checks passed (${serverIds.join(', ')})`);
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('mcp-smoke failed:', err);
  process.exit(1);
});
