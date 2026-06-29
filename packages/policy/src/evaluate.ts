import { matchingPreset, ruleMatches } from './match.js';
import type { PolicyConfig, PolicyContext, PolicyDecision, PolicyRule } from './types.js';

const DEFAULT_POLICY: Required<Pick<PolicyConfig, 'defaultMode' | 'mode'>> = {
  defaultMode: 'allow',
  mode: 'enforce',
};

function findMatchingRules(rules: readonly PolicyRule[] | undefined, ctx: PolicyContext): PolicyRule[] {
  if (rules === undefined) return [];
  return rules.filter((r) => ruleMatches(r, ctx));
}

/**
 * Evaluate policy for a tool call. Deny rules beat allow rules; explicit rules beat
 * presets; otherwise defaultMode applies.
 */
export function evaluatePolicy(config: PolicyConfig | undefined, ctx: PolicyContext): PolicyDecision {
  const defaultMode = config?.defaultMode ?? DEFAULT_POLICY.defaultMode;
  const mode = config?.mode ?? DEFAULT_POLICY.mode;
  const shadow = mode === 'shadow';

  if (config === undefined) {
    return {
      allowed: defaultMode === 'allow',
      shadow,
      mode,
      reason: defaultMode === 'allow' ? 'no policy configured (default allow)' : 'no policy configured (default deny)',
    };
  }

  const matched = findMatchingRules(config.rules, ctx);
  const denyRule = matched.find((r) => r.effect === 'deny');
  if (denyRule !== undefined) {
    return {
      allowed: false,
      shadow,
      mode,
      matchedRule: denyRule,
      reason: denyRule.reason ?? `denied by rule (effect=deny)`,
    };
  }

  const allowRule = matched.find((r) => r.effect === 'allow');
  if (allowRule !== undefined) {
    return {
      allowed: true,
      shadow,
      mode,
      matchedRule: allowRule,
      reason: allowRule.reason ?? 'allowed by explicit allow rule',
    };
  }

  const preset = matchingPreset(config.presets, ctx);
  if (preset !== undefined) {
    return {
      allowed: false,
      shadow,
      mode,
      matchedPreset: preset,
      reason: `denied by dangerous-tool preset "${preset}"`,
    };
  }

  const allowed = defaultMode === 'allow';
  return {
    allowed,
    shadow,
    mode,
    reason: allowed ? 'default allow' : 'default deny',
  };
}
