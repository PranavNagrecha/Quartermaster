# bench/

The recall@K harness — Quartermaster's credibility lives here. Run it, publish
what it says (wins and losses).

```bash
pnpm bench
```

- `cases/` — labeled `{ query, expectedTool, manifest }` fixtures at several scales.
- `run.mjs` — loads each manifest, runs each ranker, computes recall@K / MRR / token reduction, writes `results/`.

See [../docs/benchmarks.md](../docs/benchmarks.md) for the methodology and the
zero-dependency-hybrid thesis under test.
