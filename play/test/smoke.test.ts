import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANUBIS, PHARAOH, Position, SETUPS, SPHINX, fromPieces, legalMoves, parseMove, toKFEN,
} from '../../packages/khet-engine/src/index.ts';
import { GameController, moveSquares, rotationMove } from '../src/controller.ts';
import { createKEIEngine } from '../src/worker-logic.ts';

function seededRandom(seed: number): () => number {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
function shoot(game: GameController, move: string): void {
  assert.ok(game.moves.includes(move), `legal move: ${move}`);
  const shot = game.play(move);
  assert.ok(shot.laser.path.length > 0);
  if (shot.laser.hit >= 0) {
    assert.ok(shot.destroyed);
    assert.equal(game.position.pieceAt(shot.laser.hit), null);
    assert.equal(shot.pieces.length, game.position.toPieces().length + 1);
  } else assert.equal(shot.pieces.length, game.position.toPieces().length);
  for (const piece of shot.pieces) {
    const square = piece.row * 10 + piece.col;
    assert.deepEqual(game.position.pieceAt(square), square === shot.laser.hit ? null :
      { type: piece.type, color: piece.color, o: piece.o });
  }
  game.finishShot();
}

test('staging steps, swaps and rotations previews only the action, without firing or changing history', t => {
  const game = new GameController();
  const original = toKFEN(game.position), key = game.position.key(), command = game.positionCommand();
  const position = game.position;
  for (const method of ['traceLaser', 'traceLaserInto', 'previewShot', 'makeMove'] as const) {
    t.mock.method(Position.prototype, method, () => { throw new Error(`Staging called ${method}`); });
  }
  const moves = ['e1-e2', 'j1+', game.moves.find(move => move.includes('x'))!];
  assert.ok(moves[2], 'classic setup has a legal swap');
  for (const move of moves) {
    const { from, to } = moveSquares(move);
    const mover = position.pieceAt(from)!, target = position.pieceAt(to);
    game.stage(move);
    const pieces = game.stagedPieces!;
    const at = (square: number) => pieces.find(piece => piece.row * 10 + piece.col === square);
    assert.equal(game.stagedMove, move);
    assert.equal(pieces.length, position.toPieces().length);
    if (from === to) assert.notEqual(at(from)!.o, mover.o);
    else {
      assert.deepEqual(at(to), { ...mover, row: Math.floor(to / 10), col: to % 10 });
      assert.deepEqual(at(from), move.includes('x')
        ? { ...target, row: Math.floor(from / 10), col: from % 10 } : undefined);
    }
    assert.equal(game.position, position);
    assert.equal(toKFEN(position), original);
    assert.equal(position.key(), key);
    assert.equal(game.positionCommand(), command);
    assert.deepEqual(game.history, []);
    assert.equal(game.shot, null);
    assert.equal(game.humanTurn, true);
    assert.equal(game.aiTurn, false);
  }
});

test('confirm plays exactly the staged move once, then lets the AI play directly', () => {
  const game = new GameController(), expected = new GameController();
  const expectedShot = expected.play('e1-e2');
  game.stage('e1-e2');
  assert.deepEqual(game.confirm(), expectedShot);
  assert.equal(toKFEN(game.position), toKFEN(expected.position));
  assert.deepEqual(game.history, [{ move: 'e1-e2', color: 0 }]);
  assert.equal(game.stagedMove, null);
  assert.equal(game.stagedPieces, null);
  assert.equal(game.aiTurn, false, 'AI waits for the human laser animation');
  assert.throws(() => game.confirm());
  assert.equal(game.history.length, 1);
  game.finishShot();
  assert.equal(game.aiTurn, true);
  assert.throws(() => game.stage(game.moves[0]), /Wait for your turn/);
  game.play(game.moves[0]);
  assert.equal(game.history.length, 2);
  assert.equal(game.stagedMove, null);
});

test('cancel restores the board preview and leaves the game ready for another action', () => {
  const game = new GameController();
  const original = toKFEN(game.position), pieces = game.position.toPieces();
  game.stage('e1-e2'); game.clearStage(); game.clearStage();
  assert.equal(game.stagedMove, null);
  assert.equal(game.stagedPieces, null);
  assert.deepEqual(game.position.toPieces(), pieces);
  assert.equal(toKFEN(game.position), original);
  assert.equal(game.history.length, 0);
  assert.equal(game.shot, null);
  assert.equal(game.humanTurn, true);
  assert.throws(() => game.confirm(), /Choose a move/);
  game.stage('j1+');
  assert.equal(game.stagedMove, 'j1+');
});

test('replacing a stage uses the original position and confirms only the last action', () => {
  const game = new GameController(), expected = new GameController();
  const original = toKFEN(game.position);
  game.stage('e1-e2'); game.stage('e1-d2'); game.stage('j1+');
  assert.equal(game.stagedMove, 'j1+');
  assert.equal(toKFEN(game.position), original);
  assert.deepEqual(game.stagedPieces!.find(piece => piece.row === 7 && piece.col === 4),
    { ...game.position.pieceAt(74), row: 7, col: 4 });
  assert.throws(() => game.stage('e1-e8'));
  assert.equal(game.stagedMove, 'j1+', 'invalid replacements keep the current stage');
  expected.play('j1+'); game.confirm();
  assert.deepEqual(game.history, expected.history);
  assert.equal(toKFEN(game.position), toKFEN(expected.position));
  assert.deepEqual(game.shot, expected.shot);
});

test('undo and loading clear a stage; invalid loads preserve it', () => {
  const game = new GameController(), original = toKFEN(game.position);
  game.stage('e1-e2'); game.undo();
  assert.equal(game.stagedMove, null);
  assert.equal(toKFEN(game.position), original);
  game.stage('e1-e2');
  assert.throws(() => game.load('not a kfen'));
  assert.equal(game.stagedMove, 'e1-e2');
  game.load(original);
  assert.equal(game.stagedMove, null);
});

for (const [index, setup] of Object.keys(SETUPS).entries()) {
  for (const human of [0, 1] as const) {
    test(`${setup}: 20 random ${human === 0 ? 'Silver' : 'Red'} human moves against direct worker logic`, () => {
      const random = seededRandom(42 + index * 100 + human);
      const output: string[] = [];
      const engine = createKEIEngine(line => output.push(line), random);
      let game = new GameController(setup, human, 1);
      let humanMoves = 0, aiMoves = 0;
      function engineTurn(): void {
        output.length = 0;
        engine(game.positionCommand()); engine(game.goCommand());
        assert.ok(output.some(line => /^info depth \d+ score \S+ nodes \d+ pv/.test(line)));
        const move = output.find(line => line.startsWith('bestmove '))?.slice(9);
        assert.ok(move, output.join('\n'));
        shoot(game, move); aiMoves++;
      }
      while (humanMoves < 20) {
        if (game.position.result !== null) game = new GameController(setup, human, 1);
        if (game.aiTurn) engineTurn();
        if (game.position.result !== null) continue;
        assert.equal(game.humanTurn, true);
        const choices = game.moves.filter(move => {
          const next = game.position.clone(); next.makeMove(parseMove(move, next));
          return next.result !== (human ^ 1);
        });
        const moves = choices.length ? choices : game.moves;
        shoot(game, moves[Math.floor(random() * moves.length)]); humanMoves++;
        if (game.aiTurn) engineTurn();
      }
      assert.equal(humanMoves, 20);
      assert.ok(aiMoves >= 19);
    });
  }
}

test('undo restores the human + AI pair and cancels a pending shot', () => {
  const game = new GameController();
  const original = toKFEN(game.position), key = game.position.key();
  shoot(game, 'e1-e2');
  game.play(game.moves[0]); // AI shot still animating.
  assert.equal(game.undoCount, 2);
  game.undo();
  assert.equal(toKFEN(game.position), original);
  assert.equal(game.position.key(), key);
  assert.equal(game.shot, null);
  assert.equal(game.history.length, 0);
  assert.equal(game.humanTurn, true);
  game.play('e1-e2'); game.undo(); // Search has not replied yet: undo one ply.
  assert.equal(toKFEN(game.position), original);
});

test('Red undo keeps the initial Silver AI move', () => {
  const game = new GameController('classic', 1);
  shoot(game, 'e1-e2');
  const opening = toKFEN(game.position);
  assert.equal(game.undoCount, 0);
  shoot(game, 'f8-f7'); shoot(game, 'e2-e3');
  game.undo();
  assert.equal(toKFEN(game.position), opening);
  assert.equal(game.history.length, 1);
  assert.equal(game.humanTurn, true);
});

test('repetition survives KEI replay; undo reopens the game', () => {
  const position = fromPieces([
    { type: SPHINX, color: 0, o: 0, row: 7, col: 9 },
    { type: SPHINX, color: 1, o: 2, row: 0, col: 0 },
    { type: PHARAOH, color: 0, o: 0, row: 6, col: 4 },
    { type: PHARAOH, color: 1, o: 0, row: 1, col: 5 },
    { type: ANUBIS, color: 0, o: 0, row: 4, col: 4 },
    { type: ANUBIS, color: 1, o: 2, row: 3, col: 5 },
  ]);
  const game = new GameController(); game.load(toKFEN(position));
  for (let repeat = 0; repeat < 2; repeat++) for (const move of ['e4+', 'f5+', 'e4-', 'f5-']) shoot(game, move);
  assert.equal(game.position.result, 'draw');
  assert.deepEqual(game.moves, []);
  const output: string[] = [], engine = createKEIEngine(line => output.push(line));
  engine(game.positionCommand()); engine(game.goCommand());
  assert.equal(output.at(-1), 'bestmove (none)');
  game.undo(); assert.equal(game.position.result, null); assert.equal(game.history.length, 6);
});

test('invalid KFEN and illegal moves leave the game intact; valid load resets history', () => {
  const game = new GameController(); shoot(game, 'e1-e2');
  const current = toKFEN(game.position);
  assert.throws(() => game.load('not a kfen'));
  assert.equal(toKFEN(game.position), current);
  assert.throws(() => game.play('e2-e8'));
  assert.equal(toKFEN(game.position), current);
  game.load(current);
  assert.equal(game.history.length, 0); assert.equal(game.undoCount, 0);
  assert.equal(game.positionCommand(), `position kfen ${current}`);
});

test('Sphinx rotation buttons reflect the physical turn and levels map to KEI level commands', () => {
  const game = new GameController();
  assert.equal(rotationMove(game.position, 79, true), undefined);
  assert.equal(rotationMove(game.position, 79, false), 'j1+');
  for (let level = 1; level <= 10; level++) {
    game.level = level;
    assert.equal(game.goCommand(), `go level ${level}`);
  }
  assert.equal(game.goCommand(true), 'go level 7');
});

test('KEI supports readiness, setup replay, bad-command recovery, stop and quit', () => {
  const lines: string[] = [], engine = createKEIEngine(line => lines.push(line), seededRandom(2));
  engine('kei'); engine('isready');
  assert.deepEqual(lines.slice(0, 3), ['id name Khet play worker', 'keiok', 'readyok']);
  engine('newgame dynasty'); engine('position startpos classic moves e1-e2');
  engine('go level 1 movetime 200');
  const game = new GameController(); shoot(game, 'e1-e2');
  assert.ok(legalMoves(game.position).includes(lines.at(-1)!.slice(9)));
  engine('position bad'); assert.equal(lines.at(-1), 'bestmove (none)');
  engine('stop'); engine('quit'); const count = lines.length; engine('isready'); assert.equal(lines.length, count);
});

test('random fallback avoids available self-kills', () => {
  const position = fromPieces([
    { type: SPHINX, color: 0, o: 3, row: 7, col: 9 },
    { type: SPHINX, color: 1, o: 2, row: 0, col: 0 },
    { type: PHARAOH, color: 0, o: 0, row: 7, col: 5 },
    { type: PHARAOH, color: 1, o: 0, row: 0, col: 5 },
  ]);
  const possibleResults = legalMoves(position).map(move => {
    const next = position.clone(); next.makeMove(parseMove(move, next)); return next.result;
  });
  assert.ok(possibleResults.includes(1)); assert.ok(possibleResults.includes(null));
  for (const random of [() => 0, () => 0.5, () => 0.9999]) {
    const lines: string[] = [], engine = createKEIEngine(line => lines.push(line), random);
    engine(`position kfen ${toKFEN(position)}`); engine('go level 1 movetime 200');
    if (!lines.some(line => line.includes('random legal fallback'))) continue;
    const next = position.clone(); next.makeMove(parseMove(lines.at(-1)!.slice(9), next));
    assert.notEqual(next.result, 1);
  }
});
