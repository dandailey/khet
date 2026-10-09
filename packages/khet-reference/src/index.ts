// Independent, literal implementation of ENGINE_SPEC.md sections 1–6.
export type RefPiece = {
  type: 'pharaoh' | 'sphinx' | 'pyramid' | 'scarab' | 'anubis';
  color: 'silver' | 'red';
  o: number;
  row: number;
  col: number;
};

export type RefState = {
  pieces: RefPiece[];
  side: 'silver' | 'red';
  result: null | 'silver' | 'red' | 'draw';
  history: string[];
};

type Action = {
  text: string;
  kind: 'step' | 'swap' | 'rotate';
  from: number;
  to: number;
  orientation: number;
};

// N, E, S, W. These directions describe travel, facing, and entry faces.
const directions = [
  { row: -1, col: 0 },
  { row: 0, col: 1 },
  { row: 1, col: 0 },
  { row: 0, col: -1 },
];

// Rows are orientations; columns are the entry face N, E, S, W.
// Entries are outgoing travel directions, or -1 for destruction.
const pyramidReflection = [
  [1, 0, -1, -1], // NE: N -> E, E -> N
  [-1, 2, 1, -1], // SE: E -> S, S -> E
  [-1, -1, 3, 2], // SW: S -> W, W -> S
  [3, -1, -1, 0], // NW: N -> W, W -> N
];
const scarabReflection = [
  [1, 0, 3, 2], // /: N -> E, E -> N, S -> W, W -> S
  [3, 2, 1, 0], // \: N -> W, E -> S, S -> E, W -> N
];

function onBoard(row: number, col: number): boolean {
  return row >= 0 && row < 8 && col >= 0 && col < 10;
}

function square(piece: RefPiece): number {
  return piece.row * 10 + piece.col;
}

function squareText(row: number, col: number): string {
  return 'abcdefghij'[col] + String(8 - row);
}

function pieceAt(pieces: RefPiece[], row: number, col: number): RefPiece | undefined {
  for (const piece of pieces) {
    if (piece.row === row && piece.col === col) return piece;
  }
  return undefined;
}

function permittedSquare(color: RefState['side'], row: number, col: number): boolean {
  if (!onBoard(row, col)) return false;
  const redOnly = col === 0 || ((row === 0 || row === 7) && col === 8);
  const silverOnly = col === 9 || ((row === 0 || row === 7) && col === 1);
  return color === 'silver' ? !redOnly : !silverOnly;
}

/** Canonical position only: array order, result, and history do not matter. */
export function refKey(state: RefState): string {
  const ordered = [...state.pieces].sort((a, b) => square(a) - square(b));
  const entries: string[] = [];
  for (const piece of ordered) {
    // A Pharaoh's orientation has no meaning under the rules.
    const o = piece.type === 'pharaoh' ? 0 : piece.o;
    entries.push(`${square(piece)}:${piece.color}:${piece.type}:${o}`);
  }
  return `${state.side}|${entries.join('|')}`;
}

/** Accepts well-formed positions, including small fixtures without both Pharaohs. */
export function refFromPieces(pieces: RefPiece[], side: RefState['side']): RefState {
  const copied: RefPiece[] = [];
  for (const piece of pieces) {
    copied.push({ ...piece, o: piece.type === 'pharaoh' ? 0 : piece.o });
  }
  const state: RefState = { pieces: copied, side, result: null, history: [] };
  state.history.push(refKey(state));
  return state;
}

