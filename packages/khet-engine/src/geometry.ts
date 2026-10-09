import { BOARD_SIZE, RED, SILVER } from './types.ts';
// -1 = unrestricted, otherwise the only color permitted on the square.
export const RESERVED = new Int8Array(BOARD_SIZE).fill(-1);
export const NEIGHBOURS = new Int16Array(BOARD_SIZE * 8).fill(-1);
export const BEAM_NEXT = new Int16Array(BOARD_SIZE * 4).fill(-1);
const dr = [-1, -1, 0, 1, 1, 1, 0, -1];
const dc = [0, 1, 1, 1, 0, -1, -1, -1];
for (let sq = 0; sq < BOARD_SIZE; sq++) {
  const r = Math.floor(sq / 10), c = sq % 10;
  if (c === 0 || ((r === 0 || r === 7) && c === 8)) RESERVED[sq] = RED;
  if (c === 9 || ((r === 0 || r === 7) && c === 1)) RESERVED[sq] = SILVER;
  for (let d = 0; d < 8; d++) {
    const nr = r + dr[d], nc = c + dc[d];
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 10) NEIGHBOURS[sq * 8 + d] = nr * 10 + nc;
  }
  for (let d = 0; d < 4; d++) BEAM_NEXT[sq * 4 + d] = NEIGHBOURS[sq * 8 + d * 2];
}
export function permitted(sq: number, color: number): boolean {
  return RESERVED[sq] === -1 || RESERVED[sq] === color;
}
