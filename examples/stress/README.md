# Stress tests

Push Quartermaster beyond smoke — ranker scale, federation load, concurrency, chaos.

## What it runs

| Scenario | What it stresses |
|----------|------------------|
| `ranker/heritage-171` | BM25 over 171-tool production heritage corpus |
| `ranker/synthetic-500` | 500-tool synthetic federation |
| `ranker/synthetic-1000` | 1000-tool synthetic federation |
| `mcp/static-N` | `retrieve_tools` over stdio with N static tools |
| `mcp/real-federation` | Concurrent retrieve + call against filesystem, memory, everything, git |
| `mcp/chaos` | echo + flaky downstream, circuit breaker, maxConcurrency |
| `ranker/memory-stability` | 1000 routes — heap growth check |

## Commands

```bash
pnpm -r build
pnpm stress           # full run (~1–2 min)
pnpm stress:quick     # dev subset (~20s)
pnpm stress:ci        # CI-sized gates
```

## Pass criteria (full mode)

- Ranker error rate &lt; 1%
- Ranker p99: &lt;30ms @171 tools, &lt;80ms @500, &lt;150ms @1000
- MCP retrieve error rate &lt; 2%
- Real federation p99 retrieve &lt; 5s (includes npx downstream spawn overhead)
- Chaos: zero session crashes; some calls succeed through flaky server
- Memory: heap delta &lt; 80MB after 1000 in-process routes

Run with `node --expose-gc examples/stress/run-stress.mjs` for stricter memory check.
