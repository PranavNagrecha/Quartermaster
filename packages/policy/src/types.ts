export type PolicyEffect = 'allow' | 'deny';
export type PolicyDefaultMode = 'allow' | 'deny';
export type PolicyMode = 'enforce' | 'shadow';

export type DangerousToolPreset =
  | 'filesystem_write'
  | 'shell'
  | 'deploy'
  | 'delete'
  | 'network_exfiltration';

export interface PolicyRule {
  readonly effect: PolicyEffect;
  readonly serverId?: string;
  readonly tool?: string;
  readonly toolPattern?: string;
  readonly environment?: string;
  readonly agentId?: string;
  readonly reason?: string;
}

export interface PolicyConfig {
  readonly defaultMode?: PolicyDefaultMode;
  readonly mode?: PolicyMode;
  readonly presets?: readonly DangerousToolPreset[];
  readonly rules?: readonly PolicyRule[];
}

export interface PolicyContext {
  readonly toolName: string;
  readonly bareName: string;
  readonly serverId: string;
  readonly agentId: string;
  readonly environment: string;
}

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly shadow: boolean;
  readonly mode: PolicyMode;
  readonly matchedRule?: PolicyRule;
  readonly matchedPreset?: DangerousToolPreset;
  readonly reason: string;
}
