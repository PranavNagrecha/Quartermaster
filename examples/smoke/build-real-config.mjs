/**
 * Dev workbench configs — real public MCP servers engineers run locally (no API keys).
 * filesystem + memory + everything + sequential-thinking + git (uvx when available)
 *
 * Mirrors the per-team setup documented in README: starter synonymsFile +
 * small org-specific inline synonyms.
 */
import { copyFileSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = join(MODULE_DIR, '..', '..');
const STARTER_SYNONYMS_NAME = 'business-to-dev.json';

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
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO;
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

  copyFileSync(join(repoRoot, 'examples', 'synonyms', STARTER_SYNONYMS_NAME), join(dir, STARTER_SYNONYMS_NAME));

  const configPath = join(dir, 'quartermaster-dev.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        servers,
        synonymsFile: `./${STARTER_SYNONYMS_NAME}`,
        synonyms: {
          remember: ['memory', 'store', 'note'],
          think: ['sequential', 'step', 'reason'],
        },
        ranker: { expansionWeight: 0.5 },
        k: 8,
      },
      null,
      2,
    ),
  );

  return {
    configPath,
    fsRoot,
    serverIds: servers.map((s) => s.id),
    includeGit,
    synonymsFile: join(dir, STARTER_SYNONYMS_NAME),
  };
}

/** @deprecated alias */
export const writeRealServersConfig = writeDevWorkbenchConfig;

/** Static blind manifest — no synonyms (honest untuned floor). */
export function writeBlindManifestConfig(dir, tools) {
  const configPath = join(dir, 'quartermaster-blind.json');
  writeFileSync(configPath, JSON.stringify({ tools, k: 8 }, null, 2));
  return configPath;
}

/** Heritage manifest + starter synonyms for ranker regression. */
export function writeHeritageConfig(dir, repoRoot = DEFAULT_REPO) {
  const heritage = JSON.parse(readFileSync(join(repoRoot, 'bench', 'cases', 'heritage-sfi.json'), 'utf8'));
  copyFileSync(join(repoRoot, 'examples', 'synonyms', STARTER_SYNONYMS_NAME), join(dir, STARTER_SYNONYMS_NAME));
  const configPath = join(dir, 'quartermaster-heritage.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        tools: heritage.tools,
        synonymsFile: `./${STARTER_SYNONYMS_NAME}`,
        k: 8,
      },
      null,
      2,
    ),
  );
  return { configPath, caseCount: heritage.cases.length };
}
