import { bestMove, fromKFEN, newGame, parseMove } from './index.ts';
import type { SearchOptions, SearchResult } from './types.ts';
import { levelOptions } from './levels.ts';

export function parseGo(tokens: string[]): SearchOptions {
  const options: SearchOptions = {};
  if (tokens.length % 2) throw new Error('Expected go option/value pairs');
  for (let i = 0; i < tokens.length; i += 2) {
    const value = Number(tokens[i + 1]);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid go option value');
    switch (tokens[i]) {
      case 'level': levelOptions(value); options.level = value; break;
      case 'movetime': options.timeMs = value; break;
      case 'depth': if (value > 64) throw new Error('Maximum search depth is 64'); options.depth = value; break;
      case 'nodes': options.nodes = value; break;
      default: throw new Error(`Unknown go option: ${tokens[i]}`);
    }
  }
  return options;
}
export function infoLine(result: SearchResult): string {
  return `info depth ${result.depth} score ${result.score} nodes ${result.nodes} pv ${result.pv.join(' ')}`;
}
function errorLine(error: unknown): string { return 'info string ' + (error instanceof Error ? error.message : String(error)); }

/** Transport-independent synchronous session, also used inside search workers. */
export class KEISession {
  position = newGame();
  positionLine = 'position startpos';
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
          this.position = newGame(tokens[0]); this.positionLine = `position startpos ${tokens[0] ?? 'classic'}`; return [];
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
          this.position = next; this.positionLine = line; return [];
        }
        case 'go': {
          const result = bestMove(this.position, parseGo(tokens));
          return [infoLine(result), `bestmove ${result.move || '(none)'}`];
        }
        case 'stop': return [];
        case 'quit': this.quit = true; return [];
        default: throw new Error(`Unknown KEI command: ${command}`);
      }
    } catch (error) { return [errorLine(error)]; }
  }
}

export interface SearchRequest { positionLine: string; goLine: string }
export type JobFactory = (request: SearchRequest, output: (line: string) => void, failure: (error: unknown) => void) => { terminate(): void };

/** Keeps protocol handling live while a child worker performs synchronous search.
 * stop returns its last completed iteration, or a safe fallback. */
export class KEIController {
  readonly session = new KEISession();
  private job: { terminate(): void } | null = null;
  private lastMove = '(none)';
  private generation = 0;
  private send: (line: string) => void;
  private spawn: JobFactory;
  constructor(send: (line: string) => void, spawn: JobFactory) { this.send = send; this.spawn = spawn; }
  handleLine(line: string): void {
    const tokens = line.trim().split(/\s+/), command = tokens.shift();
    if (command === 'go') {
      try {
        const options = parseGo(tokens);
        this.cancel(false);
        this.lastMove = bestMove(this.session.position, { ...options, nodes: 1, tt: false }).move || '(none)';
        const generation = ++this.generation;
        this.job = this.spawn({ positionLine: this.session.positionLine, goLine: line }, output => {
          if (generation !== this.generation) return;
          const match = /^info depth \d+ score -?\d+ nodes \d+ pv (\S+)/.exec(output);
          if (match) this.lastMove = match[1];
          this.send(output);
          if (output.startsWith('bestmove ')) this.cancel(false);
        }, error => {
          if (generation !== this.generation) return;
          this.send(errorLine(error)); this.cancel(true);
        });
      } catch (error) { this.send(errorLine(error)); }
      return;
    }
    if (command === 'stop') { this.cancel(true); return; }
    if (command === 'quit' || command === 'position' || command === 'newgame') this.cancel(false);
    for (const output of this.session.handleLine(line)) this.send(output);
  }
  private cancel(report: boolean): void {
    if (!this.job) return;
    ++this.generation; this.job.terminate(); this.job = null;
    if (report) this.send(`bestmove ${this.lastMove}`);
  }
}

/** Replaying the position command preserves game repetition history. */
export function runSearchRequest(request: SearchRequest, send: (line: string) => void): void {
  try {
    const session = new KEISession();
    const errors = session.handleLine(request.positionLine);
    if (errors.length) { errors.forEach(send); send('bestmove (none)'); return; }
    const options = parseGo(request.goLine.trim().split(/\s+/).slice(1));
    options.onIteration = result => send(infoLine(result));
    const result = bestMove(session.position, options);
    send(infoLine(result)); send(`bestmove ${result.move || '(none)'}`);
  } catch (error) { send(errorLine(error)); send('bestmove (none)'); }
}
