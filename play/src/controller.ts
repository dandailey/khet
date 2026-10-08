import {
  BEAM_NEXT, ROT_CW, ROT_CCW, SCARAB, SPHINX, STEP, SWAP,
  fromKFEN, fromPieces, legalMoves, newGame, parseMove, toKFEN,
} from '../../packages/khet-engine/src/index.ts';
import type { Color, LaserResult, Piece, PlacedPiece, Position } from '../../packages/khet-engine/src/index.ts';

export type HumanSide = Color | 'watch';
export interface MoveEntry { move: string; color: Color }
export interface Shot {
  pieces: PlacedPiece[];
  laser: LaserResult;
  destroyed: Piece | null;
  color: Color;
}
export function squareName(sq: number): string {
  return String.fromCharCode(97 + sq % 10) + (8 - Math.floor(sq / 10));
}
export function moveSquares(move: string): { from: number; to: number } {
  const sq = (text: string) => (8 - Number(text[1])) * 10 + text.charCodeAt(0) - 97;
  return { from: sq(move), to: move.length === 3 ? sq(move) : sq(move.slice(3)) };
}

/** Apply only the action: staging must never trace a laser or remove a victim. */
function previewAction(position: Position, move: number): Position {
  const from = move & 127, to = (move >> 7) & 127, kind = move >> 14;
  const pieces = position.toPieces();
  const mover = pieces.find(p => p.row * 10 + p.col === from)!;
  if (kind === STEP || kind === SWAP) {
    const target = pieces.find(p => p.row * 10 + p.col === to);
    mover.row = Math.floor(to / 10); mover.col = to % 10;
    if (target) { target.row = Math.floor(from / 10); target.col = from % 10; }
  } else {
    let orientation = (mover.o + (kind === ROT_CCW ? 3 : 1)) & 3;
    if (mover.type === SCARAB) orientation = mover.o ^ 1;
    if (mover.type === SPHINX && kind === ROT_CW && BEAM_NEXT[from * 4 + orientation] < 0) {
      orientation = (mover.o + 3) & 3;
    }
    mover.o = orientation;
  }
  return fromPieces(pieces, position.side);
}

export function rotationMove(position: Position, square: number, clockwise: boolean): string | undefined {
  const piece = position.pieceAt(square);
  if (!piece) return undefined;
  const facing = piece.type === SCARAB ? piece.o ^ 1 : (piece.o + (clockwise ? 1 : 3)) & 3;
  return legalMoves(position).find(move => move.length === 3 && moveSquares(move).from === square &&
    previewAction(position, parseMove(move, position)).pieceAt(square)?.o === facing);
}

export class GameController {
  position: Position;
  human: HumanSide;
  level: number;
  history: MoveEntry[] = [];
  shot: Shot | null = null;
  stagedMove: string | null = null;
  private initialKFEN: string;

  constructor(setup = 'classic', human: HumanSide = 0, level = 3) {
    this.position = newGame(setup);
    this.human = human; this.level = level;
    this.initialKFEN = toKFEN(this.position);
  }
  get humanTurn(): boolean {
    return !this.shot && this.position.result === null && this.position.side === this.human;
  }
  get aiTurn(): boolean {
    return !this.shot && this.position.result === null && !this.humanTurn;
  }
  get moves(): string[] { return legalMoves(this.position); }
  get stagedPieces(): PlacedPiece[] | null {
    return this.stagedMove === null ? null
      : previewAction(this.position, parseMove(this.stagedMove, this.position)).toPieces();
  }
  stage(move: string): void {
    if (!this.humanTurn) throw new Error('Wait for your turn');
    parseMove(move, this.position); // Validate before replacing the pending action.
    this.stagedMove = move;
  }
  clearStage(): void { this.stagedMove = null; }
  confirm(): Shot {
    if (this.stagedMove === null) throw new Error('Choose a move before firing');
    if (!this.humanTurn) throw new Error('Wait for your turn');
    return this.play(this.stagedMove);
  }
  play(move: string): Shot {
    if (this.shot) throw new Error('Wait for the laser');
    const encoded = parseMove(move, this.position);
    const preview = previewAction(this.position, encoded);
    const color = this.position.side;
    const laser = preview.traceLaser(color);
    this.shot = { pieces: preview.toPieces(), laser, color,
      destroyed: laser.hit >= 0 ? preview.pieceAt(laser.hit) : null };
    this.position.makeMove(encoded);
    this.history.push({ move, color });
    this.clearStage();
    return this.shot;
  }
  finishShot(): void { this.shot = null; }
  get undoCount(): number {
    if (this.human === 'watch') return Math.min(2, this.history.length);
    let lastHuman = this.history.length - 1;
    while (lastHuman >= 0 && this.history[lastHuman].color !== this.human) lastHuman--;
    return lastHuman < 0 ? 0 : this.history.length - lastHuman;
  }
  undo(): void {
    const count = this.undoCount;
    this.clearStage();
    this.finishShot();
    for (let i = 0; i < count; i++) { this.position.unmakeMove(); this.history.pop(); }
  }
  load(kfen: string): void {
    const position = fromKFEN(kfen); // Validate before changing the active game.
    this.position = position; this.initialKFEN = toKFEN(position);
    this.history = []; this.shot = null; this.clearStage();
  }
  positionCommand(): string {
    return `position kfen ${this.initialKFEN}${this.history.length ? ' moves ' + this.history.map(entry => entry.move).join(' ') : ''}`;
  }
  goCommand(hint = false): string {
    const level = hint ? 7 : Math.max(1, Math.min(10, this.level));
    return `go level ${level}`;
  }
}
