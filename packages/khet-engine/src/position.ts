import { BEAM_NEXT, NEIGHBOURS, permitted } from './geometry.ts';
import { traceLaserFast } from './laser.ts';
import { SETUPS } from './setups.ts';
import { SIDE_HI, SIDE_LO, ZOBRIST_HI, ZOBRIST_LO, recomputeHash } from './zobrist.ts';
import { ANUBIS, MAX_MOVES, PHARAOH, PYRAMID, RED, ROT_CCW, ROT_CW, SCARAB, SILVER, SPHINX, STEP, SWAP, encodeMove, encodePiece, orientation, pieceColor, pieceType } from './types.ts';
import type { Color, LaserResult, Piece, PlacedPiece, Result } from './types.ts';

const UNDO_WIDTH = 9;
export class Position {
  readonly board = new Int8Array(80);
  readonly hash = new Uint32Array(2);
  side: Color;
  result: Result = null;
  ply = 0;
  private readonly sphinx = new Int16Array(2).fill(-1);
  private readonly moves = new Int32Array(MAX_MOVES);
  private readonly beamMoves = new Int32Array(MAX_MOVES);
  private readonly beamMask = new Uint8Array(80);
  private undo: Int32Array;
  private historyLo: Uint32Array;
  private historyHi: Uint32Array;
  private undoCount = 0;

  constructor(pieces: readonly PlacedPiece[], sideToMove: Color = SILVER, capacity = 1024) {
    if (sideToMove !== SILVER && sideToMove !== RED) throw new Error('Invalid side to move');
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid history capacity');
    this.side = sideToMove;
    this.undo = new Int32Array(capacity * UNDO_WIDTH);
    this.historyLo = new Uint32Array(capacity + 1);
    this.historyHi = new Uint32Array(capacity + 1);
    for (const p of pieces) {
      if (!Number.isInteger(p.row) || !Number.isInteger(p.col) || p.row < 0 || p.row > 7 || p.col < 0 || p.col > 9 ||
          !Number.isInteger(p.type) || p.type < PHARAOH || p.type > ANUBIS || (p.color !== SILVER && p.color !== RED) ||
          !Number.isInteger(p.o) || p.o < 0 || p.o > (p.type === SCARAB ? 1 : p.type === PHARAOH ? 0 : 3)) {
        throw new Error('Invalid piece');
      }
      const sq = p.row * 10 + p.col;
      if (this.board[sq]) throw new Error('Duplicate square');
      if (!permitted(sq, p.color)) throw new Error('Piece on opposing reserved square');
      if (p.type === SPHINX) {
        if (this.sphinx[p.color] >= 0) throw new Error('Duplicate Sphinx');
        if (BEAM_NEXT[sq * 4 + p.o] < 0) throw new Error('Sphinx faces off board');
        this.sphinx[p.color] = sq;
      }
      this.board[sq] = encodePiece(p.type, p.color, p.o);
    }
    recomputeHash(this.board, this.side, this.hash);
    this.historyLo[0] = this.hash[0]; this.historyHi[0] = this.hash[1];
  }

  /** Reserve outside search/game hot paths. makeMove never grows or allocates history. */
  reserveHistory(capacity: number): void {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Invalid history capacity');
    if (capacity < this.historyLo.length) return;
    const undo = new Int32Array(capacity * UNDO_WIDTH);
    const lo = new Uint32Array(capacity + 1), hi = new Uint32Array(capacity + 1);
    undo.set(this.undo); lo.set(this.historyLo); hi.set(this.historyHi);
    this.undo = undo; this.historyLo = lo; this.historyHi = hi;
  }

  private rotated(p: number, sq: number, kind: number): number {
    const type = pieceType(p), o = orientation(p);
    if (type === SCARAB) return o ^ 1;
    let next = (o + (kind === ROT_CW ? 1 : 3)) & 3;
    // A lone legal Sphinx rotation is always encoded as ROT_CW, including a CCW turn.
    if (type === SPHINX && kind === ROT_CW && BEAM_NEXT[sq * 4 + next] < 0) next = (o + 3) & 3;
    return next;
  }

  generateMoves(out: Int32Array | number[] = this.moves): number {
    if (this.result !== null) return 0;
    let count = 0;
    for (let from = 0; from < 80; from++) {
      const p = this.board[from];
      if (!p || pieceColor(p) !== this.side) continue;
      const type = pieceType(p), o = orientation(p);
      if (type !== SPHINX) {
        for (let d = 0; d < 8; d++) {
          const to = NEIGHBOURS[from * 8 + d];
          if (to < 0 || !permitted(to, this.side)) continue;
          const target = this.board[to], targetType = pieceType(target);
          if (!target) out[count++] = encodeMove(from, to, STEP);
          else if (type === SCARAB && (targetType === PYRAMID || targetType === ANUBIS) && permitted(from, pieceColor(target))) {
            out[count++] = encodeMove(from, to, SWAP);
          }
        }
      }
      if (type === PHARAOH) continue;
      if (type === SPHINX) {
        const cw = BEAM_NEXT[from * 4 + ((o + 1) & 3)] >= 0;
        const ccw = BEAM_NEXT[from * 4 + ((o + 3) & 3)] >= 0;
        if (cw || ccw) out[count++] = encodeMove(from, from, ROT_CW);
        if (cw && ccw) out[count++] = encodeMove(from, from, ROT_CCW);
      } else {
        out[count++] = encodeMove(from, from, ROT_CW);
        if (type !== SCARAB) out[count++] = encodeMove(from, from, ROT_CCW);
      }
    }
    if (out instanceof Int32Array && count > out.length) throw new Error('Move buffer too small');
    return count;
  }

