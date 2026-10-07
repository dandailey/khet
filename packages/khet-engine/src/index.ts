export { SILVER, RED, N, E, S, W, PHARAOH, SPHINX, PYRAMID, SCARAB, ANUBIS, STEP, SWAP, ROT_CW, ROT_CCW, MAX_MOVES, encodeMove, encodePiece, opposite } from './types.ts';
export type { Color, Result, Piece, PlacedPiece, LaserResult, SearchOptions, SearchResult } from './types.ts';
export { SETUPS } from './setups.ts';
export { Position, newGame, fromPieces } from './position.ts';
export { moveToString, parseMove, toKFEN, fromKFEN } from './notation.ts';
export { recomputeHash } from './zobrist.ts';
export { traceLaserFast } from './laser.ts';
export { BEAM_NEXT, NEIGHBOURS, RESERVED } from './geometry.ts';
export { EvalParams, PARAM_NAMES, DEFAULT_PARAMS, DEFAULT_EVAL_PARAMS, evaluate, evaluationFeatures } from './eval.ts';
export { search, TranspositionTable, MATE } from './search.ts';
import { Position } from './position.ts';
import { moveToString, parseMove } from './notation.ts';
import { MAX_MOVES } from './types.ts';
import { search } from './search.ts';
import type { Color, LaserResult, SearchOptions, SearchResult } from './types.ts';
export function legalMoves(pos: Position): string[] {
  const moves = new Int32Array(MAX_MOVES), count = pos.generateMoves(moves), result: string[] = [];
  for (let i = 0; i < count; i++) result.push(moveToString(moves[i], pos));
  return result;
}
export function applyMove(pos: Position, moveStr: string): Position {
  const next = pos.clone(); next.makeMove(parseMove(moveStr, next)); return next;
}
export function laserResult(pos: Position, color: Color): LaserResult { return pos.traceLaser(color); }
export function bestMove(pos: Position, opts: SearchOptions = {}): SearchResult { return search(pos, opts); }
