// Harness fixture only: rules from ENGINE_SPEC.md, no production search or strength claims.
import type { Params, Piece } from './engine.ts';

export const fixture = true;
export const SILVER = 0, RED = 1;
export const PHARAOH = 1, SPHINX = 2, PYRAMID = 3, SCARAB = 4, ANUBIS = 5;
const letters = ['', 'F', 'S', 'P', 'C', 'A'];
const faces = [[0, 1], [2, 1], [2, 3], [0, 3]];
const dr = [-1, 0, 1, 0], dc = [0, 1, 0, -1];
type Cell = { type: number; color: number; o: number } | null;
type Snapshot = { board: Cell[]; side: number; result: number | 'draw' | null; ply: number };

function inside(row: number, col: number): boolean { return row >= 0 && row < 8 && col >= 0 && col < 10; }
function allowed(sq: number, color: number): boolean {
  const row = Math.floor(sq / 10), col = sq % 10;
  if (col === 0 || ((row === 0 || row === 7) && col === 8)) return color === RED;
  if (col === 9 || ((row === 0 || row === 7) && col === 1)) return color === SILVER;
  return true;
}

export class Position {
  board: Cell[] = Array<Cell>(80).fill(null);
  side = SILVER;
  result: number | 'draw' | null = null;
  ply = 0;
  history: Snapshot[] = [];

  toPieces(): Piece[] {
    return this.board.flatMap((p, sq) => p ? [{ ...p, row: Math.floor(sq / 10), col: sq % 10 }] : []);
  }
  clone(): Position {
    const pos = new Position();
    pos.board = this.board.slice(); pos.side = this.side; pos.result = this.result; pos.ply = this.ply;
    return pos;
  }
  key(): string { return toKFEN(this).split(' ').slice(0, 2).join(' '); }
  pieceAt(sq: number): Cell { return this.board[sq]; }
  generateMoves(out: number[] = []): number {
    out.length = 0;
    if (this.result !== null) return 0;
    for (let from = 0; from < 80; from++) {
      const p = this.board[from];
      if (!p || p.color !== this.side) continue;
      const row = Math.floor(from / 10), col = from % 10;
      if (p.type !== SPHINX) {
        for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) {
          if ((!r && !c) || !inside(row + r, col + c)) continue;
          const to = (row + r) * 10 + col + c;
          if (!allowed(to, p.color)) continue;
          const target = this.board[to];
          if (!target) out.push(from | (to << 7));
          else if (p.type === SCARAB && (target.type === PYRAMID || target.type === ANUBIS) && allowed(from, target.color)) {
            out.push(from | (to << 7) | (1 << 14));
          }
        }
      }
      if (p.type === PHARAOH) continue;
      if (p.type === SCARAB) out.push(from | (from << 7) | (2 << 14));
      else for (const kind of [2, 3]) {
        const o = (p.o + (kind === 2 ? 1 : 3)) & 3;
        if (p.type !== SPHINX || inside(row + dr[o], col + dc[o])) out.push(from | (from << 7) | (kind << 14));
      }
    }
    return out.length;
  }
  traceLaser(color: number): { path: number[]; hit: number; hitType: number | null } {
    let sq = this.board.findIndex(p => p?.type === SPHINX && p.color === color);
    if (sq < 0) throw new Error('Missing Sphinx');
    let direction = this.board[sq]!.o;
    const path = [sq];
    for (let step = 0; step < 512; step++) {
      const row = Math.floor(sq / 10) + dr[direction], col = sq % 10 + dc[direction];
      if (!inside(row, col)) return { path, hit: -1, hitType: null };
      sq = row * 10 + col; path.push(sq);
      const p = this.board[sq];
      if (!p) continue;
      const entry = (direction + 2) & 3;
      if (p.type === SCARAB) {
        direction = (p.o === 0 ? [1, 0, 3, 2] : [3, 2, 1, 0])[entry];
      } else if (p.type === PYRAMID && faces[p.o].includes(entry)) {
        direction = faces[p.o].find(f => f !== entry)!;
      } else if (p.type === SPHINX || (p.type === ANUBIS && entry === p.o)) {
        return { path, hit: -1, hitType: null };
      } else return { path, hit: sq, hitType: p.type };
    }
    throw new Error('Laser exceeded 512 steps');
  }
  makeMove(move: number): void {
    this.history.push({ board: this.board.slice(), side: this.side, result: this.result, ply: this.ply });
    const from = move & 127, to = (move >>> 7) & 127, kind = move >>> 14;
    const p = this.board[from];
    if (!p) throw new Error('Move has no piece');
    if (kind <= 1) { this.board[from] = this.board[to]; this.board[to] = p; }
    else this.board[from] = { ...p, o: p.type === SCARAB ? p.o ^ 1 : (p.o + (kind === 2 ? 1 : 3)) & 3 };
    const shot = this.traceLaser(this.side);
    if (shot.hit >= 0) {
      const victim = this.board[shot.hit]!;
      this.board[shot.hit] = null;
      if (victim.type === PHARAOH) this.result = victim.color ^ 1;
    }
    this.side ^= 1; this.ply++;
  }
  unmakeMove(): void {
    const previous = this.history.pop();
    if (!previous) throw new Error('Empty undo stack');
    this.board = previous.board; this.side = previous.side; this.result = previous.result; this.ply = previous.ply;
  }
}

