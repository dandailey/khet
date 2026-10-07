# Tuning and self-play

These tools implement section 5 of [AI_DESIGN.md](AI_DESIGN.md). They run directly
in Node 22.18+ using TypeScript type stripping, explicit `.ts` imports, and no
runtime dependencies. Typecheck with `npx tsc -p tsconfig.json`; run the harness
tests with `npm run test:tools`.

This checkout has **no `packages/khet-engine/src/index.ts`**. The harness therefore
loads `tools/lib/stub-engine.ts`, a small rules/evaluation fixture transcribed from
[ENGINE_SPEC.md](ENGINE_SPEC.md). The random player picks a seeded legal move;
the greedy player takes an immediate winning move if available, otherwise picks a
seeded random move. Neither player searches or uses evaluation weights to choose
moves. Stub matches and SPSA results validate plumbing, and cannot establish
engine strength or improved weights. The checked-in example configs select these
players explicitly.

When the engine exists, `tools/lib/engine.ts` imports it automatically. It uses the
documented `SETUPS`, `newGame`, `fromPieces`, `fromKFEN`, `toKFEN`, `legalMoves`,
`applyMove`, and `Position` methods. Search calls have the signature
`bestMove(pos, { depth?, timeMs?, nodes?, seed?, params?, ...toggles })` and expect
`{ move, score, depth, nodes, pv }`. If only search is missing, the real rules are
used with greedy as the default player. A runtime error loading the real module
is reported; it does not trigger a fallback. Texel additionally needs an export
`evaluate(pos, params?)` returning a score **from the side to move's perspective**.
The optional `DEFAULT_EVAL_PARAMS` object supplies named defaults and permits
parameter-name validation. Adapt this one adapter if the eventual evaluation API
uses a flat vector rather than named overrides.

## Balanced openings

Generate a total of N openings, distributing them as evenly as possible over all
keys of `SETUPS` (N must be at least the number of setups):

```sh
majel-heavy node tools/lib/openings.ts --n 100 --seed 20261007 --out tools/data/openings.txt
```

Each candidate starts at a setup and plays 2–4 seeded random plies. Reject a
terminal game, an immediate win for the side to move, or loss of any piece by
either side. Dedupe with the engine's position key, which excludes the ply clock.
The writer emits one canonical KFEN per line; the reader validates and
canonicalises every line. Comments and blank lines are accepted on input. The
checked-in `tools/data/openings.txt` contains 12 openings, four from each setup,
generated with seed 20261007. A bounded retry count reports impossible requests.

## Match runner

A player config can look like this when the real engine is installed:

```json
{
  "label": "Candidate",
  "nodes": 10000,
  "params": {"pyramid": 102, "anubis": 121},
  "toggles": {"nullMove": false}
}
```

Use actual engine parameter and toggle names. `nodes`, `depth`, and `timeMs` are
positive integer limits; at least one is required. Fixed nodes are recommended
for comparisons. `params` are finite numbers keyed by name. `toggles` are passed
as top-level engine options. A nested `options` object is also accepted; explicit
top-level limits/params take precedence. Optional `player` is `engine` (default),
`random`, or `greedy`. Stub players ignore the limits and report their actual
probe counts and depth; they do not pretend to have searched the node budget.

```sh
majel-heavy node tools/match.ts \
  --a tools/configs/greedy.json --b tools/configs/random.json \
  --games 20 --concurrency 2 --seed 1 \
  --openings tools/data/openings.txt --out results.jsonl

majel-heavy node tools/match.ts \
  --a candidate.json --b baseline.json --games 2000 --concurrency 2 \
  --openings tools/data/openings.txt --sprt 0,10 --out sprt.jsonl
```

`--games` counts individual games and must be even. Each opening is played twice:
A as Silver, then A as Red. The opening list cycles if more pairs are requested
than available openings. A draw is adjudicated at three occurrences of the same
position (including the starting position) or at 300 additional plies. Engine
draws and no-legal-move draws have separate termination labels.

