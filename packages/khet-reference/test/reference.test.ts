import assert from 'node:assert/strict';
import test from 'node:test';
import { refApply, refFromPieces, refKey, refLegalMoves, refNewGame } from '../src/index.ts';
import type { RefPiece, RefState } from '../src/index.ts';

function piece(type: RefPiece['type'], color: RefPiece['color'], o: number, row: number, col: number): RefPiece {
  return { type, color, o, row, col };
}

function at(state: RefState, row: number, col: number): RefPiece | undefined {
  return state.pieces.find(p => p.row === row && p.col === col);
}

// The target is e5 (34). Place the firing Sphinx on the requested entry face.
// Move b1-c1 solely to trigger the mandatory shot; it is clear of every beam.
const sources = [
  piece('sphinx', 'silver', 2, 2, 4), // entering N, travelling S
  piece('sphinx', 'silver', 3, 3, 5), // entering E, travelling W
  piece('sphinx', 'silver', 0, 4, 4), // entering S, travelling N
  piece('sphinx', 'silver', 1, 3, 3), // entering W, travelling E
];
const exitPaths = {
  N: [24, 14, 4],
  E: [35, 36, 37, 38, 39],
  S: [44, 54, 64, 74],
  W: [33, 32, 31, 30],
};
const faces = ['N', 'E', 'S', 'W'];
type Exit = keyof typeof exitPaths;

function interaction(type: RefPiece['type'], o: number, face: number) {
  const target = piece(type, 'red', o, 3, 4);
  const state = refFromPieces([sources[face], target, piece('pharaoh', 'silver', 0, 7, 1)], 'silver');
  const snapshot = structuredClone(state);
  const applied = refApply(state, 'b1-c1');
  assert.deepEqual(state, snapshot, 'applying a move must leave its input intact');
  assert.equal(applied.state.side, 'red');
  assert.equal(applied.state.history.length, 2);
  assert.equal(applied.state.history[1], refKey(applied.state));
  return applied;
}

// Hand-transcribed expectations by entry face N/E/S/W. 'destroy' ends the shot.
const pyramidCases: (Exit | 'destroy')[][] = [
  ['E', 'N', 'destroy', 'destroy'], // NE
  ['destroy', 'S', 'E', 'destroy'], // SE
  ['destroy', 'destroy', 'W', 'S'], // SW
  ['W', 'destroy', 'destroy', 'N'], // NW
];
for (let o = 0; o < 4; o++) {
  for (let face = 0; face < 4; face++) {
    test(`pyramid orientation ${o}, entry ${faces[face]}`, () => {
      const { state, laser } = interaction('pyramid', o, face);
      const expected = pyramidCases[o][face];
      if (expected === 'destroy') {
        assert.deepEqual(laser, { path: [34], destroyed: 34 });
        assert.equal(at(state, 3, 4), undefined);
      } else {
        assert.deepEqual(laser, { path: [34, ...exitPaths[expected]], destroyed: -1 });
        assert.deepEqual(at(state, 3, 4), piece('pyramid', 'red', o, 3, 4));
      }
      assert.equal(state.result, null);
    });
  }
}

const scarabCases: Exit[][] = [
  ['E', 'N', 'W', 'S'], // /
  ['W', 'S', 'E', 'N'], // \
];
for (let o = 0; o < 2; o++) {
  for (let face = 0; face < 4; face++) {
    test(`scarab orientation ${o}, entry ${faces[face]}`, () => {
      const { state, laser } = interaction('scarab', o, face);
      assert.deepEqual(laser, { path: [34, ...exitPaths[scarabCases[o][face]]], destroyed: -1 });
      assert.deepEqual(at(state, 3, 4), piece('scarab', 'red', o, 3, 4));
      assert.equal(state.result, null);
    });
  }
}

for (let o = 0; o < 4; o++) {
  for (let face = 0; face < 4; face++) {
    test(`anubis orientation ${o}, entry ${faces[face]}`, () => {
      const { state, laser } = interaction('anubis', o, face);
      const shielded = face === o;
      assert.deepEqual(laser, { path: [34], destroyed: shielded ? -1 : 34 });
      assert.deepEqual(at(state, 3, 4), shielded ? piece('anubis', 'red', o, 3, 4) : undefined);
      assert.equal(state.result, null);
    });
  }
}

