import {
  bestMove, fromKFEN, legalMoves, newGame, parseMove,
} from '../../packages/khet-engine/src/index.ts';
import type { Position, SearchOptions, SearchResult } from '../../packages/khet-engine/src/index.ts';

/** Synchronous KEI core shared by the Web Worker and Node smoke tests. */
export function createKEIEngine(send: (line: string) => void, random = Math.random): (command: string) => void {
  let position: Position = newGame();
  let closed = false;
  function search(options: SearchOptions): SearchResult {
    try { return bestMove(position, options); }
    catch (error) {
      if (!(error instanceof Error) || !/not implemented/i.test(error.message)) throw error;
      const moves = legalMoves(position);
      const safe = moves.filter(move => {
        const next = position.clone(); next.makeMove(parseMove(move, next));
        return next.result !== (position.side ^ 1);
      });
      const candidates = safe.length ? safe : moves;
      const move = candidates[Math.floor(random() * candidates.length)] ?? '(none)';
      send('info string bestMove not implemented; random legal fallback (avoids self-kill when possible)');
      return { move, depth: 0, score: 0, nodes: moves.length, pv: move === '(none)' ? [] : [move] };
    }
  }
  return command => {
    if (closed) return;
    try {
      const words = command.trim().split(/\s+/), verb = words.shift();
      if (verb === 'kei') { send('id name Khet play worker'); send('keiok'); }
      else if (verb === 'isready') send('readyok');
      else if (verb === 'newgame') position = newGame(words[0] ?? 'classic');
      else if (verb === 'position') {
        const movesAt = words.indexOf('moves');
        const fields = movesAt < 0 ? words : words.slice(0, movesAt);
        let next: Position;
        if (fields[0] === 'kfen') next = fromKFEN(fields.slice(1).join(' '));
        else if (fields[0] === 'startpos') next = newGame(fields[1] ?? 'classic');
        else throw new Error('Expected position kfen or startpos');
        if (movesAt >= 0) for (const move of words.slice(movesAt + 1)) next.makeMove(parseMove(move, next));
        position = next;
      } else if (verb === 'go') {
        const options: SearchOptions = {};
        for (let i = 0; i < words.length; i += 2) {
          const value = Number(words[i + 1]);
          if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid go option');
          if (words[i] === 'level') options.level = value;
          else if (words[i] === 'movetime') options.timeMs = value;
          else if (words[i] === 'depth') options.depth = value;
          else throw new Error('Unknown go option');
        }
        if (position.result !== null) { send('bestmove (none)'); return; }
        const result = search(options);
        send(`info depth ${result.depth} score ${result.score} nodes ${result.nodes} pv ${result.pv.join(' ')}`);
        send(`bestmove ${result.move}`);
      } else if (verb === 'quit') closed = true;
      else if (verb !== 'stop') throw new Error(`Unknown KEI command: ${verb}`);
      // The main thread cancels synchronous search by terminating the worker.
    } catch (error) {
      send(`info string error ${error instanceof Error ? error.message : String(error)}`);
      send('bestmove (none)');
    }
  };
}
