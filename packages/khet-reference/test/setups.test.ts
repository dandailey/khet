import test from 'node:test';
import assert from 'node:assert/strict';
import { refNewGame } from '../src/index.ts';

for (const setup of ['classic', 'imhotep', 'dynasty'] as const) {
  test(`${setup} has the specified counts and 180-degree color symmetry`, () => {
    const pieces = refNewGame(setup).pieces;
    assert.equal(pieces.length, 26);
    assert.equal(new Set(pieces.map(p => p.row * 10 + p.col)).size, 26);
    for (const color of ['silver', 'red']) {
      for (const [type, count] of Object.entries({ pharaoh: 1, sphinx: 1, scarab: 2, anubis: 2, pyramid: 7 })) {
        assert.equal(pieces.filter(p => p.type === type && p.color === color).length, count);
      }
    }
    for (const p of pieces) {
      const twin = pieces.find(q => q.row === 7 - p.row && q.col === 9 - p.col);
      assert.deepEqual(twin, { ...p, row: 7 - p.row, col: 9 - p.col, color: p.color === 'silver' ? 'red' : 'silver',
        o: p.type === 'pharaoh' ? 0 : p.type === 'scarab' ? p.o : (p.o + 2) % 4 });
    }
    const another = refNewGame(setup);
    pieces[0].o = 0;
    assert.equal(another.pieces[0].o, 2);
  });
}