for (let face = 0; face < 4; face++) {
  test(`pharaoh entry ${faces[face]}`, () => {
    const { state, laser } = interaction('pharaoh', 0, face);
    assert.deepEqual(laser, { path: [34], destroyed: 34 });
    assert.equal(at(state, 3, 4), undefined);
    assert.equal(state.result, 'silver');
    assert.deepEqual(refLegalMoves(state), []);
  });
  for (let o = 0; o < 4; o++) {
    test(`sphinx orientation ${o}, entry ${faces[face]}`, () => {
      const { state, laser } = interaction('sphinx', o, face);
      assert.deepEqual(laser, { path: [34], destroyed: -1 });
      assert.deepEqual(at(state, 3, 4), piece('sphinx', 'red', o, 3, 4));
      assert.equal(state.result, null);
    });
  }
}

const edgeCases = [
  { name: 'north', source: piece('sphinx', 'silver', 0, 1, 4), path: [4] },
  { name: 'east', source: piece('sphinx', 'silver', 1, 3, 8), path: [39] },
  { name: 'south', source: piece('sphinx', 'silver', 2, 6, 4), path: [74] },
  { name: 'west', source: piece('sphinx', 'silver', 3, 3, 1), path: [30] },
];
for (const entry of edgeCases) {
  test(`edge exit ${entry.name} includes last on-board square`, () => {
    const state = refFromPieces([entry.source, piece('pharaoh', 'silver', 0, 7, 1)], 'silver');
    assert.deepEqual(refApply(state, 'b1-c1').laser, { path: entry.path, destroyed: -1 });
  });
}

test('a beam starting outwards at an edge has an empty path', () => {
  const state = refFromPieces([
    piece('sphinx', 'silver', 0, 0, 4), piece('pharaoh', 'silver', 0, 7, 1),
  ], 'silver');
  assert.deepEqual(refApply(state, 'b1-c1').laser, { path: [], destroyed: -1 });
});

test('empty squares and several reflections are included in order', () => {
  const state = refFromPieces([
    piece('sphinx', 'silver', 0, 7, 9),
    piece('scarab', 'red', 0, 5, 9), // N travel enters S -> W
    piece('pyramid', 'silver', 0, 5, 6), // W travel enters E -> N
    piece('anubis', 'red', 2, 2, 6), // N travel enters shielded S
    piece('pharaoh', 'silver', 0, 7, 1),
  ], 'silver');
  assert.deepEqual(refApply(state, 'b1-c1').laser, {
    path: [69, 59, 58, 57, 56, 46, 36, 26], destroyed: -1,
  });
});

test('steps include all eight neighbours, but never capture or rotate', () => {
  const state = refFromPieces([piece('pharaoh', 'silver', 0, 3, 4)], 'silver');
  assert.deepEqual(refLegalMoves(state), [
    'e5-d4', 'e5-d5', 'e5-d6', 'e5-e4', 'e5-e6', 'e5-f4', 'e5-f5', 'e5-f6',
  ]);
  state.pieces.push(piece('pyramid', 'red', 2, 3, 5));
  assert.ok(!refLegalMoves(state).includes('e5-f5'));
  assert.ok(!refLegalMoves(state).includes('e5xf5'));
  assert.ok(!refLegalMoves(state).some(move => move.startsWith('f5')));
});

test('steps preserve orientation and switch side after firing', () => {
  const state = refFromPieces([
    piece('sphinx', 'silver', 0, 7, 9), piece('pyramid', 'silver', 3, 3, 4),
  ], 'silver');
  const applied = refApply(state, 'e5-d6');
  assert.deepEqual(at(applied.state, 2, 3), piece('pyramid', 'silver', 3, 2, 3));
  assert.equal(at(applied.state, 3, 4), undefined);
  assert.equal(applied.state.side, 'red');
  assert.deepEqual(applied.laser, { path: [69, 59, 49, 39, 29, 19, 9], destroyed: -1 });
});