export function refNewGame(setup: 'classic' | 'imhotep' | 'dynasty'): RefState {
  if (setup === 'imhotep') return refFromPieces([
    { type: 'sphinx', color: 'red', o: 2, row: 0, col: 0 },
    { type: 'anubis', color: 'red', o: 2, row: 0, col: 4 },
    { type: 'pharaoh', color: 'red', o: 0, row: 0, col: 5 },
    { type: 'anubis', color: 'red', o: 2, row: 0, col: 6 },
    { type: 'scarab', color: 'red', o: 0, row: 0, col: 7 },
    { type: 'pyramid', color: 'silver', o: 3, row: 2, col: 3 },
    { type: 'pyramid', color: 'red', o: 0, row: 2, col: 6 },
    { type: 'pyramid', color: 'red', o: 0, row: 3, col: 0 },
    { type: 'pyramid', color: 'silver', o: 2, row: 3, col: 1 },
    { type: 'pyramid', color: 'silver', o: 1, row: 3, col: 4 },
    { type: 'scarab', color: 'red', o: 0, row: 3, col: 5 },
    { type: 'pyramid', color: 'red', o: 1, row: 3, col: 8 },
    { type: 'pyramid', color: 'silver', o: 3, row: 3, col: 9 },
    { type: 'pyramid', color: 'red', o: 1, row: 4, col: 0 },
    { type: 'pyramid', color: 'silver', o: 3, row: 4, col: 1 },
    { type: 'scarab', color: 'silver', o: 0, row: 4, col: 4 },
    { type: 'pyramid', color: 'red', o: 3, row: 4, col: 5 },
    { type: 'pyramid', color: 'red', o: 0, row: 4, col: 8 },
    { type: 'pyramid', color: 'silver', o: 2, row: 4, col: 9 },
    { type: 'pyramid', color: 'silver', o: 2, row: 5, col: 3 },
    { type: 'pyramid', color: 'red', o: 1, row: 5, col: 6 },
    { type: 'scarab', color: 'silver', o: 0, row: 7, col: 2 },
    { type: 'anubis', color: 'silver', o: 0, row: 7, col: 3 },
    { type: 'pharaoh', color: 'silver', o: 0, row: 7, col: 4 },
    { type: 'anubis', color: 'silver', o: 0, row: 7, col: 5 },
    { type: 'sphinx', color: 'silver', o: 0, row: 7, col: 9 },
  ], 'silver');
  if (setup === 'dynasty') return refFromPieces([
    { type: 'sphinx', color: 'red', o: 2, row: 0, col: 0 },
    { type: 'pyramid', color: 'red', o: 2, row: 0, col: 4 },
    { type: 'anubis', color: 'red', o: 2, row: 0, col: 5 },
    { type: 'pyramid', color: 'red', o: 1, row: 0, col: 6 },
    { type: 'pharaoh', color: 'red', o: 0, row: 1, col: 5 },
    { type: 'pyramid', color: 'red', o: 0, row: 2, col: 0 },
    { type: 'pyramid', color: 'red', o: 2, row: 2, col: 4 },
    { type: 'anubis', color: 'red', o: 2, row: 2, col: 5 },
    { type: 'scarab', color: 'red', o: 0, row: 2, col: 6 },
    { type: 'pyramid', color: 'red', o: 1, row: 3, col: 0 },
    { type: 'scarab', color: 'red', o: 1, row: 3, col: 2 },
    { type: 'pyramid', color: 'silver', o: 3, row: 3, col: 4 },
    { type: 'pyramid', color: 'silver', o: 1, row: 3, col: 6 },
    { type: 'pyramid', color: 'red', o: 3, row: 4, col: 3 },
    { type: 'pyramid', color: 'red', o: 1, row: 4, col: 5 },
    { type: 'scarab', color: 'silver', o: 1, row: 4, col: 7 },
    { type: 'pyramid', color: 'silver', o: 3, row: 4, col: 9 },
    { type: 'scarab', color: 'silver', o: 0, row: 5, col: 3 },
    { type: 'anubis', color: 'silver', o: 0, row: 5, col: 4 },
    { type: 'pyramid', color: 'silver', o: 0, row: 5, col: 5 },
    { type: 'pyramid', color: 'silver', o: 2, row: 5, col: 9 },
    { type: 'pharaoh', color: 'silver', o: 0, row: 6, col: 4 },
    { type: 'pyramid', color: 'silver', o: 3, row: 7, col: 3 },
    { type: 'anubis', color: 'silver', o: 0, row: 7, col: 4 },
    { type: 'pyramid', color: 'silver', o: 0, row: 7, col: 5 },
    { type: 'sphinx', color: 'silver', o: 0, row: 7, col: 9 },
  ], 'silver');
  if (setup !== 'classic') throw new Error(`Unknown setup: ${setup}`);
  // Listed by row exactly as in section 6; no generated symmetry or shared engine data.
  return refFromPieces([
    { type: 'sphinx', color: 'red', o: 2, row: 0, col: 0 },
    { type: 'anubis', color: 'red', o: 2, row: 0, col: 4 },
    { type: 'pharaoh', color: 'red', o: 0, row: 0, col: 5 },
    { type: 'anubis', color: 'red', o: 2, row: 0, col: 6 },
    { type: 'pyramid', color: 'red', o: 1, row: 0, col: 7 },
    { type: 'pyramid', color: 'red', o: 2, row: 1, col: 2 },
    { type: 'pyramid', color: 'silver', o: 3, row: 2, col: 3 },
    { type: 'pyramid', color: 'red', o: 0, row: 3, col: 0 },
    { type: 'pyramid', color: 'silver', o: 2, row: 3, col: 2 },
    { type: 'scarab', color: 'red', o: 1, row: 3, col: 4 },
    { type: 'scarab', color: 'red', o: 0, row: 3, col: 5 },
    { type: 'pyramid', color: 'red', o: 1, row: 3, col: 7 },
    { type: 'pyramid', color: 'silver', o: 3, row: 3, col: 9 },
    { type: 'pyramid', color: 'red', o: 1, row: 4, col: 0 },
    { type: 'pyramid', color: 'silver', o: 3, row: 4, col: 2 },
    { type: 'scarab', color: 'silver', o: 0, row: 4, col: 4 },
    { type: 'scarab', color: 'silver', o: 1, row: 4, col: 5 },
    { type: 'pyramid', color: 'red', o: 0, row: 4, col: 7 },
    { type: 'pyramid', color: 'silver', o: 2, row: 4, col: 9 },
    { type: 'pyramid', color: 'red', o: 1, row: 5, col: 6 },
    { type: 'pyramid', color: 'silver', o: 0, row: 6, col: 7 },
    { type: 'pyramid', color: 'silver', o: 3, row: 7, col: 2 },
    { type: 'anubis', color: 'silver', o: 0, row: 7, col: 3 },
    { type: 'pharaoh', color: 'silver', o: 0, row: 7, col: 4 },
    { type: 'anubis', color: 'silver', o: 0, row: 7, col: 5 },
    { type: 'sphinx', color: 'silver', o: 0, row: 7, col: 9 },
  ], 'silver');
}

