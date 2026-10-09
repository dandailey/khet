import { args, fail, integer, isMain, jsonFile, numberArg } from './lib/cli.ts';
import type { PlayerConfig } from './lib/config.ts';
import { validateConfig } from './lib/config.ts';
import { MatchRunner, formatSummary } from './lib/match.ts';
import type { MatchSummary } from './lib/match.ts';
import { readOpenings } from './lib/openings.ts';
import { getEngine } from './lib/engine.ts';
import { jsonLogger } from './lib/log.ts';
import { seedFor } from './lib/random.ts';

export interface LevelConfig extends PlayerConfig { level: number }
export interface Encounter { a: number; b: number; summary: MatchSummary }

// Bradley-Terry maximum likelihood. Half a virtual win and loss per matchup keeps
// finite ratings for undefeated levels in small calibration runs.
export function fitRatings(count: number, encounters: Encounter[], anchor = 0): number[] {
  const strength = Array<number>(count).fill(0);
  for (let step = 0; step < 2000; step++) {
    let maxChange = 0;
    for (let i = 0; i < count; i++) {
      if (i === anchor) continue;
      let gradient = 0, information = 0;
      for (const encounter of encounters) {
        if (encounter.a !== i && encounter.b !== i) continue;
        const { wins, draws, losses } = encounter.summary.wdl;
        const other = encounter.a === i ? encounter.b : encounter.a;
        const score = (encounter.a === i ? wins : losses) + 0.5 * draws + 0.5;
        const games = wins + draws + losses + 1;
        const probability = 1 / (1 + Math.exp(strength[other] - strength[i]));
        gradient += score - games * probability; information += games * probability * (1 - probability);
      }
      const change = information ? Math.max(-1, Math.min(1, gradient / information)) : 0;
      strength[i] += change; maxChange = Math.max(maxChange, Math.abs(change));
    }
    if (maxChange < 1e-8) break;
  }
  return strength.map(s => s * 400 / Math.LN10);
}

async function main(): Promise<void> {
  const flags = args();
  if (!flags.config) throw new Error('Usage: node tools/levels.ts --config levels.json [--games 20] [--concurrency 2] [--out levels.jsonl]');
  const config = await jsonFile<{ levels: LevelConfig[] }>(flags.config), levels = config.levels;
  if (!Array.isArray(levels) || levels.length < 2) throw new Error('Choose at least two levels');
  levels.forEach(level => { validateConfig(level); integer(level.level, 'level'); });
  if (new Set(levels.map(l => l.level)).size !== levels.length || new Set(levels.map(l => l.label)).size !== levels.length) throw new Error('Level numbers and labels must be unique');
  const anchor = levels.findIndex(l => l.level === 1);
  if (anchor < 0) throw new Error('Level 1 must be present as the Elo anchor');
  const engine = await getEngine();
  if (engine.fixture || !engine.bestMove) console.error('Using stub players; ratings validate the harness rather than real difficulty levels.');
  const openings = await readOpenings(flags.openings ?? 'tools/data/openings.txt');
  const runner = new MatchRunner(integer(numberArg(flags.concurrency, 2, 'concurrency'), 'concurrency'));
  const logger = flags.out ? await jsonLogger(flags.out) : undefined;
  const encounters: Encounter[] = [];
  const totals = levels.map(() => ({ wins: 0, draws: 0, losses: 0 }));
  try {
    for (let a = 0; a < levels.length; a++) for (let b = a + 1; b < levels.length; b++) {
      const summary = await runner.run({ a: levels[a], b: levels[b], openings,
        games: integer(numberArg(flags.games, 20, 'games'), 'games'), seed: seedFor(numberArg(flags.seed, 1, 'seed', 0), a, b),
        onGame: game => logger?.write({ levels: [levels[a].level, levels[b].level], ...game }),
        onPair: summary => console.error(`${levels[a].label} vs ${levels[b].label}: ${formatSummary(summary)}`),
      });
      encounters.push({ a, b, summary });
      totals[a].wins += summary.wdl.wins; totals[a].draws += summary.wdl.draws; totals[a].losses += summary.wdl.losses;
      totals[b].wins += summary.wdl.losses; totals[b].draws += summary.wdl.draws; totals[b].losses += summary.wdl.wins;
    }
  } finally { await runner.close(); await logger?.close(); }
  const ratings = fitRatings(levels.length, encounters, anchor);
  console.log('Level\tLabel\tElo (level 1 = 0)\tW/D/L');
  levels.forEach((level, i) => console.log(`${level.level}\t${level.label}\t${ratings[i].toFixed(1)}\t${totals[i].wins}/${totals[i].draws}/${totals[i].losses}`));
  console.error('Ratings use a joint Bradley-Terry fit with 0.5 virtual wins/losses per matchup.');
}
if (isMain(import.meta.url)) main().catch(fail);
