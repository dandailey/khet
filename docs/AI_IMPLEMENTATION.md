# Khet AI implementation report

Implemented 2026-10-07 against `ENGINE_SPEC.md` and `AI_DESIGN.md`, using
Node v22.22.2. No runtime dependencies, DOM access, commits, or pushes were added.
The existing setup list and rules behavior are preserved.

## Files

| Area | Files |
| --- | --- |
| Rules fast paths | `packages/khet-engine/src/position.ts`, `laser.ts` |
| AI and public API | `packages/khet-engine/src/eval.ts`, `search.ts`, `types.ts`, `index.ts` |
| KEI | `packages/khet-engine/src/kei.ts`, `worker.ts`, `tools/kei.ts` |
| Tests | `packages/khet-engine/test/ai-fixtures.ts`, `beam.test.ts`, `eval.test.ts`, `search.test.ts`, `kei.test.ts`, `moves.test.ts` |
| Benchmark and report | `tools/bench.ts`, `docs/AI_BENCHMARK.txt`, this file |

`Position.generateBeamMoves(color, out)` returns a count into the supplied buffer,
including Sphinx rotations. `generateMovesFor`, `previewShot`,
`generateTacticalMoves`, `findWinInOne`, and `hasWinInOne` provide reusable AI
operations without changing the board, hash, side, result, or game history.
`previewShot` accepts a generated move and returns -1 or a packed destroyed square
and victim; it restores the board in a `finally` block.

`EvalParams.values` is a 417-element `Float64Array`: 17 named scalar features and
five 80-square piece-square tables. `PARAM_NAMES`, `DEFAULT_PARAMS`, `get`, `set`,
and JSON serialization support direct vector tuning and named configuration.
`DEFAULT_EVAL_PARAMS` and named-record parameter inputs retain compatibility with
the existing tuning tools. Features cover material, mirrored reverse-ray exposure,
shelter, distinct hanging pieces (including pieces displaced by enemy swaps), beam
control, mirror mobility, PSTs, and tempo. Static evaluation depends on board and
side; search supplies terminal and repetition scores.

`bestMove` wraps `search`. Options include depth, timeMs, nodes, seed, params,
tt/ttSize, nullMove, lmr, qsearch, threatExtension, and qDepth. Level is ignored.
With no explicit limit, the time limit is 1000 ms; explicit depth/node searches
have no implicit clock limit. TT size is the number of entries, a power of two;
the default is 2^20 entries in two-slot buckets, using approximately 33 MiB for
the table. `tt: false` or `ttSize: 0` disables it. Defaults: nullMove off, LMR,
quiescence and threat extensions on; quiescence cap 4 and extension cap 2 per path.
The normal depth limit is 64. Search clones the caller's complete game history.
Fixed-depth and fixed-node runs are deterministic for a given position, options,
parameters, and seed. Time-limited depth depends on machine load.

KEI transports accept and emit strings. The CLI and public worker use a protocol
coordinator and a child search worker, so `isready`, `stop`, and `quit` remain
responsive during search. Stop returns the last completed iteration, or a legal
non-suicidal fallback before any iteration completes. Original position commands
are replayed in the search worker to preserve repetition history. `go nodes N`
is supported in addition to the specified KEI commands.

## Verification

`npx tsc -p tsconfig.json`: **exit 0**, no diagnostics. This includes strict
checking, erasable syntax, and explicit `.ts` imports.

`npm test`: **exit 0**, all nine package test files passed. The test runner in
this environment reports isolated files in the top-level summary:

```text
# tests 9
# pass 9
# fail 0
# cancelled 0
# skipped 0
```

`npm run test:tools`: **exit 0**, 12 tests passed, 0 failed. This includes
match-worker, SPSA, Texel and statistics compatibility.

The AI test summaries:

```text
Beam verification: 500 positions, both colors; 70913 shots; 7188 changed shots; brute-force win-in-one matched
Evaluation symmetry: 300 random positions; all features and nonzero PST weights matched
Self-kill verification: 500 positions; 1000 searches at depths 1/2; 150 positions with a suicide option
TT verification: 50 positions at depth 2; moves and scores identical with TT on/off
```

Beam tests compare every move's shot against the independent reference engine,
including path, hit square and victim type; exhaustive make/unmake checks both
colors' win-in-one results. Additional evaluation tests cover parameter storage,
identity across swaps, and symmetry of ended boards reconstructed without their
adjudication metadata.

