import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as fixture from '../lib/stub-engine.ts';
import type { Engine, Position } from '../lib/engine.ts';
import { hasWinInOne, quiet, stubMove } from '../lib/engine.ts';
import { generateOpenings, readOpenings, writeOpenings } from '../lib/openings.ts';
import { playGame } from '../lib/game.ts';
import { MatchRunner, runMatch } from '../lib/match.ts';
import { tuneSpsa } from '../spsa.ts';
import type { SpsaConfig } from '../spsa.ts';
import { readTraining, tuneTexel } from '../texel.ts';
import { fitRatings } from '../levels.ts';

const engine: Engine = fixture;
const random = { label: 'Random', player: 'random' as const, nodes: 100 };
const greedy = { label: 'Greedy', player: 'greedy' as const, nodes: 100 };

test('KFEN round trips all setups, including slash and backslash scarabs', () => {
  assert.equal(fixture.toKFEN(fixture.newGame()).split(' ')[0].split('/')[0], 'ss3asf-asp22');
  for (const name of Object.keys(fixture.SETUPS)) {
    const pos = fixture.newGame(name), kfen = fixture.toKFEN(pos);
    assert.equal(fixture.fromKFEN(kfen).key(), pos.key());
    const start = pos.key(), moves: number[] = []; pos.generateMoves(moves);
    for (const move of moves) { pos.makeMove(move); pos.unmakeMove(); assert.equal(pos.key(), start); }
    assert.equal(pos.toPieces().length, 26);
  }
});

test('seeded openings are unique, capture-free, nonterminal and cover all setups', async () => {
  const openings = await generateOpenings(12, 77, engine);
  assert.deepEqual(openings, await generateOpenings(12, 77, engine));
  assert.equal(new Set(openings.map(s => fixture.fromKFEN(s).key())).size, 12);
  for (const line of openings) {
    const pos = fixture.fromKFEN(line);
    assert.ok(pos.ply >= 2 && pos.ply <= 4);
    assert.equal(pos.result, null);
    assert.equal(pos.toPieces().filter(p => p.color === 0).length, 13);
    assert.equal(pos.toPieces().filter(p => p.color === 1).length, 13);
    assert.equal(hasWinInOne(pos, pos.side, engine), false);
  }
  const dir = await mkdtemp('tools/test/.tmp-openings-');
  try { const path = join(dir, 'openings.txt'); await writeOpenings(path, openings); assert.deepEqual(await readOpenings(path, engine), openings); }
  finally { await rm(dir, { recursive: true }); }
});

function tactical(): fixture.Position {
  return fixture.fromPieces([
    { type: fixture.SPHINX, color: 0, o: 0, row: 7, col: 9 },
    { type: fixture.SPHINX, color: 1, o: 2, row: 0, col: 0 },
    { type: fixture.PHARAOH, color: 0, o: 0, row: 7, col: 4 },
    { type: fixture.PHARAOH, color: 1, o: 0, row: 2, col: 8 },
    { type: fixture.PYRAMID, color: 0, o: 2, row: 2, col: 9 },
  ]);
}
test('greedy takes an immediate Pharaoh win; quiet filtering detects kills and threats', () => {
  const pos = tactical();
  assert.ok(hasWinInOne(pos, 0, engine));
  const choice = stubMove(engine, pos, { nodes: 100, seed: 12 }, 'greedy');
  assert.equal(fixture.applyMove(pos, choice.move).result, 0);
  assert.equal(quiet(pos, engine), false);
  pos.side = 1;
  assert.equal(quiet(pos, engine), false);
});

test('match adjudicates threefold repetition and the 300-ply cap', async () => {
  const start = fixture.fromPieces([
    { type: fixture.SPHINX, color: 0, o: 0, row: 7, col: 9 },
    { type: fixture.SPHINX, color: 1, o: 2, row: 0, col: 0 },
    { type: fixture.PHARAOH, color: 0, o: 0, row: 5, col: 4 },
    { type: fixture.PHARAOH, color: 1, o: 0, row: 2, col: 5 },
  ]);
  const rotate: Engine = { ...fixture, bestMove(pos) {
    const move = fixture.legalMoves(pos as fixture.Position).find(m => m.startsWith(pos.side === 0 ? 'j1' : 'a8'))!;
    return { move, depth: 1, nodes: 1, score: 0, pv: [move] };
  } };
  const task = { id: 0, pair: 0, opening: fixture.toKFEN(start), a: { label: 'a', nodes: 1 }, b: { label: 'b', nodes: 1 }, aSilver: true, seed: 1 };
  const repeated = await playGame(task, rotate);
  assert.equal(repeated.termination, 'threefold'); assert.equal(repeated.plies, 8); assert.equal(repeated.result, 'draw');
  function unique(pos: Position): Position { pos.key = () => `test-unique-${pos.ply}`; return pos; }
  const cap: Engine = { ...rotate,
    fromKFEN: text => unique(fixture.fromKFEN(text)),
    applyMove: (pos, move) => unique(fixture.applyMove(pos as fixture.Position, move)),
  };
  const capped = await playGame(task, cap);
  assert.equal(capped.termination, 'ply-cap'); assert.equal(capped.plies, 300); assert.equal(capped.scoreA, 0.5);
});

