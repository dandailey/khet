import { createHash } from 'node:crypto';
import { args, fail, integer, isMain, jsonFile, numberArg } from './lib/cli.ts';
import { getEngine } from './lib/engine.ts';
import type { Params } from './lib/engine.ts';
import type { PlayerConfig } from './lib/config.ts';
import { validateConfig } from './lib/config.ts';
import { MatchRunner } from './lib/match.ts';
import { readOpenings } from './lib/openings.ts';
import { random, seedFor } from './lib/random.ts';
import { jsonLogger, readLog } from './lib/log.ts';

export interface ParameterSchedule { start: number; a: number; c: number; min?: number; max?: number; integer?: boolean }
export interface SpsaConfig {
  player: PlayerConfig; nodes: number; iterations: number; seed?: number;
  params: Record<string, ParameterSchedule>;
  schedules?: { alpha?: number; gamma?: number; A?: number };
}
interface Iteration {
  iteration: number; fingerprint: string; seed: number;
  before: Params; theta: Params; plus: Params; minus: Params; delta: Params;
  a: Params; c: Params; scorePlus: number; wdl: { wins: number; draws: number; losses: number };
}
function clamp(value: number, p: ParameterSchedule): number {
  const bounded = Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, value));
  return p.integer ? Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, Math.round(bounded))) : bounded;
}

export async function tuneSpsa(config: SpsaConfig, openings: string[], logPath: string, iterations = config.iterations): Promise<Params> {
  integer(config.nodes, 'nodes'); integer(iterations, 'iterations');
  integer(config.seed ?? 1, 'seed', 0);
  if (!openings.length) throw new Error('At least one opening is required');
  validateConfig(config.player);
  const engine = await getEngine();
  const names = Object.keys(config.params);
  if (!names.length) throw new Error('Choose at least one parameter');
  for (const [name, p] of Object.entries(config.params)) {
    if (![p.start, p.a, p.c].every(Number.isFinite) || p.a <= 0 || p.c <= 0 || (p.min !== undefined && !Number.isFinite(p.min)) || (p.max !== undefined && !Number.isFinite(p.max)) || (p.min ?? -Infinity) > (p.max ?? Infinity)) throw new Error(`Invalid schedule for ${name}`);
    if (engine.DEFAULT_EVAL_PARAMS && !(name in engine.DEFAULT_EVAL_PARAMS)) throw new Error(`Unknown EvalParams name: ${name}`);
  }
  const alpha = config.schedules?.alpha ?? 0.602, gamma = config.schedules?.gamma ?? 0.101, A = config.schedules?.A ?? 0;
  if (![alpha, gamma, A].every(Number.isFinite) || alpha <= 0 || gamma <= 0 || A < 0) throw new Error('Invalid SPSA schedules');
  const { iterations: ignored, ...identity } = config;
  const fingerprint = createHash('sha256').update(JSON.stringify({ config: identity, openings, fixture: !!engine.fixture })).digest('hex');
  const previous = await readLog<Iteration>(logPath);
  previous.forEach((entry, i) => { if (entry.fingerprint !== fingerprint || entry.iteration !== i + 1 || names.some(name => !Number.isFinite(entry.theta[name]))) throw new Error('SPSA log/config mismatch; use the original config and openings or a new log'); });
  let theta: Params = previous.length ? { ...previous.at(-1)!.theta } : Object.fromEntries(names.map(name => [name, clamp(config.params[name].start, config.params[name])]));
  const logger = await jsonLogger(logPath, true), runner = new MatchRunner(1);
  try {
    for (let k = previous.length + 1; k <= iterations; k++) {
      const seed = seedFor(config.seed ?? 1, k), rng = random(seed);
      const delta: Params = {}, plus: Params = {}, minus: Params = {}, ak: Params = {}, ck: Params = {};
      for (const name of names) {
        const p = config.params[name];
        delta[name] = rng() < 0.5 ? -1 : 1;
        ak[name] = p.a / (A + k) ** alpha; ck[name] = p.c / k ** gamma;
        plus[name] = clamp(theta[name] + ck[name] * delta[name], p);
        minus[name] = clamp(theta[name] - ck[name] * delta[name], p);
      }
      const baseParams = config.player.params ?? config.player.options?.params ?? {};
      const player = (label: string, params: Params): PlayerConfig => ({ ...config.player, label, nodes: config.nodes,
        depth: undefined, timeMs: undefined, options: { ...config.player.options, nodes: config.nodes, depth: undefined, timeMs: undefined }, params: { ...baseParams, ...params } });
      const match = await runner.run({ a: player('theta+', plus), b: player('theta-', minus), games: 2, seed, openings: [openings[(k - 1) % openings.length]] });
      const scorePlus = (match.wdl.wins + match.wdl.draws * 0.5) / 2;
      const before = { ...theta };
      theta = { ...theta };
      for (const name of names) {
        const difference = plus[name] - minus[name];
        theta[name] = clamp(theta[name] + (difference ? ak[name] * (2 * scorePlus - 1) / difference : 0), config.params[name]);
      }
      logger.write({ iteration: k, fingerprint, seed, before, theta, plus, minus, delta, a: ak, c: ck, scorePlus, wdl: match.wdl } satisfies Iteration);
      console.error(`SPSA ${k}/${iterations}: theta+ score ${scorePlus.toFixed(2)}, theta=${JSON.stringify(theta)}`);
    }
  } finally { await runner.close(); await logger.close(); }
  return theta;
}

async function main(): Promise<void> {
  const flags = args();
  if (!flags.config) throw new Error('Usage: node tools/spsa.ts --config spsa.json [--iterations 3] [--log spsa.jsonl] [--openings tools/data/openings.txt]');
  const config = await jsonFile<SpsaConfig>(flags.config);
  const engine = await getEngine();
  if (engine.fixture || !engine.bestMove || ['random', 'greedy'].includes(config.player?.player ?? '')) console.error('Stub players: this run validates SPSA plumbing; it cannot establish parameter strength.');
  const theta = await tuneSpsa(config, await readOpenings(flags.openings ?? 'tools/data/openings.txt'), flags.log ?? 'spsa.jsonl', numberArg(flags.iterations, config.iterations, 'iterations'));
  console.log(JSON.stringify(theta, null, 2));
}
if (isMain(import.meta.url)) main().catch(fail);
