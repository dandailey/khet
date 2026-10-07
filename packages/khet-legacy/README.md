# Headless legacy Khet

These adapters preserve the old rules, including observed bugs, for differential
testing against `docs/ENGINE_SPEC.md` sections 1–6. No rule corrections are applied.
Node 22 runs the TypeScript sources directly; syntax is erasable and there are no
runtime dependencies or DOM accesses in `src/`.

## Files and provenance

- `src/ai_opponent/{types,state,rules,laser}.js`: byte-for-byte copies obtained with
  `git show origin/ai-opponent:src/game/<file>` at
  `6e87cc23a309e973a530726e38e401fee25d740e`. Imports already use local `.js` paths,
  so no changes were needed.
- `src/main_js/rules.js`: rule extraction from `git show main:src/main.js` at
  `4fbe3a43bbb01831348f4bfdfe6e17496d08a877`.
- `src/{ai_opponent_adapter,main_js_adapter}.ts`: the two public adapters.
- `src/adapter_types.ts`: native state types, square notation and piece conversion.
- `test/legacy.test.ts`: setup assertions, smoke games, preservation regressions,
  checksums and comparison of the extraction against the original main.js.
- `test/fixtures/main.js.txt`: unchanged original main.js blob used only by the VM
  oracle. It contains the original DOM code, but is never imported as a module.
  SHA-256: `fecd6fdd50c034b31a2e0b1ecd1d1f1f128a95afce003818552de4b48c1f00da`.
- `package.json`: private ESM package. The root `tsconfig.json` enables `allowJs`
  with `checkJs: false`, keeping copied JavaScript untyped and TypeScript strict.

## API and mapping

Both adapter modules export the following functions and a native `LState` type:

```ts
legacyNewGame(): LState
legacyLegalMoves(s: LState): string[]
legacyApply(s: LState, move: string): {
  state: LState
  laser: { path: number[]; destroyed: number }
}
legacyToPieces(s: LState): { type, color, o, row, col }[]
```

States retain the old representation: `board[row][col]` contains
`{type, player, facing}` or null; `currentPlayer`, `gameOver` and `winner` also
retain native values. `legacyApply` returns a new state and does not mutate its
input. Unknown move text throws. Keep the native state for subsequent moves:
the converted piece list is a comparison view, not a lossless serialization.

Both sources use 8 rows top to bottom (0–7), 10 columns left to right (0–9), Red
at the top and Silver at the bottom. These coordinates already match the spec;
there is no flip or transpose. Both start with **Silver**. The AI modules use
`'silver'`/`'red'`; main.js uses `SILVER = 2`, `RED = 1`. The piece comparison view
maps those to the requested string colors (spec engine integers would be 0/1).

Old facings are compass strings. The old `DIRECTIONS` constants encode display
angles `N=0, NE=45, E=90, SE=135, S=180, SW=225, W=270, NW=315`; the rule functions
work with the strings, not these degrees. Conversion is:

