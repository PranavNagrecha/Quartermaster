export const SCHEMA_VERSION = 2 as const;

export type CallErrorCategory =
  | 'policy_denied'
  | 'validation_error'
  | 'timeout'
  | 'downstream_error'
  | 'unknown_tool'
  | 'circuit_open';

export type ServerHealth = 'ok' | 'degraded' | 'circuit_open';

export interface AuditEventBase {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly ts: number;
  readonly sessionId: string;
}

export interface RetrieveEvent extends AuditEventBase {
  readonly event: 'retrieve';
  readonly traceId: string;
  readonly agentId: string;
  readonly query: string;
  readonly k: number;
  readonly confidence: 'none' | 'low' | 'high';
  readonly candidateTools: readonly string[];
  readonly candidateScores: readonly number[];
  readonly totalTools: number;
  readonly totalSchemaTokens: number;
  readonly shortlistSchemaTokens: number;
  readonly estimatedTokenSavings: number;
  readonly tokenEstimateMethod: string;
  readonly estimatedCostSavingsUsd: number;
  readonly latencyMs: number;
  readonly status?: 'ok';
}

export interface CallEvent extends AuditEventBase {
  readonly event: 'call';
  readonly traceId: string;
  readonly tool: string;
  readonly serverId?: string;
  readonly wasShortlisted: boolean;
  readonly rank: number;
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly error?: string;
  readonly errorCategory?: CallErrorCategory;
}

export interface CallMissEvent extends AuditEventBase {
  readonly event: 'call_miss';
  readonly traceId: string;
  readonly query: string;
  readonly tool: string;
  readonly shortlisted: readonly string[];
}

export interface PolicyDecisionEvent extends AuditEventBase {
  readonly event: 'policy_decision';
  readonly traceId: string;
  readonly tool: string;
  readonly serverId?: string;
  readonly allowed: boolean;
  readonly shadow: boolean;
  readonly mode: string;
  readonly reason: string;
  readonly matchedPreset?: string;
}

export interface ValidationErrorEvent extends AuditEventBase {
  readonly event: 'validation_error';
  readonly traceId: string;
  readonly tool: string;
  readonly serverId?: string;
  readonly errors: readonly string[];
}

export interface ServerSnapshotEvent extends AuditEventBase {
  readonly event: 'server_snapshot';
  readonly servers: readonly {
    readonly id: string;
    readonly toolCount: number;
    readonly ok: boolean;
    readonly health?: ServerHealth;
    readonly circuitOpen?: boolean;
  }[];
  readonly totalTools: number;
  readonly degraded: boolean;
}

export interface ServerErrorEvent extends AuditEventBase {
  readonly event: 'server_error';
  readonly serverId: string;
  readonly reason: string;
  readonly phase: 'boot' | 'refresh' | 'call';
}

export interface ToolCatalogSnapshotEvent extends AuditEventBase {
  readonly event: 'tool_catalog_snapshot';
  readonly totalTools: number;
  readonly totalSchemaTokens: number;
  readonly tokenEstimateMethod?: string;
  readonly serverBreakdown: readonly {
    readonly id: string;
    readonly toolCount: number;
    readonly schemaTokens: number;
  }[];
}

export interface EvalRunEvent extends AuditEventBase {
  readonly event: 'eval_run';
  readonly evalId: string;
  readonly [key: string]: unknown;
}

export type AuditEvent =
  | RetrieveEvent
  | CallEvent
  | CallMissEvent
  | PolicyDecisionEvent
  | ValidationErrorEvent
  | ServerSnapshotEvent
  | ServerErrorEvent
  | ToolCatalogSnapshotEvent
  | EvalRunEvent;

export type AuditEventInput = Omit<AuditEvent, 'schemaVersion' | 'ts' | 'sessionId'>;
