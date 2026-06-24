/**
 * quartermaster-mcp — a drop-in MCP proxy (SCAFFOLD).
 *
 * Sits in front of N downstream MCP servers. Instead of exposing every tool to
 * the client, it exposes ONE meta-tool — `retrieve_tools(query)` — backed by the
 * offline @quartermaster/core ranker. The client (or host LLM) calls it, gets a
 * ranked shortlist, then the matching tools are surfaced / called through.
 *
 * This is the intended shape, not yet a finished server. The real wiring
 * (spawning downstream servers over stdio, aggregating their `tools/list`,
 * forwarding `tools/call`) is tracked in the issues — see CONTRIBUTING.md.
 */
import { createRouter, type Tool } from '@quartermaster/core';

export interface DownstreamServer {
  /** Display id, used to namespace tool names (e.g. `github`). */
  readonly id: string;
  /** Command to launch the downstream MCP server (stdio transport). */
  readonly command: string;
  readonly args?: readonly string[];
}

export interface ProxyConfig {
  readonly servers: readonly DownstreamServer[];
  /** Optional query-expansion synonyms passed to the ranker. */
  readonly synonyms?: Readonly<Record<string, readonly string[]>>;
  /** Shortlist size returned by retrieve_tools. Default 8. */
  readonly k?: number;
}

/**
 * Aggregate every downstream server's tool manifest into one corpus and build
 * the offline router over it. (Stub: real impl connects to each server and
 * reads `tools/list`.)
 */
export async function buildToolIndex(config: ProxyConfig): Promise<ReturnType<typeof createRouter>> {
  const tools: Tool[] = [];
  for (const server of config.servers) {
    // TODO: connect over MCP stdio, call tools/list, map each into a Tool with
    // a `${server.id}.${name}` namespaced name and `category: server.id`.
    void server;
  }
  return createRouter(tools, { synonyms: config.synonyms });
}

/**
 * The single meta-tool the proxy exposes to the client. Returns a ranked
 * shortlist for the host LLM to choose from — it advises, it does not decide.
 */
export function retrieveTools(
  router: ReturnType<typeof createRouter>,
  query: string,
  k = 8,
) {
  return {
    guidance:
      'These are the most relevant tools for the query, ranked. Read them and ' +
      'choose; call retrieve_tools again with a refined query if none fit.',
    candidates: router.search(query, k),
  };
}

// TODO: export a `startProxy(config)` that wires the above into an
// @modelcontextprotocol/sdk Server over stdio.