Each completed game is streamed immediately as JSONL, including opening KFEN,
pair and game IDs, colour assignment, A/B/draw result, A's score, plies,
termination, seed, backend, and each player's average depth/nodes per move. With
`--out`, the file is appended to; without it, JSONL goes to stdout. Running and
final summaries go to stderr, keeping stdout machine-readable. Game order
depends on worker completion; IDs, moves, and outcomes are deterministic for a
fixed seed and deterministic engine. Separate invocations restart IDs at zero.

The summary contains W/D/L for all finished games and estimates from completed
pairs. A pair's mean score belongs to one of five buckets:
`0, 0.25, 0.5, 0.75, 1`. `tools/lib/stats.ts` also exposes independent trinomial
W/D/L estimates. Elo is `400*log10(score/(1-score))`; 60/20/20 W/D/L means a 70%
score and **+147.19 Elo**, while a 60% score is +70.44 Elo. The 95% interval uses
multinomial profile likelihood (an asymptotic chi-square cutoff of 3.84146).
LOS uses the normal approximation to the sample mean, so it is approximate and
can be 0 or 1 with zero observed variance. Empty samples return an unbounded
interval and LOS 0.5; unbeaten scores can have infinite Elo.

`--sprt elo0,elo1` runs a generalized SPRT using constrained multinomial maximum
likelihood on **completed pairs**, with alpha=beta=0.05. Wald boundaries are
`ln(beta/(1-alpha)) = -2.94444` and `ln((1-beta)/alpha) = +2.94444`.
H0 means the candidate failed the lower hypothesis; H1 means it passed the upper
hypothesis; otherwise continue. Once a boundary is crossed, stop scheduling new
pairs and finish all pairs in flight. This can add at most C−1 pairs. The first
verdict and crossing LLR are retained in `stoppedAt` even if those final pairs
change the LLR. This is a statistical decision rule, not a guaranteed Elo bound.

## SPSA

`tools/configs/spsa.json` chooses two fixture parameters with starts, independent
`a` and `c` magnitudes, and optional min/max/integer constraints. Its schedules
are `a_k = a/(A+k)^alpha`, `c_k = c/k^gamma`. Each iteration draws independent
±1 perturbations, plays exactly one colour-reversed pair of theta+ against
theta− at a fixed node count, and updates each parameter using the paired score
as an ascent signal, divided by its actual plus/minus parameter difference.
Clipping and optional rounding apply to both perturbations and updates. A zero
perturbation difference produces no update.

```sh
majel-heavy node tools/spsa.ts --config tools/configs/spsa.json \
  --iterations 3 --openings tools/data/openings.txt --log spsa.jsonl

# Same config/openings/log, higher total iteration target: resume at iteration 4.
majel-heavy node tools/spsa.ts --config tools/configs/spsa.json \
  --iterations 6 --openings tools/data/openings.txt --log spsa.jsonl
```

The iteration count is the total target, not the number of additional iterations.
Every fsynced JSONL entry includes the before/after parameter vectors,
perturbations, schedules, seed and outcome. Resume verifies a fingerprint of the
config, openings and backend, rejects skipped/corrupt records, and discards only
a trailing incomplete line from an interrupted write. Change config/settings
with a new log. Iteration seeds make resumed and uninterrupted runs identical.
Unselected parameters retain the player config's overrides or engine defaults.
SPSA uses one persistent worker because each iteration depends on the last.
The final selected vector is printed as JSON on stdout.

## Texel data and tuning

Generate self-play training data at a fixed node count:

```sh
majel-heavy node tools/texel.ts --generate --config tools/configs/greedy.json \
  --nodes 1000 --games 4 --concurrency 2 --every 5 --samples 12 \
  --openings tools/data/openings.txt --seed 1 --out texel.txt
```

The generator considers every `--every` plies (including the opening) and keeps
at most `--samples` quiet positions per game. Quiet means no move can destroy an
enemy piece and the opponent has no immediate Pharaoh win if the mover passed.
Label each sample after the game ends: 1 for the sampled side to move's win,
0 for its loss, 0.5 for a draw. Output is `KFEN<TAB>result`, one position per line.
Generation replaces the output file. More games may be needed when quiet
positions are rare.

