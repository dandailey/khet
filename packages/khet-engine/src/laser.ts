import { BEAM_NEXT } from './geometry.ts';
import { ANUBIS, PHARAOH, PYRAMID, SCARAB, SPHINX, opposite, orientation, pieceType } from './types.ts';
// Indexed by orientation then entry face. -1 means destruction.
const PYRAMID_EXIT = new Int8Array([1, 0, -1, -1, -1, 2, 1, -1, -1, -1, 3, 2, 3, -1, -1, 0]);
const SCARAB_EXIT = new Int8Array([1, 0, 3, 2, 3, 2, 1, 0]);
/** Allocation-free trace. path, when supplied, includes the emitter and stopping square.
 * Returns only the destroyed square; absorption and board exits return -1. */
export function traceLaserFast(board: Int8Array, sphinx: number, path?: number[]): number {
  if (sphinx < 0) return -1;
  let sq = sphinx, t = orientation(board[sq]);
  if (path) path.push(sq);
  for (let steps = 0; steps < 512; steps++) {
    sq = BEAM_NEXT[sq * 4 + t];
    if (sq < 0) return -1;
    if (path) path.push(sq);
    const p = board[sq];
    if (!p) continue;
    const type = pieceType(p), o = orientation(p), f = opposite(t);
    if (type === PYRAMID) {
      t = PYRAMID_EXIT[o * 4 + f];
      if (t < 0) return sq;
    } else if (type === SCARAB) {
      t = SCARAB_EXIT[o * 4 + f];
    } else if (type === ANUBIS) {
      return f === o ? -1 : sq;
    } else if (type === PHARAOH) {
      return sq;
    } else if (type === SPHINX) {
      return -1;
    }
  }
  throw new Error('Laser trace exceeded 512 steps');
}
