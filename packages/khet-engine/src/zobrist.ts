// xorshift32, fixed seed; table includes every possible packed piece code.
let seed = 0x6b686574;
function random32(): number {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return seed >>> 0;
}
export const ZOBRIST_LO = new Uint32Array(80 * 64);
export const ZOBRIST_HI = new Uint32Array(80 * 64);
for (let i = 0; i < ZOBRIST_LO.length; i++) {
  ZOBRIST_LO[i] = random32(); ZOBRIST_HI[i] = random32();
}
export const SIDE_LO = random32(), SIDE_HI = random32();
export function recomputeHash(board: Int8Array, side: number, out = new Uint32Array(2)): Uint32Array {
  let lo = side === 1 ? SIDE_LO : 0, hi = side === 1 ? SIDE_HI : 0;
  for (let sq = 0; sq < 80; sq++) {
    const p = board[sq];
    if (p) { lo ^= ZOBRIST_LO[sq * 64 + p]; hi ^= ZOBRIST_HI[sq * 64 + p]; }
  }
  out[0] = lo >>> 0; out[1] = hi >>> 0;
  return out;
}
