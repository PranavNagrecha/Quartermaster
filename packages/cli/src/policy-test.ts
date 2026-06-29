import { loadConfig } from 'quartermaster-mcp';
import { evaluatePolicy } from '@quartermaster/policy';

export interface PolicyTestOptions {
  readonly configPath: string;
  readonly tool: string;
  readonly agentId?: string;
  readonly environment?: string;
}

export interface PolicyTestResult {
  readonly allowed: boolean;
  readonly shadow: boolean;
  readonly mode: string;
  readonly matchedRule?: unknown;
  readonly matchedPreset?: string;
  readonly reason: string;
}

export function runPolicyTest(opts: PolicyTestOptions): PolicyTestResult {
  const config = loadConfig(opts.configPath);
  const parts = opts.tool.split('.');
  const serverId = parts.length > 1 ? parts[0]! : '';
  const bareName = parts.length > 1 ? parts.slice(1).join('.') : opts.tool;
  const decision = evaluatePolicy(config.policy, {
    toolName: opts.tool,
    bareName,
    serverId,
    agentId: opts.agentId ?? process.env.QM_AGENT_ID ?? 'unknown',
    environment: opts.environment ?? process.env.QM_ENV ?? 'default',
  });
  return {
    allowed: decision.allowed,
    shadow: decision.shadow,
    mode: decision.mode,
    matchedRule: decision.matchedRule,
    matchedPreset: decision.matchedPreset,
    reason: decision.reason,
  };
}

export async function runPolicyTestCommand(argv: readonly string[]): Promise<void> {
  let configPath: string | undefined;
  let tool: string | undefined;
  let agentId: string | undefined;
  let environment: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--config' && argv[i + 1] !== undefined) configPath = argv[++i];
    else if (a?.startsWith('--config=')) configPath = a.slice('--config='.length);
    else if (a === '--tool' && argv[i + 1] !== undefined) tool = argv[++i];
    else if (a?.startsWith('--tool=')) tool = a.slice('--tool='.length);
    else if (a === '--agent-id' && argv[i + 1] !== undefined) agentId = argv[++i];
    else if (a?.startsWith('--agent-id=')) agentId = a.slice('--agent-id='.length);
    else if (a === '--env' && argv[i + 1] !== undefined) environment = argv[++i];
    else if (a?.startsWith('--env=')) environment = a.slice('--env='.length);
    else if (a === '--query') {
      // accepted for CLI symmetry; policy test does not use query yet
      if (argv[i + 1] !== undefined) i++;
    }
    else if (a === '--help') {
      console.log(`usage: quartermaster policy test --config quartermaster.json --tool server.tool [--agent-id id] [--env staging]`);
      return;
    }
  }

  if (configPath === undefined || tool === undefined) {
    throw new Error('usage: quartermaster policy test --config <quartermaster.json> --tool <server.tool>');
  }

  const result = runPolicyTest({ configPath, tool, agentId, environment });
  console.log(JSON.stringify(result, null, 2));
  if (!result.allowed && !result.shadow) {
    process.exitCode = 1;
  }
}
