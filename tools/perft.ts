import { MAX_MOVES, Position, newGame } from '../packages/khet-engine/src/index.ts';
export function perft(pos: Position, depth: number, buffers?: Int32Array[]): number {
  if (!Number.isInteger(depth) || depth < 0) throw new Error('Depth must be a nonnegative integer');
  const moves = buffers ?? Array.from({ length: depth + 1 }, () => new Int32Array(MAX_MOVES));
  return visit(pos, depth, moves);
}
function visit(pos: Position, depth: number, buffers: Int32Array[]): number {
  if (depth === 0) return 1;
  const out = buffers[depth], count = pos.generateMoves(out);
  if (depth === 1) return count;
  let nodes = 0;
  for (let i = 0; i < count; i++) {
    pos.makeMove(out[i]); nodes += visit(pos, depth - 1, buffers); pos.unmakeMove();
  }
  return nodes;
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const setup = process.argv[2] ?? 'classic', depth = Number(process.argv[3] ?? 3);
  if (!Number.isInteger(depth) || depth < 1) throw new Error('Depth must be a positive integer');
  const pos = newGame(setup);
  pos.reserveHistory(depth);
  const buffers = Array.from({ length: depth + 1 }, () => new Int32Array(MAX_MOVES));
  // Warm the engine before timings; no timings are asserted by tests.
  perft(pos, Math.min(depth, 2), buffers);
  for (let d = 1; d <= depth; d++) {
    const start = performance.now(), nodes = perft(pos, d, buffers), seconds = (performance.now() - start) / 1000;
    console.log(`${setup} perft(${d}) = ${nodes}; ${(nodes / seconds).toFixed(0)} nodes/sec (${seconds.toFixed(6)}s)`);
  }
}
