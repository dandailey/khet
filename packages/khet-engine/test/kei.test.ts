import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { KEISession } from '../../../tools/kei.ts';
import { KEIController } from '../src/kei.ts';
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
test('KEI failures leave the previous position intact; go reports a searched legal move', () => {
  const session = new KEISession(), original = toKFEN(session.position);
  for (const line of ['newgame dynasty','position garbage','position startpos moves e1+', 'position kfen nonsense','go depth 0','go depth','go unknown 1']) {
    assert.match(session.handleLine(line)[0],/^info string /); assert.equal(toKFEN(session.position),original);
  }
  const lines = session.handleLine('go level 1 movetime 10 depth 2');
  assert.match(lines[0], /^info depth \d+ score -?\d+ nodes \d+ pv /);
  assert.ok(legalMoves(session.position).includes(lines[1].slice('bestmove '.length)));
  assert.deepEqual(session.handleLine('stop'), []); assert.deepEqual(session.handleLine('quit'), []); assert.equal(session.quit,true);
});

test('CLI scripted KEI: position startpos moves, go depth 3, bestmove', { timeout: 20000 }, async () => {
  // Worker stdin/stdout exercises the actual CLI in restricted test environments
  // that do not support child_process spawning.
  const child = new Worker(new URL('../../../tools/kei.ts', import.meta.url), { stdin: true, stdout: true, stderr: true });
  let output = '', errors = '', sentQuit = false;
  let finish: () => void = () => {};
  const bestmove = new Promise<void>(resolve => { finish = resolve; });
  child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { errors += chunk; });
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => {
    output += chunk;
    if (!sentQuit && /^bestmove /m.test(output)) { sentQuit = true; child.stdin!.end('quit\n'); finish(); }
  });
  const start = newGame(), first = legalMoves(start)[0], second = legalMoves(applyMove(start, first))[0];
  const expected = applyMove(applyMove(start, first), second);
  const timer = setTimeout(() => { void child.terminate(); }, 18000);
  try {
    const failed = new Promise<never>((_resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => { if (!sentQuit) reject(new Error(`CLI exited ${code}: ${errors}${output}`)); });
    });
    child.stdin!.write(`kei\nisready\nposition startpos moves ${first} ${second}\ngo depth 3\n`);
    await Promise.race([bestmove, failed]); assert.equal(errors, '');
    assert.match(output, /keiok/); assert.match(output, /readyok/); assert.match(output, /info depth 3 /);
    const move = /^bestmove (.+)$/m.exec(output)?.[1];
    assert.ok(move && legalMoves(expected).includes(move), output);
    console.log(`Scripted KEI: position startpos moves ${first} ${second}; go depth 3; bestmove ${move}`);
  } finally { clearTimeout(timer); await child.terminate(); }
});

test('worker_threads entry handles string KEI and remains responsive to stop', { timeout: 10000 }, async () => {
  const worker = new Worker(new URL('../src/worker.ts', import.meta.url));
  const lines: string[] = [];
  try {
    const done = new Promise<void>((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', (line: string) => { lines.push(line); if (line.startsWith('bestmove ')) resolve(); });
    });
    for (const line of ['kei', 'position startpos', 'go depth 50', 'isready', 'stop']) worker.postMessage(line);
    await done;
    assert.ok(lines.includes('keiok')); assert.ok(lines.includes('readyok'));
    assert.ok(legalMoves(newGame()).includes(lines.find(line => line.startsWith('bestmove '))!.slice(9)));
    worker.postMessage('quit');
  } finally { await worker.terminate(); }
});

test('KEI stop returns the last completed iteration and suppresses late job output', () => {
  const lines: string[] = [];
  let emit: (line: string) => void = () => {}, terminated = 0;
  const controller = new KEIController(line => lines.push(line), (_request, output) => {
    emit = output; return { terminate: () => { terminated++; } };
  });
  controller.handleLine('go depth 30'); emit('info depth 2 score 10 nodes 500 pv h2-h3 c7-c6');
  controller.handleLine('stop'); emit('bestmove stale');
  assert.equal(terminated, 1); assert.deepEqual(lines, ['info depth 2 score 10 nodes 500 pv h2-h3 c7-c6', 'bestmove h2-h3']);
});