for (const color of ['silver', 'red'] as const) {
  for (const type of ['pyramid', 'anubis'] as const) {
    test(`scarab swaps with ${color} ${type} without rotating either piece`, () => {
      const state = refFromPieces([
        piece('sphinx', 'silver', 0, 7, 9),
        piece('scarab', 'silver', 1, 3, 4), piece(type, color, 2, 4, 5),
      ], 'silver');
      assert.ok(refLegalMoves(state).includes('e5xf4'));
      assert.ok(!refLegalMoves(state).includes('e5-f4'));
      const applied = refApply(state, 'e5xf4');
      assert.deepEqual(at(applied.state, 4, 5), piece('scarab', 'silver', 1, 4, 5));
      assert.deepEqual(at(applied.state, 3, 4), piece(type, color, 2, 3, 4));
    });
  }
}

for (const type of ['pharaoh', 'sphinx', 'scarab'] as const) {
  test(`scarab cannot swap with a ${type}`, () => {
    const state = refFromPieces([
      piece('scarab', 'silver', 0, 3, 4), piece(type, 'red', 0, 4, 5),
    ], 'silver');
    assert.ok(!refLegalMoves(state).includes('e5xf4'));
  });
}

test('reserved squares reject steps for each color, including both extra home squares', () => {
  const fixtures: { color: RefPiece['color']; row: number; col: number; forbidden: string[] }[] = [
    { color: 'silver', row: 3, col: 1, forbidden: ['b5-a4', 'b5-a5', 'b5-a6'] },
    { color: 'red', row: 3, col: 8, forbidden: ['i5-j4', 'i5-j5', 'i5-j6'] },
    { color: 'silver', row: 1, col: 7, forbidden: ['h7-i8'] },
    { color: 'silver', row: 6, col: 7, forbidden: ['h2-i1'] },
    { color: 'red', row: 1, col: 2, forbidden: ['c7-b8'] },
    { color: 'red', row: 6, col: 2, forbidden: ['c2-b1'] },
  ];
  for (const fixture of fixtures) {
    const state = refFromPieces([piece('pharaoh', fixture.color, 0, fixture.row, fixture.col)], fixture.color);
    const moves = refLegalMoves(state);
    for (const move of fixture.forbidden) assert.ok(!moves.includes(move), move);
    assert.ok(moves.length > 0);
  }
  // Each color can enter its own reserved column and extra squares.
  assert.ok(refLegalMoves(refFromPieces([piece('pharaoh', 'red', 0, 3, 1)], 'red')).includes('b5-a5'));
  assert.ok(refLegalMoves(refFromPieces([piece('pharaoh', 'silver', 0, 3, 8)], 'silver')).includes('i5-j5'));
  for (const row of [0, 7]) {
    const rank = 8 - row;
    assert.ok(refLegalMoves(refFromPieces([piece('pharaoh', 'red', 0, row, 7)], 'red')).includes(`h${rank}-i${rank}`));
    assert.ok(refLegalMoves(refFromPieces([piece('pharaoh', 'silver', 0, row, 2)], 'silver')).includes(`c${rank}-b${rank}`));
  }
});

test('swaps check the destination of both pieces against reservations', () => {
  const fixtures = [
    { scarab: piece('scarab', 'silver', 0, 3, 1), target: piece('pyramid', 'red', 0, 3, 0), move: 'b5xa5' },
    { scarab: piece('scarab', 'silver', 0, 3, 9), target: piece('anubis', 'red', 0, 3, 8), move: 'j5xi5' },
    { scarab: piece('scarab', 'red', 0, 3, 8), target: piece('pyramid', 'silver', 0, 3, 9), move: 'i5xj5' },
    { scarab: piece('scarab', 'red', 0, 3, 0), target: piece('anubis', 'silver', 0, 3, 1), move: 'a5xb5' },
    { scarab: piece('scarab', 'silver', 0, 0, 1), target: piece('pyramid', 'red', 0, 1, 2), move: 'b8xc7' },
    { scarab: piece('scarab', 'red', 0, 7, 8), target: piece('anubis', 'silver', 0, 6, 7), move: 'i1xh2' },
  ];
  for (const fixture of fixtures) {
    const state = refFromPieces([fixture.scarab, fixture.target], fixture.scarab.color);
    assert.ok(!refLegalMoves(state).includes(fixture.move), fixture.move);
    assert.throws(() => refApply(state, fixture.move), /Illegal move/);
  }
  const allowed = refFromPieces([
    piece('scarab', 'silver', 0, 3, 9), piece('anubis', 'silver', 1, 3, 8),
  ], 'silver');
  assert.ok(refLegalMoves(allowed).includes('j5xi5'));
});

