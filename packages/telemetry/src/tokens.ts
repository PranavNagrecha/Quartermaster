export const TOKEN_ESTIMATE_METHOD = 'chars/4' as const;
export type TokenEstimateMethod = 'chars/4' | 'words*1.3';

export interface ToolSchemaInput {
  readonly name: string;
  readonly description?: string;
  readonly keywords?: string;
  readonly inputSchema?: unknown;
}

export interface PricingConfig {
  readonly costPer1kTokensUsd?: number;
  readonly tokenEstimateMethod?: TokenEstimateMethod;
}

/** Rough token count from character length (chars / 4, rounded up). */
export function estimateTokens(text: string, method: TokenEstimateMethod = 'chars/4'): number {
  if (text.length === 0) return 0;
  if (method === 'words*1.3') {
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    return Math.ceil(words * 1.3);
  }
  return Math.ceil(text.length / 4);
}

/** Estimate schema tokens for one tool (name, description, keywords, inputSchema JSON). */
export function estimateToolSchemaTokens(
  tool: ToolSchemaInput,
  method: TokenEstimateMethod = 'chars/4',
): number {
  const parts = [tool.name];
  if (tool.description !== undefined && tool.description !== '') parts.push(tool.description);
  if (tool.keywords !== undefined && tool.keywords !== '') parts.push(tool.keywords);
  if (tool.inputSchema !== undefined) {
    try {
      parts.push(JSON.stringify(tool.inputSchema));
    } catch {
      parts.push(String(tool.inputSchema));
    }
  }
  return estimateTokens(parts.join(' '), method);
}

export interface CatalogTokenEstimate {
  readonly totalTools: number;
  readonly totalSchemaTokens: number;
  readonly perTool: ReadonlyMap<string, number>;
}

/** Sum schema token estimates across a tool catalog. */
export function estimateCatalogTokens(
  tools: readonly ToolSchemaInput[],
  schemas?: ReadonlyMap<string, unknown>,
  method: TokenEstimateMethod = 'chars/4',
): CatalogTokenEstimate {
  const perTool = new Map<string, number>();
  let totalSchemaTokens = 0;
  for (const tool of tools) {
    const schema = schemas?.get(tool.name);
    const tokens = estimateToolSchemaTokens(
      schema !== undefined ? { ...tool, inputSchema: schema } : tool,
      method,
    );
    perTool.set(tool.name, tokens);
    totalSchemaTokens += tokens;
  }
  return { totalTools: tools.length, totalSchemaTokens, perTool };
}

/** Default reference cost per 1k tokens (USD). Override via QM_TOKEN_COST_PER_1K or pricing config. */
export function tokenCostPer1k(pricing?: PricingConfig): number {
  if (pricing?.costPer1kTokensUsd !== undefined) return pricing.costPer1kTokensUsd;
  const raw = process.env.QM_TOKEN_COST_PER_1K;
  if (raw === undefined || raw === '') return 0.003;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0.003;
}

export function estimateCostSavingsUsd(tokenSavings: number, pricing?: PricingConfig): number {
  return Math.round((tokenSavings / 1000) * tokenCostPer1k(pricing) * 1_000_000) / 1_000_000;
}

export function resolveTokenEstimateMethod(pricing?: PricingConfig): TokenEstimateMethod {
  return pricing?.tokenEstimateMethod ?? TOKEN_ESTIMATE_METHOD;
}
