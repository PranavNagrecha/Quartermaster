/**
 * Dev workbench configs — real public MCP servers engineers run locally (no API keys).
 * filesystem + memory + everything + sequential-thinking + git (uvx when available)
 */
import { realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** @returns {boolean} */
export function hasUvx() {
  const r = spawnSync('uvx', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return r.status === 0;
}

/**
 * @param {string} dir
 * @param {{ repoRoot?: string; includeGit?: boolean; includeThinking?: boolean }} [opts]
 */
export function writeDevWorkbenchConfig(dir, opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const fsRoot = realpathSync(tmpdir());
  const servers = [
    {
      id: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', fsRoot],
    },
    {
      id: 'memory',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    {
      id: 'everything',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
    },
  ];

  if (opts.includeThinking !== false) {
    servers.push({
      id: 'thinking',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    });
  }

  const includeGit = opts.includeGit ?? hasUvx();
  if (includeGit) {
    servers.push({
      id: 'git',
      command: 'uvx',
      args: ['mcp-server-git', '--repository', realpathSync(repoRoot)],
    });
  }

  const configPath = join(dir, 'quartermaster-dev.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        servers,
        synonyms: {
          folder: ['directory'],
          file: ['read'],
          remember: ['memory', 'store', 'note'],
          branch: ['git'],
          commit: ['history', 'log'],
          debug: ['think', 'step'],
          refactor: ['think', 'plan'],
          todo: ['search', 'find'],
        },
        k: 8,
      },
      null,
      2,
    ),
  );

  return { configPath, fsRoot, serverIds: servers.map((s) => s.id), includeGit };
}

/** @deprecated alias */
export const writeRealServersConfig = writeDevWorkbenchConfig;

/** Static manifest for ranker regression (no live GitHub/fetch). */
export function writeBlindManifestConfig(dir, tools) {
  const configPath = join(dir, 'quartermaster-blind.json');
  writeFileSync(configPath, JSON.stringify({ tools, k: 8 }, null, 2));
  return configPath;
}