for (const type of ['pyramid', 'anubis'] as const) {
  for (let o = 0; o < 4; o++) {
    test(`${type} orientation ${o} has two quarter-turn rotations`, () => {
      const state = refFromPieces([
        piece('sphinx', 'silver', 0, 7, 9), piece(type, 'silver', o, 3, 4),
      ], 'silver');
      assert.deepEqual(refLegalMoves(state).filter(move => /^e5[+-]$/.test(move)), ['e5+', 'e5-']);
      assert.equal(at(refApply(state, 'e5+').state, 3, 4)?.o, (o + 1) % 4);
      assert.equal(at(refApply(state, 'e5-').state, 3, 4)?.o, (o + 3) % 4);
    });
  }
}

for (let o = 0; o < 2; o++) {
  test(`scarab orientation ${o} has one toggle`, () => {
    const state = refFromPieces([
      piece('sphinx', 'silver', 0, 7, 9), piece('scarab', 'silver', o, 3, 4),
    ], 'silver');
    assert.deepEqual(refLegalMoves(state).filter(move => /^e5[+-]$/.test(move)), ['e5+']);
    assert.equal(at(refApply(state, 'e5+').state, 3, 4)?.o, 1 - o);
    assert.throws(() => refApply(state, 'e5-'), /Illegal move/);
  });
}

for (const entry of [
  { color: 'silver', row: 7, col: 9, o: 0, next: 3, text: 'j1+' },
  { color: 'silver', row: 7, col: 9, o: 3, next: 0, text: 'j1+' },
  { color: 'red', row: 0, col: 0, o: 2, next: 1, text: 'a8+' },
  { color: 'red', row: 0, col: 0, o: 1, next: 2, text: 'a8+' },
] as const) {
  test(`${entry.color} corner Sphinx facing ${entry.o} rotates only on board using '+'`, () => {
    const state = refFromPieces([piece('sphinx', entry.color, entry.o, entry.row, entry.col)], entry.color);
    assert.deepEqual(refLegalMoves(state), [entry.text]);
    const applied = refApply(state, entry.text);
    assert.equal(applied.state.pieces[0].o, entry.next);
    assert.equal(applied.laser.path[0], entry.row * 10 + entry.col + (entry.next === 0 ? -10 : entry.next === 1 ? 1 : entry.next === 2 ? 10 : -1));
  });
}

test('interior Sphinx quarter-turns are distinct and neither is a step', () => {
  const state = refFromPieces([piece('sphinx', 'silver', 0, 3, 4)], 'silver');
  assert.deepEqual(refLegalMoves(state), ['e5+', 'e5-']);
  assert.equal(refApply(state, 'e5+').state.pieces[0].o, 1);
  assert.equal(refApply(state, 'e5-').state.pieces[0].o, 3);
});

test('own Pharaoh may step into the beam: self-kill loses immediately', () => {
  const state = refFromPieces([
    piece('sphinx', 'silver', 0, 7, 9), piece('pharaoh', 'silver', 0, 6, 8),
    piece('sphinx', 'red', 2, 0, 0), piece('pharaoh', 'red', 0, 0, 5),
  ], 'silver');
  assert.ok(refLegalMoves(state).includes('i2-j2'));
  const applied = refApply(state, 'i2-j2');
  assert.deepEqual(applied.laser, { path: [69], destroyed: 69 });
  assert.equal(applied.state.result, 'red');
  assert.equal(applied.state.side, 'red');
  assert.deepEqual(refLegalMoves(applied.state), []);
  assert.throws(() => refApply(applied.state, 'a8+'), /Illegal move/);
});

test('own Pyramid may step into the beam and is removed', () => {
  const state = refFromPieces([
    piece('sphinx', 'silver', 0, 7, 9), piece('pyramid', 'silver', 0, 6, 8),
  ], 'silver');
  const applied = refApply(state, 'i2-j2');
  assert.deepEqual(applied.laser, { path: [69], destroyed: 69 });
  assert.equal(at(applied.state, 6, 9), undefined);
  assert.equal(applied.state.result, null);
});

