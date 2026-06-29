/**
 * Compare two regression rounds — report stability and drift.
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 */
export function compareRounds(a, b) {
  const lines = [];
  const issues = [];
  let ok = true;

  if (a.passed !== b.passed) {
    issues.push(`pass/fail mismatch: round1=${a.passed} round2=${b.passed}`);
    ok = false;
  }

  for (const key of ['smoke', 'stress']) {
    const ma = /** @type {Record<string, unknown>} */ (a[key] ?? {});
    const mb = /** @type {Record<string, unknown>} */ (b[key] ?? {});
    if (ma.passed !== mb.passed) {
      issues.push(`${key}: pass mismatch (${ma.passed} vs ${mb.passed})`);
      ok = false;
    }
    const drift = driftPct(ma.durationMs, mb.durationMs);
    lines.push(`  ${key} duration: ${ma.durationMs}ms → ${mb.durationMs}ms (${drift})`);
    if (ma.p99Ms != null && mb.p99Ms != null) {
      lines.push(`  ${key} p99: ${ma.p99Ms}ms → ${mb.p99Ms}ms (${driftPct(ma.p99Ms, mb.p99Ms)})`);
    }
  }

  for (const key of ['devEval', 'blindEval']) {
    const ra = /** @type {Record<string, number>} */ (a[key] ?? {});
    const rb = /** @type {Record<string, number>} */ (b[key] ?? {});
    const r8a = ra.recallAt8;
    const r8b = rb.recallAt8;
    if (r8a != null && r8b != null) {
      const delta = Math.abs(r8a - r8b);
      lines.push(`  ${key} R@8: ${pct(r8a)} → ${pct(r8b)} (Δ ${(delta * 100).toFixed(1)}pp)`);
      if (delta > 0.001) {
        issues.push(`${key}: R@8 not stable between rounds (${pct(r8a)} vs ${pct(r8b)})`);
        ok = false;
      }
    }
  }

  return { ok, lines, issues };
}

function driftPct(a, b) {
  if (a == null || b == null) return 'n/a';
  if (a === 0) return b === 0 ? '0%' : '+∞';
  const d = ((b - a) / a) * 100;
  const sign = d >= 0 ? '+' : '';
  return `${sign}${d.toFixed(1)}%`;
}

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}
