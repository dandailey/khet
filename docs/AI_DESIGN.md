# Khet AI Design

Status: v1 (2026-10-07), owner: Khet SME. Builds on `ENGINE_SPEC.md`. Goal: a strong opponent with
selectable, Elo-calibrated difficulty, where even the weakest level never makes the old AI's signature
blunder (destroying its own Pharaoh or ignoring a one-move kill).

## 1. Why the old AI failed

It searched two plies over a pruned candidate list and leaned on hand-written "safety filters". Pruning
before search throws away the defensive moves, and two plies cannot see a kill that needs a setup move.
The replacement is a conventional, well-ordered full-width search with tactical extensions, and the
evaluation is tuned by self-play rather than by hand.

## 2. Key structural fact: beam-relevant moves

The laser result of a move depends only on the contents of the squares the beam visits. A move changes the
mover's shot only if its `from` or `to` square lies on the mover's current beam path (the Sphinx square
included, so a Sphinx rotation is always relevant). Every other move produces exactly the same shot as the
current one.

Consequences used everywhere:

- **Win-in-1 detection** for a side: generate only its beam-relevant moves (pieces on the path that move,
  rotate or swap; pieces adjacent to a path square that step or swap onto it; the Sphinx rotation) and test
  each. This is the Khet analogue of "captures and checks" and costs a fraction of full move generation.
- **Kill moves** (moves whose shot destroys an enemy piece) come only from beam-relevant moves, or from
  the base shot if it already hits something.
- **Threat test**: "if the side to move passed, could the opponent kill the Pharaoh?" is a win-in-1 test for
  the opponent on the current position.

The engine exposes `generateBeamMoves(color, out)` returning the beam-relevant moves for `color`, and
`hasWinInOne(color)`. Both must be verified against brute force (generate all moves, keep those whose shot
differs from the base shot) in randomized tests.

## 3. Search

Negamax alpha-beta with principal variation search, inside iterative deepening:

- **Terminal scores**: win = `MATE - ply`, loss = `-(MATE - ply)`, draw = 0 (optionally a small contempt).
- **Immediate win first**: at every interior node, test beam-relevant moves for a Pharaoh kill before
  anything else; if found, return the mate score.
- **Threat extension**: if the opponent has a win-in-1 against the side to move, extend the node by one ply
  (capped per path) and never stand pat at depth 0. This is the "check extension" of Khet and the main cure
  for "dumb as a rock".
- **Quiescence**: at depth 0, stand pat on the static evaluation (unless threatened, see above), then search
  only kill moves (enemy pieces destroyed), ordered by victim value, with delta pruning, depth-capped.
- **Transposition table**: Zobrist key, typed-array buckets (depth-preferred plus always-replace), storing
  the best move, bound type and score (mate scores adjusted by ply). Default 2^20 entries; configurable.
- **Move ordering**: TT move, winning moves, kills ordered by victim value, killer moves (2 per ply), then
  history-heuristic score for quiet moves; moves that destroy an own piece go last.
- **Late move reductions** for quiet, late, non-threatening moves at depth >= 3; re-search on fail-high.
- **Aspiration windows** around the previous iteration's score.
- **Null-move pruning**: experimental, off by default; switched on only if self-play shows a gain.
- **Repetition**: a position repeated within the search path scores as a draw.
- **Time control**: `timeMs`, `depth` or `nodes` limits; the clock is checked every 1024 nodes; on timeout
  the best move of the last completed iteration is returned. Fixed-node limits are used for tournaments so
  results do not depend on machine load.
- **Determinism**: the same position, options and seed give the same move.

The search runs in a Web Worker in the browser (`packages/khet-engine/src/worker.ts` speaking the KEI
protocol) and in-process or in `worker_threads` under Node.

## 4. Evaluation

Score from the side to move's perspective, in centipawn-like units (a pyramid is about 100). All weights
live in one `EvalParams` object (flat number array plus names) so that tuning tools can read and write it.

Features (each a separate weight, for both sides, mirrored):

1. **Material**: pyramids and Anubis on the board (Scarabs are indestructible; they carry no material).
2. **Pharaoh exposure**: reverse rays from the Pharaoh in the four directions, followed through mirrors.
   Penalties for a ray that reaches the enemy Sphinx's firing line, for each empty square on a ray that an
   enemy piece could reach in one move, and for the ray length that is open.
3. **Pharaoh shelter**: own blockers adjacent to the Pharaoh (Anubis front facing out counts most), and
   Pharaoh on the back rank.
4. **Hanging pieces**: own pieces the opponent can destroy with one move (beam-relevant generation of the
   opponent), weighted by value; the symmetric bonus for enemy pieces we threaten. Cached in the TT entry.
5. **Beam control**: length of own beam path, whether it ends near the enemy Pharaoh, number of enemy pieces
   adjacent to the own path.
6. **Mobility of mirrors**: count of own pyramids and Scarabs that can rotate or step onto the own beam path
   (cheap proxy for attacking potential).
7. **Piece-square terms**: small per-type tables (tuned by Texel; start at zero).
8. **Tempo**: side-to-move bonus.

Lazy evaluation: compute material and Pharaoh exposure first; skip the expensive terms when far outside the
window.

## 5. Tuning

All tuning runs headless in Node on mbox under `majel-heavy`, at most 3 worker threads at a time.

- **Match runner** (`tools/match.ts`): engine A vs engine B, each defined by params and limits; balanced
  openings (a set of start positions produced by 2 to 4 random plies from each setup, de-duplicated, each
  played twice with colors reversed); fixed nodes per move; adjudication at the 300-ply cap as a draw. It
  outputs W/D/L, Elo with a 95% interval, and an SPRT verdict (elo0 = 0, elo1 = 10, alpha = beta = 0.05).
- **SPSA** (`tools/spsa.ts`) over the `EvalParams` vector using short fixed-node games.
- **Texel tuning** (`tools/texel.ts`): positions sampled from self-play games, labelled by the final result,
  quiet positions only (no kill move available to the side to move); minimise the logistic loss of
  `sigmoid(eval)` against the result by coordinate descent or Adam.
- Every accepted change must pass SPRT against the current best before it is merged; results are logged in
  `docs/TUNING_LOG.md` with the commit, settings and numbers.

## 6. Difficulty levels

Levels are search limits plus controlled imperfection, calibrated by self-play Elo:

| Level | Name | Limits (targets, to be calibrated) | Imperfection |
|---|---|---|---|
| 1 | Novice | depth 1 + quiescence | softmax choice among root moves with high temperature; never self-kill |
| 2 | Casual | depth 2 | moderate temperature; misses a 2-move setup sometimes |
| 3 | Club | depth 3 to 4, 300 ms | small temperature |
| 4 | Expert | 1 s | none |
| 5 | Master | 3 s+ (or maximum the device allows) | none |

Every level, including level 1, always takes an immediate win and never plays a move that destroys its own
Pharaoh; levels 1 and 2 may fail to see a threat that needs more depth, which is how weaker humans lose too.
Calibration: round-robin of the levels, Elo from the results, and adjustment until neighbouring levels are
roughly 150 to 250 Elo apart. Level 5's strength is whatever the tuned engine reaches.

## 7. Alternative: MCTS

After the alpha-beta engine is tuned, build an MCTS variant (UCT with the static evaluation at leaves or
short policy-guided playouts, and the immediate-win/threat rules as hard constraints) and play it against
the alpha-beta engine at equal time. Keep whichever is stronger; the API does not change.