function actions(state: RefState): Action[] {
  if (state.result !== null) return [];
  const moves: Action[] = [];
  for (const piece of state.pieces) {
    if (piece.color !== state.side) continue;
    const from = square(piece);
    const text = squareText(piece.row, piece.col);

    if (piece.type !== 'sphinx') {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const row = piece.row + dr;
          const col = piece.col + dc;
          if (!permittedSquare(piece.color, row, col)) continue;
          const target = pieceAt(state.pieces, row, col);
          const to = row * 10 + col;
          const destination = squareText(row, col);
          if (target === undefined) {
            moves.push({ text: `${text}-${destination}`, kind: 'step', from, to, orientation: piece.o });
          } else if (piece.type === 'scarab'
            && (target.type === 'pyramid' || target.type === 'anubis')
            && permittedSquare(target.color, piece.row, piece.col)) {
            moves.push({ text: `${text}x${destination}`, kind: 'swap', from, to, orientation: piece.o });
          }
        }
      }
    }

    if (piece.type === 'pyramid' || piece.type === 'anubis') {
      moves.push({ text: `${text}+`, kind: 'rotate', from, to: from, orientation: (piece.o + 1) % 4 });
      moves.push({ text: `${text}-`, kind: 'rotate', from, to: from, orientation: (piece.o + 3) % 4 });
    } else if (piece.type === 'scarab') {
      moves.push({ text: `${text}+`, kind: 'rotate', from, to: from, orientation: 1 - piece.o });
    } else if (piece.type === 'sphinx') {
      const seen: number[] = [];
      for (const turn of [1, 3]) {
        const o = (piece.o + turn) % 4;
        const direction = directions[o];
        if (!onBoard(piece.row + direction.row, piece.col + direction.col) || seen.includes(o)) continue;
        seen.push(o);
        // Section 4.4 encodes the sole corner Sphinx rotation with '+',
        // even when reaching that facing requires a counter-clockwise turn.
        // For an interior Sphinx, distinguish its two possible rotations.
        const suffix = seen.length === 1 ? '+' : '-';
        moves.push({ text: `${text}${suffix}`, kind: 'rotate', from, to: from, orientation: o });
      }
    }
  }
  return moves;
}