test('only the mover fires and destruction stops at the first victim', () => {
  const state = refFromPieces([
    piece('sphinx', 'silver', 0, 7, 9), piece('pharaoh', 'silver', 0, 7, 4),
    piece('pyramid', 'red', 0, 6, 9), piece('pharaoh', 'red', 0, 5, 9),
    piece('sphinx', 'red', 2, 0, 0), piece('pyramid', 'red', 0, 1, 0),
  ], 'silver');
  const applied = refApply(state, 'e1-d2');
  assert.deepEqual(applied.laser, { path: [69], destroyed: 69 });
  assert.ok(at(applied.state, 5, 9));
  assert.ok(at(applied.state, 1, 0), 'the non-mover laser must not fire');
  assert.equal(applied.state.result, null);
});

test('the laser sees a swap after both pieces have exchanged squares', () => {
  const state = refFromPieces([
    piece('sphinx', 'silver', 0, 7, 9), piece('scarab', 'silver', 0, 6, 9),
    piece('pyramid', 'silver', 0, 6, 8),
  ], 'silver');
  const applied = refApply(state, 'j2xi2');
  assert.deepEqual(applied.laser, { path: [69], destroyed: 69 });
  assert.deepEqual(at(applied.state, 6, 8), piece('scarab', 'silver', 0, 6, 8));
  assert.equal(at(applied.state, 6, 9), undefined);
});

test('canonical key includes squares, types, colors, orientations and side, but ignores array order', () => {
  const state = refFromPieces([
    piece('pyramid', 'silver', 1, 3, 4), piece('pharaoh', 'red', 0, 0, 5),
  ], 'silver');
  const key = refKey(state);
  assert.equal(key, refKey(refFromPieces([...state.pieces].reverse(), 'silver')));
  for (const changed of [
    { ...state.pieces[0], row: 4 }, { ...state.pieces[0], col: 5 },
    { ...state.pieces[0], type: 'anubis' as const },
    { ...state.pieces[0], color: 'red' as const }, { ...state.pieces[0], o: 2 },
  ]) {
    assert.notEqual(key, refKey(refFromPieces([changed, state.pieces[1]], 'silver')));
  }
  assert.notEqual(key, refKey({ ...state, side: 'red' }));
  assert.equal(key, refKey({ ...state, result: 'draw', history: ['unrelated'] }));
  assert.equal(key, refKey({ ...state, pieces: [state.pieces[0], { ...state.pieces[1], o: 3 }] }));
});

test('construction copies pieces, normalizes the Pharaoh, and includes the start key', () => {
  const pieces = [piece('pharaoh', 'silver', 3, 7, 4)];
  const state = refFromPieces(pieces, 'red');
  assert.equal(state.pieces[0].o, 0);
  assert.equal(pieces[0].o, 3);
  assert.deepEqual(state.history, [refKey(state)]);
  pieces[0].row = 2;
  pieces.push(piece('pyramid', 'red', 0, 0, 7));
  assert.equal(state.pieces.length, 1);
  assert.equal(state.pieces[0].row, 7);
});

test('threefold counts the initial position and side to move', () => {
  let state = refFromPieces([
    piece('sphinx', 'silver', 0, 7, 9), piece('sphinx', 'red', 2, 0, 0),
    piece('pyramid', 'silver', 0, 5, 3), piece('pyramid', 'red', 2, 2, 6),
  ], 'silver');
  const start = refKey(state);
  const moves = ['d3+', 'g6+', 'd3-', 'g6-', 'd3+', 'g6+', 'd3-', 'g6-'];
  for (let i = 0; i < moves.length; i++) {
    state = refApply(state, moves[i]).state;
    assert.equal(state.result, i === 7 ? 'draw' : null, `after ply ${i + 1}`);
    assert.equal(state.history.length, i + 2);
    if (i === 3) assert.equal(refKey(state), start);
  }
  assert.equal(refKey(state), start);
  assert.equal(state.history.filter(key => key === start).length, 3);
  assert.deepEqual(refLegalMoves(state), []);
});

test('a Pharaoh loss takes priority over a repetition draw', () => {
  const state = refFromPieces([
    piece('sphinx', 'silver', 0, 7, 9), piece('pharaoh', 'silver', 0, 6, 8),
  ], 'silver');
  const terminalKey = refKey(refApply(state, 'i2-j2').state);
  state.history.push(terminalKey, terminalKey);
  assert.equal(refApply(state, 'i2-j2').state.result, 'red');
});

