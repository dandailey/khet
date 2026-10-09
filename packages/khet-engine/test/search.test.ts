import test from 'node:test';
import assert from 'node:assert/strict';
import { ANUBIS, MATE, MAX_MOVES, PHARAOH, PYRAMID, RED, SCARAB, SILVER, SPHINX, applyMove, bestMove, fromPieces, newGame, parseMove, toKFEN } from '../src/index.ts';
import { TranspositionTable, fromTableScore, toTableScore } from '../src/search.ts';
import { piece as p, randomPositions } from './ai-fixtures.ts';

test('TT hash replacement invalidates evaluation and tactical caches together', () => {
  const tt = new TranspositionTable(2);
  tt.cacheEvaluation(11, 22, 77); tt.cacheTactical(11, 22, -1, false);
  assert.equal(tt.evaluation(11, 22), 77);
  assert.ok(tt.tactical(11, 22) >= 0);
  tt.store(12, 23, 0, 4, 9, 123, 1, 0);
  assert.equal(tt.evaluation(11, 22), null); assert.equal(tt.tactical(11, 22), -1);
  tt.cacheEvaluation(12, 23, 88); tt.cacheTactical(12, 23, -1, true);
  const entry = tt.probe(12, 23, 0), tactical = tt.tactical(12, 23);
  assert.ok(entry >= 0); assert.ok(tactical >= 0);
  assert.equal(tt.scores[entry], 9); assert.equal(tt.moves[entry], 123);
  assert.equal(tt.evaluation(12, 23), 88); assert.equal(tt.threats[tactical], 1);
  tt.store(12, 23, 0, 2, 5, 124, 1, 0);
  assert.equal(tt.depths[entry], 4); assert.equal(tt.moves[entry], 123);
});

