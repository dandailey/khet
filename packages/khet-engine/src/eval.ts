import { BEAM_NEXT, NEIGHBOURS, permitted } from './geometry.ts';
import { reflectedDirection } from './laser.ts';
import { fromPieces } from './position.ts';
import type { Position } from './position.ts';
import { ANUBIS, MAX_MOVES, PHARAOH, PYRAMID, SCARAB, SILVER, SPHINX, orientation, pieceColor, pieceType } from './types.ts';
import type { Color } from './types.ts';

const BASE_NAMES = [
  'pyramid', 'anubis', 'exposureLine', 'exposureReach', 'exposureOpen',
  'shelterBlocker', 'shelterShield', 'backRank', 'hangingPyramid', 'hangingAnubis',
  'hangingPharaoh', 'beamLength', 'beamNearKing', 'beamAdjacent', 'pyramidMobility',
  'scarabMobility', 'tempo',
] as const;
// Tables use each color's own coordinates: Silver's home rank is row 7.
export const PARAM_NAMES: readonly string[] = Object.freeze([
  ...BASE_NAMES,
  ...[PHARAOH, SPHINX, PYRAMID, SCARAB, ANUBIS].flatMap(type =>
    Array.from({ length: 80 }, (_, sq) => `pst${type}_${sq}`)),
]);
const INDEX = new Map(PARAM_NAMES.map((name, i) => [name, i]));
const INITIAL = new Float64Array(PARAM_NAMES.length);
INITIAL.set([100, 120, -100, -4, -1, 8, 16, 10, -45, -55, -400, 1, 3, 2, 2, 3, 5]);

/** Named, flat vector. values is directly usable by SPSA/Texel optimizers. */
export class EvalParams {
  readonly values: Float64Array;
  constructor(source?: EvalParams | ArrayLike<number> | Record<string, number>) {
    this.values = INITIAL.slice();
    if (source instanceof EvalParams) this.values.set(source.values);
    else if (source && 'length' in source) {
      const vector = source as ArrayLike<number>;
      if (vector.length !== PARAM_NAMES.length) throw new Error('Invalid parameter vector length');
      this.values.set(vector);
    } else if (source) for (const [name, value] of Object.entries(source)) this.set(name, value);
    if (!this.values.every(Number.isFinite)) throw new Error('Parameters must be finite');
  }
  get(name: string): number { return this.values[this.index(name)]; }
  set(name: string, value: number): void {
    if (!Number.isFinite(value)) throw new Error('Parameters must be finite');
    this.values[this.index(name)] = value;
  }
  private index(name: string): number {
    const index = INDEX.get(name);
    if (index === undefined) throw new Error(`Unknown EvalParams name: ${name}`);
    return index;
  }
  toJSON(): Record<string, number> { return Object.fromEntries(PARAM_NAMES.map((name, i) => [name, this.values[i]])); }
}
export const DEFAULT_PARAMS = new EvalParams();
// Named serialization for the existing headless tuning tools.
export const DEFAULT_EVAL_PARAMS = Object.freeze(DEFAULT_PARAMS.toJSON());

/** Synchronous evaluation scratch: allocated once, never retained in a result. */
class EvalWorkspace {
  readonly features = new Float64Array(PARAM_NAMES.length);
  readonly moves = [new Int32Array(MAX_MOVES), new Int32Array(MAX_MOVES)];
  readonly masks = [new Uint8Array(80), new Uint8Array(80)];
  readonly paths = [new Int16Array(514), new Int16Array(514)];
  readonly shots = new Int32Array(2);
  readonly counts = new Int32Array(2);
  readonly kings = new Int16Array(2);
  readonly reachable = [new Uint8Array(80), new Uint8Array(80)];
  readonly hanging = new Uint8Array(80);
  readonly adjacent = new Uint8Array(80);
  readonly seen = new Uint8Array(320);
}
const EVAL_WORKSPACE = new EvalWorkspace();

