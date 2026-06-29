import { readAuditJsonl, type AuditLine, type LegacyAuditLine } from '@quartermaster/telemetry';
import { loadCatalogFromConfig } from './config-tools.js';
import {
  findDuplicateBareNames,
  findOverlappingTools,
  scoreToolQuality,
  type CatalogTool,
} from './quality.js';

export interface InspectOptions {
  readonly configPath: string;
  readonly auditPath?: string;
}

export interface ToolTraffic {
  readonly retrieved: number;
  readonly called: number;
  readonly rankSum: number;
  readonly rankCount: number;
  readonly lowConfidenceCount: number;
}

export interface ToolInspectLine {
  readonly name: string;
  readonly quality: ReturnType<typeof scoreToolQuality>;
  readonly traffic?: ToolTraffic;
  readonly flags: readonly string[];
}

function buildTrafficMap(events: ReturnType<typeof readAuditJsonl>): Map<string, ToolTraffic> {
  const map = new Map<string, ToolTraffic>();

  const bump = (tool: string, patch: Partial<ToolTraffic>): void => {
    const cur = map.get(tool) ?? { retrieved: 0, called: 0, rankSum: 0, rankCount: 0, lowConfidenceCount: 0 };
    map.set(tool, {
      retrieved: cur.retrieved + (patch.retrieved ?? 0),
      called: cur.called + (patch.called ?? 0),
      rankSum: cur.rankSum + (patch.rankSum ?? 0),
      rankCount: cur.rankCount + (patch.rankCount ?? 0),
      lowConfidenceCount: cur.lowConfidenceCount + (patch.lowConfidenceCount ?? 0),
    });
  };

  for (const ev of events) {
    if (ev.event === 'retrieve') {
      const row = ev as LegacyAuditLine;
      const low = row.confidence === 'low' || row.confidence === 'none';
      const candidates = Array.isArray(row.candidateTools)
        ? row.candidateTools.filter((t): t is string => typeof t === 'string')
        : Array.isArray(row.candidates)
          ? row.candidates
              .map((c) =>
                typeof c === 'object' && c !== null && typeof (c as { tool?: string }).tool === 'string'
                  ? (c as { tool: string }).tool
                  : undefined,
              )
              .filter((t): t is string => t !== undefined)
          : [];
      candidates.forEach((tool, idx) => {
        bump(tool, {
          retrieved: 1,
          rankSum: idx + 1,
          rankCount: 1,
          lowConfidenceCount: low ? 1 : 0,
        });
      });
    } else if (ev.event === 'call') {
      const row = ev as LegacyAuditLine;
      if (row.ok === true && typeof row.tool === 'string') bump(row.tool, { called: 1 });
    }
  }
  return map;
}

export async function inspectCatalog(opts: InspectOptions): Promise<ToolInspectLine[]> {
  const { tools } = await loadCatalogFromConfig(opts.configPath);
  const dupes = findDuplicateBareNames(tools);
  const traffic = opts.auditPath !== undefined ? buildTrafficMap(readAuditJsonl(opts.auditPath)) : undefined;

  return tools
    .map((tool: CatalogTool) => {
      const bare = tool.name.includes('.') ? tool.name.slice(tool.name.indexOf('.') + 1) : tool.name;
      const quality = scoreToolQuality(tool, { duplicateName: dupes.has(bare) });
      const t = traffic?.get(tool.name);
      const flags: string[] = [];

      if (t !== undefined) {
        if (t.retrieved >= 3 && t.called === 0) flags.push('retrieved often but never called');
        if (t.lowConfidenceCount >= 2) flags.push('many low-confidence appearances');
      }

      return { name: tool.name, quality, traffic: t, flags };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function formatInspectOutput(
  lines: readonly ToolInspectLine[],
  overlaps: readonly { toolA: string; toolB: string; reason: string }[],
): string {
  const out: string[] = [];

  for (const line of lines) {
    out.push(line.name);
    out.push(`  quality: ${line.quality.score}/100`);
    out.push(`  description: ${line.quality.descriptionRating}`);
    out.push(`  schema tokens: ${line.quality.schemaTokens}`);
    if (line.traffic !== undefined) {
      const avgRank = line.traffic.rankCount > 0 ? line.traffic.rankSum / line.traffic.rankCount : 0;
      out.push(`  retrieved: ${line.traffic.retrieved}`);
      out.push(`  called: ${line.traffic.called}`);
      out.push(`  rank avg: ${avgRank.toFixed(1)}`);
    }
    for (const f of line.flags) out.push(`  flag: ${f}`);
    out.push('');
  }

  if (overlaps.length > 0) {
    out.push('Overlapping tools:');
    for (const o of overlaps) {
      out.push(`  ${o.toolA} ↔ ${o.toolB} (${o.reason})`);
    }
    out.push('');
  }

  return out.join('\n').trimEnd();
}

export async function runInspect(opts: InspectOptions): Promise<void> {
  const { tools } = await loadCatalogFromConfig(opts.configPath);
  const lines = await inspectCatalog(opts);
  const overlaps = findOverlappingTools(tools);
  console.log(formatInspectOutput(lines, overlaps));
}
