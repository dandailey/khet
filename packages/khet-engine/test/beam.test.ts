import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MOVES, PHARAOH, RED, SILVER, SPHINX, fromPieces, moveToString } from '../src/index.ts';
import { refApply, refFromPieces } from '../../khet-reference/src/index.ts';
import type { RefPiece } from '../../khet-reference/src/index.ts';
import { piece, randomPositions } from './ai-fixtures.ts';

test('500 random positions: changed shots are beam-relevant; win-in-one equals exhaustive play for either color', () => {
  const names = ['', 'pharaoh', 'sphinx', 'pyramid', 'scarab', 'anubis'] as const;
  let checked = 0, changed = 0;
  for (const pos of randomPositions(500)) for (const color of [SILVER, RED] as const) {
    const key = pos.key(), hash = [...pos.hash], pieces = pos.toPieces();
    const ref = refFromPieces(pieces.map(p => ({ ...p, type: names[p.type], color: p.color ? 'red' : 'silver' })) as RefPiece[], color ? 'red' : 'silver');
    const beam = new Int32Array(MAX_MOVES), all = new Int32Array(MAX_MOVES);
    const relevant = new Set(beam.subarray(0, pos.generateBeamMoves(color, beam)));
    const base = pos.traceLaser(color), count = pos.generateMovesFor(color, all);
    const mover = fromPieces(pieces, color);
    let win = false;
    for (let i = 0; i < count; i++) {
      const move = all[i], shot = refApply(ref, moveToString(move, mover)).laser;
      const from = move & 127, to = (move >>> 7) & 127, kind = move >>> 14;
      const original = kind <= 1 && shot.destroyed === to ? from : kind === 1 && shot.destroyed === from ? to : shot.destroyed;
      const hitType = original < 0 ? null : pos.pieceAt(original)!.type;
      if (shot.destroyed !== base.hit || hitType !== base.hitType || shot.path.join(',') !== base.path.slice(1).join(',')) {
        assert.ok(relevant.has(move), `${moveToString(move, mover)} missing at ${key}`); changed++;
      }
      const preview = pos.previewShot(move, color);
      assert.equal(preview < 0 ? -1 : preview & 127, shot.destroyed);
      mover.makeMove(move); win ||= mover.result === color; mover.unmakeMove();
      checked++;
    }
    assert.equal(pos.hasWinInOne(color), win);
    assert.equal(pos.key(), key); assert.deepEqual([...pos.hash], hash);
  }
  console.log(`Beam verification: 500 positions, both colors; ${checked} shots; ${changed} changed shots; brute-force win-in-one matched`);
});
test('An already winning base shot includes unchanged quiet winning actions', () => {
  const pos = fromPieces([piece(79, SPHINX, SILVER, 3), piece(74, PHARAOH, RED), piece(64, PHARAOH, SILVER)], SILVER);
  assert.equal(pos.hasWinInOne(SILVER), true);
});
