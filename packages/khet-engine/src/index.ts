export { SILVER, RED, N, E, S, W, PHARAOH, SPHINX, PYRAMID, SCARAB, ANUBIS, STEP, SWAP, ROT_CW, ROT_CCW, MAX_MOVES, encodeMove, encodePiece, opposite } from './types.ts';
export type { Color, Result, Piece, PlacedPiece, LaserResult, RootScore, SearchOptions, SearchResult } from './types.ts';
export { LEVELS, MAX_LEVEL, levelOptions } from './levels.ts';
export type { LevelDefinition } from './levels.ts';
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
import { MAX_MOVES, PHARAOH, pieceColor, pieceType } from './types.ts';
import { MATE, search } from './search.ts';
import { levelOptions } from './levels.ts';
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
export function bestMove(pos: Position, opts: SearchOptions = {}): SearchResult {
  if (opts.level === undefined) return search(pos, opts);
  const { noise, temperature = 0, blunderDepthCap: _cap, ...limits } = levelOptions(opts.level);
  const options: SearchOptions = { ...limits, ...opts, rootNoise: opts.rootNoise ?? noise };
  // Undefined values are not explicit limits.
  for (const key of ['depth', 'timeMs', 'nodes'] as const) options[key] = opts[key] ?? limits[key];
  if (temperature > 0) options.rootScores = true;
  const result = search(pos, options);
  if (!result.move) return result;
  const scores = result.rootScores ?? [];
  let choice = result.move;
  if (temperature > 0 && scores.length) {
    const max = Math.max(...scores.map(entry => entry.score));
    const weights = scores.map(entry => Math.exp((entry.score - max) / temperature));
    // Mulberry32: stable seeded sampling, including seed zero.
    const state = ((opts.seed ?? 1) + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), state | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    let target = (((x ^ (x >>> 14)) >>> 0) / 4294967296) * weights.reduce((a, b) => a + b, 0);
    choice = scores.at(-1)!.move;
    for (let i = 0; i < scores.length; i++) {
      target -= weights[i];
      if (target < 0) { choice = scores[i].move; break; }
    }
  }

  // Enforce guarantees after sampling, independently of the search budget.
  const copy = pos.clone(), moves = new Int32Array(MAX_MOVES), count = copy.generateMoves(moves);
  const wins: string[] = [], safe: string[] = [], defences: string[] = [];
  for (let i = 0; i < count; i++) {
    const move = moves[i], text = moveToString(move, copy), shot = copy.previewShot(move);
    const suicide = shot >= 0 && pieceType(shot >>> 7) === PHARAOH && pieceColor(shot >>> 7) === pos.side;
    copy.makeMove(move);
    try {
      if (copy.result === pos.side) wins.push(text);
      if (!suicide) {
        safe.push(text);
        if (opts.level >= 2 && (copy.result !== null || !copy.hasWinInOne(copy.side))) defences.push(text);
      }
    } finally { copy.unmakeMove(); }
  }
  const allowed = wins.length ? wins : opts.level >= 2 && defences.length ? defences : safe.length ? safe :
    Array.from(moves.subarray(0, count), move => moveToString(move, pos));
  if (!allowed.includes(choice)) {
    choice = allowed.includes(result.move) ? result.move : allowed.reduce((best, move) =>
      (scores.find(entry => entry.move === move)?.score ?? -Infinity) >
      (scores.find(entry => entry.move === best)?.score ?? -Infinity) ? move : best);
  }
  const score = wins.includes(choice) ? MATE - 1 : scores.find(entry => entry.move === choice)?.score;
  if (choice === result.move && (score === undefined || score === result.score)) return result;
  return { ...result, move: choice, score: score ?? result.score, pv: [choice] };
}
