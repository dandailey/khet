# Khet 2.0 Engine Specification

Status: v1 (2026-10-07), owner: Khet SME. This document is the contract for the standalone engine package
`packages/khet-engine/` (rules, move generation, laser, search, evaluation, difficulty), the independent
reference rules implementation (`packages/khet-reference/`), the adapter around the old game code
(`packages/khet-legacy/`) and the tournament tooling (`tools/`). Any change of meaning needs the Khet SME.

Language and runtime: TypeScript restricted to **erasable syntax** (no enums, namespaces or parameter
properties; `const` objects instead of enums), so Node 22 runs the `.ts` sources directly (type stripping)
and Vite/esbuild bundles them for the browser. Imports use explicit `.ts` extensions. Zero runtime
dependencies and no DOM access anywhere in `khet-engine`; it must run in Node, a Web Worker and a browser
main thread. `tsc --noEmit` (strict) must pass. Tests: `node --test`. The hot path (move generation,
laser, make/unmake) uses typed arrays and integers so that a later Rust/WASM port is a translation, not a
redesign.

## 1. Board and coordinates

- 10 columns x 8 rows. Square index `sq = row * 10 + col`, `row` 0..7 top to bottom, `col` 0..9 left to right.
- Red's home is the top (row 0); Silver's home is the bottom (row 7). **Silver moves first.**
- Directions (beam travel and facing): `N = 0` (row - 1), `E = 1` (col + 1), `S = 2` (row + 1), `W = 3` (col - 1).
  `opposite(d) = (d + 2) & 3`.
- Colors: `SILVER = 0`, `RED = 1`.
- Reserved squares (a piece may never stand on a square reserved for the other color):
  - Red-only: every square of column 0, plus (row 0, col 8) and (row 7, col 8).
  - Silver-only: every square of column 9, plus (row 0, col 1) and (row 7, col 1).

## 2. Pieces and orientation

