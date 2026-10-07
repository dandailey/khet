import { open } from 'node:fs/promises';
import { args, fail, integer, isMain, numberArg } from './lib/cli.ts';
import { readConfig } from './lib/config.ts';
import { getEngine } from './lib/engine.ts';
import { readOpenings } from './lib/openings.ts';
import { formatSummary, runMatch } from './lib/match.ts';

export async function main(): Promise<void> {
  const flags = args();
  if (!flags.a || !flags.b) throw new Error('Usage: node tools/match.ts --a config.json --b config.json --games 20 [--concurrency 2] [--openings tools/data/openings.txt] [--sprt 0,10] [--out results.jsonl]');
  const [a, b, openings, engine] = await Promise.all([readConfig(flags.a), readConfig(flags.b), readOpenings(flags.openings ?? 'tools/data/openings.txt'), getEngine()]);
  if (engine.fixture || !engine.bestMove) console.error(`Search unavailable: ${engine.fixture ? 'using harness rules fixture and ' : ''}stub players (default greedy).`);
  const hypotheses = flags.sprt?.split(',').map(Number);
  if (hypotheses && (hypotheses.length !== 2 || hypotheses.some(n => !Number.isFinite(n)))) throw new Error('--sprt requires elo0,elo1');
  const file = flags.out ? await open(flags.out, 'a') : undefined;
  // Synchronous writes prevent an unbounded output queue and preserve JSONL order.
  const { writeSync } = await import('node:fs');
  try {
    const summary = await runMatch({ a, b, openings,
      games: integer(numberArg(flags.games, 20, 'games'), 'games'),
      concurrency: integer(numberArg(flags.concurrency, 2, 'concurrency'), 'concurrency'),
      seed: numberArg(flags.seed, 1, 'seed', 0),
      ...(hypotheses ? { sprt: { elo0: hypotheses[0], elo1: hypotheses[1] } } : {}),
      onGame: game => { const line = JSON.stringify(game) + '\n'; if (file) writeSync(file.fd, line); else process.stdout.write(line); },
      onPair: s => console.error(formatSummary(s)),
    });
    console.error(`Final: ${formatSummary(summary)}`);
    if (summary.stoppedAt) console.error(`Stopped scheduling at pair ${summary.stoppedAt.pairs}; completed all in-flight colour pairs.`);
  } finally { await file?.close(); }
}
if (isMain(import.meta.url)) main().catch(fail);
