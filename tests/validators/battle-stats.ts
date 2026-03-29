/**
 * Statistical validators for Monte Carlo simulation results.
 * Uses chi-squared and basic distribution tests to ensure
 * the simulation produces statistically valid outcomes.
 */

export interface DistributionStats {
  mean: number;
  variance: number;
  stdDev: number;
  min: number;
  max: number;
  median: number;
}

export function computeStats(values: number[]): DistributionStats {
  if (values.length === 0) {
    return { mean: 0, variance: 0, stdDev: 0, min: 0, max: 0, median: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

  return {
    mean,
    variance,
    stdDev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[n - 1],
    median: n % 2 === 0
      ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      : sorted[Math.floor(n / 2)],
  };
}

/**
 * Chi-squared test for uniformity of a random distribution.
 * Returns the p-value. Low p-value (<0.05) means distribution
 * is NOT uniform (which may be expected for battle outcomes).
 */
export function chiSquaredUniformity(observed: number[], expected: number): number {
  let chiSq = 0;
  for (const o of observed) {
    chiSq += (o - expected) ** 2 / expected;
  }

  // Approximate p-value using Wilson-Hilferty transformation
  const df = observed.length - 1;
  const z = Math.pow(chiSq / df, 1 / 3) - (1 - 2 / (9 * df));
  const denom = Math.sqrt(2 / (9 * df));
  const pValue = 1 - normalCDF(z / denom);

  return pValue;
}

/**
 * Standard normal CDF approximation.
 */
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Validate that battle results make intuitive sense.
 * Returns a list of issues found.
 */
export function validateBattleResults(results: {
  armyAWins: number;
  armyBWins: number;
  draws: number;
  totalSims: number;
  avgSurvivingA: number;
  avgSurvivingB: number;
  rawResults: { armyASurviving: number; armyBSurviving: number }[];
}): string[] {
  const issues: string[] = [];

  // Basic sanity
  if (results.armyAWins + results.armyBWins + results.draws !== results.totalSims) {
    issues.push(
      `Win/loss/draw sum (${results.armyAWins + results.armyBWins + results.draws}) ` +
      `!= totalSims (${results.totalSims})`
    );
  }

  // Must have SOME variation — all identical results means RNG is broken
  const deltas = results.rawResults.map(r => r.armyASurviving - r.armyBSurviving);
  const stats = computeStats(deltas);

  if (stats.variance === 0 && results.totalSims > 1) {
    issues.push('Zero variance in outcomes — RNG may be broken or simulation is deterministic');
  }

  // Standard deviation should be reasonable (not zero, not absurdly large)
  if (stats.stdDev === 0 && results.totalSims > 10) {
    issues.push('Standard deviation is zero — all simulations produced identical results');
  }

  // Surviving counts should be non-negative
  for (let i = 0; i < results.rawResults.length; i++) {
    const r = results.rawResults[i];
    if (r.armyASurviving < 0 || r.armyBSurviving < 0) {
      issues.push(`Simulation ${i}: negative survivor count`);
      break; // One example is enough
    }
  }

  // At least one side should have survivors in most simulations
  const totalAnnihilation = results.rawResults.filter(
    r => r.armyASurviving === 0 && r.armyBSurviving === 0
  ).length;
  if (totalAnnihilation > results.totalSims * 0.9) {
    issues.push(
      `${totalAnnihilation}/${results.totalSims} simulations ended in total annihilation — ` +
      'damage calculations may be too high'
    );
  }

  return issues;
}