| Piece | Old facing | Comparison `o` |
| --- | --- | --- |
| Pharaoh | any | 0 |
| Sphinx, Anubis | N, E, S, W | 0, 1, 2, 3 |
| Pyramid | NE, SE, SW, NW | 0, 1, 2, 3 |
| Scarab | NE or SE | 0 (`/`) |
| Scarab | NW or SW | 1 (`\`) |

Scarab conversion follows the old **reflection sets**, rather than guessing from
the compass label. The four original facing strings remain in native state.

Moves are sorted lexicographically. Squares use `a..j` and `8-row`, for example
`c7-d6`, `e5xf4`, `e5+`, `e5-`. Scarab toggles and Sphinx rotations use `+` even
when the old UI invokes its left button. Main.js has two equivalent scarab
buttons; their identical actions are represented once, as required by spec 4.4.

**Two unavoidable representational limits in the AI branch:**

1. Its extra rotations cannot all be expressed in spec 4.4. A genuine 90° CW/CCW
   pyramid/Anubis action uses `+`/`-`; the native scarab toggle
   `NE↔SW` or `NW↔SE` uses `+`. Other native rotations use an explicit absolute
   facing suffix, for example `d1+@N`, `e5+@SE`. This extends the notation instead
   of deleting legacy moves or silently changing their meaning. These labels are
   accepted by `legacyApply`; each native action has a distinct label. A supplied
   Sphinx with a facing outside its color's old pair uses this extension too.
2. The AI generator can put a Pyramid on a cardinal facing or an Anubis on a
   diagonal facing. Neither has a spec orientation. `legacyToPieces` reports
   `o = -1` for these cases; it does not substitute a legal orientation. Consult
   the native `facing` to distinguish them. Ordinary legal orientations always
   use the spec encoding.

Thus a fully spec-only interface cannot represent every old AI behavior. A
differential harness must retain these extra moves/invalid facings as evidence,
or explicitly filter them in the harness; this adapter does not filter them.

Laser squares are `row*10+col`. Both adapters return visited in-board squares
**after** the first step, including any hit square; the firing Sphinx and an
off-board endpoint are omitted. Repeated visits are retained. `destroyed` is the
destroyed square or `-1` when nothing was destroyed. AI paths already have this
shape; main.js segment endpoints are converted and its off-board final segment
is omitted. No beam interactions are modified during this conversion.

AI composition is native `applyMove` → mover's `resolveLaser` → `switchPlayer`
unless terminal. Its pure generator's lack of a game-over gate is preserved.
Main.js composition runs the original move/rotation mutation and fire/completion
rules synchronously. On terminal turns the shooter remains `currentPlayer`;
the legacy `winner` value is left untouched.

## Main.js extraction boundary

The following functions are copied with rule statements unchanged:
`setPiece`, `setupClassicLayout`, `isValidMove`, `computeLaserPath`,
`resolveLaserInteraction`, `findCurrentPlayerSphinx`; the rule portions of
`movePiece`, `rotatePiece`, `endTurn`, `handleLaserHit` are likewise unchanged.
Rendering, selection cleanup, animations and delayed laser firing calls are
removed from the last four functions and handled by synchronous adapter plumbing.

Some rules exist only in UI code:

- `showMoveOptions` contains the eight-neighbor enumeration and bounds check;
  querying a square and adding `moveable` are replaced by collecting `{row,col}`.
  The enumeration and validation conditions are unchanged.
- `addPieceControls` supplies the Pharaoh's lack of rotation controls, one
  Sphinx button and two left/right buttons for other pieces. Its corner/facing
  decisions for Sphinx direction are extracted into `rotationDirections`;
  text, button styles and event registration are omitted. The adapter deduplicates
  the equivalent scarab actions only at the notation boundary.
- `handleSquareClick` gates input on `gameOver` and selects only a current-player
  piece. Those gates live in the adapter's move enumeration.
- `initGame` allocates an empty 8×10 board before `setupClassicLayout`; its native
  initial/reset values form the headless `createInitialState`.
- `handleFireLaser` gates on game over, returns without ending the turn for an
  empty path, resolves a destroyed endpoint and ends the turn only if the game
  continues. `fireLaser` retains that ordering and executes the completion
  callback immediately. It omits the presentation lock `laserActive` and timers.

Original global `gameState` functions are bound synchronously to each input clone
by `withGameState`, with restoration in `finally`. Independent games do not
share persistent state. The tests evaluate the original main.js in a VM, replace
only its DOM/animation helpers, and compare every UI move choice plus each action,
laser and resulting native state for 50 plies.

All requested rule categories were extracted. Browser animation timing, selection
visuals, SVG rendering, overlays and input races during an active laser are
outside this headless one-action-at-a-time interface. The AI policies/evaluation
and the AI branch's separate DOM main.js are not part of this pure-module adapter.

## Observed or suspected differences from the spec (preserved)

1. **Both: wrong winner when destroying an enemy Pharaoh.** The winner is the
   opponent of the shooter, irrespective of the destroyed Pharaoh's owner. A
   self-kill happens to award the correct opponent; an enemy kill awards the
   victim the win. This comes from the specified main branch, even though the
   AI branch's separate UI main.js contains a different winner rule.
2. **Both: no threefold repetition detection or 300-ply draw cap.** Neither
   adapter adds them. The latter is specified as a harness rule, so a tournament
   harness can supply it externally without modifying the legacy rules.
3. **Main.js: Classic scarabs differ.** All other starting squares/pieces match.

   | Square `(row,col)` | Spec Classic | Old main.js |
   | --- | --- | --- |
   | (3,4) / e5 | Red `\` | Silver `/` (NE) |
   | (3,5) / f5 | Red `/` | Silver `\` (SW) |
   | (4,4) / e4 | Silver `/` | Red `\` (SW) |
   | (4,5) / f4 | Silver `\` | Red `/` (NE) |

4. **Main.js: scarab swap only checks the scarab destination.** It never checks
   whether the displaced piece may occupy the scarab's source square. For
   example Silver scarab `(1,9)` swaps with Red pyramid `(1,8)`, placing Red on
   a Silver-only square.
5. **Main.js: Sphinx rotation is hard-coded to (0,0) and (7,9).** It does not
   implement the spec's general on-board-first-step rule. At other squares the
   UI still provides a button, but `rotatePiece` leaves the facing unchanged,
   consuming an action and firing. Not reachable from its standard setup.
6. **Main.js: laser termination differs.** It silently stops at 100 segments or
   a repeated `(row,col,direction)`, instead of the spec's 512-step cap with an
   exception. An absent Sphinx or invalid firing direction returns an empty
   path and never ends the turn. These are chiefly supplied-position edge cases.
7. **AI: Classic relocates ten pieces.** All orientations below are retained.

   | Piece | Spec square → old square `(row,col)` |
   | --- | --- |
   | Red pyramid SE | (0,7) → (0,9) |
   | Red pyramid NE | (3,0) → (3,1) |
   | Silver pyramid SW | (3,2) → (3,3) |
   | Red pyramid SE | (4,0) → (4,1) |
   | Silver pyramid NW | (4,2) → (4,3) |
   | Silver pyramid NE | (6,7) → (6,6) |
   | Silver pyramid NW | (7,2) → (7,3) |
   | Silver Anubis N | (7,3) → (7,4) |
   | Silver Pharaoh | (7,4) → (7,5) |
   | Silver Anubis N | (7,5) → (7,6) |

   Its scarabs are Red NE/SE at (3,4)/(3,5), Silver SE/NE at
   (4,4)/(4,5). Under its reflection sets **all four are `/`**; the spec requires
   `\` at (3,4) and (4,5). The Red Pharaoh is initialized facing S rather than
   main.js's N; Pharaoh orientation is ignored and converts to 0 in both cases.
   The relocated Red pyramid at (0,9) starts on a spec Silver-only square.
8. **AI: both reserved-square sets are identical and cover the entire board
   perimeter.** Ordinary moves of either color into any perimeter square are
   forbidden, including the mover's own home row and own exclusive edge.
9. **AI: scarab swaps bypass reserved-square validation entirely.** Neither
   destination is checked, unlike its ordinary moves and the spec.
10. **AI: Pyramid and Anubis rotations choose any of eight compass facings except
    the current one.** Seven rotations are generated, including illegal 45°
    turns, 180° turns, cardinal Pyramid and diagonal Anubis facings. Scarabs
    choose any of the other three diagonal facings, including optically
    unchanged orientations; the spec allows a single toggle. See notation limits.
11. **AI: pyramid reflections travel opposite to the other mirror face.**
    `getPyramidReflection` returns `OPPOSITE_DIRECTIONS[otherSide]`. For example
    NE hit through N leaves W, while the spec and main.js leave E. A Pyramid in
    a generated cardinal facing has only one mirror face and is destroyed on
    every entry, including that face.
12. **AI: Anubis is always destroyed.** `getAnubisReflection` returns null for
    every entry, including its shielded front; `processLaserHit` treats null as
    destruction. The spec and main.js absorb a front hit.
13. **AI: Sphinx legal facings depend only on color.** Silver permits N/W and
    Red S/E, without considering the Sphinx's position. Its firing helper also
    maps diagonal NE/SE to E and NW/SW to W. Standard generated Sphinx positions
    stay in their corners, so diagonal firing requires a supplied state.
14. **AI: laser cap counts reflections, not visited squares.** Its nominal
    `maxSteps=100` counter advances only after a surviving piece interaction;
    empty squares `continue` without increment. It has no visited-state check
    and silently truncates instead of throwing after 512 square steps.
15. **AI: native move generation ignores `gameOver`.** It can generate moves
    after a winner is recorded; the adapter deliberately retains this pure
    function behavior. Main.js's UI gate returns no moves at game over. Stop
    smoke/tournament games when native `gameOver` becomes true.

These are findings from the specified source snapshots, not a claim that every
legacy bug has been identified. The tests assert the documented differences,
so correcting them accidentally will fail preservation checks.

## Validation

From the repository root:

```sh
npx tsc -p tsconfig.json
node --test packages/khet-legacy/test/legacy.test.ts
npm test
```

The suite contains 16 tests. Each Classic comparison checks all 80 squares
piece-by-piece against the spec plus explicitly recorded deviations; known
setup discrepancies are diagnostics rather than failures. Both adapters complete
50 random legal plies from their native Classic starts, checking sorted/unique
moves, input immutability and in-board path indices. Fixed LCG seeds are
`0x12345678` for main.js and `4` for the AI adapter; these smoke trajectories
reach 50 plies without an earlier win. The original-source VM oracle runs an
additional 50 main.js plies. Focused tests preserve the winner, reflection,
shield, reservation and rotation bugs; checksums verify untouched source copies.