function parseSetup(rows: string[]): Piece[] {
  return rows.flatMap(line => line.trim().split(/\s+/).map(token => {
    const [sq, code] = token.split(':');
    const color = code[0] === 's' ? SILVER : RED;
    const type = letters.indexOf(code[1]);
    return { row: Math.floor(Number(sq) / 10), col: Number(sq) % 10, color, type, o: Number(code[2] ?? 0) };
  }));
}

export const SETUPS = {
  classic: parseSetup([
    '0:rS2 4:rA2 5:rF0 6:rA2 7:rP1 12:rP2 23:sP3',
    '30:rP0 32:sP2 34:rC1 35:rC0 37:rP1 39:sP3',
    '40:rP1 42:sP3 44:sC0 45:sC1 47:rP0 49:sP2',
    '56:rP1 67:sP0 72:sP3 73:sA0 74:sF0 75:sA0 79:sS0',
  ]),
  imhotep: parseSetup([
    '0:rS2 4:rA2 5:rF0 6:rA2 7:rC0 23:sP3 26:rP0',
    '30:rP0 31:sP2 34:sP1 35:rC0 38:rP1 39:sP3',
    '40:rP1 41:sP3 44:sC0 45:rP3 48:rP0 49:sP2',
    '53:sP2 56:rP1 72:sC0 73:sA0 74:sF0 75:sA0 79:sS0',
  ]),
  dynasty: parseSetup([
    '0:rS2 4:rP2 5:rA2 6:rP1 15:rF0 20:rP0 24:rP2 25:rA2 26:rC0',
    '30:rP1 32:rC1 34:sP3 36:sP1 43:rP3 45:rP1 47:sC1 49:sP3',
    '53:sC0 54:sA0 55:sP0 59:sP2 64:sF0 73:sP3 74:sA0 75:sP0 79:sS0',
  ]),
};

