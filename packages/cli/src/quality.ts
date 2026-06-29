import { estimateToolSchemaTokens } from '@quartermaster/telemetry';

export interface ToolQualityInput {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface ToolQualityResult {
  readonly score: number;
  readonly descriptionRating: 'missing' | 'short' | 'generic' | 'good';
  readonly schemaTokens: number;
  readonly deductions: readonly string[];
}

const GENERIC_DESCRIPTION =
  /\b(run command|execute|perform|tool for)\b/i;

export function scoreToolQuality(tool: ToolQualityInput, opts: { duplicateName?: boolean } = {}): ToolQualityResult {
  let score = 100;
  const deductions: string[] = [];
  let descriptionRating: ToolQualityResult['descriptionRating'] = 'good';

  const desc = tool.description?.trim() ?? '';
  if (desc === '') {
    score -= 30;
    deductions.push('missing description (-30)');
    descriptionRating = 'missing';
  } else if (desc.length < 20) {
    score -= 20;
    deductions.push('short description (-20)');
    descriptionRating = 'short';
  } else if (GENERIC_DESCRIPTION.test(desc)) {
    score -= 15;
    deductions.push('generic description (-15)');
    descriptionRating = 'generic';
  }

  const schemaTokens = estimateToolSchemaTokens(tool);
  if (schemaTokens > 2000) {
    score -= 15;
    deductions.push('large schema (-15)');
  }

  if (opts.duplicateName) {
    score -= 20;
    deductions.push('duplicate name (-20)');
  }

  return {
    score: Math.max(0, score),
    descriptionRating,
    schemaTokens,
    deductions,
  };
}

export interface CatalogTool extends ToolQualityInput {
  readonly category?: string;
}

/** Detect duplicate bare tool names after stripping server prefix. */
export function findDuplicateBareNames(tools: readonly CatalogTool[]): Set<string> {
  const seen = new Map<string, string>();
  const dupes = new Set<string>();
  for (const t of tools) {
    const dot = t.name.indexOf('.');
    const bare = dot > 0 ? t.name.slice(dot + 1) : t.name;
    const prev = seen.get(bare);
    if (prev !== undefined && prev !== t.name) {
      dupes.add(bare);
    } else {
      seen.set(bare, t.name);
    }
  }
  return dupes;
}

export interface OverlapPair {
  readonly toolA: string;
  readonly toolB: string;
  readonly reason: string;
}

/** Find overlapping tools from multiple servers (similar names or descriptions). */
export function findOverlappingTools(tools: readonly CatalogTool[]): OverlapPair[] {
  const pairs: OverlapPair[] = [];
  for (let i = 0; i < tools.length; i++) {
    for (let j = i + 1; j < tools.length; j++) {
      const a = tools[i]!;
      const b = tools[j]!;
      const serverA = serverFromTool(a.name);
      const serverB = serverFromTool(b.name);
      if (serverA === undefined || serverB === undefined || serverA === serverB) continue;

      const bareA = bareName(a.name);
      const bareB = bareName(b.name);
      if (bareA === bareB) {
        pairs.push({ toolA: a.name, toolB: b.name, reason: 'same bare name' });
        continue;
      }

      const descA = (a.description ?? '').toLowerCase().trim();
      const descB = (b.description ?? '').toLowerCase().trim();
      if (descA.length >= 10 && descA === descB) {
        pairs.push({ toolA: a.name, toolB: b.name, reason: 'identical description' });
        continue;
      }

      if (similarNames(bareA, bareB)) {
        pairs.push({ toolA: a.name, toolB: b.name, reason: 'similar name' });
      }
    }
  }
  return pairs;
}

function serverFromTool(name: string): string | undefined {
  const dot = name.indexOf('.');
  return dot > 0 ? name.slice(0, dot) : undefined;
}

function bareName(name: string): string {
  const dot = name.indexOf('.');
  return dot > 0 ? name.slice(dot + 1) : name;
}

function similarNames(a: string, b: string): boolean {
  if (a === b) return true;
  const na = a.replace(/_/g, '').toLowerCase();
  const nb = b.replace(/_/g, '').toLowerCase();
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return Math.min(na.length, nb.length) >= 4;
  return false;
}