test('Search takes wins in one: direct Sphinx rotation, pyramid reflection, scarab reflection', () => {
  const cases = [
    [p(79, SPHINX, SILVER), p(64, PHARAOH, SILVER), p(74, PHARAOH, RED), p(0, SPHINX, RED, 2)],
    [p(79, SPHINX, SILVER), p(74, PHARAOH, SILVER), p(44, PHARAOH, RED), p(49, PYRAMID, SILVER, 1), p(0, SPHINX, RED, 2)],
    [p(79, SPHINX, SILVER), p(74, PHARAOH, SILVER), p(44, PHARAOH, RED), p(49, SCARAB, SILVER, 1), p(0, SPHINX, RED, 2)],
  ];
  for (const pieces of cases) {
    const pos = fromPieces(pieces, SILVER), text = toKFEN(pos), hash = [...pos.hash];
    assert.ok(pos.hasWinInOne(SILVER));
    for (const depth of [1, 2, 3]) {
      const result = bestMove(pos, { depth, ttSize: 1024 });
      assert.equal(applyMove(pos, result.move).result, SILVER); assert.equal(result.score, MATE - 1);
    }
    assert.equal(toKFEN(pos), text); assert.deepEqual([...pos.hash], hash);
  }
});
test('500 random positions: depth 1 and 2 never self-kill when a safe move exists', () => {
  let checked = 0, dangerous = 0;
  const out = new Int32Array(MAX_MOVES);
  for (const pos of randomPositions(500, 0x34567)) {
    let safe = false, suicide = false;
    const count = pos.generateMoves(out);
    for (let i = 0; i < count; i++) {
      pos.makeMove(out[i]);
      if (pos.result === pos.side) suicide = true; else safe = true;
      pos.unmakeMove();
    }
    if (!safe) continue;
    if (suicide) dangerous++;
    for (const depth of [1, 2]) {
      const result = bestMove(pos, { depth, ttSize: 1024 });
      const next = applyMove(pos, result.move);
      assert.notEqual(next.result, next.side, `self-kill at depth ${depth}: ${toKFEN(pos)} ${result.move}`);
      checked++;
    }
  }
  console.log(`Self-kill verification: 500 positions; ${checked} searches at depths 1/2; ${dangerous} positions with a suicide option`);
});
test('Search blocks or dodges a win-in-one in four constructed positions', () => {
  const cases = [
    [p(0, SPHINX, RED, 1), p(4, PHARAOH, SILVER), p(65, PHARAOH, RED), p(79, SPHINX, SILVER)],
    [p(0, SPHINX, RED, 2), p(30, PYRAMID, RED), p(34, PHARAOH, SILVER), p(43, ANUBIS, SILVER, 3), p(65, PHARAOH, RED), p(79, SPHINX, SILVER)],
    [p(22, SPHINX, RED, 1), p(26, PHARAOH, SILVER), p(35, ANUBIS, SILVER, 3), p(5, PHARAOH, RED), p(79, SPHINX, SILVER)],
    [p(0, SPHINX, RED, 2), p(20, SCARAB, RED, 1), p(24, PHARAOH, SILVER), p(33, ANUBIS, SILVER, 3), p(65, PHARAOH, RED), p(79, SPHINX, SILVER)],
  ];
  for (const pieces of cases) {
    const pos = fromPieces(pieces, SILVER), out = new Int32Array(MAX_MOVES);
    assert.ok(pos.hasWinInOne(RED));
    const count = pos.generateMoves(out);
    let defences = 0;
    for (let i = 0; i < count; i++) {
      pos.makeMove(out[i]); if (pos.result !== RED && !pos.hasWinInOne(RED)) defences++; pos.unmakeMove();
    }
    assert.ok(defences > 0, 'fixture must have a defence');
    for (const depth of [1, 2, 3]) {
      const result = bestMove(pos, { depth, ttSize: 1024 });
      const next = applyMove(pos, result.move);
      assert.notEqual(next.result, RED); assert.equal(next.hasWinInOne(RED), false, result.move);
    }
  }
});
test('Quiet two-mirror setup forces a win in three plies, verified against every reply', () => {
  const pos = fromPieces([
    p(79, SPHINX, SILVER), p(76, PHARAOH, SILVER), p(0, SPHINX, RED, 2), p(4, PHARAOH, RED),
    p(3, SCARAB, SILVER), p(5, SCARAB, SILVER), p(13, SCARAB, SILVER), p(15, SCARAB, SILVER),
    p(49, SCARAB, SILVER, 1), p(44, PYRAMID, SILVER, 1),
  ], SILVER);
  assert.equal(pos.hasWinInOne(SILVER), false);
  const result = bestMove(pos, { depth: 3, ttSize: 4096 });
  assert.equal(result.score, MATE - 3);
  const next = applyMove(pos, result.move), out = new Int32Array(MAX_MOVES), count = next.generateMoves(out);
  assert.equal(next.result, null); assert.ok(count > 0);
  for (let i = 0; i < count; i++) {
    next.makeMove(out[i]);
    assert.ok(next.result === SILVER || (next.result === null && next.hasWinInOne(SILVER)), 'every defence must lose');
    next.unmakeMove();
  }
});
test('TT on/off: identical depth-2 move and score in 50 positions', () => {
  for (const pos of randomPositions(50, 0xabcdef)) {
    const a = bestMove(pos, { depth: 2, ttSize: 4096, seed: 77 });
    const b = bestMove(pos, { depth: 2, tt: false, seed: 77 });
    assert.equal(a.move, b.move, toKFEN(pos)); assert.equal(a.score, b.score, toKFEN(pos));
  }
  console.log('TT verification: 50 positions at depth 2; moves and scores identical with TT on/off');
});
test('Node/time aborts keep the last complete iteration and preserve state; fixed seed is deterministic', () => {
  const pos = newGame(), initial = toKFEN(pos), hash = [...pos.hash];
  const iterations: { move: string; depth: number }[] = [];
  const limited = bestMove(pos, { nodes: 600, ttSize: 1024, onIteration: r => iterations.push({ move: r.move, depth: r.depth }) });
  assert.equal(limited.nodes, 600); assert.ok(iterations.length > 0);
  assert.equal(limited.move, iterations.at(-1)!.move); assert.equal(limited.depth, iterations.at(-1)!.depth);
  const fallback = bestMove(pos, { nodes: 1, tt: false });
  assert.equal(fallback.depth, 0); assert.ok(parseMove(fallback.move, pos) >= 0);
  const timed = bestMove(pos, { timeMs: 10, ttSize: 1024 }); assert.ok(timed.timeMs < 1000);
  const a = bestMove(pos, { nodes: 400, ttSize: 1024, seed: 55 });
  const b = bestMove(pos, { nodes: 400, ttSize: 1024, seed: 55 });
  assert.deepEqual({ ...a, timeMs: 0 }, { ...b, timeMs: 0 });
  assert.equal(toKFEN(pos), initial); assert.deepEqual([...pos.hash], hash);
});
test('Mate scores normalize correctly across TT plies and all feature toggles run', () => {
  assert.equal(fromTableScore(toTableScore(MATE - 7, 3), 5), MATE - 9);
  assert.equal(fromTableScore(toTableScore(-MATE + 7, 3), 5), -MATE + 9);
  for (const opts of [{ nullMove: true }, { lmr: false }, { qsearch: false }, { threatExtension: false }]) {
    assert.ok(bestMove(newGame(), { ...opts, nodes: 250, ttSize: 1024 }).move);
  }
});
test('A second occurrence within the search path scores as draw before game threefold', () => {
  const pos = fromPieces([p(0, SPHINX, RED, 2), p(79, SPHINX, SILVER)], SILVER);
  assert.equal(pos.result, null);
  for (const tt of [false, true]) {
    const result = bestMove(pos, { depth: 4, tt, ttSize: 1024, qsearch: false });
    assert.equal(result.score, 0); assert.equal(result.depth, 4);
  }
  assert.equal(pos.result, null); assert.equal(pos.ply, 0);
});
