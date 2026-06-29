#!/usr/bin/env node
// quartermaster-mcp CLI entry. Loads a config and serves the proxy over MCP stdio.
//   quartermaster-mcp --config ./quartermaster.json
import { runCli } from '../dist/index.js';

runCli(process.argv.slice(2));
