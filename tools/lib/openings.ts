import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getEngine, hasWinInOne } from './engine.ts';
import type { Engine } from './engine.ts';
import { random } from './random.ts';
import { args, fail, integer, isMain, numberArg } from './cli.ts';

export async function generateOpenings(n: number, seed = 1, engine?: Engine): Promise<string[]> {
  integer(n, 'opening count');
  integer(seed, 'seed', 0);
  const e = engine ?? await getEngine();
  const setups = Object.keys(e.SETUPS);
  if (n < setups.length) throw new Error(`At least ${setups.length} openings are needed to cover all setups`);
  const rng = random(seed), seen = new Set<string>(), result: string[] = [];
  for (let i = 0; i < n; i++) {
    const setup = setups[i % setups.length];
    const start = e.newGame(setup);
    const material = [e.SILVER, e.RED].map(color => start.toPieces().filter(p => p.color === color).length);
    let accepted = false;
    for (let tries = 0; tries < 10000; tries++) {
      let pos = start.clone();
      const plies = 2 + Math.floor(rng() * 3);
      for (let ply = 0; ply < plies && pos.result === null; ply++) {
        const moves = e.legalMoves(pos);
        if (!moves.length) break;
        pos = e.applyMove(pos, moves[Math.floor(rng() * moves.length)]);
      }
      if (pos.result !== null || pos.ply - start.ply !== plies || seen.has(pos.key())) continue;
      if ([e.SILVER, e.RED].some((color, j) => pos.toPieces().filter(p => p.color === color).length !== material[j])) continue;
      if (hasWinInOne(pos, pos.side, e)) continue;
      seen.add(pos.key()); result.push(e.toKFEN(pos)); accepted = true; break;
    }
    if (!accepted) throw new Error(`Could not generate opening ${i + 1} from ${setup}`);
  }
  return result;
}

export async function writeOpenings(path: string, openings: string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, openings.join('\n') + '\n');
}
export async function readOpenings(path: string, engine?: Engine): Promise<string[]> {
  const e = engine ?? await getEngine();
  const lines = (await readFile(path, 'utf8')).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  if (!lines.length) throw new Error(`No openings in ${path}`);
  return lines.map((line, i) => {
    try { return e.toKFEN(e.fromKFEN(line)); }
    catch (error) { throw new Error(`Invalid opening ${i + 1}: ${String(error)}`); }
  });
}

if (isMain(import.meta.url)) {
  const flags = args();
  generateOpenings(integer(numberArg(flags.n, 100, 'n'), 'n'), numberArg(flags.seed, 1, 'seed', 0))
    .then(async openings => { await writeOpenings(flags.out ?? 'tools/data/openings.txt', openings); console.log(`Wrote ${openings.length} balanced openings`); }).catch(fail);
}
