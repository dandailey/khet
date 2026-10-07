import { SETUPS, bestMove, newGame, toKFEN } from '../packages/khet-engine/src/index.ts';
import type { Position } from '../packages/khet-engine/src/index.ts';
import { random } from './lib/random.ts';

/** Exactly twenty stable positions, independent of the search implementation. */
export function benchPositions(): { name: string; pos: Position }[] {
  const names = Object.keys(SETUPS), rng = random(0x4b484554);
  const positions = names.map(name => ({ name: `${name}-start`, pos: newGame(name) }));
  for (let i = positions.length; i < 20; i++) {
    const setup = names[(i - names.length) % names.length], target = 4 + (i - names.length) * 4;
    let pos: Position;
    do {
      pos = newGame(setup);
      const moves: number[] = [];
      while (pos.result === null && pos.ply < target) {
        const count = pos.generateMoves(moves); pos.makeMove(moves[Math.floor(rng() * count)]);
      }
    } while (pos.result !== null);
    positions.push({ name: `${setup}-${target}ply`, pos });
  }
  return positions;
}

export function bench(): void {
  const positions = benchPositions();
  console.log('name\tlimit\tnodes\tnps\tdepth\tms\tmove');
  const totals = [{ nodes: 0, ms: 0, depth: 0, min: 64, max: 0 }, { nodes: 0, ms: 0, depth: 0, min: 64, max: 0 }];
  for (const { name, pos } of positions) {
    for (const [index, limit] of [{ depth: 4 }, { timeMs: 1000 }].entries()) {
      const result = bestMove(pos, { ...limit, seed: 1 });
      const nps = Math.round(result.nodes * 1000 / Math.max(1, result.timeMs));
      console.log(`${name}\t${index ? '1000ms' : 'depth4'}\t${result.nodes}\t${nps}\t${result.depth}\t${result.timeMs.toFixed(1)}\t${result.move}`);
      const total = totals[index]; total.nodes += result.nodes; total.ms += result.timeMs; total.depth += result.depth;
      total.min = Math.min(total.min, result.depth); total.max = Math.max(total.max, result.depth);
    }
  }
  for (const [i, t] of totals.entries()) console.log(`TOTAL ${i ? '1000ms' : 'depth4'}: ${t.nodes} nodes; ${Math.round(t.nodes * 1000 / t.ms)} NPS; ${t.ms.toFixed(1)} ms; depth mean ${(t.depth / positions.length).toFixed(2)} range ${t.min}-${t.max}`);
  console.log('Position manifest (KFEN):');
  for (const { name, pos } of positions) console.log(`${name}\t${toKFEN(pos)}`);
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) bench();