```sh
majel-heavy node tools/texel.ts --tune --config tools/configs/texel.json \
  --data texel.txt --max-positions 10000 --seed 1
```

The tuning config chooses names, start values and coordinate steps, optional
bounds, `passes` (default 30), `minStep` (0.01), and `kMax` (0.1). Optional
`baseParams` supplies other overrides. First fit K in `[0,kMax]` by a grid and
golden-section refinement, then hold K fixed during coordinate descent of
`mean((sigmoid(K*eval)-result)^2)`. The sigmoid uses the natural exponential.
Unsuccessful coordinates halve their steps. The tool prints the selected/new
overrides as JSON on stdout and K/MSE/sample counts on stderr. Preserve the
reported K for validation. Compare on held-out data before accepting new weights;
this tool performs training-set fitting only. With uninformative data, K may fit
to zero and parameters will remain unchanged.

Training input is read as a stream with seeded reservoir sampling, capped at
`--max-positions` (default 10000), so a large file does not all enter memory.
Quiet filtering and final-result orientation are tested independently of tuning.

## Level calibration

`tools/configs/levels.json` has a `levels` array of player configs with unique
integer `level` values and unique labels. Level 1 must be included.

```sh
majel-heavy node tools/levels.ts --config tools/configs/levels.json \
  --games 20 --concurrency 2 --openings tools/data/openings.txt \
  --seed 1 --out levels.jsonl
```

Play every unordered matchup, with `--games` individual games per matchup and
colour-reversed openings. Print a tab-separated Elo table anchored at level 1=0,
with aggregate W/D/L. Ratings come from a joint Bradley–Terry maximum-likelihood
fit, counting draws as half a win. Half a virtual win and loss per matchup keeps
the fit finite for unbeaten levels; small-run ratings are therefore regularised.
Optional JSONL output contains each game and its level numbers. A persistent
worker pool is reused across matchups. Replace the fixture players with real
level/search options before using these ratings to calibrate difficulty.

## Memory and concurrency on the 4-core / ~2 GB host

Run **one job at a time under `majel-heavy`**, which on this host uses a 1 GiB job
memory cap and 256 MiB swap by default. Leave the remaining memory and a CPU core
for the host. Default concurrency is 2; the hard maximum is 3. Use 1 when other
work is active. Never run several independent 3-worker jobs simultaneously.
Prefer fixed nodes, not wall time, for reproducible comparisons under load.

Each worker has a 128 MiB old-generation heap limit, 16 MiB young generation,
and 4 MiB stack. After each move it checks heap plus external buffers against
192 MiB, leaving headroom toward a ~250 MB per-worker budget. Keep transposition
tables small (e.g. 16–32 MiB) using the actual engine's table-size toggle. These
limits cannot cap transient native/external allocations inside a search call;
the `majel-heavy` process-group cap is the final bound. The fixture does not
allocate a transposition table. Games are sent to the parent one at a time;
only incomplete pairs are retained, and SPSA/levels reuse worker pools.

In restricted environments, `majel-heavy` may fail to connect to the systemd
user bus. Report that failure; the commands above are intended for the host with
its user bus available. Worker limits still apply during sandbox smoke tests.

Before accepting a real engine change, run SPRT against the current best and
record the revision, config, seed, openings, node count, game counts, Elo/interval,
and verdict in `docs/TUNING_LOG.md`, as required by the AI design. Stub results
do not meet that acceptance gate.

## Fixture smoke-test examples

With the checked-in openings and seed 1, a 20-game Greedy vs Random match printed:

```text
20 games / 10 pairs: 15/0/5 W/D/L; paired Elo 190.8 (95% [58.6, 365.3]); LOS 99.9%
GSPRT LLR 0.284 [-2.944, 2.944] continue
```

The three-iteration example SPSA run produced
`{"pyramid":99.29338317805863,"anubis":119.29338317805863}`; rerunning with the
same total target wrote no duplicate records. The four-game Texel example sampled
six quiet positions and printed `K=0.024290, MSE 0.180120 -> 0.142707` after 12
passes. These numbers validate execution only. The three-worker match's measured
peak RSS was approximately 150 MiB for the entire process, including its workers.
