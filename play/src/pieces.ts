import { ANUBIS, PHARAOH, PYRAMID, SCARAB, SPHINX } from '../../packages/khet-engine/src/index.ts';
import type { Piece } from '../../packages/khet-engine/src/index.ts';

export const PIECE_NAMES: Record<number, string> = {
  [PHARAOH]: 'Pharaoh', [SPHINX]: 'Sphinx', [PYRAMID]: 'Pyramid', [SCARAB]: 'Scarab', [ANUBIS]: 'Anubis',
};
export function pieceSVG(piece: Piece): string {
  let shape = '';
  let rotation = piece.o * 90;
  if (piece.type === PHARAOH) {
    rotation = 0;
    shape = '<path d="M27 76 L31 39 L23 22 L41 31 L50 16 L59 31 L77 22 L69 39 L73 76 Z"/><path class="detail" d="M33 49 H67 M33 66 H67"/><circle class="detail" cx="50" cy="56" r="4"/>';
  } else if (piece.type === SPHINX) {
    shape = '<path d="M26 75 V51 L34 39 H66 L74 51 V75 Z"/><path class="detail" d="M38 74 V53 H62 V74"/><path class="firing-arrow" d="M50 54 V17 M38 29 L50 17 L62 29"/>';
  } else if (piece.type === PYRAMID) {
    // NE mirror normal: solid triangle southwest of the hypotenuse.
    shape = '<path d="M23 23 V77 H77 Z"/><path class="mirror" d="M23 23 L77 77"/>';
  } else if (piece.type === SCARAB) {
    rotation = piece.o === 0 ? 0 : 90;
    shape = '<ellipse cx="50" cy="50" rx="29" ry="29" class="scarab-body"/><path class="detail" d="M25 39 L17 32 M27 61 L17 68 M75 39 L83 32 M73 61 L83 68"/><path class="mirror" d="M24 76 L76 24"/><path class="mirror-second" d="M20 72 L72 20"/>';
  } else if (piece.type === ANUBIS) {
    shape = '<path d="M27 29 H73 V61 L50 80 L27 61 Z"/><path class="detail" d="M38 46 L50 58 L62 46"/><path class="shield" d="M23 26 H77"/>';
  }
  return `<svg class="piece ${piece.color === 0 ? 'silver' : 'red'}" viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(${rotation} 50 50)">${shape}</g></svg>`;
}
