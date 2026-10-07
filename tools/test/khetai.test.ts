import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../../packages/khet-engine/src/index.ts';
import { boardTokens, engineIndex, khetaiIndex, ourMove } from '../external/khetai.ts';
import { validateConfig } from '../lib/config.ts';
import { playGame } from '../lib/game.ts';
import { getEngine } from '../lib/engine.ts';

test('external move notation preserves swaps and canonicalizes symmetric rotations', () => {
  const pos = engine.newGame();
  const scarab = pos.toPieces().find(p => p.color === 0 && p.type === engine.SCARAB)!;
  const sq = scarab.row * 10 + scarab.col, index = khetaiIndex(sq);
  assert.equal(ourMove(pos, { start: index, end: index, rotation: 1, depth: 1 }), ourMove(pos, { start: index, end: index, rotation: -1, depth: 1 }));
  assert.equal(ourMove(pos, { start: 106, end: 106, rotation: -1, depth: 1 }), 'j1+');
  assert.equal(boardTokens(pos)[13], 'L2'); assert.equal(boardTokens(pos)[106], 'l0');
  for (let sq = 0; sq < 80; sq++) assert.equal(engineIndex(khetaiIndex(sq)), sq);
  for (const index of [0, 12, 23, 108, 119]) assert.throws(() => engineIndex(index), /Invalid/);
});

test('khetai config requires a millisecond limit and bounds the C depth arrays', () => {
  const config = { label: 'khetai-1s', player: 'khetai' as const, timeMs: 1000, depth: 25 };
  assert.deepEqual(validateConfig(config), config);
  assert.throws(() => validateConfig({ ...config, depth: 26 }), /khetai requires/);
  assert.throws(() => validateConfig({ label: 'khetai', player: 'khetai', nodes: 1 }), /khetai requires/);
});

test('an illegal khetai swap forfeits, records move and KFEN, and scores both colours correctly', async () => {
  const pos = engine.fromPieces([
    { type: engine.SPHINX, color: 1, o: 2, row: 0, col: 0 },
    { type: engine.PHARAOH, color: 1, o: 0, row: 0, col: 5 },
    { type: engine.SPHINX, color: 0, o: 0, row: 7, col: 9 },
    { type: engine.PHARAOH, color: 0, o: 0, row: 7, col: 5 },
    { type: engine.SCARAB, color: 0, o: 0, row: 0, col: 1 },
    { type: engine.PYRAMID, color: 1, o: 0, row: 1, col: 2 },
  ]);
  const opening = engine.toKFEN(pos);
  const external = { label: 'external', player: 'khetai' as const, timeMs: 1, depth: 1 };
  const local = { label: 'local', player: 'random' as const, nodes: 1 };
  for (const aSilver of [true, false]) {
    const result = await playGame({ id: 0, pair: 0, opening, a: aSilver ? external : local,
      b: aSilver ? local : external, aSilver, seed: 1 }, await getEngine(), () => ({ move: 'b8xc7', depth: 1, nodes: 0, score: 0, pv: [] }));
    assert.equal(result.termination, 'illegal-move'); assert.equal(result.plies, 0);
    assert.deepEqual(result.illegalMove, { move: 'b8xc7', kfen: opening, player: 'external' });
    assert.equal(result.scoreA, aSilver ? 0 : 1);
    assert.equal(result.result, aSilver ? 'B' : 'A');
  }
});
