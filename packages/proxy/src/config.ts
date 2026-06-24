/**
 * Parse + validate a `quartermaster.json` config. Hand-rolled (zero extra deps)
 * with actionable error messages — a bad config should tell the operator exactly
 * what to fix, not throw a cryptic type error deep in the server.
 */
import { readFileSync } from 'node:fs';
import type { DownstreamServer, ProxyConfig } from './index.js';
import type { Tool } from '@quartermaster/core';

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
  return v.map((s, i) => {
    if (!isObject(s)) throw new Error(`quartermaster: ${src} servers[${i}] must be an object.`);
    if (typeof s.id !== 'string' || s.id.trim() === '') {
      throw new Error(`quartermaster: ${src} servers[${i}] is missing a non-empty string "id".`);
    }
    if (typeof s.command !== 'string' || s.command.trim() === '') {
      throw new Error(`quartermaster: ${src} servers[${i}] ("${s.id}") is missing a non-empty string "command".`);
    }
    if (s.args !== undefined && (!Array.isArray(s.args) || s.args.some((a) => typeof a !== 'string'))) {
      throw new Error(`quartermaster: ${src} servers[${i}] ("${s.id}").args must be an array of strings.`);
    }
    if (s.env !== undefined && (!isObject(s.env) || Object.values(s.env).some((val) => typeof val !== 'string'))) {
      throw new Error(`quartermaster: ${src} servers[${i}] ("${s.id}").env must be an object of string -> string.`);
    }
    return {
      id: s.id,
      command: s.command,
      args: s.args as string[] | undefined,
      env: s.env as Record<string, string> | undefined,
    };
  });
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
    k: validateK(data.k, source),
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
  return parseConfig(raw, path);
}
