export interface WDL { wins: number; draws: number; losses: number }
export type Pentanomial = [number, number, number, number, number];
export interface SprtOptions { elo0: number; elo1: number; alpha?: number; beta?: number }

function countsValid(counts: readonly number[]): void {
  if (counts.length !== 3 && counts.length !== 5) throw new Error('Expected three or five outcome categories');
  if (counts.some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('Counts must be nonnegative integers');
}
export function elo(score: number): number {
  if (!Number.isFinite(score) || score < 0 || score > 1) throw new Error('Score must be in [0,1]');
  return 400 * Math.log10(score / (1 - score));
}
export function scoreFromElo(value: number): number { return 1 / (1 + 10 ** (-value / 400)); }

// Multinomial maximum likelihood subject to sum(p_i*x_i) = target.
// A vanishing pseudocount permits the optimum to place mass on unobserved categories.
function constrained(counts: readonly number[], target: number): number[] {
  const n = counts.reduce((a, b) => a + b, 0);
  const f = counts.map(c => (c + 1e-9) / (n + counts.length * 1e-9));
  const x = counts.map((_, i) => i / (counts.length - 1));
  let low = -1 / (1 - target) + 1e-12, high = 1 / target - 1e-12;
  for (let step = 0; step < 100; step++) {
    const lambda = (low + high) / 2;
    const residual = f.reduce((s, v, i) => s + v * (x[i] - target) / (1 + lambda * (x[i] - target)), 0);
    if (residual > 0) low = lambda; else high = lambda;
  }
  const lambda = (low + high) / 2;
  const p = f.map((v, i) => v / Math.max(1e-15, 1 + lambda * (x[i] - target)));
  const sum = p.reduce((a, b) => a + b, 0);
  return p.map(v => v / sum);
}
function logLikelihood(counts: readonly number[], probabilities: readonly number[]): number {
  return counts.reduce((sum, n, i) => sum + (n ? n * Math.log(probabilities[i]) : 0), 0);
}
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}

export function distributionStats(counts: readonly number[]) {
  countsValid(counts);
  const n = counts.reduce((a, b) => a + b, 0);
  if (!n) return { samples: 0, score: 0.5, variance: 0, stderr: 0, elo: 0, elo95: [-Infinity, Infinity] as [number, number], los: 0.5 };
  const score = counts.reduce((s, c, i) => s + c * i / (counts.length - 1), 0) / n;
  const variance = counts.reduce((s, c, i) => s + c * (i / (counts.length - 1) - score) ** 2, 0) / n;
  const stderr = Math.sqrt(variance / n);
  const maximum = logLikelihood(counts, counts.map(c => c / n));
  const cutoff = maximum - 3.841458820694124 / 2;
  function bound(left: boolean): number {
    let low = left ? 1e-12 : score, high = left ? score : 1 - 1e-12;
    if (score === 0 && left) return 0;
    if (score === 1 && !left) return 1;
    for (let step = 0; step < 65; step++) {
      const mid = (low + high) / 2;
      const inside = logLikelihood(counts, constrained(counts, mid)) >= cutoff;
      if (inside === left) high = mid; else low = mid;
    }
    return (low + high) / 2;
  }
  const los = stderr ? normalCDF((score - 0.5) / stderr) : score > 0.5 ? 1 : score < 0.5 ? 0 : 0.5;
  return { samples: n, score, variance, stderr, elo: elo(score), elo95: [elo(bound(true)), elo(bound(false))] as [number, number], los };
}

export function trinomial(wdl: WDL) { return distributionStats([wdl.losses, wdl.draws, wdl.wins]); }
export function pentanomial(counts: Pentanomial) { return distributionStats(counts); }
export function addPair(counts: Pentanomial, first: number, second: number): void {
  if (![0, 0.5, 1].includes(first) || ![0, 0.5, 1].includes(second)) throw new Error('Game scores must be 0, 0.5 or 1');
  counts[Math.round(2 * (first + second))]++;
}

export function sprt(counts: readonly number[], options: SprtOptions) {
  countsValid(counts);
  const { elo0, elo1, alpha = 0.05, beta = 0.05 } = options;
  if (!Number.isFinite(elo0) || !Number.isFinite(elo1) || elo0 >= elo1 || !(alpha > 0 && alpha < 1 && beta > 0 && beta < 1) || alpha + beta >= 1) throw new Error('Invalid SPRT hypotheses/error rates');
  if (!(scoreFromElo(elo0) > 0 && scoreFromElo(elo1) < 1)) throw new Error('SPRT hypotheses exceed floating-point probability range');
  const lower = Math.log(beta / (1 - alpha)), upper = Math.log((1 - beta) / alpha);
  const llr = logLikelihood(counts, constrained(counts, scoreFromElo(elo1))) - logLikelihood(counts, constrained(counts, scoreFromElo(elo0)));
  const verdict: 'H0' | 'H1' | 'continue' = llr <= lower ? 'H0' : llr >= upper ? 'H1' : 'continue';
  return { llr, lower, upper, verdict };
}