| Type | Code | Orientation `o` meaning | Moves | Rotates |
|---|---|---|---|---|
| Pharaoh | `PHARAOH` | ignored (always 0) | yes | no |
| Sphinx | `SPHINX` | firing direction (N/E/S/W) | no | yes, restricted (see 4.3) |
| Pyramid | `PYRAMID` | diagonal the mirror faces: 0 = NE, 1 = SE, 2 = SW, 3 = NW | yes | yes |
| Scarab | `SCARAB` | 0 = `/` mirror, 1 = `\` mirror (only two distinct orientations) | yes, plus swap | yes (toggle) |
| Anubis | `ANUBIS` | direction the shielded front faces (N/E/S/W) | yes | yes |

Per side: 1 Pharaoh, 1 Sphinx, 2 Scarabs, 2 Anubis, 7 Pyramids.

## 3. Laser interaction

A beam travelling in direction `t` enters a square through the face `f = opposite(t)` (the face pointing
back where it came from). Results:

- **Pyramid** with mirror diagonal `o`. The mirror covers two faces: NE covers {N, E}, SE covers {S, E},
  SW covers {S, W}, NW covers {N, W}. If `f` is one of the two mirror faces, the beam leaves through the
  other mirror face, i.e. new travel direction = the other face. Otherwise the pyramid is **destroyed** and
  the beam stops.
  - Example: pyramid NE, beam travelling S (enters the N face) leaves travelling E.
  - Example: pyramid NE, beam travelling W (enters the E face) leaves travelling N.
- **Scarab** `/` (o = 0): enter N -> travel E; enter E -> travel N; enter S -> travel W; enter W -> travel S.
  **Scarab** `\` (o = 1): enter N -> travel W; enter W -> travel N; enter S -> travel E; enter E -> travel S.
  A scarab is never destroyed.
- **Anubis** with front `o`: if `f == o` the beam is absorbed (stops, nothing destroyed); otherwise the
  Anubis is **destroyed** and the beam stops.
- **Pharaoh**: any hit destroys it; its owner loses immediately.
- **Sphinx**: any hit stops the beam; nothing happens.
- Leaving the board stops the beam.

The beam starts at the mover's Sphinx square and first steps one square in the Sphinx's direction. At most
one piece is destroyed per shot. Beam paths are reversible, so a beam that leaves the Sphinx cannot loop;
implementations still cap the trace at 512 steps and throw if it is exceeded.

The laser destroys pieces of **either** color, including the mover's own pieces and the mover's own
Pharaoh. A turn that destroys the mover's own Pharaoh loses the game for the mover.

## 4. Turn and move generation

On a turn the side to move makes exactly one action, then its own Sphinx fires (mandatory). Only the
mover's laser fires.

### 4.1 Step
Any own Pharaoh, Pyramid, Scarab or Anubis moves one square in any of the 8 directions to an **empty**,
on-board square that is not reserved for the other color. Orientation is unchanged.

### 4.2 Scarab swap
An own Scarab may exchange squares with an adjacent (8-neighbourhood) **Pyramid or Anubis of either color**.
Neither piece rotates. A swap is illegal if either piece would end on a square reserved for the other color
(the Scarab's color for the Scarab, the swapped piece's color for the swapped piece). A Scarab never swaps
with a Pharaoh, Sphinx or Scarab.

### 4.3 Rotation
- Pyramid and Anubis: rotate 90 degrees clockwise (`o + 1`) or counter-clockwise (`o + 3`), mod 4. Two moves.
- Scarab: one rotation move that toggles `o` (clockwise and counter-clockwise give the same result, so it is
  generated once).
- Sphinx: the Sphinx may face only directions whose first beam step is on the board. In the standard corner
  positions it has exactly two legal facings, so it has exactly one rotation move (to the other facing).
  General rule: rotation by +/-90 degrees to a facing whose first step is on board; deduplicate identical
  results.
- Pharaoh: no rotation moves (a Pharaoh rotation would only be a pass).

### 4.4 Move encoding (32-bit integer)
`move = from | (to << 7) | (kind << 14)` where `kind`:
- `0 STEP` (from -> to),
- `1 SWAP` (scarab at from, other piece at to),
- `2 ROT_CW` (to = from),
- `3 ROT_CCW` (to = from).
Scarab toggles and Sphinx rotations use `ROT_CW`. Text notation for logs and tests:
`STEP: "e5-f6"`-style uses `colLetter + (8 - row)` where colLetter `a..j` = col 0..9, so row 0 is rank 8.
Examples: step `"c7-d6"`, swap `"e5xf4"`, rotation `"e5+"` (cw) / `"e5-"` (ccw).

## 5. Game end

- A Pharaoh is destroyed: its owner loses. (`result = winner color`.)
- Threefold repetition: the same position (pieces, orientations, side to move) occurs the third time ->
  draw.
- Engine harness move cap: 300 plies without a result -> draw (tournaments and tests only; the UI may
  disable it).

## 6. Starting setups

Each setup is listed as `square: piece` with `row, col` (0-based). Notation: `s`/`r` color, `F` Pharaoh,
`S` Sphinx, `A` Anubis, `C` Scarab, `P` Pyramid; pyramid arrows give the mirror diagonal
(↗ NE, ↘ SE, ↙ SW, ↖ NW); Anubis/Sphinx arrows give the facing; scarab `/` or `\`.
All setups are point-symmetric: `(r, c) -> (7 - r, 9 - c)` swaps colors and rotates every orientation
by 180 degrees (scarab orientation unchanged).

### Classic (verified by Daniel, project knowledge base `board_layouts.md`)
```
row 0: rS↓(0,0) rA↓(0,4) rF(0,5) rA↓(0,6) rP↘(0,7)
row 1: rP↙(1,2)
row 2: sP↖(2,3)
row 3: rP↗(3,0) sP↙(3,2) rC\(3,4) rC/(3,5) rP↘(3,7) sP↖(3,9)
row 4: rP↘(4,0) sP↖(4,2) sC/(4,4) sC\(4,5) rP↗(4,7) sP↙(4,9)
row 5: rP↘(5,6)
row 6: sP↗(6,7)
row 7: sP↖(7,2) sA↑(7,3) sF(7,4) sA↑(7,5) sS↑(7,9)
```

### Imhotep and Dynasty (from two independent open-source implementations that agree cell by cell;
see `docs/RULES_RESEARCH.md` section 2; to be eyeballed against the physical set)
```
Imhotep
row 0: rS↓(0,0) rA↓(0,4) rF(0,5) rA↓(0,6) rC/(0,7)
row 2: sP↖(2,3) rP↗(2,6)
row 3: rP↗(3,0) sP↙(3,1) sP↘(3,4) rC/(3,5) rP↘(3,8) sP↖(3,9)
row 4: rP↘(4,0) sP↖(4,1) sC/(4,4) rP↖(4,5) rP↗(4,8) sP↙(4,9)
row 5: sP↙(5,3) rP↘(5,6)
row 7: sC/(7,2) sA↑(7,3) sF(7,4) sA↑(7,5) sS↑(7,9)

