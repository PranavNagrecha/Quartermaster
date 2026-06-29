#!/usr/bin/env node
import { main } from '../dist/index.js';

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
