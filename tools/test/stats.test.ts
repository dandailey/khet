import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elo, scoreFromElo, trinomial, pentanomial, addPair, sprt } from '../lib/stats.ts';

function near(actual: number, expected: number, tolerance = 1e-7) { assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`); }

test('trinomial score, variance, Elo and profile likelihood interval', () => {
  const s = trinomial({ wins: 60, draws: 20, losses: 20 });
  near(s.score, 0.7); near(s.variance, 0.16); near(s.stderr, 0.04);
  near(s.elo, 147.19071411783773);
  near(s.elo95[0], 83.37817518, 1e-4); near(s.elo95[1], 213.55448752, 1e-4);
  assert.ok(s.los > 0.999);
  near(elo(0.6), 70.43650362227247);
  near(scoreFromElo(elo(0.7)), 0.7);
});

test('pentanomial uses pair means and preserves within-pair correlation', () => {
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const pair of [[0, 0], [0, 0.5], [1, 0], [1, 0.5], [1, 1]]) addPair(counts, pair[0], pair[1]);
  assert.deepEqual(counts, [1, 1, 1, 1, 1]);
  const paired = pentanomial([20, 0, 20, 0, 60]);
  near(paired.score, 0.7); near(paired.elo, 147.19071411783773); near(paired.stderr, 0.04);
  const independent = trinomial({ wins: 120, draws: 40, losses: 40 });
  assert.ok(paired.stderr > independent.stderr);
});

test('GSPRT agrees with independent binomial LLR and exact Wald bounds', () => {
  const p0 = scoreFromElo(0), p1 = scoreFromElo(10);
  const result = sprt([20, 0, 60], { elo0: 0, elo1: 10 });
  near(result.llr, 60 * Math.log(p1 / p0) + 20 * Math.log((1 - p1) / (1 - p0)), 1e-7);
  near(result.lower, Math.log(0.05 / 0.95)); near(result.upper, Math.log(0.95 / 0.05));
  assert.equal(result.verdict, 'continue');
  assert.equal(sprt([0, 0, 0, 0, 200], { elo0: 0, elo1: 10 }).verdict, 'H1');
  assert.equal(sprt([200, 0, 0, 0, 0], { elo0: 0, elo1: 10 }).verdict, 'H0');
  near(sprt([0, 0, 0], { elo0: 0, elo1: 10 }).llr, 0);
});

test('statistics handle no games, all draws, extreme scores and invalid inputs', () => {
  assert.deepEqual(trinomial({ wins: 0, draws: 0, losses: 0 }).elo95, [-Infinity, Infinity]);
  const draws = trinomial({ wins: 0, draws: 100, losses: 0 });
  near(draws.elo, 0); near(draws.los, 0.5);
  assert.ok(draws.elo95[0] < 0 && draws.elo95[1] > 0);
  assert.equal(trinomial({ wins: 10, draws: 0, losses: 0 }).elo, Infinity);
  assert.equal(trinomial({ wins: 0, draws: 0, losses: 10 }).elo, -Infinity);
  assert.throws(() => sprt([1, 2, 3], { elo0: 10, elo1: 0 }));
  assert.throws(() => trinomial({ wins: -1, draws: 0, losses: 0 }));
});
