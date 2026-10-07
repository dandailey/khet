import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BEAM_NEXT, MAX_MOVES, ROT_CW, SCARAB, SPHINX, STEP, SWAP, newGame, moveToString, toKFEN } from '../packages/khet-engine/src/index.ts';
import type { Position, Color } from '../packages/khet-engine/src/index.ts';
import { refApply, refLegalMoves, refNewGame } from '../packages/khet-reference/src/index.ts';
import type { RefState, RefPiece } from '../packages/khet-reference/src/index.ts';
import * as main from '../packages/khet-legacy/src/main_js_adapter.ts';
import * as ai from '../packages/khet-legacy/src/ai_opponent_adapter.ts';
import type { LState, LegacyAdapter, Facing } from '../packages/khet-legacy/src/adapter_types.ts';
import { random } from './lib/random.ts';
import { perft } from './perft.ts';

export const setupNames = ['classic', 'imhotep', 'dynasty'] as const;
export type Setup = typeof setupNames[number];
export type Category = 'legal moves' | 'laser' | 'destroyed' | 'result' | 'position';
export const categories: Category[] = ['legal moves', 'laser', 'destroyed', 'result', 'position'];
export interface Options { games: number; seed: number; setup?: Setup | 'all'; legacy?: 'main' | 'ai' | 'none' }
export interface Reproduction {
  game: number; setup: Setup; moves: string[]; item: Category; fast: unknown; other: unknown;
  // The full prefix preserves repetition history; KFEN + final move is a smaller local replay.
  beforeKFEN: string; localMoves: string[]; mode: 'reference' | 'legacy turn' | 'legacy native start';
}
export interface Summary {
  options: Options; games: number; plies: number; shotsDestroying: number; preferredShots: number;
  outcomes: Record<'silver' | 'red' | 'repetition' | 'cap' | 'disagreement', number>;
  setups: Record<Setup, number>; reference: Reproduction[];
  legacy: Record<Category, { count: number; examples: Reproduction[] }>;
  legacyTurns: number; legacyApplied: number; legacyUnavailable: number; nativeStartChecks: number;
}
const typeNames = ['', 'pharaoh', 'sphinx', 'pyramid', 'scarab', 'anubis'] as const;
function colorName(color: Color): RefState['side'] { return color === 0 ? 'silver' : 'red'; }
export function fastPieces(pos: Position): RefPiece[] {
  return pos.toPieces().map(p => ({ ...p, type: typeNames[p.type] as RefPiece['type'], color: colorName(p.color) }));
}
function positionValue(pieces: RefPiece[], side: RefState['side']): string {
  return side + '|' + pieces.slice().sort((a, b) => a.row * 10 + a.col - b.row * 10 - b.col)
    .map(p => `${p.row * 10 + p.col}:${p.color}:${p.type}:${p.o}`).join('|');
}
function equal(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Preview only the action on the public board; restore it in finally. No history changes.
 * Normalised paths omit the fast engine's initial emitter square, retain repeated
 * visits and the stopping square, and never contain an off-board endpoint. */
export function actionShot(pos: Position, move: number): { path: number[]; hit: number } {
  const from = move & 127, to = (move >> 7) & 127, kind = move >> 14;
  const p = pos.board[from], target = pos.board[to], type = p & 7, o = p >> 4;
  try {
    if (kind === STEP || kind === SWAP) {
      pos.board[from] = kind === SWAP ? target : 0; pos.board[to] = p;
    } else {
      let next = type === SCARAB ? o ^ 1 : (o + (kind === ROT_CW ? 1 : 3)) & 3;
      if (type === SPHINX && kind === ROT_CW && BEAM_NEXT[from * 4 + next] < 0) next = (o + 3) & 3;
      pos.board[from] = (p & 15) | (next << 4);
    }
    const shot = pos.traceLaser(pos.side);
    return { path: shot.path.slice(1), hit: shot.hit };
  } finally { pos.board[from] = p; pos.board[to] = target; }
}

// A common-input legacy turn avoids counting consequences of earlier divergences.
// Preserve full native states within legacyApply; only the input projection uses
// the adapter README's orientation mapping (Scarab / -> NE, backslash -> SW).
function legacyInput(pos: Position, adapter: LegacyAdapter<LState>, name: 'main' | 'ai'): LState {
  const state = adapter.legacyNewGame();
  state.board = Array.from({ length: 8 }, () => Array(10).fill(null));
  state.currentPlayer = name === 'main' ? (pos.side === 0 ? 2 : 1) : colorName(pos.side);
  state.gameOver = false; state.winner = null;
  for (const p of fastPieces(pos)) {
    const facing = p.type === 'pyramid' ? ['NE', 'SE', 'SW', 'NW'][p.o]
      : p.type === 'scarab' ? ['NE', 'SW'][p.o] : ['N', 'E', 'S', 'W'][p.o];
    state.board[p.row][p.col] = { type: p.type, player: name === 'main' ? (p.color === 'silver' ? 2 : 1) : p.color, facing: facing as Facing };
  }
  return state;
}
function legacyColor(player: LState['currentPlayer']): RefState['side'] { return player === 1 || player === 'red' ? 'red' : 'silver'; }

export function runDifferential(options: Options, progress?: (summary: Summary) => void): Summary {
  const selected = options.setup ?? 'all', legacyName = options.legacy ?? 'none';
  const adapter = (legacyName === 'main' ? main : ai) as LegacyAdapter<LState>;
  const rng = random(options.seed), buffer = new Int32Array(MAX_MOVES);
  const summary: Summary = {
    options, games: 0, plies: 0, shotsDestroying: 0, preferredShots: 0,
    outcomes: { silver: 0, red: 0, repetition: 0, cap: 0, disagreement: 0 },
    setups: { classic: 0, imhotep: 0, dynasty: 0 }, reference: [],
    legacy: { 'legal moves': { count: 0, examples: [] }, laser: { count: 0, examples: [] }, destroyed: { count: 0, examples: [] }, result: { count: 0, examples: [] }, position: { count: 0, examples: [] } },
    legacyTurns: 0, legacyApplied: 0, legacyUnavailable: 0, nativeStartChecks: 0,
  };
  for (let game = 0; game < options.games; game++) {
    const setup = selected === 'all' ? setupNames[game % setupNames.length] : selected;
    const pos = newGame(setup); let ref = refNewGame(setup); const moves: string[] = [];
    summary.setups[setup]++;
    const record = (item: Category, fast: unknown, other: unknown, mode: Reproduction['mode'], kfen: string, localMoves: string[]): boolean => {
      if (equal(fast, other)) return false;
      const repro: Reproduction = { game, setup, moves: [...moves], item, fast, other, beforeKFEN: kfen, localMoves, mode };
      if (mode === 'reference') summary.reference.push(repro);
      else { const bucket = summary.legacy[item]; bucket.count++; if (bucket.examples.length < 3) bucket.examples.push(repro); }
      return true;
    };
    if (legacyName !== 'none' && setup === 'classic') {
      const native = adapter.legacyNewGame(), kfen = toKFEN(pos), n = pos.generateMoves(buffer);
      summary.nativeStartChecks++;
      record('position', positionValue(fastPieces(pos), colorName(pos.side)), positionValue(adapter.legacyToPieces(native), legacyColor(native.currentPlayer)), 'legacy native start', kfen, []);
      record('legal moves', Array.from(buffer.subarray(0, n), m => moveToString(m, pos)).sort(), adapter.legacyLegalMoves(native).sort(), 'legacy native start', kfen, []);
    }
    let disagreed = false;
    while (pos.result === null && moves.length < 300) {
      const count = pos.generateMoves(buffer);
      const texts = Array.from(buffer.subarray(0, count), m => moveToString(m, pos)).sort();
      const refTexts = refLegalMoves(ref);
      // Generate a KFEN only when needed for a reproduction or a legacy comparison.
      if (!equal(texts, refTexts)) { record('legal moves', texts, refTexts, 'reference', toKFEN(pos), []); disagreed = true; break; }
      if (!count) throw new Error(`No moves in nonterminal ${setup} game ${game}`);
      let chosen = buffer[Math.floor(rng() * count)];
      if (rng() < 0.3) {
        const tactical: number[] = [];
        for (let i = 0; i < count; i++) if (actionShot(pos, buffer[i]).hit >= 0) tactical.push(buffer[i]);
        if (tactical.length) { chosen = tactical[Math.floor(rng() * tactical.length)]; summary.preferredShots++; }
      }
      const text = moveToString(chosen, pos), shot = actionShot(pos, chosen), beforeBoard = pos.board.slice();
      const beforeKFEN = legacyName !== 'none' ? toKFEN(pos) : '';
      let legacyApplied: ReturnType<LegacyAdapter<LState>['legacyApply']> | undefined;
      if (legacyName !== 'none') {
        const input = legacyInput(pos, adapter, legacyName), legacyMoves = adapter.legacyLegalMoves(input).sort();
        summary.legacyTurns++;
        record('legal moves', texts, legacyMoves, 'legacy turn', beforeKFEN, []);
        if (legacyMoves.includes(text)) { legacyApplied = adapter.legacyApply(input, text); summary.legacyApplied++; }
        else summary.legacyUnavailable++;
      }
      const applied = refApply(ref, text);
      pos.makeMove(chosen); ref = applied.state; moves.push(text); summary.plies++;
      // Read destruction from makeMove's actual board, rather than assuming
      // its mutation agrees with traceLaser. Occupancy after the action is
      // known even for rotations, swaps, and destruction on from/to.
      const from = chosen & 127, to = (chosen >> 7) & 127, kind = chosen >> 14;
      let destroyed = -1;
      for (let sq = 0; sq < 80; sq++) {
        const occupied = sq === to ? beforeBoard[from] : sq === from ? (kind === SWAP ? beforeBoard[to] : 0) : beforeBoard[sq];
        if (occupied && !pos.board[sq]) {
          if (destroyed !== -1) throw new Error('Fast makeMove destroyed more than one piece');
          destroyed = sq;
        }
      }
      if (destroyed >= 0) summary.shotsDestroying++;
      const fastResult = pos.result === null || pos.result === 'draw' ? pos.result : colorName(pos.result);
      const fastPosition = positionValue(fastPieces(pos), colorName(pos.side));
      const comparisons: [Category, unknown, unknown][] = [
        ['laser', shot.path, applied.laser.path], ['destroyed', destroyed, applied.laser.destroyed],
        ['result', fastResult, ref.result], ['position', fastPosition, positionValue(ref.pieces, ref.side)],
      ];
      for (const [item, fast, other] of comparisons) {
        if (!equal(fast, other)) {
          pos.unmakeMove(); const kfen = toKFEN(pos); pos.makeMove(chosen);
          record(item, fast, other, 'reference', kfen, [text]); disagreed = true; break;
        }
      }
      if (legacyApplied) {
        const s = legacyApplied.state;
        record('laser', shot.path, legacyApplied.laser.path, 'legacy turn', beforeKFEN, [text]);
        record('destroyed', destroyed, legacyApplied.laser.destroyed, 'legacy turn', beforeKFEN, [text]);
        record('result', fastResult, s.gameOver ? (s.winner === null ? null : legacyColor(s.winner)) : null, 'legacy turn', beforeKFEN, [text]);
        record('position', fastPosition, positionValue(adapter.legacyToPieces(s), legacyColor(s.currentPlayer)), 'legacy turn', beforeKFEN, [text]);
      }
      if (disagreed) break;
    }
    if (disagreed) summary.outcomes.disagreement++;
    else if (pos.result === null) summary.outcomes.cap++;
    else if (pos.result === 'draw') summary.outcomes.repetition++;
    else summary.outcomes[colorName(pos.result)]++;
    summary.games++;
    if (summary.games % 100 === 0) progress?.(summary);
  }
  return summary;
}

export function referencePerft(state: RefState, depth: number): number {
  if (!Number.isInteger(depth) || depth < 0) throw new Error('Depth must be a nonnegative integer');
  if (!depth) return 1;
  const moves = refLegalMoves(state);
  if (depth === 1) return moves.length;
  let nodes = 0;
  for (const move of moves) nodes += referencePerft(refApply(state, move).state, depth - 1);
  return nodes;
}
export function measurePerft(): Record<Setup, { fast: number[]; reference: number[]; referenceSeconds: number[] }> {
  return Object.fromEntries(setupNames.map(setup => {
    const fast: number[] = [], reference: number[] = [], referenceSeconds: number[] = [];
    for (let depth = 1; depth <= 3; depth++) {
      fast.push(perft(newGame(setup), depth));
      const start = performance.now(); reference.push(referencePerft(refNewGame(setup), depth));
      referenceSeconds.push((performance.now() - start) / 1000);
    }
    return [setup, { fast, reference, referenceSeconds }];
  })) as ReturnType<typeof measurePerft>;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (!['--games', '--seed', '--setup', '--legacy', '--out', '--perft-out'].includes(args[i]) || !args[i + 1] || values.has(args[i])) throw new Error(`Invalid argument: ${args[i]}`);
    values.set(args[i], args[i + 1]);
  }
  const games = Number(values.get('--games') ?? 100), seed = Number(values.get('--seed') ?? 1);
  const setup = values.get('--setup') ?? 'all', legacy = values.get('--legacy') ?? 'none';
  if (!Number.isSafeInteger(games) || games < 1 || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || ![...setupNames, 'all'].includes(setup) || !['main', 'ai', 'none'].includes(legacy)) throw new Error('Usage: node tools/difftest.ts --games N --seed S [--setup classic|imhotep|dynasty|all] [--legacy main|ai|none] [--out docs/diff/run.json] [--perft-out path.json]');
  const start = performance.now();
  const summary = runDifferential({ games, seed, setup: setup as Options['setup'], legacy: legacy as Options['legacy'] }, s => {
    if (s.games % 1000 === 0) console.error(`${s.games}/${games} games; ${s.plies} plies; ${s.reference.length} reference disagreements`);
  });
  const output = { ...summary, seconds: (performance.now() - start) / 1000 };
  const write = (path: string, value: unknown): void => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); };
  if (values.has('--out')) write(values.get('--out')!, output);
  console.log(JSON.stringify({ games: summary.games, plies: summary.plies, referenceDisagreements: summary.reference.length, legacy: Object.fromEntries(categories.map(c => [c, summary.legacy[c].count])), seconds: output.seconds }));
  if (values.has('--perft-out')) write(values.get('--perft-out')!, measurePerft());
  if (summary.reference.length) process.exitCode = 1;
}