test('applying to deeply frozen input creates independent objects and history', () => {
  const state = refNewGame('classic');
  const snapshot = structuredClone(state);
  for (const p of state.pieces) Object.freeze(p);
  Object.freeze(state.pieces);
  Object.freeze(state.history);
  Object.freeze(state);
  const applied = refApply(state, 'j1+');
  assert.deepEqual(state, snapshot);
  assert.notEqual(applied.state.history, state.history);
  assert.notEqual(applied.state.pieces, state.pieces);
  for (const p of applied.state.pieces) assert.ok(!state.pieces.includes(p));
  applied.state.history.push('changed');
  applied.state.pieces[0].o = 0;
  assert.deepEqual(state, snapshot);
});

test('illegal text moves fail without modifying state', () => {
  const state = refNewGame('classic');
  const snapshot = structuredClone(state);
  for (const move of ['j1-j2', 'e1+', 'j1-', 'a8+', 'e1-e1', 'nonsense', ' j1+']) {
    assert.throws(() => refApply(state, move), /Illegal move/);
    assert.deepEqual(state, snapshot);
  }
});

test('every game-over result has no legal moves', () => {
  for (const result of ['silver', 'red', 'draw'] as const) {
    const state = { ...refNewGame('classic'), result };
    assert.deepEqual(refLegalMoves(state), []);
    assert.throws(() => refApply(state, 'j1+'), /Illegal move/);
  }
});

test('Classic setup has the literal piece counts, orientations and starting history', () => {
  const state = refNewGame('classic');
  assert.equal(state.pieces.length, 26);
  assert.equal(state.side, 'silver');
  assert.equal(state.result, null);
  assert.deepEqual(state.history, [refKey(state)]);
  for (const color of ['silver', 'red'] as const) {
    const expected = { pharaoh: 1, sphinx: 1, scarab: 2, anubis: 2, pyramid: 7 };
    for (const [type, count] of Object.entries(expected)) {
      assert.equal(state.pieces.filter(p => p.color === color && p.type === type).length, count);
    }
  }
  assert.deepEqual(at(state, 0, 7), piece('pyramid', 'red', 1, 0, 7));
  assert.deepEqual(at(state, 2, 3), piece('pyramid', 'silver', 3, 2, 3));
  assert.deepEqual(at(state, 3, 4), piece('scarab', 'red', 1, 3, 4));
  assert.deepEqual(at(state, 4, 5), piece('scarab', 'silver', 1, 4, 5));
  assert.deepEqual(at(state, 7, 9), piece('sphinx', 'silver', 0, 7, 9));
  const other = refNewGame('classic');
  state.pieces[0].o = 0;
  assert.equal(other.pieces[0].o, 2);
});

test('Classic start legal move count is pinned after independent hand counting', () => {
  const state = refNewGame('classic');
  const moves = refLegalMoves(state);
  assert.deepEqual(moves, [...moves].sort());
  assert.equal(new Set(moves).size, moves.length);
  // Hand-counted as [square, empty steps, swaps, rotations].
  const counts: [string, number, number, number][] = [
    ['d6', 5, 0, 2], ['c5', 6, 0, 2], ['j5', 4, 0, 2],
    ['c4', 7, 0, 2], ['e4', 5, 0, 1], ['f4', 4, 1, 1],
    ['j4', 4, 0, 2], ['h2', 6, 0, 2], ['c1', 4, 0, 2],
    ['d1', 3, 0, 2], ['e1', 3, 0, 0], ['f1', 4, 0, 2],
    ['j1', 0, 0, 1],
  ];
  for (const [from, steps, swaps, rotations] of counts) {
    const own = moves.filter(move => move.startsWith(from));
    assert.equal(own.filter(move => move.length === 5 && move[2] === '-').length, steps, `${from} steps`);
    assert.equal(own.filter(move => move[2] === 'x').length, swaps, `${from} swaps`);
    assert.equal(own.filter(move => move.length === 3).length, rotations, `${from} rotations`);
  }
  // 55 empty steps + 1 swap + 21 rotations.
  assert.equal(moves.length, 77);
});