/** Fill reusable scratch; evaluation never exposes this buffer to callers. */
function fillEvaluationFeatures(position: Position, hangingPieces: boolean, workspace: EvalWorkspace, preparedHanging?: ArrayLike<number>): Float64Array {
  // Static evaluation is a board + side function, independent of adjudication
  // and history. Terminal/draw scores belong to search. Reconstruct only ended
  // positions so their move-derived features still obey color symmetry.
  const pos = position.result === null ? position : fromPieces(position.toPieces(), position.side);
  const f = workspace.features; f.fill(0);
  const board = pos.board, kings = workspace.kings; kings.fill(-1);
  for (let c: Color = 0; c < 2; c++) {
    workspace.shots[c] = pos.traceLaserInto(c as Color, workspace.paths[c], workspace.masks[c]);
    if (hangingPieces && !preparedHanging) workspace.counts[c] = pos.generateBeamMoves(c as Color, workspace.moves[c], workspace.masks[c]);
  }
  const needMoves = hangingPieces && !preparedHanging;
  workspace.reachable[0].fill(0); workspace.reachable[1].fill(0);
  // Share a single piece pass for kings, material, PSTs, reachability and
  // mirror mobility rather than scanning the board separately per feature.
  for (let from = 0; from < 80; from++) {
    const p = board[from];
    if (!p) continue;
    const color = pieceColor(p), type = pieceType(p), sign = color === pos.side ? 1 : -1;
    if (type === PHARAOH) kings[color] = from;
    if (type === PYRAMID) f[0] += sign;
    if (type === ANUBIS) f[1] += sign;
    const canonical = color === SILVER ? from : 79 - from;
    f[BASE_NAMES.length + (type - 1) * 80 + canonical] += sign;
    if (type === SPHINX) continue;
    const mask = workspace.masks[color], reachable = workspace.reachable[color];
    const mobile = !needMoves && (type === PYRAMID || type === SCARAB), feature = type === PYRAMID ? 14 : 15;
    if (mobile && mask[from]) f[feature] += sign * (type === PYRAMID ? 2 : 1);
    for (let d = 0; d < 8; d++) {
      const to = NEIGHBOURS[from * 8 + d];
      if (to < 0 || !permitted(to, color)) continue;
      const target = board[to], targetType = pieceType(target);
      if (!target) reachable[to] = 1;
      if (mobile && mask[to] && (!target || (type === SCARAB && (targetType === PYRAMID || targetType === ANUBIS) && permitted(from, pieceColor(target))))) f[feature] += sign;
    }
  }
  for (let color: Color = 0; color < 2; color++) {
    const sign = color === pos.side ? 1 : -1, enemy = (color ^ 1) as Color;
    const king = kings[color], enemyKing = kings[enemy];
    const ownPath = workspace.paths[color], pathLength = ownPath[0], mask = workspace.masks[color], enemyMask = workspace.masks[enemy];
    const reachable = workspace.reachable[enemy];
    if (king >= 0) {
      // Reverse rays follow the same reversible mirror geometry as the laser.
      for (let direction = 0; direction < 4; direction++) {
        let sq = king, t = direction, line = false;
        const seen = workspace.seen; seen.fill(0);
        for (let step = 0; step < 320; step++) {
          sq = BEAM_NEXT[sq * 4 + t];
          if (sq < 0 || seen[sq * 4 + t]) break;
          seen[sq * 4 + t] = 1;
          const p = board[sq];
          if (!p) {
            f[4] += sign; f[3] += sign * reachable[sq];
            if (enemyMask[sq]) line = true;
            continue;
          }
          if (pieceType(p) === SPHINX && pieceColor(p) === enemy && orientation(p) === ((t + 2) & 3)) line = true;
          t = reflectedDirection(p, t);
          if (t < 0) break;
        }
        if (line) f[2] += sign;
      }
      for (let d = 0; d < 8; d++) {
        const sq = NEIGHBOURS[king * 8 + d];
        if (sq < 0 || !board[sq] || pieceColor(board[sq]) !== color) continue;
        f[5] += sign;
        if (pieceType(board[sq]) === ANUBIS && d % 2 === 0 && orientation(board[sq]) === d / 2) f[6] += sign;
      }
      if (Math.floor(king / 10) === (color === SILVER ? 7 : 0)) f[7] += sign;
    }
    if (hangingPieces && !preparedHanging) {
      const hanging = workspace.hanging; hanging.fill(0);
      const base = workspace.shots[enemy];
      if (base >= 0 && pieceColor(base >>> 7) === color && pos.findUnchangedMove(enemy, enemyMask) >= 0) {
        const sq = base & 127, type = pieceType(base >>> 7);
        hanging[sq] = 1;
        if (type === PYRAMID) f[8] += sign;
        if (type === ANUBIS) f[9] += sign;
        if (type === PHARAOH) f[10] += sign;
      }
      const moves = workspace.moves[enemy], count = workspace.counts[enemy];
      for (let i = 0; i < count; i++) {
        const move = moves[i], shot = pos.previewShot(move, enemy), p = shot >>> 7;
        const hit = shot & 127;
        // Preserve the original identity of a victim moved by a Scarab swap.
        const sq = (move >>> 14) === 1 && hit === (move & 127) ? (move >>> 7) & 127 : hit;
        if (shot < 0 || pieceColor(p) !== color || hanging[sq]) continue;
        hanging[sq] = 1;
        const type = pieceType(p);
        if (type === PYRAMID) f[8] += sign;
        if (type === ANUBIS) f[9] += sign;
        if (type === PHARAOH) f[10] += sign;
      }
    }
    f[11] += sign * pathLength;
    if (enemyKing >= 0 && pathLength) {
      const end = ownPath[pathLength];
      const distance = Math.abs(Math.floor(end / 10) - Math.floor(enemyKing / 10)) + Math.abs(end % 10 - enemyKing % 10);
      f[12] += sign * Math.max(0, 8 - distance);
    }
    const adjacent = workspace.adjacent; adjacent.fill(0);
    for (let i = 1; i <= pathLength; i++) for (let d = 0; d < 8; d++) {
      const to = NEIGHBOURS[ownPath[i] * 8 + d];
      if (to >= 0 && board[to] && pieceColor(board[to]) === enemy) adjacent[to] = 1;
    }
    for (const value of adjacent) f[13] += sign * value;
    if (hangingPieces && !preparedHanging) {
      const moves = workspace.moves[color], count = workspace.counts[color];
      for (let i = 0; i < count; i++) {
        const m = moves[i], type = pieceType(board[m & 127]);
        if ((m >>> 14) < 2 && !mask[(m >>> 7) & 127]) continue;
        if (type === PYRAMID) f[14] += sign;
        if (type === SCARAB) f[15] += sign;
      }
    }
  }
  if (hangingPieces && preparedHanging) for (let i = 0; i < 3; i++) f[8 + i] = preparedHanging[i];
  f[16] = 1;
  return f;
}

/** Independent feature vector, from the side to move, for tuning/inspection. */
export function evaluationFeatures(position: Position, hangingPieces = true): Float64Array {
  return fillEvaluationFeatures(position, hangingPieces, new EvalWorkspace());
}

export function evaluate(pos: Position, params: EvalParams | Record<string, number> = DEFAULT_PARAMS, hangingPieces = true, preparedHanging?: ArrayLike<number>): number {
  const weights = params instanceof EvalParams ? params.values : new EvalParams(params).values;
  const features = fillEvaluationFeatures(pos, hangingPieces && (weights[8] !== 0 || weights[9] !== 0 || weights[10] !== 0), EVAL_WORKSPACE, preparedHanging);
  let score = 0;
  for (let i = 0; i < weights.length; i++) score += features[i] * weights[i];
  return Math.max(-90000, Math.min(90000, Math.round(score)));
}
