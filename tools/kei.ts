import { createInterface } from 'node:readline';
import { bestMove, fromKFEN, newGame, parseMove } from '../packages/khet-engine/src/index.ts';
import type { SearchOptions } from '../packages/khet-engine/src/index.ts';

/** Reusable line handler; the CLI below handles only stdin/stdout transport. */
export class KEISession {
  position = newGame();
  quit = false;
  handleLine(line: string): string[] {
    const tokens = line.trim().split(/\s+/), command = tokens.shift();
    if (!command) return [];
    try {
      switch (command) {
        case 'kei': return ['id name khet-engine', 'keiok'];
        case 'isready': return ['readyok'];
        case 'newgame':
          if (tokens.length > 1) throw new Error('Usage: newgame [setup]');
          this.position = newGame(tokens[0]); return [];
        case 'position': {
          const marker = tokens.indexOf('moves');
          const positionTokens = marker < 0 ? tokens : tokens.slice(0, marker);
          const moveTokens = marker < 0 ? [] : tokens.slice(marker + 1);
          const mode = positionTokens.shift();
          if (mode !== 'startpos' && mode !== 'kfen') throw new Error('Expected position startpos or position kfen');
          if (mode === 'startpos' && positionTokens.length > 1) throw new Error('Usage: position startpos [setup] [moves ...]');
          const next = mode === 'startpos' ? newGame(positionTokens[0]) : fromKFEN(positionTokens.join(' '));
          next.reserveHistory(moveTokens.length + 1024);
          for (const move of moveTokens) next.makeMove(parseMove(move, next));
          this.position = next; return [];
        }
        case 'go': {
          const options: SearchOptions = {};
          if (tokens.length % 2) throw new Error('Expected go option/value pairs');
          for (let i = 0; i < tokens.length; i += 2) {
            const value = Number(tokens[i + 1]);
            if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid go option value');
            switch (tokens[i]) {
              case 'level': options.level = value; break;
              case 'movetime': options.timeMs = value; break;
              case 'depth': options.depth = value; break;
              default: throw new Error(`Unknown go option: ${tokens[i]}`);
            }
          }
          const result = bestMove(this.position, options);
          return [`info depth ${result.depth} score ${result.score} nodes ${result.nodes} pv ${result.pv.join(' ')}`, `bestmove ${result.move}`];
        }
        case 'stop': return [];
        case 'quit': this.quit = true; return [];
        default: throw new Error(`Unknown KEI command: ${command}`);
      }
    } catch (error) {
      return ['info string ' + (error instanceof Error ? error.message : String(error))];
    }
  }
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const session = new KEISession(), input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', line => {
    for (const output of session.handleLine(line)) process.stdout.write(output + '\n');
    if (session.quit) { input.close(); process.stdin.pause(); }
  });
}
