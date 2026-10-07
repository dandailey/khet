import { createReadStream, writeSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { args, fail, integer, isMain, jsonFile, numberArg } from './lib/cli.ts';
import { getEngine } from './lib/engine.ts';
import type { Engine, Params, Position } from './lib/engine.ts';
import { readConfig } from './lib/config.ts';
import { readOpenings } from './lib/openings.ts';
import { formatSummary, runMatch } from './lib/match.ts';
import { random } from './lib/random.ts';

export interface TexelParameter { start: number; step: number; min?: number; max?: number }
export interface TexelConfig { params: Record<string, TexelParameter>; baseParams?: Params; passes?: number; kMax?: number; minStep?: number }
export interface TrainingPosition { pos: Position; result: number }
export function sigmoid(value: number): number {
  return value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));
}

export async function readTraining(path: string, engine: Engine, maxPositions = 10000, seed = 1): Promise<TrainingPosition[]> {
  integer(maxPositions, 'max positions');
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  const sample: TrainingPosition[] = [], rng = random(seed);
  let count = 0;
  for await (const line of lines) {
    if (!line.trim() || line.startsWith('#')) continue;
    const split = line.lastIndexOf('\t');
    if (split < 0) throw new Error('Training lines must be KFEN<TAB>result');
    const result = Number(line.slice(split + 1));
    if (![0, 0.5, 1].includes(result)) throw new Error('Training result must be 0, 0.5 or 1 from the side-to-move perspective');
    const pos = engine.fromKFEN(line.slice(0, split));
    const item = { pos, result };
    count++;
    if (sample.length < maxPositions) sample.push(item);
    else { const index = Math.floor(rng() * count); if (index < maxPositions) sample[index] = item; }
  }
  if (!sample.length) throw new Error('Training set is empty');
  return sample;
}

export function tuneTexel(data: TrainingPosition[], engine: Engine, config: TexelConfig) {
  if (!engine.evaluate) throw new Error('Texel requires engine export evaluate(pos, namedParams), with a side-to-move score');
  const names = Object.keys(config.params);
  if (!names.length || !data.length) throw new Error('Choose params and nonempty training data');
  let params: Params = { ...config.baseParams };
  const steps: Params = {};
  for (const [name, p] of Object.entries(config.params)) {
    if (![p.start, p.step].every(Number.isFinite) || p.step <= 0 || (p.min !== undefined && !Number.isFinite(p.min)) || (p.max !== undefined && !Number.isFinite(p.max)) || (p.min ?? -Infinity) > (p.max ?? Infinity)) throw new Error(`Invalid parameter ${name}`);
    if (engine.DEFAULT_EVAL_PARAMS && !(name in engine.DEFAULT_EVAL_PARAMS)) throw new Error(`Unknown EvalParams name: ${name}`);
    params[name] = Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, p.start)); steps[name] = p.step;
  }
  const passes = integer(config.passes ?? 30, 'passes');
  const kMax = config.kMax ?? 0.1, minStep = config.minStep ?? 0.01;
  if (!Number.isFinite(kMax) || kMax <= 0 || !Number.isFinite(minStep) || minStep <= 0) throw new Error('kMax/minStep must be positive');
  const evaluation = engine.evaluate.bind(engine);
  const initialScores = data.map(item => evaluation(item.pos, params));
  if (initialScores.some(score => !Number.isFinite(score))) throw new Error('Evaluation returned a nonfinite score');
  const lossScores = (scores: number[], k: number) => scores.reduce((s, v, i) => s + (sigmoid(k * v) - data[i].result) ** 2, 0) / data.length;
  // First fit K, then hold it fixed so parameter and sigmoid scales cannot drift together.
  let bestK = 0, bestKLoss = lossScores(initialScores, 0), bestIndex = 0;
  for (let i = 1; i <= 100; i++) {
    const k = kMax * i / 100, loss = lossScores(initialScores, k);
    if (loss < bestKLoss) { bestK = k; bestKLoss = loss; bestIndex = i; }
  }
  let low = Math.max(0, (bestIndex - 1) * kMax / 100), high = Math.min(kMax, (bestIndex + 1) * kMax / 100);
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 60; i++) {
    const left = high - ratio * (high - low), right = low + ratio * (high - low);
    if (lossScores(initialScores, left) < lossScores(initialScores, right)) high = right; else low = left;
  }
  const candidateK = (low + high) / 2, candidateLoss = lossScores(initialScores, candidateK);
  if (candidateLoss < bestKLoss) { bestK = candidateK; bestKLoss = candidateLoss; }
  const loss = (p: Params) => {
    const scores = data.map(item => evaluation(item.pos, p));
    if (scores.some(score => !Number.isFinite(score))) throw new Error('Evaluation returned a nonfinite score');
    return lossScores(scores, bestK);
  };
  let current = bestKLoss, completed = 0;
  for (let pass = 0; pass < passes; pass++) {
    let improved = false;
    for (const name of names) {
      const p = config.params[name];
      let best = params, bestLoss = current;
      for (const direction of [-1, 1]) {
        const value = Math.max(p.min ?? -Infinity, Math.min(p.max ?? Infinity, params[name] + direction * steps[name]));
        const candidate = { ...params, [name]: value }, candidateLoss = loss(candidate);
        if (candidateLoss < bestLoss - 1e-12) { best = candidate; bestLoss = candidateLoss; }
      }
      if (best !== params) { params = best; current = bestLoss; improved = true; }
      else steps[name] *= 0.5;
    }
    completed++;
    if (!improved && names.every(name => steps[name] < minStep)) break;
  }
  return { params, K: bestK, initialMse: bestKLoss, mse: current, passes: completed, positions: data.length };
}

