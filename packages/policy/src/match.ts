import { PRESET_PATTERNS } from './presets.js';
import type { DangerousToolPreset, PolicyContext, PolicyRule } from './types.js';

/** Convert a simple glob (* and ?) to a case-insensitive RegExp. */
export function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export function matchesGlob(value: string, pattern: string): boolean {
  return globToRegExp(pattern).test(value);
}

export function ruleMatches(rule: PolicyRule, ctx: PolicyContext): boolean {
  if (rule.serverId !== undefined && rule.serverId !== ctx.serverId) return false;
  if (rule.agentId !== undefined && rule.agentId !== ctx.agentId) return false;
  if (rule.environment !== undefined && rule.environment !== ctx.environment) return false;
  if (rule.tool !== undefined && rule.tool !== ctx.toolName && rule.tool !== ctx.bareName) return false;
  if (rule.toolPattern !== undefined) {
    const hit =
      matchesGlob(ctx.toolName, rule.toolPattern) ||
      matchesGlob(ctx.bareName, rule.toolPattern);
    if (!hit) return false;
  }
  return true;
}

export function matchingPreset(
  presets: readonly DangerousToolPreset[] | undefined,
  ctx: PolicyContext,
): DangerousToolPreset | undefined {
  if (presets === undefined || presets.length === 0) return undefined;
  for (const preset of presets) {
    const patterns = PRESET_PATTERNS[preset];
    for (const pattern of patterns) {
      if (matchesGlob(ctx.toolName, pattern) || matchesGlob(ctx.bareName, pattern)) {
        return preset;
      }
    }
  }
  return undefined;
}
