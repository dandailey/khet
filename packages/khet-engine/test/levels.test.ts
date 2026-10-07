import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANUBIS, LEVELS, MATE, MAX_MOVES, PHARAOH, PYRAMID, RED, SCARAB, SILVER, SPHINX,
  applyMove, bestMove, evaluate, fromPieces, legalMoves, levelOptions, newGame, search, toKFEN } from '../src/index.ts';
import { KEISession, parseGo } from '../src/kei.ts';
import { piece as p } from './ai-fixtures.ts';
import { searchOptions, validateConfig } from '../../../tools/lib/config.ts';
import type { LevelConfig } from '../../../tools/levels.ts';

test('Five tunable levels have the specified defaults and reject invalid levels', () => {
  assert.deepEqual(LEVELS.map(l => [l.level, l.name, l.temperature]), [
    [1, 'Novice', 120], [2, 'Casual', 60], [3, 'Club', 20], [4, 'Expert', 0], [5, 'Master', 0],
  ]);
  assert.deepEqual(LEVELS.map(l => l.limits), [
    { depth: 1 }, { depth: 2 }, { timeMs: 300, depth: 4 }, { timeMs: 1000 }, { timeMs: 3000 },
  ]);
  for (const level of [0, 6, 1.5, NaN]) {
    assert.throws(() => levelOptions(level));
    assert.throws(() => bestMove(newGame(), { level, nodes: 1 }));
  }
});

test('Every level takes immediate wins, even when the search budget is one node', () => {
  const cases = [
    [p(79, SPHINX, SILVER), p(64, PHARAOH, SILVER), p(74, PHARAOH, RED), p(0, SPHINX, RED, 2)],
    [p(79, SPHINX, SILVER), p(74, PHARAOH, SILVER), p(44, PHARAOH, RED), p(49, PYRAMID, SILVER, 1), p(0, SPHINX, RED, 2)],
    [p(79, SPHINX, SILVER), p(74, PHARAOH, SILVER), p(44, PHARAOH, RED), p(49, SCARAB, SILVER, 1), p(0, SPHINX, RED, 2)],
  ];
  for (const pieces of cases) for (let level = 1; level <= 5; level++) for (const nodes of [1, 500]) {
    const pos = fromPieces(pieces, SILVER), initial = toKFEN(pos);
    assert.ok(pos.hasWinInOne(SILVER));
    const result = bestMove(pos, { level, nodes, seed: 33, ttSize: 1024 });
    assert.equal(applyMove(pos, result.move).result, SILVER);
    assert.equal(result.score, MATE - 1);
    assert.equal(toKFEN(pos), initial);
  }
});

test('Every level avoids destroying its own Pharaoh when another move exists', () => {
  const pos = fromPieces([
    p(79, SPHINX, SILVER), p(74, PHARAOH, SILVER), p(4, PHARAOH, RED), p(0, SPHINX, RED, 2),
  ], SILVER);
  const moves = legalMoves(pos);
  assert.ok(moves.some(move => applyMove(pos, move).result === RED));
  assert.ok(moves.some(move => applyMove(pos, move).result !== RED));
  for (let level = 1; level <= 5; level++) for (const nodes of [1, 500]) for (let seed = 0; seed < 8; seed++) {
    const result = bestMove(pos, { level, nodes, seed, ttSize: 1024 });
    assert.notEqual(applyMove(pos, result.move).result, RED, `level ${level}, seed ${seed}`);
  }
});

test('Levels 2–5 avoid an opponent win-in-one whenever a defence exists', () => {
  const cases = [
    [p(0, SPHINX, RED, 1), p(4, PHARAOH, SILVER), p(65, PHARAOH, RED), p(79, SPHINX, SILVER)],
    [p(0, SPHINX, RED, 2), p(30, PYRAMID, RED), p(34, PHARAOH, SILVER), p(43, ANUBIS, SILVER, 3), p(65, PHARAOH, RED), p(79, SPHINX, SILVER)],
    [p(22, SPHINX, RED, 1), p(26, PHARAOH, SILVER), p(35, ANUBIS, SILVER, 3), p(5, PHARAOH, RED), p(79, SPHINX, SILVER)],
    [p(0, SPHINX, RED, 2), p(20, SCARAB, RED, 1), p(24, PHARAOH, SILVER), p(33, ANUBIS, SILVER, 3), p(65, PHARAOH, RED), p(79, SPHINX, SILVER)],
  ];
  for (const pieces of cases) {
    const pos = fromPieces(pieces, SILVER);
    assert.ok(pos.hasWinInOne(RED));
    const children = legalMoves(pos).map(move => applyMove(pos, move));
    assert.ok(children.some(next => next.result !== RED && !next.hasWinInOne(RED)));
    assert.ok(children.some(next => next.hasWinInOne(RED)));
    for (let level = 2; level <= 5; level++) for (const nodes of [1, 500]) for (const seed of [0, 1, 77]) {
      const result = bestMove(pos, { level, nodes, seed, ttSize: 1024 });
      const next = applyMove(pos, result.move);
      assert.notEqual(next.result, RED);
      assert.equal(next.hasWinInOne(RED), false, `level ${level}, ${result.move}`);
    }
  }
});