Dynasty
row 0: rS↓(0,0) rP↙(0,4) rA↓(0,5) rP↘(0,6)
row 1: rF(1,5)
row 2: rP↗(2,0) rP↙(2,4) rA↓(2,5) rC/(2,6)
row 3: rP↘(3,0) rC\(3,2) sP↖(3,4) sP↘(3,6)
row 4: rP↖(4,3) rP↘(4,5) sC\(4,7) sP↖(4,9)
row 5: sC/(5,3) sA↑(5,4) sP↗(5,5) sP↙(5,9)
row 6: sF(6,4)
row 7: sP↖(7,3) sA↑(7,4) sP↗(7,5) sS↑(7,9)
```

### Rules decisions where sources disagree (Khet SME, 2026-10-07)
- Scarab swap that would put either piece on a square reserved for the other color: illegal (matches
  alaingilbert/khet; rel1c allows it). Section 4.2.
- Sphinx: two legal facings only (rel1c and the German rules summary; alaingilbert allows four).
- Threefold repetition: automatic draw in the engine (the rule text makes it claimable; a UI may offer the
  claim instead).
- Pharaoh rotation: some sources allow it as a pointless "pass with laser"; Daniel's rules notes say the
  Pharaoh cannot rotate. Engine option `allowPharaohRotation`, default **false**; open question for Daniel.

## 7. Engine API (`packages/khet-engine/src/index.ts`)

```js
export const SILVER, RED, N, E, S, W, PHARAOH, SPHINX, PYRAMID, SCARAB, ANUBIS;
export const SETUPS;                      // { classic: [...], ... } piece lists
export function newGame(setupName = 'classic'): Position
export function fromPieces(pieces, sideToMove): Position // pieces: [{type,color,o,row,col}]
class Position {
  side;                                   // color to move
  hash;                                   // 2 x 32-bit Zobrist (hashLo, hashHi) or a BigInt-free pair
  result;                                 // null | SILVER | RED | 'draw'
  ply;
  generateMoves(out?: Int32Array|number[]): number   // legal moves for side to move; returns count
  makeMove(move): void                    // applies action + fires laser + updates result/hash/side
  unmakeMove(): void                      // exact inverse, including restoring a destroyed piece
  traceLaser(color): { path: number[] /*squares*/, hit: number /*sq or -1*/, hitType }
  pieceAt(sq): { type, color, o } | null
  clone(): Position
  toPieces(): [{type,color,o,row,col}]
  key(): string                           // canonical string for repetition and debugging
}
export function moveToString(move, pos): string
export function parseMove(str, pos): number
export function toKFEN(pos): string
export function fromKFEN(text): Position
// Portable convenience API (stable; what other front ends use):
export function legalMoves(pos): string[]
export function applyMove(pos, moveStr): Position      // returns a new Position (immutable wrapper)
export function laserResult(pos, color): { path, hit, hitType }
export function bestMove(pos, opts: { level?: 1..N, timeMs?: number, depth?: number, seed?: number })
  : { move: string, score: number, depth: number, nodes: number, pv: string[] }
```

### 7.1 KFEN position notation
Eight rank fields from row 0 (top, rank 8) to row 7, separated by `/`, then side to move (`s` or `r`).
Within a rank, a digit 1..9 or `10` counts empty squares; a piece is a letter (uppercase = Silver,
lowercase = Red: `F` pharaoh, `S` sphinx, `P` pyramid, `C` scarab, `A` anubis) followed by one orientation
character: for P `1`=NE `2`=SE `3`=SW `4`=NW; for A and S `n e s w`; for C `/` or `\`; F has none.
Every piece is exactly two characters (letter, then orientation; the Pharaoh uses `-`), so a parser always
consumes one orientation character after a piece letter; digits elsewhere are empty-square counts (greedy,
so `10` is ten). Fields are separated by one space; an optional third field is the ply count. Example: rank
0 of Classic is `ss3asf-asp22` (Sphinx S, 3 empty, Anubis S, Pharaoh, Anubis S, Pyramid SE, 2 empty). The
full Classic KFEN is generated by `toKFEN` (the canonical writer) and pinned in tests.

### 7.2 KEI text protocol (Khet Engine Interface, UCI-like)
Line-based over stdin/stdout (`tools/kei.ts`) or Worker `postMessage` strings:
`kei` -> `id name ...` + `keiok`; `isready` -> `readyok`; `newgame [setup]`;
`position kfen <kfen> [moves m1 m2 ...]` or `position startpos [setup] [moves ...]`;
`go [level n] [movetime ms] [depth d]` -> `info depth d score s nodes n pv ...` lines then
`bestmove <move>`; `stop`; `quit`.

`makeMove` stores enough undo information that any sequence of `makeMove` calls can be undone exactly by the
same number of `unmakeMove` calls. After a game-ending move, `generateMoves` returns 0.

## 8. Verification requirements

1. Hand-written laser tests for every piece type, orientation and entry face (pyramid 4 x 4, scarab 2 x 4,
   anubis 4 x 4, pharaoh, sphinx), plus board-edge exits.
2. Self-kill tests: a move that puts the mover's own Pharaoh in its own beam loses; a move that destroys an
   own pyramid is applied and that pyramid is removed.
3. Make/unmake round trip: random games, after each make/unmake pair the position key and hash are identical.
4. Zobrist hash equals a from-scratch recomputation after every move in random games.
5. **Differential test** against the independent reference engine (`packages/khet-reference/`, written
   separately from the rules text only): for 10,000 random games, at every ply the sorted legal-move strings, the laser path,
   the destroyed piece and the result are identical.
6. Perft counts (number of leaf positions after n plies from each setup, n = 1..3) recorded in
   `test/perft.json` once both engines agree.
</content>
</invoke>
7. **Legacy differential**: the old game's rules (`main` branch `src/main.js`; `ai-opponent` branch
   `src/game/*.js`) wrapped in a Node adapter and compared with the new engine on random games. Every
   disagreement is logged in `docs/LEGACY_DIFF.md` and resolved by the rules text (bugs may be on either side).
