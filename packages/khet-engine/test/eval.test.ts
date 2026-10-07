import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PARAMS, EvalParams, PARAM_NAMES, PHARAOH, PYRAMID, RED, SCARAB, SILVER, SPHINX, applyMove, evaluate, evaluationFeatures, fromPieces } from '../src/index.ts';
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
