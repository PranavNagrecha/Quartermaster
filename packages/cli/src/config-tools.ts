import { readFileSync, writeFileSync } from 'node:fs';
import {
  applyOverlays,
  buildToolIndex,
  buildRouterOptions,
  closeIndex,
  loadConfig,
  type FederatedIndex,
  type ProxyConfig,
} from 'quartermaster-mcp';
import type { Tool } from '@quartermaster/core';
import type { CatalogTool } from './quality.js';

/** Load catalog tools from a quartermaster.json — static manifest or federated boot. */
export async function loadCatalogFromConfig(
  configPath: string,
): Promise<{ tools: CatalogTool[]; config: ProxyConfig }> {
  const config = loadConfig(configPath);
  if ((config.tools?.length ?? 0) > 0) {
    const tools = applyOverlays(config.tools ?? [], config.overlays).map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
    }));
    return { tools, config };
  }
  if ((config.servers?.length ?? 0) > 0) {
    const index = await buildToolIndex(config);
    try {
      const tools = federatedCatalog(index, config);
      if (tools.length === 0) {
        throw new Error('quartermaster: federated boot returned no tools — check downstream servers.');
      }
      return { tools, config };
    } finally {
      await closeIndex(index);
    }
  }
  throw new Error('quartermaster: config has no tools or servers.');
}

/** @deprecated Use loadCatalogFromConfig */
export async function loadToolsFromConfig(configPath: string): Promise<{ tools: Tool[]; config: ProxyConfig }> {
  const { tools, config } = await loadCatalogFromConfig(configPath);
  return { tools: tools as Tool[], config };
}

function federatedCatalog(index: FederatedIndex, config: ProxyConfig): CatalogTool[] {
  const merged: CatalogTool[] = [];
  for (const serverTools of index.lastKnownTools.values()) {
    for (const t of serverTools) {
      merged.push({
        name: t.name,
        description: t.description,
        category: t.category,
        inputSchema: index.schemas.get(t.name),
      });
    }
  }
  return applyOverlays(merged as Tool[], config.overlays).map((t) => ({
    name: t.name,
    description: t.description,
    category: t.category,
    inputSchema: index.schemas.get(t.name),
  }));
}

export function loadSynonymsFromConfig(config: ProxyConfig): Record<string, readonly string[]> {
  return (config.synonyms ?? {}) as Record<string, readonly string[]>;
}

export function routerOptionsFromConfig(config: ProxyConfig) {
  return buildRouterOptions(config);
}

export interface EvalCase {
  readonly query: string;
  readonly expectedTool: string;
  readonly source?: string;
  readonly confidence?: string;
  readonly weakReasons?: readonly string[];
}

export function loadCasesJsonl(path: string): EvalCase[] {
  const text = readFileSync(path, 'utf8');
  const cases: EvalCase[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`${path}:${i + 1}: invalid JSON — ${(e as Error).message}`);
    }
    if (typeof obj.query !== 'string' || typeof obj.expectedTool !== 'string') {
      throw new Error(`${path}:${i + 1}: each case needs "query" and "expectedTool" strings.`);
    }
    cases.push({
      query: obj.query,
      expectedTool: obj.expectedTool,
      source: typeof obj.source === 'string' ? obj.source : undefined,
      confidence: typeof obj.confidence === 'string' ? obj.confidence : undefined,
    });
  }
  return cases;
}

export function writeCasesJsonl(path: string, cases: readonly EvalCase[]): void {
  const lines = cases.map((c) => JSON.stringify(c));
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
}