test('Level searches are deterministic with fixed seeds and node budgets', () => {
  const pos = newGame(), initial = toKFEN(pos), hash = [...pos.hash];
  for (let level = 1; level <= 5; level++) {
    const opts = { level, nodes: 500, seed: 123, ttSize: 1024 };
    const a = bestMove(pos, opts), b = bestMove(pos, opts);
    assert.deepEqual({ ...a, timeMs: 0 }, { ...b, timeMs: 0 });
  }
  assert.equal(toKFEN(pos), initial); assert.deepEqual([...pos.hash], hash);
});

test('Temperature zero uses the plain search move; explicit limits override level defaults', () => {
  const pos = newGame(), opts = { depth: 1, nodes: 2000, timeMs: 10000, seed: 52, ttSize: 1024 };
  const plain = search(pos, opts);
  for (const level of [4, 5]) {
    const result = bestMove(pos, { ...opts, level });
    assert.equal(result.move, plain.move); assert.equal(result.score, plain.score);
    assert.equal(result.depth, 1); assert.equal(result.rootScores, undefined);
  }
  assert.equal(bestMove(pos, { level: 1, depth: 2, ttSize: 1024 }).depth, 2);
  assert.equal(bestMove(pos, { level: 3, nodes: 1, ttSize: 1024 }).nodes, 1);
});

test('Novice softmax selects varied Classic opening moves across seeds', () => {
  const pos = newGame(), choices = new Set<string>();
  for (let seed = 0; seed < 24; seed++) {
    const result = bestMove(pos, { level: 1, seed, ttSize: 1024 });
    assert.equal(result.depth, 1); choices.add(result.move);
  }
  assert.ok(choices.size > 1, `Only ${choices.size} distinct move`);
});

test('Root scores cover all legal moves and aborts retain only a completed iteration', () => {
  const pos = newGame(), iterations: ReturnType<typeof search>[] = [];
  const result = search(pos, { rootScores: true, nodes: 500, ttSize: 1024,
    onIteration: iteration => iterations.push(iteration) });
  assert.ok(iterations.length > 0);
  assert.deepEqual(result.rootScores, iterations.at(-1)!.rootScores);
  assert.equal(result.depth, iterations.at(-1)!.depth);
  assert.deepEqual(result.rootScores!.map(entry => entry.move).sort(), legalMoves(pos).sort());
  assert.equal(result.score, Math.max(...result.rootScores!.map(entry => entry.score)));
  assert.equal(search(pos, { rootScores: true, nodes: 1, tt: false }).rootScores, undefined);
  assert.ok(result.rootScores!.length <= MAX_MOVES);
});

test('Full-window root scores match static and tactical leaves, including moves below the best', () => {
  const pos = newGame();
  const result = search(pos, { depth: 1, rootScores: true, qsearch: false,
    threatExtension: false, hangingPieces: false, ttSize: 1024 });
  for (const entry of result.rootScores!) {
    const next = applyMove(pos, entry.move);
    assert.equal(next.result, null);
    const expected = next.hasWinInOne(next.side) ? -MATE + 2 : -evaluate(next, undefined, false);
    assert.equal(entry.score, expected, entry.move);
  }
  const win = fromPieces([
    p(79, SPHINX, SILVER), p(64, PHARAOH, SILVER), p(74, PHARAOH, RED), p(0, SPHINX, RED, 2),
  ], SILVER);
  const winningScores = search(win, { depth: 1, rootScores: true, ttSize: 1024 });
  assert.equal(winningScores.rootScores!.length, legalMoves(win).length);
  assert.equal(winningScores.score, MATE - 1);
});

test('KEI supports level defaults and explicit movetime; calibration configs need no limits', () => {
  assert.deepEqual(parseGo(['level', '1', 'movetime', '20']), { level: 1, timeMs: 20 });
  assert.throws(() => parseGo(['level', '6']));
  const session = new KEISession();
  const expected = bestMove(session.position, { level: 1 });
  assert.equal(session.handleLine('go level 1').at(-1), `bestmove ${expected.move}`);
  assert.match(session.handleLine('go level 1 movetime 20').at(-1)!, /^bestmove /);
  const config = JSON.parse(readFileSync(new URL('../../../tools/configs/levels.json', import.meta.url), 'utf8')) as { levels: LevelConfig[] };
  assert.equal(config.levels.length, 5);
  for (const entry of config.levels) {
    validateConfig(entry); assert.equal(entry.player, 'engine');
    assert.deepEqual(searchOptions(entry), { level: entry.level, ttSize: 65536 });
  }
  assert.throws(() => validateConfig({ label: 'missing limits' }));
  assert.throws(() => validateConfig({ label: 'invalid level', options: { level: 6 } }));
});
