import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MOVES, PHARAOH, Position, RED, SCARAB, SILVER, SPHINX, fromKFEN, fromPieces, newGame, parseMove, recomputeHash, toKFEN } from '../src/index.ts';
import type { PlacedPiece } from '../src/index.ts';
import { perft } from '../../../tools/perft.ts';

export const CLASSIC_KFEN = 'ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0';
function rng(seed: number): () => number {
  return () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; };
}
function p(sq: number, type: number, color: 0 | 1, o = 0): PlacedPiece {
  return { row: Math.floor(sq / 10), col: sq % 10, type, color, o };
}
function cyclePosition(): Position {
  return fromPieces([p(79, SPHINX, SILVER), p(0, SPHINX, RED, 2), p(44, SCARAB, SILVER), p(35, SCARAB, RED)], SILVER);
}
const cycle = ['e4+', 'f5+', 'e4+', 'f5+'];
test('Classic KFEN is pinned, supports both Scarab delimiters, and optional ply', () => {
  const pos = newGame();
  assert.equal(toKFEN(pos), CLASSIC_KFEN);
  assert.equal(toKFEN(fromKFEN(CLASSIC_KFEN)), CLASSIC_KFEN);
  assert.equal(toKFEN(fromKFEN(CLASSIC_KFEN.slice(0,-2))), CLASSIC_KFEN);
  assert.equal(toKFEN(fromKFEN('10/10/10/10/10/10/10/10 r 42')), '10/10/10/10/10/10/10/10 r 42');
  assert.deepEqual(Array.from(pos.hash), Array.from(recomputeHash(pos.board,pos.side)));
  assert.deepEqual(Array.from(pos.hash), [912565222, 3776868266]);
});
test('KFEN rejects malformed ranks, pieces, orientations, reservations, sides and ply', () => {
  for (const text of ['', '10/10 s', '11/10/10/10/10/10/10/10 s', '09/10/10/10/10/10/10/10 s',
    'F9/10/10/10/10/10/10/10 s', 'P09/10/10/10/10/10/10/10 s', 'Sw9/10/10/10/10/10/10/10 s',
    'C?9/10/10/10/10/10/10/10 s', 'Z-9/10/10/10/10/10/10/10 s', '10/10/10/10/10/10/10/10 x',
    '10/10/10/10/10/10/10/10 s -1', '10/10/10/10/10/10/10/10 s 1.5', '10/10/10/10/10/10/10/10 s 9007199254740992',
    '10/10/10/10/10/10/10/10/ s', '10/10/10/10/10/10/10/10 s 1 extra']) {
    assert.throws(() => fromKFEN(text), Error, text);
  }
});
test('Threefold includes side and orientation; clone and undo retain repetition history', () => {
  const pos = cyclePosition(), initial = pos.key();
  for (let i = 0; i < 7; i++) {
    pos.makeMove(parseMove(cycle[i % 4], pos));
    assert.equal(pos.result, null);
    if (i === 1) assert.notEqual(pos.key(), initial);
    if (i === 3) assert.equal(pos.key(), initial);
  }
  const clone = pos.clone(), text = cycle[3];
  clone.makeMove(parseMove(text, clone)); pos.makeMove(parseMove(text,pos));
  assert.equal(clone.result, 'draw'); assert.equal(pos.result, 'draw');
  assert.equal(pos.key(), initial); assert.equal(pos.generateMoves(), 0);
  pos.unmakeMove(); assert.equal(pos.result, null);
  pos.makeMove(parseMove(text, pos)); assert.equal(pos.result, 'draw');
  for (let i = 0; i < 8; i++) pos.unmakeMove();
  assert.equal(pos.key(), initial); assert.equal(pos.ply,0); assert.equal(pos.result,null);
  const altered = fromPieces(pos.toPieces(), RED);
  assert.notEqual(altered.key(), pos.key()); assert.notDeepEqual(Array.from(altered.hash),Array.from(pos.hash));
});
test('Preallocated undo limit fails atomically and can be reserved outside hot paths', () => {
  const pos = new Position(cyclePosition().toPieces(), SILVER, 2);
  pos.makeMove(parseMove(cycle[0],pos)); pos.makeMove(parseMove(cycle[1],pos));
  const initial = pos.key(), hash = Array.from(pos.hash), move = parseMove(cycle[2],pos);
  assert.throws(() => pos.makeMove(move), /capacity exceeded/);
  assert.equal(pos.key(),initial); assert.deepEqual(Array.from(pos.hash),hash);
  pos.reserveHistory(8); pos.makeMove(move); pos.unmakeMove(); assert.equal(pos.key(),initial);
});
test('300 seeded random games: every make/unmake, incremental hash and KFEN round trip', () => {
  const random = rng(0x1234cafe), out = new Int32Array(MAX_MOVES), scratch = new Uint32Array(2);
  let plies = 0, wins = 0, repetitionDraws = 0, capped = 0;
  for (let game = 0; game < 300; game++) {
    const pos = newGame(), initialKey = pos.key(), initialKFEN = toKFEN(pos), initialHash = Array.from(pos.hash);
    const boardReference = pos.board, hashReference = pos.hash;
    function checkKFEN(): void {
      const text = toKFEN(pos), restored = fromKFEN(text);
      assert.equal(toKFEN(restored),text); assert.equal(restored.key(),pos.key());
      assert.deepEqual(Array.from(restored.hash),Array.from(pos.hash)); assert.equal(restored.ply,pos.ply);
      if (pos.result !== 'draw') assert.equal(restored.result,pos.result);
    }
    checkKFEN();
    while (pos.result === null && pos.ply < 300) {
      const count = pos.generateMoves(out); assert.ok(count > 0);
      const move = out[random() % count];
      const beforeKey = pos.key(), beforeKFEN = toKFEN(pos), beforeHash = Array.from(pos.hash), beforeSide = pos.side;
      pos.makeMove(move);
      recomputeHash(pos.board,pos.side,scratch); assert.deepEqual(pos.hash,scratch);
      const afterKey = pos.key(), afterKFEN = toKFEN(pos), afterHash = Array.from(pos.hash), afterResult = pos.result;
      checkKFEN();
      pos.unmakeMove();
      assert.equal(pos.key(),beforeKey); assert.equal(toKFEN(pos),beforeKFEN); assert.deepEqual(Array.from(pos.hash),beforeHash);
      assert.equal(pos.side,beforeSide); assert.equal(pos.result,null);
      pos.makeMove(move);
      assert.equal(pos.key(),afterKey); assert.equal(toKFEN(pos),afterKFEN); assert.deepEqual(Array.from(pos.hash),afterHash); assert.equal(pos.result,afterResult);
      assert.equal(pos.board,boardReference); assert.equal(pos.hash,hashReference);
      plies++;
    }
    if (pos.result === null) { assert.equal(pos.ply,300); capped++; pos.result = 'draw'; }
    else if (pos.result === 'draw') repetitionDraws++; else wins++;
    const clone = pos.clone(); assert.equal(clone.result,pos.result); assert.equal(clone.key(),pos.key());
    const length = pos.ply;
    for (let i = 0; i < length; i++) {
      pos.unmakeMove(); clone.unmakeMove();
      recomputeHash(pos.board,pos.side,scratch); assert.deepEqual(pos.hash,scratch);
      assert.equal(clone.key(),pos.key()); assert.equal(clone.result,pos.result);
    }
    assert.equal(pos.key(),initialKey); assert.equal(toKFEN(pos),initialKFEN); assert.deepEqual(Array.from(pos.hash),initialHash);
  }
  console.log(`Random games: 300; plies: ${plies}; wins: ${wins}; repetition draws: ${repetitionDraws}; harness cap draws: ${capped}`);
});
test('Classic perft is pinned at depths 0 through 3; traversal restores full state', () => {
  const pos = newGame(), initial = toKFEN(pos), hash = Array.from(pos.hash);
  assert.equal(perft(pos,0),1); assert.equal(perft(pos,1),77); assert.equal(perft(pos,2),5920); assert.equal(perft(pos,3),449414);
  assert.equal(toKFEN(pos),initial); assert.deepEqual(Array.from(pos.hash),hash); assert.equal(pos.result,null);
});
test('KFEN recovers a Pharaoh loss but intentionally resets repetition history', () => {
  const pos = fromPieces([p(79, SPHINX, SILVER),p(68,PHARAOH,SILVER),p(5,PHARAOH,RED)],SILVER);
  pos.makeMove(parseMove('i2-j2',pos)); const restored = fromKFEN(toKFEN(pos));
  assert.equal(restored.result,RED); assert.equal(restored.generateMoves(),0);
  const repeating = cyclePosition();
  for (let i = 0; i < 8; i++) repeating.makeMove(parseMove(cycle[i % 4],repeating));
  assert.equal(repeating.result,'draw'); assert.equal(fromKFEN(toKFEN(repeating)).result,null);
});
