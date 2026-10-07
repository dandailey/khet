import test from 'node:test';
import assert from 'node:assert/strict';
import { ANUBIS, BEAM_NEXT, MAX_MOVES, NEIGHBOURS, PHARAOH, PYRAMID, RED, RESERVED, ROT_CCW, ROT_CW, SCARAB, SILVER, SPHINX, SWAP, applyMove, bestMove, encodeMove, fromKFEN, fromPieces, laserResult, legalMoves, moveToString, newGame, parseMove, toKFEN } from '../src/index.ts';
import type { PlacedPiece } from '../src/index.ts';
function p(sq: number, type: number, color: 0 | 1, o = 0): PlacedPiece {
  return { row: Math.floor(sq / 10), col: sq % 10, type, color, o };
}
function moves(pieces: PlacedPiece[]): number[] {
  const pos = fromPieces(pieces, SILVER), out: number[] = [];
  pos.generateMoves(out); return out;
}
test('Geometry tables contain all and only on-board neighbours; reservations are exact', () => {
  for (let sq = 0; sq < 80; sq++) {
    const r = Math.floor(sq / 10), c = sq % 10;
    const expected = c === 0 || ((r === 0 || r === 7) && c === 8) ? RED :
      c === 9 || ((r === 0 || r === 7) && c === 1) ? SILVER : -1;
    assert.equal(RESERVED[sq], expected);
    const actual = Array.from(NEIGHBOURS.slice(sq * 8, sq * 8 + 8)).filter(x => x >= 0).sort((a,b) => a-b);
    const expectedNeighbours: number[] = [];
    for (let t = 0; t < 80; t++) if (t !== sq && Math.abs(Math.floor(t / 10) - r) <= 1 && Math.abs(t % 10 - c) <= 1) expectedNeighbours.push(t);
    assert.deepEqual(actual, expectedNeighbours);
    assert.deepEqual(Array.from(BEAM_NEXT.slice(sq * 4, sq * 4 + 4)), [r > 0 ? sq - 10 : -1, c < 9 ? sq + 1 : -1, r < 7 ? sq + 10 : -1, c > 0 ? sq - 1 : -1]);
  }
});
test('Scarab swaps only with adjacent Pyramid or Anubis of either color, without rotation', () => {
  for (const type of [PHARAOH, SPHINX, PYRAMID, SCARAB, ANUBIS]) for (const color of [SILVER, RED] as const) {
    const pos = fromPieces([p(44, SCARAB, SILVER, 1), p(45, type, color, type === PHARAOH ? 0 : 1)], SILVER);
    const swap = encodeMove(44, 45, SWAP), out: number[] = [];
    pos.generateMoves(out);
    assert.equal(out.includes(swap), type === PYRAMID || type === ANUBIS);
    if (out.includes(swap)) {
      const initial = pos.key(); pos.makeMove(swap);
      assert.deepEqual(pos.pieceAt(45), { type: SCARAB, color: SILVER, o: 1 });
      assert.deepEqual(pos.pieceAt(44), { type, color, o: 1 });
      pos.unmakeMove(); assert.equal(pos.key(), initial);
    }
  }
  assert.equal(moves([p(44, SCARAB, SILVER), p(46, PYRAMID, RED)]).includes(encodeMove(44, 46, SWAP)), false);
});
test('Swaps enforce the reserved destination of both participants', () => {
  assert.equal(moves([p(19, SCARAB, SILVER), p(18, PYRAMID, RED)]).includes(encodeMove(19, 18, SWAP)), false);
  assert.equal(moves([p(18, SCARAB, SILVER), p(8, ANUBIS, RED)]).includes(encodeMove(18, 8, SWAP)), false);
  assert.equal(moves([p(19, SCARAB, SILVER), p(18, ANUBIS, SILVER)]).includes(encodeMove(19, 18, SWAP)), true);
  const red = fromPieces([p(10, SCARAB, RED), p(11, ANUBIS, SILVER)], RED), out: number[] = [];
  red.generateMoves(out); assert.equal(out.includes(encodeMove(10, 11, SWAP)), false);
});
test('Every step respects reservations for either color and keeps orientation', () => {
  for (const color of [SILVER, RED] as const) for (let sq = 0; sq < 80; sq++) {
    if (RESERVED[sq] !== -1 && RESERVED[sq] !== color) continue;
    const pos = fromPieces([p(sq, PYRAMID, color, 3)], color), out: number[] = [];
    pos.generateMoves(out);
    for (const move of out) {
      const to = (move >> 7) & 127;
      if ((move >> 14) !== 0) continue;
      assert.ok(RESERVED[to] === -1 || RESERVED[to] === color);
      const initial = pos.key(); pos.makeMove(move);
      assert.deepEqual(pos.pieceAt(to), { type: PYRAMID, color, o: 3 });
      pos.unmakeMove(); assert.equal(pos.key(), initial);
    }
  }
});
test('Pharaoh never rotates; Scarab toggles exactly once; Pyramid and Anubis have two rotations', () => {
  for (const type of [PHARAOH, SCARAB, PYRAMID, ANUBIS]) {
    const rotations = moves([p(44, type, SILVER)]).filter(m => (m >> 14) >= ROT_CW);
    assert.equal(rotations.length, type === PHARAOH ? 0 : type === SCARAB ? 1 : 2);
    for (const move of rotations) {
      const pos = fromPieces([p(44, type, SILVER)], SILVER); pos.makeMove(move);
      assert.equal(pos.pieceAt(44)?.o, type === SCARAB ? 1 : (move >> 14) === ROT_CW ? 1 : 3);
    }
  }
});
test('Sphinx never steps and generates exactly the permitted distinct rotations everywhere', () => {
  for (const color of [SILVER, RED] as const) for (let sq = 0; sq < 80; sq++) for (let o = 0; o < 4; o++) {
    if ((RESERVED[sq] !== -1 && RESERVED[sq] !== color) || BEAM_NEXT[sq * 4 + o] < 0) continue;
    const pos = fromPieces([p(sq, SPHINX, color, o)], color), out: number[] = [];
    pos.generateMoves(out);
    const expected = [(o + 1) & 3, (o + 3) & 3].filter(d => BEAM_NEXT[sq * 4 + d] >= 0).sort();
    const actual: number[] = [];
    for (const move of out) {
      assert.ok((move >> 14) >= ROT_CW); assert.equal(move & 127, sq); assert.equal((move >> 7) & 127, sq);
      if (expected.length === 1) assert.equal(move >> 14, ROT_CW);
      const initial = pos.key(); pos.makeMove(move);
      actual.push(pos.pieceAt(sq)!.o); pos.unmakeMove(); assert.equal(pos.key(), initial);
    }
    assert.deepEqual(actual.sort(), expected);
  }
});
test('Classic move count is computed and pinned; output buffers and notation agree', () => {
  const pos = newGame(), out = new Int32Array(MAX_MOVES), list: number[] = [];
  const count = pos.generateMoves(out); console.log(`Classic start legal moves: ${count}`);
  assert.equal(count, 77); assert.equal(pos.generateMoves(list), count); assert.equal(pos.generateMoves(), count);
  assert.deepEqual(Array.from(out.slice(0,count)), list); assert.equal(new Set(list).size, count);
  for (const move of list) assert.equal(parseMove(moveToString(move, pos), pos), move);
  assert.throws(() => pos.generateMoves(new Int32Array(1)), /buffer too small/);
});
test('Convenience wrappers preserve original state, clone undo and expose the required stub', () => {
  const pos = newGame(), original = toKFEN(pos), text = legalMoves(pos)[0], next = applyMove(pos, text);
  assert.equal(toKFEN(pos), original); assert.notEqual(toKFEN(next), original);
  next.unmakeMove(); assert.equal(toKFEN(next), original);
  assert.deepEqual(laserResult(pos, SILVER), pos.traceLaser(SILVER));
  assert.throws(() => bestMove(pos), { message: 'bestMove: not implemented' });
  assert.throws(() => newGame('unknown'), /Unknown setup/);
  assert.throws(() => newGame('toString'), /Unknown setup/);
  assert.equal(fromKFEN(original).key(), pos.key());
});
test('Malformed or illegal moves fail without changing the position', () => {
  const pos = newGame(), initial = pos.key(), hash = Array.from(pos.hash);
  for (const str of ['z9-a1', 'e1+', 'j1-j2', 'e1xf1', 'e1+garbage', 'j1-']) assert.throws(() => parseMove(str, pos));
  for (const move of [-1, 65536, 1.5, encodeMove(74,74,ROT_CW), encodeMove(79,69,0), encodeMove(79,79,ROT_CCW)]) {
    assert.throws(() => pos.makeMove(move), /Illegal move/); assert.equal(pos.key(),initial); assert.deepEqual(Array.from(pos.hash),hash);
  }
  assert.throws(() => pos.unmakeMove(), /No move/);
});
