import { Worker } from 'node:worker_threads';
import { getEngine } from './engine.ts';
import { validateConfig } from './config.ts';
import type { PlayerConfig } from './config.ts';
import type { GameResult, GameTask } from './game.ts';
import { integer } from './cli.ts';
import { addPair, pentanomial, sprt, trinomial } from './stats.ts';
import type { Pentanomial, SprtOptions, WDL } from './stats.ts';

export interface MatchOptions {
  a: PlayerConfig; b: PlayerConfig; games: number; openings: string[];
  concurrency?: number; seed?: number; sprt?: SprtOptions;
  sampling?: GameTask['sampling'];
  onGame?: (game: GameResult) => void;
  onPair?: (summary: MatchSummary) => void;
}
export interface MatchSummary {
  games: number; pairs: number; wdl: WDL; pentanomial: Pentanomial;
  stats: ReturnType<typeof trinomial>; pairStats: ReturnType<typeof pentanomial>;
  sprt?: ReturnType<typeof sprt>;
  stoppedAt?: { games: number; pairs: number; llr: number; verdict: 'H0' | 'H1' };
}

// Bounded persistent pool, reused across SPSA iterations and round-robin matches.
export class MatchRunner {
  workers: Worker[] = [];
  concurrency: number;
  busy = false;
  closed = false;
  constructor(concurrency = 2) { this.concurrency = integer(concurrency, 'concurrency'); if (concurrency > 3) throw new Error('Concurrency is capped at 3'); }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(this.workers.map(async worker => {
      // Let each IO worker close its persistent external CLI before termination.
      await new Promise<void>(resolve => {
        const timer = setTimeout(done, 10000);
        function message(value: { kind: string }) { if (value.kind === 'closed') done(); }
        function done() { clearTimeout(timer); worker.off('message', message); worker.off('exit', done); resolve(); }
        worker.on('message', message); worker.once('exit', done); worker.postMessage({ kind: 'close' });
      });
      await worker.terminate();
    }));
    this.workers = [];
  }
  async run(options: MatchOptions): Promise<MatchSummary> {
    if (this.closed || this.busy) throw new Error('Runner is closed or already running');
    validateConfig(options.a); validateConfig(options.b);
    integer(options.games, 'games');
    integer(options.seed ?? 1, 'seed', 0);
    if (options.games % 2) throw new Error('games must be even: every opening is played as a colour-reversed pair');
    if (!options.openings.length) throw new Error('At least one opening is required');
    const engine = await getEngine();
    for (const opening of options.openings) engine.fromKFEN(opening);
    if (options.sprt) sprt([0, 0, 0, 0, 0], options.sprt);
    if (options.sampling) { integer(options.sampling.every, 'sample interval'); integer(options.sampling.maxPerGame, 'max samples'); }
    this.busy = true;
    const totalPairs = options.games / 2;
    while (this.workers.length < Math.min(this.concurrency, totalPairs)) this.workers.push(new Worker(new URL('./match-worker.ts', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')),
    }));
    const wdl: WDL = { wins: 0, draws: 0, losses: 0 }, counts: Pentanomial = [0, 0, 0, 0, 0];
    const results = new Map<number, GameResult[]>();
    let dispatched = 0, completed = 0, active = 0, gameCount = 0;
    let stoppedAt: MatchSummary['stoppedAt'];
    function summary(): MatchSummary {
      return { games: gameCount, pairs: completed, wdl: { ...wdl }, pentanomial: [...counts], stats: trinomial(wdl), pairStats: pentanomial(counts),
        ...(options.sprt ? { sprt: sprt(counts, options.sprt) } : {}), ...(stoppedAt ? { stoppedAt } : {}) };
    }
    try {
      return await new Promise<MatchSummary>((resolve, reject) => {
        let finished = false;
        const handlers = new Map<Worker, { message: (m: Message) => void; error: (e: Error) => void; exit: (code: number) => void }>();
        function cleanup() { for (const [worker, h] of handlers) { worker.off('message', h.message); worker.off('error', h.error); worker.off('exit', h.exit); } }
        function finish(error?: Error) {
          if (finished) return; finished = true; cleanup();
          if (error) reject(error); else resolve(summary());
        }
        const dispatch = (worker: Worker) => {
          if (finished) return;
          if (stoppedAt || dispatched >= totalPairs) { if (!active) finish(); return; }
          const pair = dispatched++;
          const base = { pair, opening: options.openings[pair % options.openings.length], a: options.a, b: options.b, seed: options.seed ?? 1, sampling: options.sampling };
          active++;
          worker.postMessage([{ ...base, id: pair * 2, aSilver: true }, { ...base, id: pair * 2 + 1, aSilver: false }] satisfies [GameTask, GameTask]);
        };
        type Message = { kind: 'game'; game: GameResult } | { kind: 'pair'; pair: number } | { kind: 'failure'; message: string };
        for (const worker of this.workers.slice(0, Math.min(this.concurrency, totalPairs))) {
          const h = {
            message: (m: Message) => {
              try {
                if (m.kind === 'failure') { finish(new Error(m.message)); return; }
                if (m.kind === 'game') {
                  const list = results.get(m.game.pair) ?? []; list.push(m.game); results.set(m.game.pair, list);
                  gameCount++; if (m.game.scoreA === 1) wdl.wins++; else if (m.game.scoreA === 0) wdl.losses++; else wdl.draws++;
                  options.onGame?.(m.game);
                } else {
                  const pair = results.get(m.pair);
                  if (pair?.length !== 2) throw new Error('Incomplete game pair');
                  addPair(counts, pair[0].scoreA, pair[1].scoreA); results.delete(m.pair);
                  completed++; active--;
                  const current = summary();
                  if (!stoppedAt && current.sprt && current.sprt.verdict !== 'continue') {
                    stoppedAt = { games: completed * 2, pairs: completed, llr: current.sprt.llr, verdict: current.sprt.verdict };
                  }
                  options.onPair?.(summary()); dispatch(worker);
                }
              } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
            },
            error: (e: Error) => finish(e),
            exit: (code: number) => finish(new Error(`Match worker exited unexpectedly (${code})`)),
          };
          handlers.set(worker, h); worker.on('message', h.message); worker.on('error', h.error); worker.on('exit', h.exit);
        }
        for (const worker of handlers.keys()) dispatch(worker);
      });
    } catch (error) { await this.close(); throw error; }
    finally { this.busy = false; }
  }
}

export async function runMatch(options: MatchOptions): Promise<MatchSummary> {
  const runner = new MatchRunner(options.concurrency);
  try { return await runner.run(options); } finally { await runner.close(); }
}

function formatElo(value: number): string { return Number.isFinite(value) ? value.toFixed(1) : String(value); }
export function formatSummary(s: MatchSummary): string {
  const interval = s.pairStats.elo95.map(formatElo).join(', ');
  return `${s.games} games / ${s.pairs} pairs: ${s.wdl.wins}/${s.wdl.draws}/${s.wdl.losses} W/D/L; paired Elo ${formatElo(s.pairStats.elo)} (95% [${interval}]); LOS ${(s.pairStats.los * 100).toFixed(1)}%` +
    (s.sprt ? `; GSPRT LLR ${s.sprt.llr.toFixed(3)} [${s.sprt.lower.toFixed(3)}, ${s.sprt.upper.toFixed(3)}] ${s.stoppedAt?.verdict ?? s.sprt.verdict}` : '');
}
