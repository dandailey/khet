import test from 'node:test';
import assert from 'node:assert/strict';
import { ANUBIS, PHARAOH, PYRAMID, RED, SCARAB, SILVER, SPHINX, fromPieces, parseMove } from '../src/index.ts';
import type { PlacedPiece } from '../src/index.ts';

const target = 44;
const emitters = [34, 45, 54, 43];
const dr = [-1, 0, 1, 0], dc = [0, 1, 0, -1];
function p(sq: number, type: number, color: 0 | 1, o = 0): PlacedPiece {
  return { row: Math.floor(sq / 10), col: sq % 10, type, color, o };
}
function reflectedPath(emitter: number, direction: number): number[] {
  const path = [emitter, target];
  let r = 4 + dr[direction], c = 4 + dc[direction];
  while (r >= 0 && r < 8 && c >= 0 && c < 10) {
    path.push(r * 10 + c); r += dr[direction]; c += dc[direction];
  }
  return path;
}
// Expectations are entry-face tables copied directly from the contract, independent of travel tables.
const pyramids = [[1, 0, -1, -1], [-1, 2, 1, -1], [-1, -1, 3, 2], [3, -1, -1, 0]];
const scarabs = [[1, 0, 3, 2], [3, 2, 1, 0]];
for (const color of [SILVER, RED] as const) {
  for (let o = 0; o < 4; o++) for (let face = 0; face < 4; face++) {
    test(`Pyramid color=${color} orientation=${o} entry=${face}`, () => {
      const pos = fromPieces([p(emitters[face], SPHINX, SILVER, (face + 2) & 3), p(target, PYRAMID, color, o)], SILVER);
      const exit = pyramids[o][face], result = pos.traceLaser(SILVER);
      assert.deepEqual(result, exit < 0 ? { path: [emitters[face], target], hit: target, hitType: PYRAMID } :
        { path: reflectedPath(emitters[face], exit), hit: -1, hitType: null });
    });
    test(`Anubis color=${color} orientation=${o} entry=${face}`, () => {
      const pos = fromPieces([p(emitters[face], SPHINX, SILVER, (face + 2) & 3), p(target, ANUBIS, color, o)], SILVER);
      assert.deepEqual(pos.traceLaser(SILVER), { path: [emitters[face], target], hit: face === o ? -1 : target, hitType: face === o ? null : ANUBIS });
    });
  }
  for (let o = 0; o < 2; o++) for (let face = 0; face < 4; face++) {
    test(`Scarab color=${color} orientation=${o} entry=${face}`, () => {
      const pos = fromPieces([p(emitters[face], SPHINX, SILVER, (face + 2) & 3), p(target, SCARAB, color, o)], SILVER);
      assert.deepEqual(pos.traceLaser(SILVER), { path: reflectedPath(emitters[face], scarabs[o][face]), hit: -1, hitType: null });
      assert.deepEqual(pos.pieceAt(target), { type: SCARAB, color, o });
    });
  }
  for (let face = 0; face < 4; face++) {
    test(`Pharaoh color=${color} entry=${face}`, () => {
      const pos = fromPieces([p(emitters[face], SPHINX, SILVER, (face + 2) & 3), p(target, PHARAOH, color)], SILVER);
      assert.deepEqual(pos.traceLaser(SILVER), { path: [emitters[face], target], hit: target, hitType: PHARAOH });
    });
  }
}
for (let o = 0; o < 4; o++) for (let face = 0; face < 4; face++) {
  test(`Sphinx orientation=${o} entry=${face} absorbs`, () => {
    const pos = fromPieces([p(emitters[face], SPHINX, SILVER, (face + 2) & 3), p(target, SPHINX, RED, o)], SILVER);
    assert.deepEqual(pos.traceLaser(SILVER), { path: [emitters[face], target], hit: -1, hitType: null });
  });
}
for (let direction = 0; direction < 4; direction++) {
  test(`Empty beam exits edge in direction ${direction}`, () => {
    const pos = fromPieces([p(target, SPHINX, SILVER, direction)], SILVER);
    assert.deepEqual(pos.traceLaser(SILVER), { path: reflectedPath(target, direction).slice(1), hit: -1, hitType: null });
  });
}
test('Missing emitter yields an empty path', () => {
  assert.deepEqual(fromPieces([], SILVER).traceLaser(SILVER), { path: [], hit: -1, hitType: null });
});
test('A scarab survives an actual shot of either color', () => {
  for (const color of [SILVER, RED] as const) for (let o = 0; o < 2; o++) {
    const pos = fromPieces([p(74, SPHINX, SILVER, 0), p(target, SCARAB, color, o), p(31, PHARAOH, SILVER), p(5, PHARAOH, RED)], SILVER);
    const initial = pos.key();
    pos.makeMove(parseMove('b5-c5', pos));
    assert.deepEqual(pos.pieceAt(target), { type: SCARAB, color, o });
    assert.equal(pos.result, null);
    pos.unmakeMove(); assert.equal(pos.key(), initial);
  }
});
test('Own Pharaoh in own beam loses, with exact undo', () => {
  const pos = fromPieces([p(79, SPHINX, SILVER), p(68, PHARAOH, SILVER), p(5, PHARAOH, RED)], SILVER);
  const initial = pos.key(), hash = Array.from(pos.hash);
  pos.makeMove(parseMove('i2-j2', pos));
  assert.equal(pos.result, RED); assert.equal(pos.pieceAt(69), null);
  assert.equal(pos.side, RED); assert.equal(pos.generateMoves(), 0);
  pos.unmakeMove();
  assert.equal(pos.key(), initial); assert.deepEqual(Array.from(pos.hash), hash); assert.equal(pos.result, null);
});
test('Own Pyramid hit on a nonmirror face is removed, with exact undo', () => {
  const pos = fromPieces([p(79, SPHINX, SILVER), p(68, PYRAMID, SILVER), p(74, PHARAOH, SILVER), p(5, PHARAOH, RED)], SILVER);
  const initial = pos.key();
  pos.makeMove(parseMove('i2-j2', pos));
  assert.equal(pos.pieceAt(69), null); assert.equal(pos.result, null);
  pos.unmakeMove(); assert.equal(pos.key(), initial);
});
test('Only the mover fires and only the first victim is removed', () => {
  const pos = fromPieces([p(79, SPHINX, SILVER), p(0, SPHINX, RED, 2), p(59, PYRAMID, SILVER), p(69, PYRAMID, SILVER), p(10, PYRAMID, RED), p(74, PHARAOH, SILVER), p(5, PHARAOH, RED)], SILVER);
  pos.makeMove(parseMove('e1-f2', pos));
  assert.equal(pos.pieceAt(69), null); assert.notEqual(pos.pieceAt(59), null); assert.notEqual(pos.pieceAt(10), null);
});
test('Destroying the opponent Pharaoh wins for the mover', () => {
  const pos = fromPieces([p(79, SPHINX, SILVER), p(69, PYRAMID, SILVER, 2), p(68, PHARAOH, RED), p(31, PHARAOH, SILVER)], SILVER);
  pos.makeMove(parseMove('b5-c5', pos));
  assert.equal(pos.result, SILVER); assert.equal(pos.pieceAt(68), null); assert.equal(pos.generateMoves(), 0);
});
test('Undo restores a swap victim on the origin and a rotated victim on the same square', () => {
  for (const swap of [false, true]) {
    const pieces = swap ? [p(79, SPHINX, SILVER), p(69, SCARAB, SILVER), p(68, PYRAMID, SILVER)] :
      [p(79, SPHINX, SILVER), p(69, PYRAMID, SILVER, 1)];
    const pos = fromPieces(pieces, SILVER), initial = pos.key(), hash = Array.from(pos.hash);
    pos.makeMove(parseMove(swap ? 'j2xi2' : 'j2-', pos));
    assert.equal(pos.pieceAt(69), null);
    pos.unmakeMove(); assert.equal(pos.key(), initial); assert.deepEqual(Array.from(pos.hash), hash);
  }
});
