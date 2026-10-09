import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { args, fail, integer, isMain } from '../lib/cli.ts';
import { random } from '../lib/random.ts';
import { ANUBIS, PHARAOH, PYRAMID, SPHINX, fromPieces, legalMoves, newGame, parseMove, RED, RESERVED, SCARAB, SETUPS, SILVER, toKFEN } from '../../packages/khet-engine/src/index.ts';
import type { Position } from '../../packages/khet-engine/src/index.ts';
import { boardTokens, engineIndex, KhetaiClient, ourMove } from './khetai.ts';
import type { KhetaiRawMove } from './khetai.ts';

export async function verify(count = 500, seed = 20261007, binary?: string) {
  const client = new KhetaiClient(binary), rng = random(seed), setups = Object.keys(SETUPS);
  const seen = new Set<string>();
  const illegal: { move: string; raw: KhetaiRawMove; kfen: string }[] = [];
  const differences: { move: string; kfen: string; reason: string }[] = [];
  const orientations = new Set<string>();
  let shots = 0, comparisons = 0, games = 0, gamePlies = 0;
  function fresh(): Position { games++; gamePlies = 0; return newGame(setups[Math.floor(rng() * setups.length)]); }
  function tokens(pos: Position): string { return boardTokens(pos, seen.size % 2 === 0).join(' '); }
  function checkLasers(pos: Position): void {
    for (const side of [SILVER, RED] as const) {
      const reply = client.request(`laser ${side} ${tokens(pos)}`);
      const match = /^laser (-?\d+) end (\d+)$/.exec(reply);
      assert.ok(match, reply);
      const expected = pos.traceLaser(side);
      const hit = +match[1] < 0 ? -1 : engineIndex(+match[1]);
      const end = engineIndex(+match[2]);
      assert.equal(hit, expected.hit, `laser hit side=${side} KFEN=${toKFEN(pos)}`);
      assert.equal(end, expected.path.at(-1), `laser end side=${side} KFEN=${toKFEN(pos)}`);
      shots++;
    }
  }
  function externalMoves(pos: Position): Set<string> {
    const reply = client.request(`moves ${pos.side} ${tokens(pos)}`).split(' ');
    assert.equal(reply[0], 'moves'); assert.equal(+reply[1], reply.length - 2);
    return new Set(reply.slice(2).map(text => {
      const [start, end, rotation] = text.split(',').map(Number);
      return ourMove(pos, { start, end, rotation, depth: 0 });
    }));
  }
  function swapDifference(pos: Position, move: string): string | null {
    const match = /^([a-j])([1-8])x([a-j])([1-8])$/.exec(move);
    if (!match) return null;
    const from = (8 - +match[2]) * 10 + match[1].charCodeAt(0) - 97;
    const to = (8 - +match[4]) * 10 + match[3].charCodeAt(0) - 97;
    const moving = pos.pieceAt(from), target = pos.pieceAt(to);
    if (moving?.type !== SCARAB || !target) return null;
    if (target.type === SPHINX) return 'sphinx-swap';
    if ((target.type === PYRAMID || target.type === ANUBIS) && RESERVED[from] >= 0 && RESERVED[from] !== target.color) return 'reserved-swap';
    return null;
  }
  try {
    // Explicit reverse-swap fixture: silver scarab b8 would displace red pyramid c7 onto b8.
    const fixture = fromPieces([
      { type: SPHINX, color: RED, o: 2, row: 0, col: 0 },
      { type: PHARAOH, color: RED, o: 0, row: 0, col: 5 },
      { type: SPHINX, color: SILVER, o: 0, row: 7, col: 9 },
      { type: PHARAOH, color: SILVER, o: 0, row: 7, col: 5 },
      { type: SCARAB, color: SILVER, o: 0, row: 0, col: 1 },
      { type: PYRAMID, color: RED, o: 0, row: 1, col: 2 },
    ], SILVER);
    assert.ok(externalMoves(fixture).has('b8xc7'));
    assert.ok(!legalMoves(fixture).includes('b8xc7'));
    checkLasers(fixture);
    const sphinxFixture = fromPieces([
      ...fixture.toPieces().filter(p => p.type !== SCARAB && p.type !== PYRAMID),
      { type: SCARAB, color: SILVER, o: 0, row: 6, col: 9 },
    ], SILVER);
    assert.ok(externalMoves(sphinxFixture).has('j2xj1'));
    assert.ok(!legalMoves(sphinxFixture).includes('j2xj1'));
    checkLasers(sphinxFixture);
    let pos = fresh();
    while (seen.size < count) {
      if (pos.result !== null || gamePlies >= 100) pos = fresh();
      const legal = legalMoves(pos);
      if (!legal.length) { pos = fresh(); continue; }
      if (!seen.has(pos.key())) {
        seen.add(pos.key());
        for (const p of pos.toPieces()) orientations.add(`${p.type}:${p.color}:${p.o}`);
        checkLasers(pos);
        const external = externalMoves(pos);
        for (const move of legal) assert.ok(external.has(move), `Missing external move ${move}: ${toKFEN(pos)}`);
        for (const move of external) if (!legal.includes(move)) {
          const reason = swapDifference(pos, move);
          assert.ok(reason, `Unexpected rule difference ${move}: ${toKFEN(pos)}`);
          differences.push({ move, kfen: toKFEN(pos), reason });
        }
        comparisons++;
        const raw = client.rawMove(pos, { depth: 2, timeMs: 25 }), move = ourMove(pos, raw);
        if (!legal.includes(move)) illegal.push({ move, raw, kfen: toKFEN(pos) });
        if (seen.size % 100 === 0) console.error(`Verified ${seen.size}/${count} positions; ${illegal.length} illegal search returns`);
      }
      pos.makeMove(parseMove(legal[Math.floor(rng() * legal.length)], pos)); gamePlies++;
    }
    return { seed, positions: seen.size, randomGames: games, laserChecks: shots, moveSetComparisons: comparisons,
      returnedMoves: count, legalReturnedMoves: count - illegal.length, illegalReturnedMoves: illegal,
      reservedSwapExtras: differences.filter(d => d.reason === 'reserved-swap').length,
      sphinxSwapExtras: differences.filter(d => d.reason === 'sphinx-swap').length, ruleDifferenceExamples: differences.slice(0, 10),
      targetedDifferences: ['b8xc7 displaces red onto silver reservation', 'j2xj1 swaps with own Sphinx'], orientations: [...orientations].sort(),
      note: 'Laser checks include both sides of every position plus two targeted fixtures; board inputs alternate 80/120 tokens. Search returns are not filtered.' };
  } finally { client.close(); }
}
export async function main(): Promise<void> {
  const flags = args();
  const report = await verify(integer(Number(flags.positions ?? 500), 'positions'), integer(Number(flags.seed ?? 20261007), 'seed', 0), flags.binary);
  const json = JSON.stringify(report, null, 2) + '\n';
  if (flags.out) await writeFile(flags.out, json);
  process.stdout.write(json);
  assert.equal(report.illegalReturnedMoves.length, 0, 'khetai returned illegal moves; see recorded moves and KFEN (rule differences are not filtered)');
}
if (isMain(import.meta.url)) main().catch(fail);
