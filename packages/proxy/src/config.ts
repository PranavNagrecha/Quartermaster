/**
 * Parse + validate a `quartermaster.json` config. Hand-rolled (zero extra deps)
 * with actionable error messages — a bad config should tell the operator exactly
 * what to fix, not throw a cryptic type error deep in the server.
 */
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { mergePolicy, parsePolicyObject } from '@quartermaster/policy';
import type { PolicyConfig } from '@quartermaster/policy';
import type { DownstreamServer, ProxyConfig, ProxyRankerConfig } from './index.js';
import type { RouterConfig, Tool } from '@quartermaster/core';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function validateTools(v: unknown, src: string): Tool[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`quartermaster: ${src} "tools" must be an array.`);
  return v.map((t, i) => {
    if (!isObject(t)) throw new Error(`quartermaster: ${src} tools[${i}] must be an object.`);
    if (typeof t.name !== 'string' || t.name.trim() === '') {
      throw new Error(`quartermaster: ${src} tools[${i}] is missing a non-empty string "name".`);
    }
    for (const key of ['description', 'keywords', 'category'] as const) {
      if (t[key] !== undefined && typeof t[key] !== 'string') {
        throw new Error(`quartermaster: ${src} tools[${i}].${key} must be a string if present.`);
      }
    }
    return {
      name: t.name,
      description: t.description as string | undefined,
      keywords: t.keywords as string | undefined,
      category: t.category as string | undefined,
    };
  });
}

function validateServers(v: unknown, src: string): DownstreamServer[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`quartermaster: ${src} "servers" must be an array.`);
  const out: DownstreamServer[] = v.map((s, i) => {
    if (!isObject(s)) throw new Error(`quartermaster: ${src} servers[${i}] must be an object.`);
    if (typeof s.id !== 'string' || s.id.trim() === '') {
      throw new Error(`quartermaster: ${src} servers[${i}] is missing a non-empty string "id".`);
    }
    if (s.id.includes('.')) {
      throw new Error(
        `quartermaster: ${src} servers[${i}] ("${s.id}") id must not contain '.' — it namespaces tool names as server.tool.`,
      );
    }
    const transport = s.transport;
    if (transport !== undefined && transport !== 'stdio' && transport !== 'http') {
      throw new Error(`quartermaster: ${src} servers[${i}] ("${s.id}").transport must be "stdio" or "http".`);
    }
    const hasCommand = typeof s.command === 'string' && s.command.trim() !== '';
    const hasUrl = typeof s.url === 'string' && s.url.trim() !== '';
    if (hasCommand && hasUrl) {
      throw new Error(
        `quartermaster: ${src} servers[${i}] ("${s.id}") must not set both "command" and "url" — use stdio or http.`,
      );
    }
    if (!hasCommand && !hasUrl) {
      throw new Error(
        `quartermaster: ${src} servers[${i}] ("${s.id}") needs "command" (stdio) or "url" (http).`,
      );
    }
    if (hasUrl || transport === 'http') {
      if (!hasUrl) {
        throw new Error(`quartermaster: ${src} servers[${i}] ("${s.id}") with transport "http" needs a "url".`);
      }
      if (s.headers !== undefined && (!isObject(s.headers) || Object.values(s.headers).some((val) => typeof val !== 'string'))) {
        throw new Error(`quartermaster: ${src} servers[${i}] ("${s.id}").headers must be an object of string -> string.`);
      }
      return {
        id: s.id,
        transport: 'http' as const,
        url: s.url as string,
        headers: s.headers as Record<string, string> | undefined,
        ...validateServerReliability(s, src, i),
      };
    }
    if (s.args !== undefined && (!Array.isArray(s.args) || s.args.some((a) => typeof a !== 'string'))) {
      throw new Error(`quartermaster: ${src} servers[${i}] ("${s.id}").args must be an array of strings.`);
    }
    if (s.env !== undefined && (!isObject(s.env) || Object.values(s.env).some((val) => typeof val !== 'string'))) {
      throw new Error(`quartermaster: ${src} servers[${i}] ("${s.id}").env must be an object of string -> string.`);
    }
    return {
      id: s.id,
      transport: 'stdio' as const,
      command: s.command as string,
      args: s.args as string[] | undefined,
      env: s.env as Record<string, string> | undefined,
      ...validateServerReliability(s, src, i),
    };
  });
  // Ids must be unique — they namespace tool names, so a collision would shadow tools.
  const seen = new Set<string>();
  for (const s of out) {
    if (seen.has(s.id)) {
      throw new Error(`quartermaster: ${src} has a duplicate server id "${s.id}" — ids must be unique (they namespace tool names).`);
    }
    seen.add(s.id);
  }
  return out;
}

