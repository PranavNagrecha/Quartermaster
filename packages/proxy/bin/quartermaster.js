#!/usr/bin/env node
// Quartermaster product CLI entry. Bundled into the quartermaster-mcp npm package.
//   quartermaster report --audit audit.jsonl
import { main } from '../dist/cli.js';

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