  /** Generate for either color without touching hashes or repetition history. */
  generateMovesFor(color: Color, out: Int32Array | number[]): number {
    if (color !== SILVER && color !== RED) throw new Error('Invalid mover color');
    const side = this.side;
    try { this.side = color; return this.generateMoves(out); }
    finally { this.side = side; }
  }

  generateBeamMoves(color: Color, out: Int32Array | number[] = this.moves): number {
    const count = this.generateMovesFor(color, this.beamMoves);
    this.beamMask.fill(0);
    for (const sq of this.traceLaser(color).path) this.beamMask[sq] = 1;
    let n = 0;
    for (let i = 0; i < count; i++) {
      const move = this.beamMoves[i];
      if (this.beamMask[move & 127] || this.beamMask[(move >>> 7) & 127]) out[n++] = move;
    }
    if (out instanceof Int32Array && n > out.length) throw new Error('Move buffer too small');
    return n;
  }

  /** Fast action + shot preview for a generated move. -1 means no destruction;
   * otherwise low 7 bits are the hit square and upper bits the packed victim.
   * Restores the board even if tracing throws; does not fire or advance history. */
  previewShot(move: number, color: Color = this.side): number {
    const from = move & 127, to = (move >>> 7) & 127, kind = move >>> 14;
    const p = this.board[from], target = this.board[to];
    try {
      if (kind === STEP || kind === SWAP) {
        this.board[from] = kind === SWAP ? target : 0; this.board[to] = p;
      } else this.board[from] = (p & 15) | (this.rotated(p, from, kind) << 4);
      const hit = traceLaserFast(this.board, this.sphinx[color]);
      return hit < 0 ? -1 : hit | (this.board[hit] << 7);
    } finally { this.board[from] = p; this.board[to] = target; }
  }

  /** Include unchanged shots when the base shot already destroys an enemy. */
  generateTacticalMoves(color: Color, out: Int32Array | number[]): number {
    const hit = traceLaserFast(this.board, this.sphinx[color]);
    return hit >= 0 && pieceColor(this.board[hit]) !== color
      ? this.generateMovesFor(color, out) : this.generateBeamMoves(color, out);
  }

  findWinInOne(color: Color): number {
    const count = this.generateTacticalMoves(color, this.moves);
    for (let i = 0; i < count; i++) {
      const shot = this.previewShot(this.moves[i], color), victim = shot >>> 7;
      if (shot >= 0 && pieceType(victim) === PHARAOH && pieceColor(victim) !== color) return this.moves[i];
    }
    return -1;
  }
  hasWinInOne(color: Color): boolean { return this.findWinInOne(color) >= 0; }

  private isLegal(move: number): boolean {
    if (!Number.isInteger(move) || move < 0 || move > 65535 || this.result !== null) return false;
    const from = move & 127, to = (move >> 7) & 127, kind = move >> 14;
    if (from >= 80 || to >= 80) return false;
    const p = this.board[from];
    if (!p || pieceColor(p) !== this.side) return false;
    const type = pieceType(p);
    if (kind >= ROT_CW) {
      if (to !== from || type === PHARAOH || (type === SCARAB && kind === ROT_CCW)) return false;
      if (type !== SPHINX) return true;
      const o = orientation(p);
      if (kind === ROT_CCW && BEAM_NEXT[from * 4 + ((o + 1) & 3)] < 0) return false;
      return BEAM_NEXT[from * 4 + this.rotated(p, from, kind)] >= 0;
    }
    if (type === SPHINX || !permitted(to, this.side)) return false;
    let adjacent = false;
    for (let d = 0; d < 8; d++) if (NEIGHBOURS[from * 8 + d] === to) adjacent = true;
    if (!adjacent) return false;
    const target = this.board[to], targetType = pieceType(target);
    if (kind === STEP) return target === 0;
    return type === SCARAB && (targetType === PYRAMID || targetType === ANUBIS) && permitted(from, pieceColor(target));
  }

  private setSquare(sq: number, p: number): void {
    const old = this.board[sq];
    let lo = this.hash[0], hi = this.hash[1];
    if (old) { lo ^= ZOBRIST_LO[sq * 64 + old]; hi ^= ZOBRIST_HI[sq * 64 + old]; }
    if (p) { lo ^= ZOBRIST_LO[sq * 64 + p]; hi ^= ZOBRIST_HI[sq * 64 + p]; }
    this.board[sq] = p; this.hash[0] = lo >>> 0; this.hash[1] = hi >>> 0;
  }

