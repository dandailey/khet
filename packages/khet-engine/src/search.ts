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
  readonly evaluations: Int32Array; readonly evalValid: Uint8Array;
  readonly tacticalValid: Uint8Array; readonly wins: Int32Array; readonly threats: Uint8Array;
  readonly mask: number;
  constructor(size = 1 << 20) {
    if (!Number.isSafeInteger(size) || size < 2 || size > (1 << 24) || (size & (size - 1))) throw new Error('ttSize must be a power of two between 2 and 2^24');
    this.mask = (size >>> 1) - 1;
    this.lo = new Uint32Array(size); this.hi = new Uint32Array(size);
    this.depths = new Int16Array(size); this.scores = new Int32Array(size);
    this.moves = new Int32Array(size).fill(-1); this.bounds = new Uint8Array(size);
    this.contexts = new Uint8Array(size);
    this.evaluations = new Int32Array(size); this.evalValid = new Uint8Array(size);
    this.tacticalValid = new Uint8Array(size); this.wins = new Int32Array(size); this.threats = new Uint8Array(size);
  }
  probe(lo: number, hi: number, context: number): number {
    const start = (lo & this.mask) * 2;
    for (let i = start; i <= start + 1; i++) if (this.bounds[i] && this.lo[i] === lo && this.hi[i] === hi && this.contexts[i] === context) return i;
    return -1;
  }
  store(lo: number, hi: number, context: number, depth: number, score: number, move: number, bound: number, ply: number): void {
    const start = (lo & this.mask) * 2;
    const match = this.probe(lo, hi, context);
    if (match >= 0 && this.depths[match] > depth && this.bounds[match] === EXACT) return;
    const i = match >= 0 ? match : !this.bounds[start] || depth >= this.depths[start] ? start : start + 1;
    if (this.lo[i] !== lo || this.hi[i] !== hi) { this.evalValid[i] = 0; this.tacticalValid[i] = 0; }
    this.lo[i] = lo; this.hi[i] = hi; this.contexts[i] = context;
    this.depths[i] = depth; this.scores[i] = toTableScore(score, ply);
    this.moves[i] = move; this.bounds[i] = bound;
  }
  evaluation(lo: number, hi: number): number | null {
    const start = (lo & this.mask) * 2;
    for (let i = start; i <= start + 1; i++) if (this.evalValid[i] && this.lo[i] === lo && this.hi[i] === hi) return this.evaluations[i];
    return null;
  }
  private cacheSlot(lo: number, hi: number): number {
    const start = (lo & this.mask) * 2;
    let slot = !this.bounds[start] ? start : start + 1;
    for (let i = start; i <= start + 1; i++) if ((this.bounds[i] || this.evalValid[i] || this.tacticalValid[i]) && this.lo[i] === lo && this.hi[i] === hi) slot = i;
    if (this.lo[slot] !== lo || this.hi[slot] !== hi) {
      this.bounds[slot] = 0; this.depths[slot] = -1; this.moves[slot] = -1;
      this.evalValid[slot] = 0; this.tacticalValid[slot] = 0;
      this.lo[slot] = lo; this.hi[slot] = hi;
    }
    return slot;
  }
  cacheEvaluation(lo: number, hi: number, score: number): void {
    const slot = this.cacheSlot(lo, hi);
    this.evaluations[slot] = score; this.evalValid[slot] = 1;
  }
  tactical(lo: number, hi: number): number {
    const start = (lo & this.mask) * 2;
    for (let i = start; i <= start + 1; i++) if (this.tacticalValid[i] && this.lo[i] === lo && this.hi[i] === hi) return i;
    return -1;
  }
  cacheTactical(lo: number, hi: number, win: number, threatened?: boolean): void {
    const slot = this.cacheSlot(lo, hi);
    this.wins[slot] = win; this.tacticalValid[slot] |= 1;
    if (threatened !== undefined) { this.threats[slot] = Number(threatened); this.tacticalValid[slot] |= 2; }
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
  const buffers = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_MOVES));
  const beamMasks = Array.from({ length: MAX_PLY }, () => new Uint8Array(80));
  const enemyBeamMasks = Array.from({ length: MAX_PLY }, () => new Uint8Array(80));
  const ownVictims = Array.from({ length: MAX_PLY }, () => new Uint8Array(80));
  const enemyVictims = Array.from({ length: MAX_PLY }, () => new Uint8Array(80));
  const hangingCounts = Array.from({ length: MAX_PLY }, () => new Int16Array(3));
  const scores = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_MOVES));
  const shots = Array.from({ length: MAX_PLY }, () => new Int32Array(MAX_MOVES));
  const ties = Array.from({ length: MAX_PLY }, () => new Uint32Array(MAX_MOVES));
  const pv = new Int32Array(MAX_PLY * (MAX_PLY + 1) / 2);
  const pvOffsets = new Int32Array(MAX_PLY), pvLengths = new Int32Array(MAX_PLY);
  for (let i = 0; i < MAX_PLY; i++) pvOffsets[i] = i * (2 * MAX_PLY - i + 1) / 2;
  let nodes = 0;

  function staticEvaluation(preparedHanging?: ArrayLike<number>): number {
    const cached = tt?.evaluation(pos.hash[0], pos.hash[1]);
    if (cached !== null && cached !== undefined) return cached;
    const score = evaluate(pos, params, options.hangingPieces !== false, preparedHanging);
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
    const lo = pos.hash[0], hi = pos.hash[1], entry = tt?.tactical(lo, hi) ?? -1;
    const win = entry >= 0 ? tt!.wins[entry] : pos.findWinInOne(pos.side);
    if (entry < 0) tt?.cacheTactical(lo, hi, win);
    return win >= 0 ? MATE - ply - 1 : staticEvaluation();
  }
  function negamax(depth: number, alpha: number, beta: number, ply: number, extensions: number, qleft: number, canNull = true): number {
    visit(); pvLengths[ply] = 0;
    const end = terminal(ply);
    if (end !== null) return end;
    if (repeated(ply)) return 0;
    pathLo[ply] = pos.hash[0]; pathHi[ply] = pos.hash[1];
    const requestedDepth = depth <= 0 ? qleft : depth;
    // Bounds use incoming extension budgets. Qsearch is a separate context
    // with its remaining budget stored as depth; full search also keys qleft.
    // PV nodes probe for ordering, while bounds only cut off non-PV nodes.
    const lo = pos.hash[0], hi = pos.hash[1], context = extensions | (depth <= 0 ? 128 : (qleft << 2));
    const entry = !tt ? -1 : tt.probe(lo, hi, context);
    const ttMove = entry < 0 ? -1 : tt!.moves[entry];
    // Repetition was checked on the current path before probing. Accept
    // graph-history interaction when reusing bounds from other paths.
    if (entry >= 0 && ply > 0 && beta === alpha + 1 && tt!.depths[entry] >= requestedDepth) {
      const score = fromTableScore(tt!.scores[entry], ply), bound = tt!.bounds[entry];
      if (bound === EXACT || (bound === LOWER && score >= beta) || (bound === UPPER && score <= alpha)) {
        if (ttMove >= 0) { pv[pvOffsets[ply]] = ttMove; pvLengths[ply] = 1; }
        return score;
      }
    }
    const mask = beamMasks[ply], baseShot = pos.shotOnPath(pos.side, mask);
    const tactical = tt?.tactical(lo, hi) ?? -1;
    const collectVictims = tactical < 0 && options.hangingPieces !== false;
    const counts = hangingCounts[ply]; counts.fill(0);
    const win = tactical >= 0 ? tt!.wins[tactical] : pos.findWinInOne(pos.side, mask, baseShot,
      collectVictims ? ownVictims[ply] : undefined, collectVictims ? counts : undefined, -1);
    if (win >= 0) {
      pv[pvOffsets[ply]] = win; pvLengths[ply] = 1;
      tt?.store(lo, hi, context, 64, MATE - ply - 1, win, EXACT, ply);
      return MATE - ply - 1;
    }
    if (ply >= MAX_PLY - 2) return staticEvaluation();
    let threatened: boolean;
    if (tactical >= 0 && (tt!.tacticalValid[tactical] & 2)) threatened = !!tt!.threats[tactical];
    else {
      const enemy = (pos.side ^ 1) as Color, enemyMask = enemyBeamMasks[ply];
      const enemyShot = pos.shotOnPath(enemy, enemyMask);
      threatened = pos.findWinInOne(enemy, enemyMask, enemyShot, collectVictims ? enemyVictims[ply] : undefined, collectVictims ? counts : undefined, 1) >= 0;
    }
    const preparedHanging = collectVictims && !threatened ? counts : undefined;
    if (tactical < 0 || !(tt!.tacticalValid[tactical] & 2)) tt?.cacheTactical(lo, hi, win, threatened);
    if (options.threatExtension !== false && threatened && extensions < 2) { depth = Math.max(0, depth) + 1; extensions++; }
    const quietSearch = depth <= 0;
    const originalAlpha = alpha;
    let best = -INF, bestMove = -1;
    if (quietSearch && !threatened) {
      best = staticEvaluation(preparedHanging);
      if (options.qsearch === false || qleft <= 0 || best >= beta) {
        tt?.store(lo, hi, context, requestedDepth, best, -1, best >= beta ? LOWER : EXACT, ply);
        return best;
      }
      alpha = Math.max(alpha, best);
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
    const legalTT = ttMove >= 0 && pos.isLegal(ttMove);
    const stagedShot = legalTT
      ? (mask[ttMove & 127] || mask[(ttMove >>> 7) & 127] ? pos.previewShot(ttMove) : baseShot) : -1;
    const stagedMove = legalTT && (!quietSearch || threatened || (stagedShot >= 0 && pieceColor(stagedShot >>> 7) !== pos.side)) &&
      !(stagedShot >= 0 && pieceType(stagedShot >>> 7) === PHARAOH && pieceColor(stagedShot >>> 7) === pos.side) ? ttMove : -1;
    const out = buffers[ply], ranks = scores[ply], shotBuffer = shots[ply], tieBuffer = ties[ply];
    let generated = false, safe = stagedMove >= 0, searched = 0, index = 0, count = 0;
    let pendingTT = stagedMove >= 0;
    while (true) {
      let move: number, shot: number;
      if (pendingTT) {
        pendingTT = false; move = stagedMove; shot = stagedShot;
      } else {
        if (!generated) {
          generated = true;
          const total = quietSearch && !threatened && !(baseShot >= 0 && pieceColor(baseShot >>> 7) !== pos.side)
            ? pos.generateBeamMoves(pos.side, out, mask) : pos.generateMoves(out);
          for (let i = 0; i < total; i++) {
            const m = out[i];
            if (m === stagedMove) continue;
            const hit = mask[m & 127] || mask[(m >>> 7) & 127] ? pos.previewShot(m) : baseShot;
            const victim = hit >>> 7, own = hit >= 0 && pieceColor(victim) === pos.side;
            if (!(own && pieceType(victim) === PHARAOH)) safe = true;
            if (quietSearch && !threatened && (hit < 0 || own)) continue;
            let rank = own ? -1000000 - victimValue(victim) : hit >= 0 ? 1000000 + victimValue(victim) : 0;
            if (ply > 0) {
              if (m === ttMove) rank += 10000000;
              else if (hit < 0 && m === killers[ply * 2]) rank += 900000;
              else if (hit < 0 && m === killers[ply * 2 + 1]) rank += 800000;
              else if (hit < 0) rank += history[pos.side * 65536 + m];
            }
            out[count] = m; ranks[count] = rank; shotBuffer[count] = hit; tieBuffer[count++] = mix(m, seed);
          }
        }
        if (index >= count) break;
        let pick = index;
        for (let i = index + 1; i < count; i++) {
          if (ranks[i] > ranks[pick] || (ranks[i] === ranks[pick] &&
            (tieBuffer[i] < tieBuffer[pick] || (tieBuffer[i] === tieBuffer[pick] && out[i] < out[pick])))) pick = i;
        }
        move = out[pick]; shot = shotBuffer[pick];
        out[pick] = out[index]; ranks[pick] = ranks[index]; shotBuffer[pick] = shotBuffer[index]; tieBuffer[pick] = tieBuffer[index];
        index++;
        if (safe && shot >= 0 && pieceType(shot >>> 7) === PHARAOH && pieceColor(shot >>> 7) === pos.side) continue;
      }
      const side = pos.side, quiet = shot < 0;
      pos.makeMove(move);
      let score: number;
      try {
        if (quietSearch && qleft <= 0) {
          pvLengths[ply + 1] = 0;
          score = -staticChild(ply + 1);
        } else {
          const nextDepth = quietSearch ? 0 : depth - 1, nextQ = quietSearch ? qleft - 1 : qleft;
          const reduce = options.lmr !== false && depth >= 3 && searched >= 4 && quiet && !threatened && ply > 0;
          if (searched === 0) score = -negamax(nextDepth, -beta, -alpha, ply + 1, extensions, nextQ);
          else {
            score = -negamax(nextDepth - (reduce ? 1 : 0), -alpha - 1, -alpha, ply + 1, extensions, nextQ);
            if (reduce && score > alpha) score = -negamax(nextDepth, -alpha - 1, -alpha, ply + 1, extensions, nextQ);
            if (score > alpha && score < beta) score = -negamax(nextDepth, -beta, -alpha, ply + 1, extensions, nextQ);
          }
        }
      } finally { pos.unmakeMove(); }
      searched++;
      if (score > best) {
        best = score; bestMove = move;
        const offset = pvOffsets[ply], child = pvOffsets[ply + 1];
        pv[offset] = move; pvLengths[ply] = pvLengths[ply + 1] + 1;
        for (let i = 0; i < pvLengths[ply + 1]; i++) pv[offset + 1 + i] = pv[child + i];
      }
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
    if (!searched && best === -INF) best = staticEvaluation(preparedHanging);
    if (tt) tt.store(lo, hi, context, requestedDepth, best, bestMove,
      best <= originalAlpha ? UPPER : best >= beta ? LOWER : EXACT, ply);
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
    let window = depth === 1 ? INF * 2 : 20;
    try {
      let score: number;
      while (true) {
        const alpha = window >= INF ? -INF : Math.max(-INF, completed.score - window);
        const beta = window >= INF ? INF : Math.min(INF, completed.score + window);
        score = negamax(depth, alpha, beta, 0, 0, qcap);
        if (score > alpha && score < beta) break;
        window *= 2;
      }
      const line = Array.from(pv.subarray(0, pvLengths[0]));
      completed = result(line[0] ?? fallback, score, depth, line);
      options.onIteration?.(completed);
      if (Math.abs(score) >= MATE_BOUND || performance.now() >= deadline || nodes >= maxNodes) break;
    } catch (error) { if (error !== ABORT) throw error; break; }
  }
  return { ...completed, nodes, timeMs: performance.now() - start };
}
