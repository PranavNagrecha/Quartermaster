/** Parse bm25 R@8 from quartermaster eval table output. */
export function parseEvalRecallAt8(stdout) {
  const line = stdout.split('\n').find((l) => l.trimStart().startsWith('bm25'));
  if (!line) return null;
  const parts = line.trim().split(/\s+/);
  // Variant  R@1  R@3  R@5  R@8  MRR
  const r8 = parts[4];
  if (!r8) return null;
  return Number.parseInt(r8.replace('%', ''), 10) / 100;
}
