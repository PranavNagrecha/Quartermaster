/** @param {number[]} ms */
export function summarize(ms) {
  if (ms.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...ms].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round(sum / sorted.length),
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
  };
}

export function formatStats(label, stats) {
  return `${label}: n=${stats.count} mean=${stats.mean}ms p50=${stats.p50}ms p95=${stats.p95}ms p99=${stats.p99}ms max=${stats.max}ms`;
}

/**
 * @param {number} actual
 * @param {number} limit
 * @param {string} label
 */
export function assertMax(actual, limit, label) {
  if (actual > limit) {
    throw new Error(`${label}: p99 ${actual}ms exceeds limit ${limit}ms`);
  }
}