function validateSynonyms(v: unknown, src: string): Record<string, string[]> | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v)) throw new Error(`quartermaster: ${src} "synonyms" must be an object of token → string[].`);
  const out: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(v)) {
    if (!Array.isArray(val) || val.some((s) => typeof s !== 'string')) {
      throw new Error(`quartermaster: ${src} synonyms["${key}"] must be an array of strings.`);
    }
    out[key] = val as string[];
  }
  return out;
}

function validateOverlays(v: unknown, src: string): Record<string, { keywords?: string }> | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v)) throw new Error(`quartermaster: ${src} "overlays" must be an object of toolName → { keywords }.`);
  const out: Record<string, { keywords?: string }> = {};
  for (const [key, val] of Object.entries(v)) {
    if (!isObject(val) || (val.keywords !== undefined && typeof val.keywords !== 'string')) {
      throw new Error(`quartermaster: ${src} overlays["${key}"] must be an object with a string "keywords".`);
    }
    out[key] = { keywords: val.keywords as string | undefined };
  }
  return out;
}

function validateK(v: unknown, src: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`quartermaster: ${src} "k" must be a positive number.`);
  }
  return v;
}

const RANKER_KEYS = new Set([
  'ranker',
  'nameWeight',
  'k1',
  'b',
  'expansionWeight',
  'marginThreshold',
  'minTopScore',
  'hintBoost',
]);

function validateRanker(v: unknown, src: string): ProxyRankerConfig | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v)) throw new Error(`quartermaster: ${src} "ranker" must be an object.`);
  for (const key of Object.keys(v)) {
    if (!RANKER_KEYS.has(key)) {
      throw new Error(`quartermaster: ${src} ranker has unknown key "${key}".`);
    }
  }
  const ranker = v.ranker;
  if (ranker !== undefined && ranker !== 'bm25' && ranker !== 'tfidf') {
    throw new Error(`quartermaster: ${src} ranker.ranker must be "bm25" or "tfidf".`);
  }
  const posNum = (val: unknown, key: string): number | undefined => {
    if (val === undefined) return undefined;
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      throw new Error(`quartermaster: ${src} ranker.${key} must be a non-negative number.`);
    }
    return val;
  };
  const exp = v.expansionWeight;
  if (exp !== undefined && (typeof exp !== 'number' || !Number.isFinite(exp) || exp < 0 || exp > 1)) {
    throw new Error(`quartermaster: ${src} ranker.expansionWeight must be a number in [0, 1].`);
  }
  const margin = v.marginThreshold;
  if (margin !== undefined && (typeof margin !== 'number' || !Number.isFinite(margin) || margin < 0 || margin > 1)) {
    throw new Error(`quartermaster: ${src} ranker.marginThreshold must be a number in [0, 1].`);
  }
  return {
    ranker: ranker as 'bm25' | 'tfidf' | undefined,
    nameWeight: posNum(v.nameWeight, 'nameWeight'),
    k1: posNum(v.k1, 'k1'),
    b: posNum(v.b, 'b'),
    expansionWeight: exp as number | undefined,
    marginThreshold: margin as number | undefined,
    minTopScore: posNum(v.minTopScore, 'minTopScore'),
    hintBoost: posNum(v.hintBoost, 'hintBoost'),
  };
}

function validateRefreshInterval(v: unknown, src: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 1000) {
    throw new Error(`quartermaster: ${src} "refreshIntervalMs" must be a number >= 1000.`);
  }
  return v;
}

function validatePositiveMs(v: unknown, name: string, src: string): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new Error(`quartermaster: ${src} "${name}" must be a positive number.`);
  }
  return v;
}

function validateCircuitBreaker(v: unknown, src: string, i: number) {
  if (v === undefined) return undefined;
  if (!isObject(v)) {
    throw new Error(`quartermaster: ${src} servers[${i}].circuitBreaker must be an object.`);
  }
  const failureThreshold = validatePositiveMs(v.failureThreshold, 'failureThreshold', `${src} servers[${i}].circuitBreaker`);
  const resetMs = validatePositiveMs(v.resetMs, 'resetMs', `${src} servers[${i}].circuitBreaker`);
  if (failureThreshold === undefined && resetMs === undefined) return undefined;
  return { failureThreshold, resetMs };
}

function validateServerReliability(s: Record<string, unknown>, src: string, i: number) {
  return {
    callTimeoutMs: validatePositiveMs(s.callTimeoutMs, 'callTimeoutMs', `${src} servers[${i}]`),
    connectTimeoutMs: validatePositiveMs(s.connectTimeoutMs, 'connectTimeoutMs', `${src} servers[${i}]`),
    maxConcurrency: validatePositiveMs(s.maxConcurrency, 'maxConcurrency', `${src} servers[${i}]`),
    circuitBreaker: validateCircuitBreaker(s.circuitBreaker, src, i),
  };
}

