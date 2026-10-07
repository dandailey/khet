import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame } from '../src/index.ts';
import { refNewGame } from '../../khet-reference/src/index.ts';
import { measurePerft, referencePerft, runDifferential, setupNames } from '../../../tools/difftest.ts';
import { perft } from '../../../tools/perft.ts';

const counts = JSON.parse(readFileSync(new URL('./perft.json', import.meta.url), 'utf8')) as ReturnType<typeof measurePerft>;
for (const [index, setup] of setupNames.entries()) {
  test(`${setup}: 300 seeded games agree with the independent reference at every ply`, () => {
    const result = runDifferential({ games: 300, seed: 0xd1ff2026 + index, setup, legacy: 'none' });
    assert.deepEqual(result.reference, []);
    assert.equal(result.games, 300);
    assert.equal(result.outcomes.disagreement, 0);
    console.log(`${setup} differential: ${result.games} games; ${result.plies} plies; ${result.reference.length} disagreements`);
  });
  test(`${setup}: both engines agree with recorded perft(1..3)`, () => {
    assert.deepEqual(counts[setup].fast, counts[setup].reference);
    assert.equal(counts[setup].fast.length, 3);
    for (let depth = 1; depth <= 3; depth++) {
      assert.equal(perft(newGame(setup), depth), counts[setup].fast[depth - 1]);
      // If the recorded depth-3 reference traversal took over a minute, keep
      // CI at depth 2. The CLI --perft-out still always measures depth 3.
      if (depth < 3 || counts[setup].referenceSeconds[2] <= 60) {
        assert.equal(referencePerft(refNewGame(setup), depth), counts[setup].reference[depth - 1]);
      } else console.log(`${setup}: reference perft(3) recorded by the tool; test stops at depth 2 (>60s)`);
    }
  });
}
