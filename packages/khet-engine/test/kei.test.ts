import test from 'node:test';
import assert from 'node:assert/strict';
import { KEISession } from '../../../tools/kei.ts';
import { applyMove, legalMoves, newGame, toKFEN } from '../src/index.ts';

test('KEI handshake, newgame, position startpos and KFEN move replay', () => {
  const session = new KEISession();
  assert.deepEqual(session.handleLine('kei'), ['id name khet-engine','keiok']);
  assert.deepEqual(session.handleLine('isready'), ['readyok']);
  const start = newGame(), first = legalMoves(start)[0], afterFirst = applyMove(start,first), second = legalMoves(afterFirst)[0];
  const expected = applyMove(afterFirst,second);
  assert.deepEqual(session.handleLine(`position startpos classic moves ${first} ${second}`), []);
  assert.equal(toKFEN(session.position),toKFEN(expected));
  assert.deepEqual(session.handleLine(`position kfen ${toKFEN(afterFirst)} moves ${second}`), []);
  assert.equal(toKFEN(session.position),toKFEN(expected));
  session.handleLine('newgame'); assert.equal(toKFEN(session.position),toKFEN(start));
});
test('KEI failures leave the previous position intact; search exposes the required stub', () => {
  const session = new KEISession(), original = toKFEN(session.position);
  for (const line of ['newgame dynasty','position garbage','position startpos moves e1+', 'position kfen nonsense','go depth 0','go depth','go unknown 1']) {
    assert.match(session.handleLine(line)[0],/^info string /); assert.equal(toKFEN(session.position),original);
  }
  assert.deepEqual(session.handleLine('go level 1 movetime 10 depth 2'), ['info string bestMove: not implemented']);
  assert.deepEqual(session.handleLine('stop'), []); assert.deepEqual(session.handleLine('quit'), []); assert.equal(session.quit,true);
});