function validatePricing(v: unknown, src: string): ProxyConfig['pricing'] | undefined {
  if (v === undefined) return undefined;
  if (!isObject(v)) throw new Error(`quartermaster: ${src} "pricing" must be an object.`);
  const cost = v.costPer1kTokensUsd;
  if (cost !== undefined && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)) {
    throw new Error(`quartermaster: ${src} pricing.costPer1kTokensUsd must be a non-negative number.`);
  }
  const method = v.tokenEstimateMethod;
  if (method !== undefined && method !== 'chars/4' && method !== 'words*1.3') {
    throw new Error(`quartermaster: ${src} pricing.tokenEstimateMethod must be "chars/4" or "words*1.3".`);
  }
  return {
    costPer1kTokensUsd: cost as number | undefined,
    tokenEstimateMethod: method as 'chars/4' | 'words*1.3' | undefined,
  };
}

/** Merge proxy config into core `RouterConfig` (synonyms at top level + optional ranker block). */
export function buildRouterOptions(config: ProxyConfig): RouterConfig {
  const r = config.ranker ?? {};
  return {
    ranker: r.ranker,
    synonyms: config.synonyms,
    nameWeight: r.nameWeight,
    k1: r.k1,
    b: r.b,
    expansionWeight: r.expansionWeight,
    marginThreshold: r.marginThreshold,
    minTopScore: r.minTopScore,
    hintBoost: r.hintBoost,
  };
}

/** Reject paths that escape the config directory via `..` or absolute paths. */
export function assertWithinConfigDir(configDir: string, resolvedPath: string): void {
  const base = resolve(configDir);
  const target = resolve(resolvedPath);
  const rel = relative(base, target);
  if (rel.startsWith('..') || resolve(base, rel) !== target) {
    throw new Error(
      `quartermaster: external file path must stay within the config directory (${base}) — got "${resolvedPath}".`,
    );
  }
}

function validateOptionalString(v: unknown, name: string, src: string): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`quartermaster: ${src} "${name}" must be a non-empty string (a file path).`);
  }
  return v;
}

function validatePolicy(v: unknown, src: string): PolicyConfig | undefined {
  if (v === undefined) return undefined;
  return parsePolicyObject(v, `${src} policy`);
}

/** Validate an already-parsed config object. `source` is used in error messages. */
export function parseConfig(text: string, source = '<config>'): ProxyConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`quartermaster: ${source} is not valid JSON — ${(e as Error).message}`);
  }
  if (!isObject(data)) throw new Error(`quartermaster: ${source} must be a JSON object.`);

  const tools = validateTools(data.tools, source);
  const servers = validateServers(data.servers, source);
  if (tools.length === 0 && servers.length === 0) {
    throw new Error(
      `quartermaster: ${source} must define a non-empty "tools" array (static manifest) or "servers" array (downstream).`,
    );
  }
  return {
    tools,
    servers,
    synonyms: validateSynonyms(data.synonyms, source),
    overlays: validateOverlays(data.overlays, source),
    synonymsFile: validateOptionalString(data.synonymsFile, 'synonymsFile', source),
    overlaysFile: validateOptionalString(data.overlaysFile, 'overlaysFile', source),
    k: validateK(data.k, source),
    ranker: validateRanker(data.ranker, source),
    refreshIntervalMs: validateRefreshInterval(data.refreshIntervalMs, source),
    callTimeoutMs: validatePositiveMs(data.callTimeoutMs, 'callTimeoutMs', source),
    maxK: validateK(data.maxK, source),
    policy: validatePolicy(data.policy, source),
    policyFile: validateOptionalString(data.policyFile, 'policyFile', source),
    pricing: validatePricing(data.pricing, source),
  };
}

/** Read + validate a config file at `path`. Throws an actionable error if missing or invalid. */
export function loadConfig(path: string): ProxyConfig {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`quartermaster: cannot read config file: ${path}`);
  }
  const config = parseConfig(raw, path);
  const dir = dirname(path);

  const readJsonFile = (rel: string, label: string): unknown => {
    const file = resolve(dir, rel);
    assertWithinConfigDir(dir, file);
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      throw new Error(`quartermaster: cannot read ${label} file: ${file}`);
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(`quartermaster: ${label} file ${file} is not valid JSON — ${(e as Error).message}`);
    }
  };

  // External files are the base; inline values override per key.
  let synonyms = config.synonyms;
  if (config.synonymsFile !== undefined) {
    const ext = validateSynonyms(readJsonFile(config.synonymsFile, 'synonyms'), config.synonymsFile) ?? {};
    synonyms = { ...ext, ...(config.synonyms ?? {}) };
  }
  let overlays = config.overlays;
  if (config.overlaysFile !== undefined) {
    const ext = validateOverlays(readJsonFile(config.overlaysFile, 'overlays'), config.overlaysFile) ?? {};
    overlays = { ...ext, ...(config.overlays ?? {}) };
  }
  let policy = config.policy;
  if (config.policyFile !== undefined) {
    const ext = parsePolicyObject(readJsonFile(config.policyFile, 'policy'), config.policyFile);
    policy = mergePolicy(ext, config.policy);
  }
  return { ...config, synonyms, overlays, policy };
}
