import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newGame, legalMoves } from '../../packages/khet-engine/src/index.ts';
import { boardTokens, KhetaiClient, ourMove } from './khetai.ts';

test('persistent CLI validates input, resets after laser calls, and supports the depth-25 boundary', () => {
  const client = new KhetaiClient(process.env.KHETAI_TEST_BINARY);
  const pos = newGame(), tokens = boardTokens(pos).join(' ');
  try {
    for (const line of ['go 2 1 100 ' + tokens, 'go 0 26 100 ' + tokens,
      'go 0 1 0 ' + tokens, 'go 0 1 100 --', 'laser 0 ' + tokens.replace(/^--/, 'p0')]) {
      assert.throws(() => client.request(line), /invalid-request/);
    }
    const first = client.rawMove(pos, { depth: 1, timeMs: 1000 });
    assert.equal(first.depth, 1);
    client.request(`laser 0 ${tokens}`); client.request(`laser 1 ${tokens}`);
    assert.deepEqual(client.rawMove(pos, { depth: 1, timeMs: 1000 }), first);
    const started = performance.now(), timed = client.rawMove(pos, { depth: 25, timeMs: 50 });
    assert.ok(performance.now() - started < 2000, '50ms budget should not take whole seconds');
    assert.ok(legalMoves(pos).includes(ourMove(pos, timed)));
    assert.ok(timed.depth >= 0 && timed.depth <= 25);
  } finally { client.close(); }
});
