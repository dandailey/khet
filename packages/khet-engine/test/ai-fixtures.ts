import { MAX_MOVES, newGame } from '../src/index.ts';
import type { Color, PlacedPiece, Position } from '../src/index.ts';
export function rng(seed: number): () => number {
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
}
export function piece(sq: number, type: number, color: Color, o = 0): PlacedPiece {
  return { row: Math.floor(sq / 10), col: sq % 10, type, color, o };
}
export function randomPositions(count: number, seed = 0x718af): Position[] {
  const random = rng(seed), out = new Int32Array(MAX_MOVES), positions: Position[] = [];
  let pos = newGame();
  while (positions.length < count) {
    if (pos.result !== null || pos.ply >= 250) pos = newGame();
    if (pos.ply % 5 === 0) positions.push(pos.clone());
    const count = pos.generateMoves(out);
    pos.makeMove(out[random() % count]);
  }
  return positions;
}