  makeMove(move: number): void {
    if (!this.isLegal(move)) throw new Error('Illegal move');
    if (this.undoCount + 1 >= this.historyLo.length) throw new Error('Undo capacity exceeded; call reserveHistory before play');
    const from = move & 127, to = (move >> 7) & 127, kind = move >> 14;
    const p = this.board[from], target = this.board[to], u = this.undoCount * UNDO_WIDTH;
    this.undo[u] = move; this.undo[u + 1] = p; this.undo[u + 2] = target;
    this.undo[u + 5] = this.result === null ? -1 : this.result === 'draw' ? 2 : this.result;
    this.undo[u + 6] = this.ply; this.undo[u + 7] = this.hash[0]; this.undo[u + 8] = this.hash[1];
    if (kind === STEP || kind === SWAP) {
      this.setSquare(from, kind === SWAP ? target : 0); this.setSquare(to, p);
    } else this.setSquare(from, (p & 15) | (this.rotated(p, from, kind) << 4));
    const hit = traceLaserFast(this.board, this.sphinx[this.side]);
    this.undo[u + 3] = hit; this.undo[u + 4] = hit < 0 ? 0 : this.board[hit];
    if (hit >= 0) {
      const destroyed = this.board[hit];
      if (pieceType(destroyed) === PHARAOH) this.result = (pieceColor(destroyed) ^ 1) as Color;
      this.setSquare(hit, 0);
    }
    this.side = (this.side ^ 1) as Color; this.ply++;
    this.hash[0] = (this.hash[0] ^ SIDE_LO) >>> 0; this.hash[1] = (this.hash[1] ^ SIDE_HI) >>> 0;
    this.undoCount++;
    this.historyLo[this.undoCount] = this.hash[0]; this.historyHi[this.undoCount] = this.hash[1];
    if (this.result === null) {
      let repetitions = 1;
      for (let i = this.undoCount - 2; i >= 0; i -= 2) {
        if (this.historyLo[i] === this.hash[0] && this.historyHi[i] === this.hash[1] && ++repetitions === 3) {
          this.result = 'draw'; break;
        }
      }
    }
  }

  unmakeMove(): void {
    if (this.undoCount === 0) throw new Error('No move to unmake');
    const u = --this.undoCount * UNDO_WIDTH, move = this.undo[u];
    const from = move & 127, to = (move >> 7) & 127, hit = this.undo[u + 3];
    if (hit >= 0) this.board[hit] = this.undo[u + 4];
    this.board[from] = this.undo[u + 1]; this.board[to] = this.undo[u + 2];
    const result = this.undo[u + 5];
    this.result = result === -1 ? null : result === 2 ? 'draw' : result as Color;
    this.ply = this.undo[u + 6]; this.side = (this.side ^ 1) as Color;
    this.hash[0] = this.undo[u + 7] >>> 0; this.hash[1] = this.undo[u + 8] >>> 0;
  }

  traceLaser(color: Color): LaserResult {
    if (color !== SILVER && color !== RED) throw new Error('Invalid laser color');
    const path: number[] = [], hit = traceLaserFast(this.board, this.sphinx[color], path);
    return { path, hit, hitType: hit < 0 ? null : pieceType(this.board[hit]) };
  }
  pieceAt(sq: number): Piece | null {
    if (!Number.isInteger(sq) || sq < 0 || sq >= 80) throw new Error('Invalid square');
    const p = this.board[sq];
    return p ? { type: pieceType(p), color: pieceColor(p), o: orientation(p) } : null;
  }
  toPieces(): PlacedPiece[] {
    const pieces: PlacedPiece[] = [];
    for (let sq = 0; sq < 80; sq++) {
      const p = this.board[sq];
      if (p) pieces.push({ type: pieceType(p), color: pieceColor(p), o: orientation(p), row: Math.floor(sq / 10), col: sq % 10 });
    }
    return pieces;
  }
  clone(): Position {
    const pos = new Position(this.toPieces(), this.side, this.historyLo.length - 1);
    pos.result = this.result; pos.ply = this.ply; pos.undoCount = this.undoCount;
    pos.undo.set(this.undo); pos.historyLo.set(this.historyLo); pos.historyHi.set(this.historyHi);
    return pos;
  }
  /** Board and side only: deliberately excludes ply, result and repetition history. */
  key(): string {
    let key = String(this.side) + ':';
    for (let sq = 0; sq < 80; sq++) key += this.board[sq].toString(16).padStart(2, '0');
    return key;
  }
}
export function fromPieces(pieces: readonly PlacedPiece[], sideToMove: Color = SILVER): Position {
  return new Position(pieces, sideToMove);
}
export function newGame(setupName = 'classic'): Position {
  const pieces = (SETUPS as Record<string, readonly PlacedPiece[]>)[setupName];
  if (!Object.hasOwn(SETUPS, setupName) || !pieces) throw new Error(`Unknown setup: ${setupName}`);
  return fromPieces(pieces, SILVER);
}
