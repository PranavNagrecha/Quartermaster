declare module 'quartermaster-mcp' {
  import type { Router, Tool, RouterConfig } from '@quartermaster/core';
  import type { PolicyConfig } from '@quartermaster/policy';
  import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

  export interface DownstreamServer {
    readonly id: string;
    readonly transport?: 'stdio' | 'http';
    readonly command?: string;
    readonly args?: readonly string[];
    readonly env?: Readonly<Record<string, string>>;
    readonly url?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly callTimeoutMs?: number;
    readonly connectTimeoutMs?: number;
    readonly maxConcurrency?: number;
    readonly circuitBreaker?: { readonly failureThreshold?: number; readonly resetMs?: number };
  }

  export interface ProxyConfig {
    readonly tools?: readonly Tool[];
    readonly servers?: readonly DownstreamServer[];
    readonly synonyms?: Readonly<Record<string, readonly string[]>>;
    readonly overlays?: Readonly<Record<string, { readonly keywords?: string }>>;
    readonly ranker?: Record<string, unknown>;
    readonly policy?: PolicyConfig;
    readonly policyFile?: string;
    readonly pricing?: {
      readonly costPer1kTokensUsd?: number;
      readonly tokenEstimateMethod?: 'chars/4' | 'words*1.3';
    };
  }

  export interface FederatedIndex {
    router: Router;
    readonly clients: Map<string, Client>;
    readonly toolToServer: Map<string, string>;
    readonly toolToBare: Map<string, string>;
    readonly schemas: Map<string, unknown>;
    readonly lastKnownTools: Map<string, Tool[]>;
    catalogTools: Tool[];
    readonly serverById: Map<string, DownstreamServer>;
    circuitBreakers: Map<string, unknown>;
    readonly semaphores: Map<string, unknown>;
  }

  export function loadConfig(path: string): ProxyConfig;
  export function buildRouterOptions(config: ProxyConfig): RouterConfig;
  export function applyOverlays(tools: readonly Tool[], overlays?: ProxyConfig['overlays']): Tool[];
  export function buildToolIndex(config: ProxyConfig): Promise<FederatedIndex>;
  export function closeIndex(index: FederatedIndex): Promise<void>;
  export function interpolateEnv(
    env: Readonly<Record<string, string>>,
    source?: Readonly<Record<string, string | undefined>>,
  ): Record<string, string>;
}
