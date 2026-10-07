import { access } from 'node:fs/promises';
import { random } from './random.ts';

export type Params = Record<string, number>;
export interface Piece { type: number; color: number; o: number; row: number; col: number }
export interface Position {
  side: number;
  result: number | 'draw' | null;
  ply: number;
  generateMoves(out: number[]): number;
  makeMove(move: number): void;
  unmakeMove(): void;
  clone(): Position;
  key(): string;
  toPieces(): Piece[];
  traceLaser(color: number): { path: number[]; hit: number; hitType: number | null };
  hasWinInOne?(color: number): boolean;
}
export interface SearchOptions {
  level?: number;
  depth?: number; timeMs?: number; nodes?: number; seed?: number; params?: Params;
  [name: string]: unknown;
}
export interface SearchResult { move: string; score: number; depth: number; nodes: number; pv: string[] }
export interface Engine {
  SILVER: number; RED: number; PHARAOH: number; PYRAMID: number; ANUBIS: number;
  SETUPS: Record<string, unknown>;
  newGame(setup?: string): Position;
  fromPieces(pieces: Piece[], side: number): Position;
  toKFEN(pos: Position): string;
  fromKFEN(text: string): Position;
  legalMoves(pos: Position): string[];
  applyMove(pos: Position, move: string): Position;
  bestMove?: (pos: Position, opts: SearchOptions) => SearchResult;
  evaluate?(pos: Position, params?: Params): number;
  DEFAULT_EVAL_PARAMS?: Params;
  fixture?: boolean;
}

let loaded: Promise<Engine> | undefined;
export function getEngine(): Promise<Engine> {
  return loaded ??= (async () => {
    const url = new URL('../../packages/khet-engine/src/index.ts', import.meta.url);
    try { await access(url); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return await import('./stub-engine.ts');
    }
    // Dynamic URL deliberately permits working before the engine package exists.
    return await import(url.href) as Engine;
  })();
}

export function hasWinInOne(pos: Position, color: number, engine: Engine): boolean {
  if (pos.hasWinInOne) return pos.hasWinInOne(color);
  // Reconstruct to preserve a real engine's Zobrist side bit and repetition state.
  const copy = engine.fromPieces(pos.toPieces(), color);
  const moves: number[] = [];
  copy.generateMoves(moves);
  for (const move of moves) {
    copy.makeMove(move);
    const wins = copy.result === color;
    copy.unmakeMove();
    if (wins) return true;
  }
  return false;
}

export function quiet(pos: Position, engine: Engine): boolean {
  if (pos.result !== null || hasWinInOne(pos, pos.side === engine.SILVER ? engine.RED : engine.SILVER, engine)) return false;
  const moves: number[] = [];
  pos.generateMoves(moves);
  const count = pos.toPieces().filter(p => p.color !== pos.side).length;
  for (const move of moves) {
    pos.makeMove(move);
    const kill = pos.toPieces().filter(p => p.color === pos.side).length < count;
    pos.unmakeMove();
    if (kill) return false;
  }
  return true;
}

export function stubMove(engine: Engine, pos: Position, opts: SearchOptions, kind: 'random' | 'greedy'): SearchResult {
  const moves = engine.legalMoves(pos);
  if (!moves.length) throw new Error('Player called on a position with no moves');
  let nodes = 0;
  if (kind === 'greedy') {
    for (const move of moves) {
      nodes++;
      if (engine.applyMove(pos, move).result === pos.side) return { move, score: 100000, depth: 1, nodes, pv: [move] };
    }
  }
  const move = moves[Math.floor(random(opts.seed ?? 1)() * moves.length)];
  return { move, score: 0, depth: 0, nodes: nodes + 1, pv: [move] };
}
