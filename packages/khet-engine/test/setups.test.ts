import test from 'node:test';
import assert from 'node:assert/strict';
import { SETUPS, newGame, PHARAOH, SCARAB, SILVER, RED, SPHINX, PYRAMID, ANUBIS } from '../src/index.ts';

for (const setup of Object.keys(SETUPS)) {
  test(`${setup} has the specified counts and 180-degree color symmetry`, () => {
    const pieces = newGame(setup).toPieces();
    assert.equal(pieces.length, 26);
    assert.equal(new Set(pieces.map(p => p.row * 10 + p.col)).size, 26);
    for (const color of [SILVER, RED]) {
      for (const [type, count] of [[PHARAOH, 1], [SPHINX, 1], [SCARAB, 2], [ANUBIS, 2], [PYRAMID, 7]]) {
        assert.equal(pieces.filter(p => p.type === type && p.color === color).length, count);
      }
    }
    for (const p of pieces) {
      const twin = pieces.find(q => q.row === 7 - p.row && q.col === 9 - p.col);
      assert.deepEqual(twin, { ...p, row: 7 - p.row, col: 9 - p.col, color: p.color ^ 1,
        o: p.type === PHARAOH ? 0 : p.type === SCARAB ? p.o : (p.o + 2) & 3 });
    }
  });
}