export function fromPieces(pieces: Piece[], side = SILVER): Position {
  const pos = new Position(); pos.side = side;
  for (const p of pieces) pos.board[p.row * 10 + p.col] = { type: p.type, color: p.color, o: p.o };
  return pos;
}
export function newGame(name = 'classic'): Position {
  const pieces = SETUPS[name as keyof typeof SETUPS];
  if (!pieces) throw new Error(`Unknown setup ${name}`);
  return fromPieces(pieces);
}
function square(sq: number): string { return String.fromCharCode(97 + sq % 10) + (8 - Math.floor(sq / 10)); }
export function moveToString(move: number): string {
  const from = move & 127, to = (move >>> 7) & 127, kind = move >>> 14;
  return square(from) + (kind >= 2 ? (kind === 2 ? '+' : '-') : (kind === 1 ? 'x' : '-') + square(to));
}
export function legalMoves(pos: Position): string[] {
  const out: number[] = []; pos.generateMoves(out); return out.map(moveToString);
}
export function applyMove(pos: Position, text: string): Position {
  const out: number[] = []; pos.generateMoves(out);
  const move = out.find(m => moveToString(m) === text);
  if (move === undefined) throw new Error(`Illegal move ${text}`);
  const next = pos.clone(); next.makeMove(move); next.history.length = 0; return next;
}
export function toKFEN(pos: Position): string {
  const ranks: string[] = [];
  for (let row = 0; row < 8; row++) {
    let rank = '', empty = 0;
    for (let col = 0; col < 10; col++) {
      const p = pos.board[row * 10 + col];
      if (!p) { empty++; continue; }
      if (empty) { rank += empty; empty = 0; }
      const letter = letters[p.type];
      const o = p.type === PHARAOH ? '-' : p.type === PYRAMID ? String(p.o + 1) : p.type === SCARAB ? (p.o ? '\\' : '/') : 'nesw'[p.o];
      rank += (p.color === SILVER ? letter : letter.toLowerCase()) + o;
    }
    if (empty) rank += empty;
    ranks.push(rank);
  }
  return `${ranks.join('/')} ${pos.side === SILVER ? 's' : 'r'} ${pos.ply}`;
}
export function fromKFEN(text: string): Position {
  const [board, side, ply = '0'] = text.trim().split(/\s+/);
  if (!['s', 'r'].includes(side) || !/^\d+$/.test(ply)) throw new Error('Invalid KFEN side/ply');
  const pos = new Position(); pos.side = side === 's' ? SILVER : RED; pos.ply = Number(ply);
  // Scarab orientation '/' is part of a two-character piece token, never a rank separator.
  let row = 0, col = 0;
  for (let i = 0; i < board.length;) {
    const ch = board[i++];
    if (ch === '/') { if (col !== 10 || ++row > 7) throw new Error('Invalid KFEN rank'); col = 0; continue; }
    if (/\d/.test(ch)) {
      let digits = ch;
      while (i < board.length && /\d/.test(board[i])) digits += board[i++];
      const n = Number(digits); if (n < 1 || n > 10) throw new Error('Invalid KFEN empty run'); col += n;
    } else {
      const type = letters.indexOf(ch.toUpperCase()), orientation = board[i++];
      const o = type === PHARAOH ? (orientation === '-' ? 0 : -1) : type === PYRAMID ? '1234'.indexOf(orientation) : type === SCARAB ? '/\\'.indexOf(orientation) : 'nesw'.indexOf(orientation);
      if (type < 1 || o < 0 || col >= 10) throw new Error('Invalid KFEN piece');
      pos.board[row * 10 + col++] = { type, color: ch === ch.toUpperCase() ? SILVER : RED, o };
    }
    if (col > 10) throw new Error('Invalid KFEN width');
  }
  if (row !== 7 || col !== 10) throw new Error('Invalid KFEN board');
  if (pos.toPieces().filter(p => p.type === PHARAOH).length !== 2) throw new Error('KFEN requires two Pharaohs');
  return pos;
}

export const DEFAULT_EVAL_PARAMS: Params = { pyramid: 100, anubis: 120, shelter: 10, beam: 2, tempo: 5 };
export function evaluate(pos: Position, overrides: Params = {}): number {
  const p = { ...DEFAULT_EVAL_PARAMS, ...overrides };
  let score = 0;
  const pieces = pos.toPieces();
  for (const color of [SILVER, RED]) {
    const own = pieces.filter(piece => piece.color === color);
    const king = own.find(piece => piece.type === PHARAOH);
    const shelter = king ? own.filter(piece => piece !== king && Math.max(Math.abs(piece.row - king.row), Math.abs(piece.col - king.col)) <= 1).length : 0;
    const value = own.filter(piece => piece.type === PYRAMID).length * p.pyramid + own.filter(piece => piece.type === ANUBIS).length * p.anubis + shelter * p.shelter + pos.traceLaser(color).path.length * p.beam;
    score += color === pos.side ? value : -value;
  }
  return score + p.tempo;
}