test('20 games complete as colour pairs; results are deterministic across concurrency', async () => {
  const openings = await generateOpenings(6, 44, engine);
  const first: unknown[] = [], second: unknown[] = [];
  const a = await runMatch({ a: greedy, b: random, games: 20, openings, seed: 123, concurrency: 2, onGame: g => first.push(g) });
  const b = await runMatch({ a: greedy, b: random, games: 20, openings, seed: 123, concurrency: 1, onGame: g => second.push(g) });
  const byId = (items: unknown[]) => (items as { id: number }[]).sort((x, y) => x.id - y.id);
  assert.deepEqual(byId(first), byId(second)); assert.deepEqual(a, b);
  assert.equal(a.games, 20); assert.equal(a.pairs, 10); assert.equal(a.pentanomial.reduce((x, y) => x + y), 10);
  for (let pair = 0; pair < 10; pair++) {
    const games = first as { opening: string; colours: { a: string } }[];
    assert.equal(games[pair * 2].opening, games[pair * 2 + 1].opening);
    assert.equal(games[pair * 2].colours.a, 'silver'); assert.equal(games[pair * 2 + 1].colours.a, 'red');
  }
  const runner = new MatchRunner(1);
  try {
    await assert.rejects(runner.run({ a: greedy, b: random, games: 3, openings }), /even/);
    assert.throws(() => new MatchRunner(4), /capped/);
  } finally { await runner.close(); }
});

test('SPRT stops scheduling and drains complete pairs', async () => {
  const result = await runMatch({ a: greedy, b: random, games: 40,
    openings: await generateOpenings(3, 12, engine), concurrency: 2,
    sprt: { elo0: -10000, elo1: -9000 },
  });
  assert.ok(result.stoppedAt); assert.equal(result.stoppedAt.verdict, 'H1');
  assert.ok(result.games < 40); assert.equal(result.games % 2, 0);
  assert.ok(result.pairs <= result.stoppedAt.pairs + 1);
});

test('SPSA resumes exactly and rejects config changes; Texel generates and reduces MSE', async () => {
  const dir = await mkdtemp('tools/test/.tmp-tuning-');
  try {
    const openings = await generateOpenings(3, 123, engine);
    const config: SpsaConfig = { player: greedy, nodes: 100, iterations: 3, seed: 7, params: { pyramid: { start: 100, a: 10, c: 5 } } };
    const resumedLog = join(dir, 'resumed.jsonl'), fullLog = join(dir, 'full.jsonl');
    await tuneSpsa(config, openings, resumedLog, 1);
    const resumed = await tuneSpsa(config, openings, resumedLog, 3);
    assert.deepEqual(resumed, await tuneSpsa(config, openings, fullLog, 3));
    assert.equal(await readFile(resumedLog, 'utf8'), await readFile(fullLog, 'utf8'));
    assert.equal((await readFile(resumedLog, 'utf8')).trim().split('\n').length, 3);
    await assert.rejects(tuneSpsa({ ...config, nodes: 200 }, openings, resumedLog), /mismatch/);
    const rows: string[] = [];
    await runMatch({ a: greedy, b: greedy, games: 4, openings, concurrency: 1, sampling: { every: 5, maxPerGame: 12 },
      onGame: game => { for (const sample of game.samples ?? []) {
        assert.ok(quiet(fixture.fromKFEN(sample.kfen), engine)); rows.push(`${sample.kfen}\t${sample.result}`);
      } },
    });
    assert.ok(rows.length > 0);
    const path = join(dir, 'texel.txt'); await writeFile(path, rows.join('\n') + '\n');
    const data = await readTraining(path, engine, 100);
    const result = tuneTexel(data, engine, { params: { pyramid: { start: 100, step: 10 }, tempo: { start: 5, step: 2 } }, passes: 5 });
    assert.ok(Number.isFinite(result.K)); assert.ok(result.mse <= result.initialMse);
    assert.ok(result.mse >= 0 && result.mse <= 1);
  } finally { await rm(dir, { recursive: true }); }
});

test('joint level ratings anchor at level 1 and recover a known rating difference', () => {
  const summary = { wdl: { wins: 75, draws: 0, losses: 25 } } as Parameters<typeof fitRatings>[1][number]['summary'];
  const ratings = fitRatings(2, [{ a: 1, b: 0, summary }]);
  assert.equal(ratings[0], 0);
  assert.ok(Math.abs(ratings[1] - 400 * Math.log10(75.5 / 25.5)) < 1e-5);
});
