import test from 'node:test';
import assert from 'node:assert/strict';
import { ANUBIS, DEFAULT_PARAMS, EvalParams, MAX_MOVES, PARAM_NAMES, PHARAOH, PYRAMID, RED, SCARAB, SILVER, SPHINX, applyMove, evaluate, evaluationFeatures, fromPieces } from '../src/index.ts';
import { pieceColor, pieceType } from '../src/types.ts';
import type { Color } from '../src/index.ts';
import { piece as p, randomPositions } from './ai-fixtures.ts';

test('Named parameters use a flat Float64Array, independent defaults, and reject invalid input', () => {
  const p = new EvalParams({ pyramid: 123 });
  assert.ok(p.values instanceof Float64Array); assert.equal(p.values.length, PARAM_NAMES.length);
  assert.equal(p.get('pyramid'), 123); assert.equal(DEFAULT_PARAMS.get('pyramid'), 100);
  assert.deepEqual(new EvalParams(p.toJSON()).values, p.values);
  assert.throws(() => new EvalParams({ nonsense: 1 })); assert.throws(() => p.set('tempo', NaN));
});
test('Hanging pieces retain their identity across enemy Scarab swaps', () => {
  const pos = fromPieces([
    p(0, SPHINX, RED, 2), p(20, PYRAMID, RED), p(23, SCARAB, RED), p(24, PYRAMID, SILVER),
    p(79, SPHINX, SILVER), p(74, PHARAOH, SILVER), p(5, PHARAOH, RED),
  ], SILVER);
  assert.equal(evaluationFeatures(pos)[8], 1);
});
test('Hanging features match exhaustive shots, including unchanged base shots', () => {
  const moves = new Int32Array(MAX_MOVES);
  for (const pos of randomPositions(150, 0x987abc)) {
    const expected = [0, 0, 0];
    for (const color of [SILVER, RED] as const) {
      const enemy = (color ^ 1) as Color, sign = color === pos.side ? 1 : -1;
      const victims = new Set<number>(), count = pos.generateMovesFor(enemy, moves);
      for (let i = 0; i < count; i++) {
        const move = moves[i], shot = pos.previewShot(move, enemy);
        if (shot < 0 || pieceColor(shot >>> 7) !== color) continue;
        const hit = shot & 127;
        const identity = (move >>> 14) === 1 && hit === (move & 127) ? (move >>> 7) & 127 : hit;
        if (victims.has(identity)) continue;
        victims.add(identity);
        const type = pieceType(shot >>> 7);
        if (type === PYRAMID) expected[0] += sign;
        if (type === ANUBIS) expected[1] += sign;
        if (type === PHARAOH) expected[2] += sign;
      }
    }
    assert.deepEqual(Array.from(evaluationFeatures(pos).subarray(8, 11)), expected);
    const collected = [0, 0, 0], mask = new Uint8Array(80), victims = new Uint8Array(80);
    let complete = true;
    for (const attacker of [SILVER, RED] as const) {
      const base = pos.shotOnPath(attacker, mask);
      if (pos.findWinInOne(attacker, mask, base, victims) >= 0) { complete = false; break; }
      const sign = attacker === pos.side ? -1 : 1;
      for (const victim of victims) {
        if (pieceType(victim) === PYRAMID) collected[0] += sign;
        if (pieceType(victim) === ANUBIS) collected[1] += sign;
        if (pieceType(victim) === PHARAOH) collected[2] += sign;
      }
    }
    if (complete) {
      assert.deepEqual(collected, expected);
      assert.equal(evaluate(pos, DEFAULT_PARAMS, true, collected), evaluate(pos));
    }
    const params = new EvalParams({ hangingPyramid: 0, hangingAnubis: 0, hangingPharaoh: 0 });
    assert.equal(evaluate(pos, params), evaluate(pos, params, false));
  }
  console.log('Hanging verification: 150 positions; optimized features matched exhaustive shots for both colors');
});
test('Static evaluation remains symmetric for ended boards reconstructed without adjudication', () => {
  const pos = applyMove(fromPieces([
    p(79, SPHINX, SILVER), p(68, PHARAOH, SILVER), p(5, PHARAOH, RED), p(0, SPHINX, RED, 2),
  ], SILVER), 'i2-j2');
  assert.equal(pos.result, RED);
  const mirrored = fromPieces(pos.toPieces().map(piece => ({
    ...piece, color: (piece.color ^ 1) as Color, row: 7 - piece.row, col: 9 - piece.col,
    o: piece.type === PHARAOH ? 0 : (piece.o + 2) & 3,
  })), (pos.side ^ 1) as Color);
  assert.equal(evaluate(pos), evaluate(mirrored));
  pos.result = 'draw'; assert.equal(evaluate(pos), evaluate(mirrored));
});
test('300 random positions: every feature and nonzero piece-square table is color symmetric', () => {
  const params = new EvalParams();
  for (let i = 17; i < PARAM_NAMES.length; i++) params.values[i] = (i * 7 % 29) - 14;
  for (const pos of randomPositions(300, 0x123abcd)) {
    const mirrored = fromPieces(pos.toPieces().map(p => ({
      ...p, color: (p.color ^ 1) as Color, row: 7 - p.row, col: 9 - p.col,
      o: p.type === PHARAOH || p.type === SCARAB ? p.o : (p.o + 2) & 3,
    })), (pos.side ^ 1) as Color);
    assert.deepEqual(evaluationFeatures(pos), evaluationFeatures(mirrored));
    assert.equal(evaluate(pos, params), evaluate(mirrored, params));
    assert.equal(evaluate(pos), evaluate(mirrored));
  }
  console.log('Evaluation symmetry: 300 random positions; all features and nonzero PST weights matched');
});