All eight search tests pass. Besides the randomized checks, they cover direct,
pyramid and Scarab wins; four positions with a verified defense; a quiet
two-mirror setup whose three-ply win is checked against every opponent reply;
node/time aborts and determinism; mate-distance normalization; feature toggles;
and a second occurrence in the search path scoring as draw before game threefold.
The original 300-game rules round trips, reference/legacy comparisons, and
Classic perft checks (77, 5920, 449414 at depths 1, 2, 3) also pass.

The scripted CLI test runs the actual `tools/kei.ts` stdin/stdout adapter using
worker stdin/stdout, which works in the restricted environment. A separate real
shell session also passed:

```text
position startpos moves h2-h3 c7-c6
go depth 3
info depth 3 score 49 nodes 6145 pv j4-j3 a5-a6 f4-g4
bestmove j4-j3
```

The worker_threads entry is tested with string handshake, position, go, isready,
stop and quit messages. The Web Worker branch typechecks; no real browser runtime
was launched in this headless environment.

## Benchmark

Command: `node tools/bench.ts`. Fixed position seed: `0x4b484554`; search seed: 1;
default parameters, TT and feature switches. The benchmark contains Classic's
start plus 19 nonterminal random continuations at 4, 8, ..., 76 plies, preserving
their game histories. Classic is the only setup currently exposed by the engine;
the benchmark automatically includes every setup in `SETUPS` without adding or
changing setups. Each search starts with a fresh table.

| Limit | Positions | Nodes | Aggregate NPS | Total search time | Completed depth |
| --- | ---: | ---: | ---: | ---: | --- |
| Depth 4 | 20 | 2,394,813 | 42,710 | 56,072.0 ms | 4 in every position |
| 1000 ms | 20 | 582,656 | 28,560 | 20,401.4 ms | mean 3.00; range 2–4 |

NPS is total nodes divided by total measured search time. Times include table
allocation, evaluation and iterative deepening. Every 1000 ms run exceeded its
target by 3.3–52.3 ms with the specified 1024-node clock sampling. Per-position
nodes, NPS, depth, milliseconds and move, together with the complete KFEN manifest,
are recorded in [AI_BENCHMARK.txt](AI_BENCHMARK.txt).

## Choices differing from AI_DESIGN

- When the unchanged base shot already destroys an enemy piece, tactical
  generation includes all moves. In particular, a quiet move can retain a
  winning base shot even if beam-relevant moves disrupt it. This closes an edge
  case in a win-in-one implementation that only tests beam moves.
- Material-based quiescence delta pruning is omitted. A concrete randomized
  TT comparison exposed a wrong result when a kill changed beam exposure by
  more than victim value plus the delta margin. Removing this pruning restored
  identical depth-two moves and scores with TT enabled and disabled.
- Evaluation computes the full feature vector rather than using lazy window
  cutoffs. No safe bound on the expensive terms is established for arbitrary
  tuning parameters. TT entries cache the complete static score, including
  hanging pieces, instead of caching just the hanging term.
- TT bound cutoffs use exact depth, matching extension/quiescence budgets,
  matching 64-bit ancestor-path fingerprints, and scout windows. This protects
  fixed-depth semantics and path-dependent repetition; PV nodes are searched
  to produce a useful line. Moves and static evaluations remain reusable
  across paths. Root ordering uses static tactical ranks and seeded ties so
  changing the TT does not change equal-score root selection.
- Pharaoh firing-line exposure uses intersections with the enemy's current
  beam as a geometric proxy. Reverse rays still follow actual mirror
  geometry; exact move reachability is scored separately on empty ray squares.
- A coordinator plus a terminable child worker implements protocol stop. This
  avoids relying on shared memory or yielding within the synchronous search;
  it costs worker startup time, outside the in-process benchmark.

## Known weaknesses

Weights are initial, untuned values and PST defaults are zero; no Elo or strength
claim has been established. Exposure and beam-control terms are heuristics.
Bounded quiescence/extensions can miss longer quiet laser setups, and LMR can
miss late quiet tactics. Null-move pruning remains experimental and off by
default because mandatory firing and zugzwang can make a hypothetical pass
unreliable. Full feature computation and move-order allocations limit throughput.
Clock limits are sampled rather than hard deadlines. Real browser bundling and
worker execution still need integration testing; TypeScript must be bundled for
browser execution.
