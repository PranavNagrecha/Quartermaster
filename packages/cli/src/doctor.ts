import { buildToolIndex, interpolateEnv, loadConfig, type ProxyConfig } from 'quartermaster-mcp';
import { evaluatePolicy } from '@quartermaster/policy';

export type DoctorSeverity = 'error' | 'warn' | 'ok';

export interface DoctorCheck {
  readonly id: string;
  readonly severity: DoctorSeverity;
  readonly message: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[];
  readonly ok: boolean;
}

function push(checks: DoctorCheck[], id: string, severity: DoctorSeverity, message: string): void {
  checks.push({ id, severity, message });
}

export async function runDoctor(configPath: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  let config;
  try {
    config = loadConfig(configPath);
    push(checks, 'config', 'ok', 'Config parsed successfully');
  } catch (e) {
    push(checks, 'config', 'error', (e as Error).message);
    return { checks, ok: false };
  }

  for (const server of config.servers ?? []) {
    if (server.env !== undefined) {
      try {
        interpolateEnv(server.env);
        push(checks, `env:${server.id}`, 'ok', `Env interpolation ok for server "${server.id}"`);
      } catch (e) {
        push(checks, `env:${server.id}`, 'error', (e as Error).message);
      }
    }
  }

  if (config.policy !== undefined) {
    push(checks, 'policy', 'ok', 'Policy config loaded');
    for (const rule of config.policy.rules ?? []) {
      if (rule.serverId !== undefined) {
        const known = (config.servers ?? []).some((s) => s.id === rule.serverId);
        if (!known) {
          push(checks, 'policy-server', 'warn', `Policy references unknown server "${rule.serverId}"`);
        }
      }
    }
  }

  const bareNames = new Map<string, string[]>();
  for (const server of config.servers ?? []) {
    try {
      const idx = await buildToolIndex({
        servers: [server],
        overlays: config.overlays,
        ranker: config.ranker as ProxyConfig['ranker'],
      });
      try {
        const toolCount = idx.toolToServer.size;
        push(checks, `downstream:${server.id}`, 'ok', `Server "${server.id}" connected (${toolCount} tools)`);
        for (const [tool] of idx.toolToServer) {
          const bare = idx.toolToBare.get(tool) ?? tool;
          const list = bareNames.get(bare) ?? [];
          list.push(server.id);
          bareNames.set(bare, list);
          const meta = idx.catalogTools.find((t) => t.name === tool);
          if (meta?.description === undefined || meta.description.trim() === '') {
            push(checks, `description:${tool}`, 'warn', `Tool "${tool}" has empty description`);
          }
          if (!idx.schemas.has(tool)) {
            push(checks, `schema:${tool}`, 'warn', `Tool "${tool}" missing inputSchema`);
          }
        }
      } finally {
        for (const client of idx.clients.values()) await client.close().catch(() => {});
      }
    } catch (e) {
      push(checks, `downstream:${server.id}`, 'error', `Server "${server.id}" failed: ${(e as Error).message}`);
    }
  }

  for (const [bare, servers] of bareNames) {
    if (servers.length > 1) {
      push(checks, `duplicate:${bare}`, 'warn', `Bare tool name "${bare}" appears on servers: ${servers.join(', ')}`);
    }
  }

  // Policy smoke test on first tool if available
  const firstServer = config.servers?.[0];
  if (firstServer !== undefined && config.policy !== undefined) {
    evaluatePolicy(config.policy, {
      toolName: `${firstServer.id}.example`,
      bareName: 'example',
      serverId: firstServer.id,
      agentId: 'doctor',
      environment: process.env.QM_ENV ?? 'default',
    });
    push(checks, 'policy-eval', 'ok', 'Policy engine evaluates without error');
  }

  const ok = !checks.some((c) => c.severity === 'error');
  return { checks, ok };
}

export async function runDoctorCommand(argv: readonly string[]): Promise<void> {
  let configPath: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' && argv[i + 1] !== undefined) configPath = argv[++i];
    else if (a?.startsWith('--config=')) configPath = a.slice('--config='.length);
    else if (a === '--json') json = true;
    else if (a === '--help') {
      console.log('usage: quartermaster doctor --config quartermaster.json [--json]');
      return;
    }
  }
  if (configPath === undefined) {
    throw new Error('usage: quartermaster doctor --config <quartermaster.json> [--json]');
  }
  const report = await runDoctor(configPath);
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const c of report.checks) {
      const tag = c.severity === 'ok' ? 'OK' : c.severity === 'warn' ? 'WARN' : 'ERROR';
      console.log(`[${tag}] ${c.id}: ${c.message}`);
    }
  }
  if (!report.ok) process.exitCode = 1;
}