async function main(): Promise<void> {
  const flags = args();
  if (!!flags.generate === !!flags.tune || !flags.config) throw new Error('Use --generate or --tune, with --config file.json');
  const engine = await getEngine();
  if (engine.fixture) console.error('Using harness rules/evaluation fixture; these results are for tool validation.');
  if (flags.generate) {
    const config = await readConfig(flags.config);
    const nodes = integer(numberArg(flags.nodes, config.nodes ?? config.options?.nodes ?? 1000, 'nodes'), 'nodes');
    const player = { ...config, nodes, depth: undefined, timeMs: undefined, options: { ...config.options, nodes, depth: undefined, timeMs: undefined } };
    const openings = await readOpenings(flags.openings ?? 'tools/data/openings.txt');
    const file = await open(flags.out ?? 'texel.txt', 'w');
    let samples = 0;
    try {
      const summary = await runMatch({ a: { ...player, label: 'self-A' }, b: { ...player, label: 'self-B' }, openings,
        games: integer(numberArg(flags.games, 20, 'games'), 'games'),
        concurrency: integer(numberArg(flags.concurrency, 2, 'concurrency'), 'concurrency'), seed: numberArg(flags.seed, 1, 'seed', 0),
        sampling: { every: integer(numberArg(flags.every, 10, 'every'), 'every'), maxPerGame: integer(numberArg(flags.samples, 30, 'samples'), 'samples') },
        onGame: game => { for (const sample of game.samples ?? []) { writeSync(file.fd, `${sample.kfen}\t${sample.result}\n`); samples++; } },
        onPair: s => console.error(formatSummary(s)),
      });
      console.error(`${formatSummary(summary)}; wrote ${samples} quiet positions`);
      if (!samples) throw new Error('No quiet positions sampled; increase games or sampling frequency');
    } finally { await file.close(); }
  } else {
    const config = await jsonFile<TexelConfig>(flags.config);
    const data = await readTraining(flags.data ?? 'texel.txt', engine, integer(numberArg(flags['max-positions'], 10000, 'max positions'), 'max positions'), numberArg(flags.seed, 1, 'seed', 0));
    const result = tuneTexel(data, engine, config);
    console.error(`Texel ${result.positions} positions: K=${result.K.toFixed(6)}, MSE ${result.initialMse.toFixed(6)} -> ${result.mse.toFixed(6)} (${result.passes} passes)`);
    console.log(JSON.stringify(result.params, null, 2));
  }
}
if (isMain(import.meta.url)) main().catch(fail);
