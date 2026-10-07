import { DEFAULT_PARAMS, EvalParams, evaluate } from './eval.ts';
import { moveToString } from './notation.ts';
import type { Position } from './position.ts';
import { SIDE_HI, SIDE_LO } from './zobrist.ts';
import { ANUBIS, MAX_MOVES, PHARAOH, PYRAMID, pieceColor, pieceType } from './types.ts';
import type { Color, SearchOptions, SearchResult } from './types.ts';

export const MATE = 100000;
const MATE_BOUND = 99000, INF = 100001, MAX_PLY = 128;
const EXACT = 1, LOWER = 2, UPPER = 3;
const ABORT = Symbol('search aborted');

/** Two slots per bucket: depth-preferred and always-replace. Size is entry count. */
export class TranspositionTable {
  readonly lo: Uint32Array; readonly hi: Uint32Array;
  readonly depths: Int16Array; readonly scores: Int32Array;
  readonly moves: Int32Array; readonly bounds: Uint8Array;
  readonly contexts: Uint8Array;
  readonly pathsLo: Uint32Array; readonly pathsHi: Uint32Array;
  readonly evaluations: Int32Array; readonly evalValid: Uint8Array;
  readonly mask: number;
  constructor(size = 1 << 20) {
    if (!Number.isSafeInteger(size) || size < 2 || size > (1 << 24) || (size & (size - 1))) throw new Error('ttSize must be a power of two between 2 and 2^24');
    this.mask = (size >>> 1) - 1;
    this.lo = new Uint32Array(size); this.hi = new Uint32Array(size);
    this.depths = new Int16Array(size); this.scores = new Int32Array(size);
    this.moves = new Int32Array(size).fill(-1); this.bounds = new Uint8Array(size);
    this.contexts = new Uint8Array(size);
    this.pathsLo = new Uint32Array(size); this.pathsHi = new Uint32Array(size);
    this.evaluations = new Int32Array(size); this.evalValid = new Uint8Array(size);
  }
  probe(lo: number, hi: number, context: number): number {
    const start = (lo & this.mask) * 2;
    for (let i = start; i <= start + 1; i++) if (this.bounds[i] && this.lo[i] === lo && this.hi[i] === hi && this.contexts[i] === context) return i;
    return -1;
  }
  store(lo: number, hi: number, context: number, depth: number, score: number, move: number, bound: number, ply: number, pathLo = 0, pathHi = 0): void {
    const start = (lo & this.mask) * 2;
    const match = this.probe(lo, hi, context);
    const i = match >= 0 ? match : !this.bounds[start] || depth >= this.depths[start] ? start : start + 1;
    if (this.lo[i] !== lo || this.hi[i] !== hi) this.evalValid[i] = 0;
    this.lo[i] = lo; this.hi[i] = hi; this.contexts[i] = context;
    this.depths[i] = depth; this.scores[i] = toTableScore(score, ply);
    this.moves[i] = move; this.bounds[i] = bound;
    this.pathsLo[i] = pathLo; this.pathsHi[i] = pathHi;
  }
  evaluation(lo: number, hi: number): number | null {
    const start = (lo & this.mask) * 2;
    for (let i = start; i <= start + 1; i++) if (this.evalValid[i] && this.lo[i] === lo && this.hi[i] === hi) return this.evaluations[i];
    return null;
  }
  cacheEvaluation(lo: number, hi: number, score: number): void {
    const start = (lo & this.mask) * 2;
    let slot = !this.bounds[start] ? start : start + 1;
    for (let i = start; i <= start + 1; i++) if ((this.bounds[i] || this.evalValid[i]) && this.lo[i] === lo && this.hi[i] === hi) slot = i;
    if (this.lo[slot] !== lo || this.hi[slot] !== hi) {
      this.bounds[slot] = 0; this.depths[slot] = -1; this.moves[slot] = -1;
      this.lo[slot] = lo; this.hi[slot] = hi;
    }
    this.evaluations[slot] = score; this.evalValid[slot] = 1;
  }
}
export function toTableScore(score: number, ply: number): number {
  return score >= MATE_BOUND ? score + ply : score <= -MATE_BOUND ? score - ply : score;
}
export function fromTableScore(score: number, ply: number): number {
  return score >= MATE_BOUND ? score - ply : score <= -MATE_BOUND ? score + ply : score;
}
function mix(move: number, seed: number): number {
  let x = Math.imul(move ^ seed, 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}
function victimValue(p: number): number {
  const type = pieceType(p);
  return type === PHARAOH ? MATE : type === PYRAMID ? 100 : type === ANUBIS ? 120 : 0;
}

export function search(position: Position, options: SearchOptions = {}): SearchResult {
  for (const name of ['depth', 'nodes', 'timeMs'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error(`Invalid ${name} limit`);
  }
  if ((options.depth ?? 64) > 64) throw new Error('Maximum search depth is 64');
  if (options.qDepth !== undefined && (!Number.isInteger(options.qDepth) || options.qDepth < 0 || options.qDepth > 16)) throw new Error('Invalid qDepth');
  const start = performance.now(), pos = position.clone();
  pos.reserveHistory(pos.ply + MAX_PLY + 1024);
  const params = options.params instanceof EvalParams ? options.params : options.params ? new EvalParams(options.params) : DEFAULT_PARAMS;
  const tt = options.tt === false || options.ttSize === 0 ? null : new TranspositionTable(options.ttSize);
  const seed = options.seed ?? 1, qcap = options.qDepth ?? 4;
  const maxDepth = options.depth ?? 64, maxNodes = options.nodes ?? Infinity;
  const timeLimit = options.timeMs ?? (options.depth === undefined && options.nodes === undefined ? 1000 : Infinity);
  const deadline = start + timeLimit;
  const killers = new Int32Array(MAX_PLY * 2).fill(-1), history = new Int32Array(2 * 65536);
  const pathLo = new Uint32Array(MAX_PLY), pathHi = new Uint32Array(MAX_PLY);
  const signatureLo = new Uint32Array(MAX_PLY), signatureHi = new Uint32Array(MAX_PLY);
  const buffers = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_MOVES));
  const pvs: number[][] = Array.from({ length: MAX_PLY }, () => []);
  let nodes = 0;

  function staticEvaluation(): number {
    const cached = tt?.evaluation(pos.hash[0], pos.hash[1]);
    if (cached !== null && cached !== undefined) return cached;
    const score = evaluate(pos, params);
    // This includes the expensive hanging-piece term, keyed by board + side.
    tt?.cacheEvaluation(pos.hash[0], pos.hash[1], score);
    return score;
  }

  function visit(): void {
    if (nodes >= maxNodes || (options.stop && Atomics.load(options.stop, 0))) throw ABORT;
    if ((nodes & 1023) === 0 && performance.now() >= deadline) throw ABORT;
    nodes++;
  }
  function repeated(ply: number): boolean {
    for (let i = ply - 2; i >= 0; i -= 2) if (pathLo[i] === pos.hash[0] && pathHi[i] === pos.hash[1]) return true;
    return false;
  }
  function terminal(ply: number): number | null {
    return pos.result === null ? null : pos.result === 'draw' ? 0 : pos.result === pos.side ? MATE - ply : -MATE + ply;
  }
  function staticChild(ply: number): number {
    visit();
    const end = terminal(ply);
    if (end !== null) return end;
    if (repeated(ply)) return 0;
    return pos.hasWinInOne(pos.side) ? MATE - ply - 1 : staticEvaluation();
  }
  function negamax(depth: number, alpha: number, beta: number, ply: number, extensions: number, qleft: number, canNull = true): number {
    visit(); pvs[ply] = [];
    const end = terminal(ply);
    if (end !== null) return end;
    if (repeated(ply)) return 0;
    pathLo[ply] = pos.hash[0]; pathHi[ply] = pos.hash[1];
    signatureLo[ply + 1] = Math.imul(signatureLo[ply] ^ pos.hash[0], 0x45d9f3b) >>> 0;
    signatureHi[ply + 1] = Math.imul(signatureHi[ply] ^ pos.hash[1], 0x119de1f3) >>> 0;
    const win = pos.findWinInOne(pos.side);
    if (win >= 0) { pvs[ply] = [win]; return MATE - ply - 1; }
    if (ply >= MAX_PLY - 2) return staticEvaluation();
    const threatened = pos.hasWinInOne((pos.side ^ 1) as Color);
    if (options.threatExtension !== false && threatened && extensions < 2) { depth = Math.max(0, depth) + 1; extensions++; }
    const quietSearch = depth <= 0;
    const originalAlpha = alpha;
    let best = -INF, bestMove = -1;
    if (quietSearch && !threatened) {
      best = staticEvaluation();
      if (options.qsearch === false || qleft <= 0 || best >= beta) return best;
      alpha = Math.max(alpha, best);
    }
    // Context includes extension and quiescence budgets. Exact-depth bounds
    // preserve fixed-depth semantics; PV nodes are searched for a complete line.
    const lo = pos.hash[0], hi = pos.hash[1], context = extensions | (qleft << 2);
    const entry = quietSearch || !tt ? -1 : tt.probe(lo, hi, context);
    const ttMove = entry < 0 ? -1 : tt!.moves[entry];
    // Scores depend on ancestors because repetition is a search-path draw.
    // Move ordering and static evaluation can still be shared across paths.
    if (entry >= 0 && ply > 0 && beta === alpha + 1 && tt!.depths[entry] === depth &&
        tt!.pathsLo[entry] === signatureLo[ply] && tt!.pathsHi[entry] === signatureHi[ply]) {
      const score = fromTableScore(tt!.scores[entry], ply), bound = tt!.bounds[entry];
      if (bound === EXACT || (bound === LOWER && score >= beta) || (bound === UPPER && score <= alpha)) {
        if (ttMove >= 0) pvs[ply] = [ttMove];
        return score;
      }
    }
    // Experimental pass: no shot, no rule/history mutation; forbid consecutive nulls.
    if (options.nullMove && canNull && !quietSearch && !threatened && depth >= 3 && ply > 0 && beta === alpha + 1 && Math.abs(beta) < MATE_BOUND) {
      pos.side = (pos.side ^ 1) as Color;
      pos.hash[0] ^= SIDE_LO; pos.hash[1] ^= SIDE_HI;
      let score: number;
      try { score = -negamax(depth - 3, -beta, -beta + 1, ply + 1, extensions, qleft, false); }
      finally { pos.hash[0] ^= SIDE_LO; pos.hash[1] ^= SIDE_HI; pos.side = (pos.side ^ 1) as Color; }
      if (score >= beta) return score;
    }
    const out = buffers[ply];
    const count = quietSearch && !threatened ? pos.generateTacticalMoves(pos.side, out) : pos.generateMoves(out);
    const ordered: { move: number; rank: number; shot: number; tie: number }[] = [];
    let safe = false;
    for (let i = 0; i < count; i++) {
      const move = out[i], shot = pos.previewShot(move), victim = shot >>> 7;
      const own = shot >= 0 && pieceColor(victim) === pos.side;
      const suicide = own && pieceType(victim) === PHARAOH;
      if (!suicide) safe = true;
      if (quietSearch && !threatened && (shot < 0 || own)) continue;
      // Material-only delta bounds are unsafe: a kill can open a winning beam
      // or change exposure by much more than the victim's material value.
      let rank = own ? -1000000 - victimValue(victim) : shot >= 0 ? 1000000 + victimValue(victim) : 0;
      if (ply > 0) {
        if (move === ttMove) rank += 10000000;
        else if (shot < 0 && move === killers[ply * 2]) rank += 900000;
        else if (shot < 0 && move === killers[ply * 2 + 1]) rank += 800000;
        else if (shot < 0) rank += history[pos.side * 65536 + move];
      }
      ordered.push({ move, rank, shot, tie: mix(move, seed) });
    }
    ordered.sort((a, b) => b.rank - a.rank || a.tie - b.tie || a.move - b.move);
    let searched = 0;
    for (const candidate of ordered) {
      const { move, shot } = candidate, victim = shot >>> 7;
      if (safe && shot >= 0 && pieceType(victim) === PHARAOH && pieceColor(victim) === pos.side) continue;
      const side = pos.side, quiet = shot < 0;
      pos.makeMove(move);
      let score: number;
      try {
        if (quietSearch && qleft <= 0) {
          pvs[ply + 1] = [];
          score = -staticChild(ply + 1);
        } else {
          const nextDepth = quietSearch ? 0 : depth - 1, nextQ = quietSearch ? qleft - 1 : qleft;
          const reduce = options.lmr !== false && depth >= 3 && searched >= 4 && quiet && !threatened && ply > 0 && !pos.hasWinInOne(side);
          if (searched === 0) score = -negamax(nextDepth, -beta, -alpha, ply + 1, extensions, nextQ);
          else {
            score = -negamax(nextDepth - (reduce ? 1 : 0), -alpha - 1, -alpha, ply + 1, extensions, nextQ);
            if (reduce && score > alpha) score = -negamax(nextDepth, -alpha - 1, -alpha, ply + 1, extensions, nextQ);
            if (score > alpha && score < beta) score = -negamax(nextDepth, -beta, -alpha, ply + 1, extensions, nextQ);
          }
        }
      } finally { pos.unmakeMove(); }
      searched++;
      if (score > best) { best = score; bestMove = move; pvs[ply] = [move, ...pvs[ply + 1]]; }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (quiet && !quietSearch) {
          if (killers[ply * 2] !== move) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = move; }
          const index = side * 65536 + move;
          history[index] = Math.min(700000, history[index] + depth * depth);
        }
        break;
      }
    }
    if (!searched && best === -INF) best = staticEvaluation();
    if (!quietSearch && tt && bestMove >= 0) tt.store(lo, hi, context, depth, best, bestMove,
      best <= originalAlpha ? UPPER : best >= beta ? LOWER : EXACT, ply, signatureLo[ply], signatureHi[ply]);
    return best;
  }

  const rootMoves = new Int32Array(MAX_MOVES), count = pos.generateMoves(rootMoves);
  let fallback = -1;
  for (let i = 0; i < count; i++) {
    const m = rootMoves[i], shot = pos.previewShot(m), p = shot >>> 7;
    if (fallback < 0) fallback = m;
    if (!(shot >= 0 && pieceType(p) === PHARAOH && pieceColor(p) === pos.side)) { fallback = m; break; }
  }
  function result(move: number, score: number, depth: number, pv: number[]): SearchResult {
    const replay = position.clone(), text: string[] = [];
    for (const m of pv) { text.push(moveToString(m, replay)); replay.makeMove(m); if (replay.result !== null) break; }
    return { move: move < 0 ? '' : moveToString(move, position), score, depth, nodes, pv: text, timeMs: performance.now() - start };
  }
  let completed = result(fallback, terminal(0) ?? staticEvaluation(), 0, fallback < 0 ? [] : [fallback]);
  if (fallback < 0) return completed;
  // A tiny limit still receives an immediate win or a safe fallback.
  const immediate = pos.findWinInOne(pos.side);
  if (immediate >= 0) { nodes = 1; return result(immediate, MATE - 1, 1, [immediate]); }
  for (let depth = 1; depth <= maxDepth; depth++) {
    let window = depth === 1 ? INF * 2 : 50;
    try {
      let score: number;
      while (true) {
        const alpha = window >= INF ? -INF : Math.max(-INF, completed.score - window);
        const beta = window >= INF ? INF : Math.min(INF, completed.score + window);
        score = negamax(depth, alpha, beta, 0, 0, qcap);
        if (score > alpha && score < beta) break;
        window *= 2;
      }
      const pv = pvs[0].slice();
      completed = result(pv[0] ?? fallback, score, depth, pv);
      options.onIteration?.(completed);
      if (Math.abs(score) >= MATE_BOUND || performance.now() >= deadline || nodes >= maxNodes) break;
    } catch (error) { if (error !== ABORT) throw error; break; }
  }
  return { ...completed, nodes, timeMs: performance.now() - start };
}
