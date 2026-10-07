import { getEngine, quiet, stubMove } from './engine.ts';
import { searchOptions } from './config.ts';
import type { PlayerConfig } from './config.ts';
import { seedFor } from './random.ts';

export interface Sample { kfen: string; result: number }
export interface GameTask {
  id: number; pair: number; opening: string; a: PlayerConfig; b: PlayerConfig;
  aSilver: boolean; seed: number;
  sampling?: { every: number; maxPerGame: number };
}
export interface SideMetrics { moves: number; avgDepth: number; avgNodes: number }
export interface GameResult {
  id: number; pair: number; opening: string;
  colours: { silver: string; red: string; a: 'silver' | 'red' };
  result: 'A' | 'B' | 'draw'; scoreA: number;
  plies: number; termination: 'pharaoh' | 'threefold' | 'ply-cap' | 'no-moves' | 'engine-draw';
  stats: { A: SideMetrics; B: SideMetrics };
  backend: string; seed: number;
  samples?: Sample[];
}

export async function playGame(task: GameTask, suppliedEngine?: Awaited<ReturnType<typeof getEngine>>): Promise<GameResult> {
  const engine = suppliedEngine ?? await getEngine();
  let pos = engine.fromKFEN(task.opening);
  if (pos.result !== null) throw new Error('Opening is terminal');
  const colourA = task.aSilver ? engine.SILVER : engine.RED;
  const repetitions = new Map([[pos.key(), 1]]);
  const metrics = [{ moves: 0, depth: 0, nodes: 0 }, { moves: 0, depth: 0, nodes: 0 }];
  const samples: { kfen: string; side: number }[] = [];
  let plies = 0;
  let termination: GameResult['termination'] = 'ply-cap';
  while (plies < 300 && pos.result === null) {
    if (task.sampling && plies % task.sampling.every === 0 && samples.length < task.sampling.maxPerGame && quiet(pos, engine)) {
      samples.push({ kfen: engine.toKFEN(pos), side: pos.side });
    }
    if (!engine.legalMoves(pos).length) { termination = 'no-moves'; break; }
    const index = pos.side === colourA ? 0 : 1;
    const config = index === 0 ? task.a : task.b;
    const opts = { ...searchOptions(config), seed: seedFor(task.seed, task.pair, task.aSilver ? 0 : 1, plies) };
    const result = config.player === 'random' || config.player === 'greedy'
      ? stubMove(engine, pos, opts, config.player)
      : engine.bestMove ? engine.bestMove(pos, opts) : stubMove(engine, pos, opts, 'greedy');
    if (!Number.isFinite(result.nodes) || !Number.isFinite(result.depth) || result.nodes < 0 || result.depth < 0) throw new Error('Engine returned invalid search metrics');
    metrics[index].moves++; metrics[index].depth += result.depth; metrics[index].nodes += result.nodes;
    pos = engine.applyMove(pos, result.move); plies++;
    if (pos.result !== null) { termination = pos.result === 'draw' ? 'engine-draw' : 'pharaoh'; break; }
    const key = pos.key(), count = (repetitions.get(key) ?? 0) + 1;
    repetitions.set(key, count);
    if (count >= 3) { termination = 'threefold'; break; }
    // Worker heaps and buffers are bounded separately from the parent process.
    const memory = process.memoryUsage();
    if (memory.heapUsed + memory.external > 192 * 1024 * 1024) throw new Error('Worker exceeded 192 MiB heap + external memory; reduce engine table size');
  }
  const winner = typeof pos.result === 'number' ? pos.result : null;
  const scoreA = winner === null ? 0.5 : winner === colourA ? 1 : 0;
  const sideStats = metrics.map(m => ({ moves: m.moves, avgDepth: m.moves ? m.depth / m.moves : 0, avgNodes: m.moves ? m.nodes / m.moves : 0 }));
  return {
    id: task.id, pair: task.pair, opening: task.opening,
    colours: { silver: task.aSilver ? task.a.label : task.b.label, red: task.aSilver ? task.b.label : task.a.label, a: task.aSilver ? 'silver' : 'red' },
    result: scoreA === 1 ? 'A' : scoreA === 0 ? 'B' : 'draw', scoreA, plies, termination,
    stats: { A: sideStats[0], B: sideStats[1] }, seed: task.seed,
    backend: engine.fixture ? 'rules-fixture' : 'engine',
    ...(task.sampling ? { samples: samples.map(s => ({ kfen: s.kfen, result: winner === null ? 0.5 : winner === s.side ? 1 : 0 })) } : {}),
  };
}
