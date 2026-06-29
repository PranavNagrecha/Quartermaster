/**
 * Build quartermaster.json configs that federate real public MCP servers (npx / uvx).
 * No API keys required for the default set.
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
 * @param {{ repoRoot?: string; includeGit?: boolean }} [opts]
 */
export function writeRealServersConfig(dir, opts = {}) {
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

  const includeGit = opts.includeGit ?? hasUvx();
  if (includeGit) {
    servers.push({
      id: 'git',
      command: 'uvx',
      args: ['mcp-server-git', '--repository', realpathSync(repoRoot)],
    });
  }

  const configPath = join(dir, 'quartermaster-real.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        servers,
        synonyms: {
          folder: ['directory'],
          file: ['read'],
          remember: ['memory', 'store'],
          branch: ['git'],
          commit: ['history', 'log'],
        },
        k: 8,
      },
      null,
      2,
    ),
  );

  return { configPath, fsRoot, serverIds: servers.map((s) => s.id), includeGit };
}