export function refLegalMoves(state: RefState): string[] {
  return actions(state).map(move => move.text).sort();
}

// Called only on the copied position. A shot removes at most one piece.
function fire(state: RefState, mover: RefState['side']): { path: number[]; destroyed: number } {
  const sphinx = state.pieces.find(piece => piece.type === 'sphinx' && piece.color === mover);
  if (sphinx === undefined) throw new Error(`No ${mover} Sphinx to fire`);
  const path: number[] = [];
  let travel = sphinx.o;
  let row = sphinx.row + directions[travel].row;
  let col = sphinx.col + directions[travel].col;
  while (onBoard(row, col)) {
    if (path.length >= 512) throw new Error('Laser trace exceeded 512 steps');
    path.push(row * 10 + col);
    const piece = pieceAt(state.pieces, row, col);
    if (piece !== undefined) {
      const face = (travel + 2) % 4;
      if (piece.type === 'sphinx') break;
      if (piece.type === 'anubis' && face === piece.o) break;
      if (piece.type === 'scarab') {
        travel = scarabReflection[piece.o][face];
      } else if (piece.type === 'pyramid' && pyramidReflection[piece.o][face] !== -1) {
        travel = pyramidReflection[piece.o][face];
      } else {
        state.pieces.splice(state.pieces.indexOf(piece), 1);
        if (piece.type === 'pharaoh') {
          state.result = piece.color === 'silver' ? 'red' : 'silver';
        }
        return { path, destroyed: row * 10 + col };
      }
    }
    row += directions[travel].row;
    col += directions[travel].col;
  }
  return { path, destroyed: -1 };
}

export function refApply(state: RefState, move: string): {
  state: RefState;
  laser: { path: number[]; destroyed: number };
} {
  const action = actions(state).find(candidate => candidate.text === move);
  if (action === undefined) throw new Error(`Illegal move: ${move}`);
  const next: RefState = {
    pieces: state.pieces.map(piece => ({ ...piece })),
    side: state.side,
    result: state.result,
    history: [...state.history],
  };
  const piece = next.pieces.find(candidate => square(candidate) === action.from)!;
  if (action.kind === 'rotate') {
    piece.o = action.orientation;
  } else {
    if (action.kind === 'swap') {
      const other = next.pieces.find(candidate => square(candidate) === action.to)!;
      other.row = piece.row;
      other.col = piece.col;
    }
    piece.row = Math.floor(action.to / 10);
    piece.col = action.to % 10;
  }
  const laser = fire(next, state.side);
  next.side = state.side === 'silver' ? 'red' : 'silver';
  const key = refKey(next);
  next.history.push(key);
  let repetitions = 0;
  for (const previous of next.history) {
    if (previous === key) repetitions++;
  }
  // A Pharaoh's destruction ends the game before the repetition rule.
  if (next.result === null && repetitions >= 3) next.result = 'draw';
  return { state: next, laser };
}
