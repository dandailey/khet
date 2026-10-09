import { Position, fromPieces } from './position.ts';
import { ANUBIS, MAX_MOVES, PHARAOH, PYRAMID, RED, ROT_CCW, ROT_CW, SCARAB, SILVER, SPHINX, STEP, SWAP, encodeMove, orientation, pieceColor, pieceType } from './types.ts';
import type { PlacedPiece } from './types.ts';

function squareText(sq: number): string { return String.fromCharCode(97 + sq % 10) + (8 - Math.floor(sq / 10)); }
function readSquare(text: string): number { return (8 - Number(text[1])) * 10 + text.charCodeAt(0) - 97; }
export function moveToString(move: number, _pos: Position): string {
  const from = move & 127, to = (move >> 7) & 127, kind = move >> 14;
  if (!Number.isInteger(move) || move < 0 || move > 65535 || from >= 80 || to >= 80 || (kind >= ROT_CW && to !== from)) {
    throw new Error('Invalid move encoding');
  }
  return squareText(from) + (kind === ROT_CW ? '+' : kind === ROT_CCW ? '-' : (kind === SWAP ? 'x' : '-') + squareText(to));
}
export function parseMove(str: string, pos: Position): number {
  const match = /^([a-j][1-8])(?:([-x])([a-j][1-8])|([+-]))$/.exec(str);
  if (!match) throw new Error(`Invalid move notation: ${str}`);
  const from = readSquare(match[1]);
  const to = match[3] ? readSquare(match[3]) : from;
  const kind = match[4] ? (match[4] === '+' ? ROT_CW : ROT_CCW) : (match[2] === 'x' ? SWAP : STEP);
  const move = encodeMove(from, to, kind), moves = new Int32Array(MAX_MOVES), count = pos.generateMoves(moves);
  for (let i = 0; i < count; i++) if (moves[i] === move) return move;
  throw new Error(`Illegal move: ${str}`);
}

const LETTERS = ['', 'F', 'S', 'P', 'C', 'A'];
const FACING = 'nesw';
export function toKFEN(pos: Position): string {
  const ranks: string[] = [];
  for (let row = 0; row < 8; row++) {
    let rank = '', empty = 0;
    for (let col = 0; col < 10; col++) {
      const p = pos.board[row * 10 + col];
      if (!p) { empty++; continue; }
      if (empty) { rank += empty; empty = 0; }
      const type = pieceType(p), o = orientation(p), letter = LETTERS[type];
      rank += pieceColor(p) === SILVER ? letter : letter.toLowerCase();
      rank += type === PHARAOH ? '-' : type === PYRAMID ? String(o + 1) : type === SCARAB ? (o === 0 ? '/' : '\\') : FACING[o];
    }
    if (empty) rank += empty;
    ranks.push(rank);
  }
  return ranks.join('/') + (pos.side === SILVER ? ' s ' : ' r ') + pos.ply;
}
export function fromKFEN(text: string): Position {
  const fields = text.trim().split(/\s+/);
  if (fields.length < 2 || fields.length > 3 || !/^[sr]$/.test(fields[1])) throw new Error('Invalid KFEN fields');
  const ply = fields.length === 3 ? Number(fields[2]) : 0;
  if ((fields.length === 3 && !/^(0|[1-9]\d*)$/.test(fields[2])) || !Number.isSafeInteger(ply)) throw new Error('Invalid KFEN ply');
  const board = fields[0], pieces: PlacedPiece[] = [];
  let index = 0, silverPharaohs = 0, redPharaohs = 0;
  // Consume each rank by its width. Splitting on '/' would split C/ tokens.
  for (let row = 0; row < 8; row++) {
    let col = 0;
    while (col < 10) {
      const letter = board[index++];
      if (!letter) throw new Error('Incomplete KFEN rank');
      if (letter >= '1' && letter <= '9') {
        let digits = letter;
        while (index < board.length && board[index] >= '0' && board[index] <= '9') digits += board[index++];
        const empty = Number(digits);
        if (empty > 10 || col + empty > 10) throw new Error('KFEN rank too wide');
        col += empty; continue;
      }
      const type = LETTERS.indexOf(letter.toUpperCase()), facing = board[index++];
      if (type < PHARAOH || type > ANUBIS || facing === undefined) throw new Error('Invalid KFEN piece');
      const color = letter === letter.toUpperCase() ? SILVER : RED;
      let o: number;
      if (type === PHARAOH) {
        if (facing !== '-') throw new Error('Invalid Pharaoh orientation');
        o = 0;
        if (color === SILVER) silverPharaohs++; else redPharaohs++;
      } else if (type === PYRAMID) {
        if (!/^[1-4]$/.test(facing)) throw new Error('Invalid Pyramid orientation');
        o = Number(facing) - 1;
      } else if (type === SCARAB) {
        if (facing !== '/' && facing !== '\\') throw new Error('Invalid Scarab orientation');
        o = facing === '/' ? 0 : 1;
      } else {
        o = FACING.indexOf(facing);
        if (o < 0) throw new Error('Invalid facing');
      }
      pieces.push({ type, color, o, row, col }); col++;
    }
    if (row < 7 && board[index++] !== '/') throw new Error('Invalid KFEN rank separator');
  }
  if (index !== board.length || silverPharaohs > 1 || redPharaohs > 1) throw new Error('Invalid KFEN board');
  const pos = fromPieces(pieces, fields[1] === 's' ? SILVER : RED);
  pos.ply = ply;
  // KFEN cannot encode repetition history. A single remaining Pharaoh identifies a win.
  if (silverPharaohs === 1 && redPharaohs === 0) pos.result = SILVER;
  if (redPharaohs === 1 && silverPharaohs === 0) pos.result = RED;
  return pos;
}
