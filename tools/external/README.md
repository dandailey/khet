# External khetai benchmark bridge

Build and run from the repository root, without network access:

```sh
bash tools/external/build-khetai.sh
node tools/external/verify-khetai.ts --out external/bridge/verification.json
node --test tools/external/protocol-khetai.test.ts
npm run typecheck
npm run test:tools
node tools/match.ts --a tools/configs/engine-500ms.json --b tools/configs/khetai-500ms.json --games 6 --concurrency 3 --seed 20261007 --out external/bridge/smoke.jsonl
```

The build uses `gcc -O2`. The local C copy, exact changes, and MIT license are
in [external/bridge](../../external/bridge/CHANGES.md). The upstream source and
generated executables remain gitignored; bridge source and recorded results
are visible to git. No commit or push is needed. `--out` for match output appends,
so use a fresh filename when rerunning.

## Mapping derived from C

Source evidence is `str_to_square`, `get_piece`, `get_owner`, `get_orientation`,
`directions`, `reflections`, `can_move`, `sphinx_loc`, and the Ruby wrapper's
padding conversion. The upstream README's claimed 1–4 compass numbering is
incorrect; its own example already uses 0.

| Concept | Our engine | khetai C / CLI |
|---|---|---|
| Silver | side 0; uppercase KFEN | side 0; lowercase tokens |
| Red | side 1; lowercase KFEN | side 1; uppercase tokens |
| Pharaoh | type 1, `F` / `f` | type 4, `x0` / `X0`; orientation irrelevant |
| Sphinx | type 2, `S` / `s` | type 5, `l<o>` / `L<o>` |
| Pyramid | type 3, `P` / `p` | type 2, `p<o>` / `P<o>` |
| Scarab | type 4, `C` / `c` | type 3, `s<o>` / `S<o>` |
| Anubis | type 5, `A` / `a` | type 1, `a<o>` / `A<o>` |
| Orientation | 0=N, 1=E, 2=S, 3=W | Identical; pyramid reflecting faces agree |
| Scarab orientation | 0=`/`, 1=`\` | 0/2=`/`, 1/3=`\`; adapter sends 0/1 |
| Empty | board byte 0 | `--` |
| Board layout | 8×10, row 0 is rank 8 | 10×12 with a one-cell border |
| Square conversion | `sq=row*10+col` | `index=13+row*12+col` |
| Corners | a8=0, j8=9, a1=70, j1=79 | a8=13, j8=22, a1=97, j1=106 |
| Sphinx locations | Red a8; Silver j1 in standard setups | Hard-coded Red=13; Silver=106 |
| Laser steps N/E/S/W | row/column neighbors | -12 / +1 / +12 / -1 |
| Translation/swap | `a1-b2` / `a1xb2` | rotation 0; occupied destination means swap |
| Rotation | `+` clockwise, `-` counterclockwise | +1 clockwise, -1 counterclockwise |
| Symmetric rotations | Scarab and corner Sphinx use `+` | Both scarab rotations map to `+`; Sphinx's lone inward turn maps to `+` |

Padding indices are the complete first/last 12-cell rows, plus columns 0 and
11 in each playable row. The 80-token form omits that border. A 120-token form
must use `--` there. Anubis shields and pyramid/scarab reflection orientations
were checked against actual C laser execution, not inferred from labels alone.

`can_move` agrees with our ordinary destination reservations: Red owns file a
and i8/i1; Silver owns file j and b8/b1. The C scarab swap generator has two
additional behaviors described below.

## Adapter and match integration

`khetaiMove(pos, { depth, timeMs }): string` is synchronous and returns our move
notation. A persistent IO worker spawns the C CLI once and owns asynchronous
stdin/stdout; a shared-memory mailbox lets the caller wait synchronously.
`khetaiMoveResult` also returns completed depth. Node counts are unavailable
and recorded as 0. Standalone callers should call `closeKhetai()` when finished.
Each match worker reuses its CLI across games; the runner shuts those processes
down before terminating its workers. CLI requests have a bounded transport
timeout in addition to the C search budget.

The provided config is:

```json
{"label":"khetai-1s","player":"khetai","timeMs":1000,"depth":25}
```

Depth defaults to 25 for this player; `timeMs` is required. No search-return
filter substitutes a legal move. If the returned notation is absent from our
legal move list, the game awards the opponent the win and records
`termination: "illegal-move"` plus `illegalMove: {move, kfen, player}`. The
KFEN is the position before the attempted move, and the attempt does not count
as a played ply. Other transport/build failures remain match errors.

## Verification results, 2026-10-07

[verification.json](../../external/bridge/verification.json) records seed
20261007 and 500 distinct nonterminal positions sampled while playing random
legal games from our three setups (10 games visited; up to 100 plies per game).
Each position is checked before continuing its random game; external search
moves do not drive the random sequence.

- 1,000 random-position laser checks plus 4 targeted-fixture checks: all
  destroyed squares and final on-board path squares agree with `traceLaser`.
  Inputs alternate between the 80- and 120-token encodings.
- 500 searches at depth 2 / 25 ms: all 500 returned moves are legal in our
  engine. The verifier records an illegal return's raw triple, translated move,
  and KFEN, then fails its final assertion if any occurred.
- 500 complete move-set comparisons: every move in our rules is present in
  khetai after rotation canonicalization. There were 2 extra reserved-square
  swaps and 17 extra Sphinx swaps, all classified explicitly.
- Random samples cover all four pyramid and Anubis orientations for both
  colours, both scarab orientations, and both allowed corner Sphinx facings.
- Both rule differences have deterministic targeted fixtures.
- Typecheck passed. All 15 tooling tests passed, including forfeit result
  attribution with khetai as either A or B, move/KFEN recording, canonical
  rotations, and config limits. The separate persistent-protocol test passed
  for the release build and an AddressSanitizer/UndefinedBehaviorSanitizer build,
  including malformed inputs, reset behavior, millisecond timing, and depth 25.

These checks validate encoding and laser behavior; the observed move-set
differences mean the engines do not implement identical rules.

## Rule differences retained for benchmarking

1. **Displaced-piece reservations.** C checks `can_move[mover][destination]`
   but does not check whether the displaced piece may occupy the starting
   square. In the targeted fixture, Silver's scarab on b8 swaps with Red's
   pyramid on c7 (`b8xc7`), putting Red on the Silver-only b8. Our rules reject
   it. Ordinary empty-square destination restrictions agree.
2. **Sphinx swaps.** C allows scarab swaps with any occupied destination whose
   type is neither scarab nor Pharaoh, including a Sphinx. `j2xj1` swaps a
   Silver scarab with its own Sphinx in the targeted fixture. Our rules allow
   swaps only with pyramids or Anubis. C also keeps firing from its hard-coded
   corner after a hypothetical Sphinx swap during search; that can influence
   evaluation even when the eventual root move is legal.
3. **Emitter placement and repetition.** Our position model supports arbitrary
   inward-facing Sphinx squares; C assumes the standard corners. The CLI
   validates the standard locations rather than pretending to support arbitrary
   placements. Our engine/harness detects threefold draws; C search has no
   repetition history. Match draw adjudication remains in our harness.
4. **Equivalent rotations are notation differences.** C emits both scarab
   rotations and uses literal +/-90° for its Sphinx toggle. Our engine represents
   equivalent scarab rotations and the sole inward corner Sphinx rotation with
   `+`. Canonicalization preserves the physical resulting beam behavior.

## Six-game smoke match

[smoke.jsonl](../../external/bridge/smoke.jsonl) contains the complete game
records. Both players used 500 ms, depth 25, seed 20261007, three workers, and
the first three repository openings, each played with colours reversed.

| Game ID | Our colour | Our result | Plies | Termination |
|---|---|---|---|---|
| 0 | Silver | Win | 58 | pharaoh |
| 1 | Red | Loss | 43 | pharaoh |
| 2 | Silver | Win | 29 | pharaoh |
| 3 | Red | Loss | 73 | pharaoh |
| 4 | Silver | Win | 28 | pharaoh |
| 5 | Red | Loss | 106 | pharaoh |

```text
Final: 6 games / 3 pairs: 3/0/3 W/D/L; paired Elo 0.0 (95% [-178.5, 178.5]); LOS 50.0%
```

There were no illegal-move forfeits or CLI failures in this smoke match. Timed
search results depend on machine load; this six-game smoke is a completion
check and does not establish playing strength.

To reproduce the sanitizer protocol check:

```sh
gcc -O1 -g -std=c11 -D_POSIX_C_SOURCE=200809L -fsanitize=address,undefined -fno-omit-frame-pointer external/bridge/khetai_cli.c external/bridge/khetai_lib.c -o external/bridge/khetai_cli-asan
KHETAI_TEST_BINARY=external/bridge/khetai_cli-asan node --test tools/external/protocol-khetai.test.ts
```
