import type { DangerousToolPreset, PolicyConfig, PolicyDefaultMode, PolicyMode, PolicyRule } from './types.js';
import { listPresets } from './presets.js';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const VALID_PRESETS = new Set<string>(listPresets());

function validateEffect(v: unknown, src: string, i: number): 'allow' | 'deny' {
  if (v !== 'allow' && v !== 'deny') {
    throw new Error(`quartermaster: ${src} policy.rules[${i}].effect must be "allow" or "deny".`);
  }
  return v;
}

function validateOptionalString(v: unknown, field: string, src: string, i: number): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new Error(`quartermaster: ${src} policy.rules[${i}].${field} must be a non-empty string.`);
  }
  return v;
}

function validateRules(v: unknown, src: string): PolicyRule[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new Error(`quartermaster: ${src} policy.rules must be an array.`);
  return v.map((raw, i) => {
    if (!isObject(raw)) throw new Error(`quartermaster: ${src} policy.rules[${i}] must be an object.`);
    const effect = validateEffect(raw.effect, src, i);
    const serverId = validateOptionalString(raw.serverId, 'serverId', src, i);
    const tool = validateOptionalString(raw.tool, 'tool', src, i);
    const toolPattern = validateOptionalString(raw.toolPattern, 'toolPattern', src, i);
    const environment = validateOptionalString(raw.environment, 'environment', src, i);
    const agentId = validateOptionalString(raw.agentId, 'agentId', src, i);
    const reason = validateOptionalString(raw.reason, 'reason', src, i);
    if (serverId === undefined && tool === undefined && toolPattern === undefined && environment === undefined && agentId === undefined) {
      throw new Error(
        `quartermaster: ${src} policy.rules[${i}] must specify at least one matcher (serverId, tool, toolPattern, environment, or agentId).`,
      );
    }
    return { effect, serverId, tool, toolPattern, environment, agentId, reason };
  });
}

function validatePresets(v: unknown, src: string): DangerousToolPreset[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new Error(`quartermaster: ${src} policy.presets must be an array.`);
  const out: DangerousToolPreset[] = [];
  for (const p of v) {
    if (typeof p !== 'string' || !VALID_PRESETS.has(p)) {
      throw new Error(
        `quartermaster: ${src} policy.presets has invalid preset "${String(p)}" — valid: ${[...VALID_PRESETS].join(', ')}.`,
      );
    }
    out.push(p as DangerousToolPreset);
  }
  return out;
}

function validateDefaultMode(v: unknown, src: string): PolicyDefaultMode | undefined {
  if (v === undefined) return undefined;
  if (v !== 'allow' && v !== 'deny') {
    throw new Error(`quartermaster: ${src} policy.defaultMode must be "allow" or "deny".`);
  }
  return v;
}

function validateMode(v: unknown, src: string): PolicyMode | undefined {
  if (v === undefined) return undefined;
  if (v !== 'enforce' && v !== 'shadow') {
    throw new Error(`quartermaster: ${src} policy.mode must be "enforce" or "shadow".`);
  }
  return v;
}

/** Validate a policy object from JSON. */
export function parsePolicyObject(data: unknown, source = '<policy>'): PolicyConfig {
  if (data === undefined) return {};
  if (!isObject(data)) throw new Error(`quartermaster: ${source} policy must be a JSON object.`);
  return {
    defaultMode: validateDefaultMode(data.defaultMode, source),
    mode: validateMode(data.mode, source),
    presets: validatePresets(data.presets, source),
    rules: validateRules(data.rules, source),
  };
}

/** Merge file policy under inline policy (inline wins per field). */
export function mergePolicy(base: PolicyConfig | undefined, override: PolicyConfig | undefined): PolicyConfig | undefined {
  if (base === undefined && override === undefined) return undefined;
  return {
    defaultMode: override?.defaultMode ?? base?.defaultMode,
    mode: override?.mode ?? base?.mode,
    presets: override?.presets ?? base?.presets,
    rules: [...(base?.rules ?? []), ...(override?.rules ?? [])],
  };
}
