import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const requireFromProxy = createRequire(join(REPO, 'packages', 'proxy', 'package.json'));

const { Client } = await import(
  pathToFileURL(requireFromProxy.resolve('@modelcontextprotocol/sdk/client/index.js')).href
);
const { StdioClientTransport } = await import(
  pathToFileURL(requireFromProxy.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href
);

/**
 * @param {{ command: string; args: string[]; env?: Record<string, string> }} launch
 */
export async function connectMcp(launch) {
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: launch.env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'qm-stress', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return {
    client,
    async close() {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    },
  };
}

export const textOf = (res) => res.content?.[0]?.text ?? '';

/**
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} client
 */
export async function retrieveTools(client, query, k = 8) {
  const res = await client.callTool({ name: 'retrieve_tools', arguments: { query, k } });
  return JSON.parse(textOf(res));
}

/**
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} client
 */
export async function callNamespaced(client, name, args = {}) {
  return client.callTool({ name: 'call_tool', arguments: { name, arguments: args } });
}
