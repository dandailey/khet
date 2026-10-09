# khet-engine

Portable Khet 2.0 rules with no runtime dependencies. Import `src/index.ts`
directly in a runtime that strips TypeScript, or bundle it. `bestMove` is the
specified throwing stub. Only `SETUPS.classic` is supplied.

```ts
import { newGame, MAX_MOVES, toKFEN } from './src/index.ts';
const pos = newGame();
const moves = new Int32Array(MAX_MOVES);
const count = pos.generateMoves(moves);
if (count) {
  pos.makeMove(moves[0]);
  console.log(toKFEN(pos));
  pos.unmakeMove();
}
```

`board` is an 80-square `Int8Array`, with zero for empty and
`type | (color << 3) | (orientation << 4)` for pieces. `hash` is a stable
`Uint32Array([lo, hi])`, mutated in place. Treat both as read-only to preserve
hash, emitter and undo invariants. `recomputeHash(board, side, out?)` provides
an independent full-board verification. Geometry tables are precomputed.

Successful `generateMoves`, `makeMove`, `unmakeMove` and `traceLaserFast` calls
without a path buffer allocate no objects. Reuse a move buffer of `MAX_MOVES`
elements; omitting it uses position-owned scratch storage and still returns
only the count. The optional `number[]` form is supported for convenience.
The undo and repetition arrays reserve 1,024 moves at construction. For longer
sessions call `reserveHistory(capacity)` outside the hot path, or construct a
`Position(pieces, side, capacity)`. Exceeding capacity rejects the move before
mutating state. `clone()` retains undo and repetition history independently.
The 300-ply limit belongs to the harness; the core does not impose it.

`traceLaser(color)` includes the emitter as the first path square, and includes
the final on-board square (including an absorber or destroyed piece). `hit` is
the destroyed square only, or `-1` for absorption, exit, or missing emitter;
`hitType` is the destroyed piece type or `null`. Tracing does not change state.
Only `makeMove` applies a shot. `traceLaserFast(board, sphinxSquare)` returns
only the destroyed square. The recording wrapper allocates its result/path.

Scarab rotation uses `ROT_CW`. A Sphinx with one legal adjacent facing also
uses `ROT_CW`, even when the physical turn is counter-clockwise. For an interior
Sphinx with both adjacent facings available, clockwise and counter-clockwise
use `ROT_CW` and `ROT_CCW` respectively: the spec's requirement to encode both
with the same integer cannot represent both moves. Notation follows the encoded
kind, so a corner Sphinx's `+` can turn it counter-clockwise.

`toKFEN` always writes the optional ply field. Its parser consumes piece tokens
before recognizing `/` rank separators, since `/` is also a Scarab orientation.
KFEN contains board, side and ply, not repetition history. Reading it starts a
new repetition history, recovers a win when exactly one Pharaoh remains, and
cannot recover a repetition draw. `fromPieces` allows partial test positions;
absent emitters have an empty path and absent Pharaohs do not by themselves end
such a position. `key()` includes only board and side, as repetition requires.

Run `npx tsc -p tsconfig.json`,
`node --test "packages/*/test/*.test.ts"`, and
`node tools/perft.ts classic 3` at the repository root. Perft counts leaves at
exactly the requested depth (a terminal position has zero children). At depth
one it returns the move count directly; speed measures this perft traversal.
Counts are engine regression pins, pending independent reference verification.

`node tools/kei.ts` runs the section 7.2 line protocol. It supports the handshake,
readiness, setup selection, KFEN/start-position loading and move replay, stop and
quit. `go` validates its options and returns `info string bestMove: not implemented`
until search is implemented. Failed position commands retain the previous position.
