# Tuning Log

## 2026-10-07 — Feature ablations (time-based)

Setup: each variant vs the default engine, 100 ms per move, ttSize 65536, 150 games (75 opening pairs, colours
reversed), `tools/ablate.sh`, engine commit d9a6542 (post speed pass 1). The host was heavily loaded (load
average 5-11 on 4 cores), so 100 ms under load is roughly 20-30 ms of quiet search (depth 2-3).

| Variant | Elo vs default (95% interval) | Decision |
|---|---|---|
| hangingPieces off | -65.6 [-111.4, -20.3] | keep hanging-piece term (significant) |
| qDepth 2 (default 4) | +2.3 [-47.7, 52.2] | no measurable difference; keep 4 |
| qDepth 1 | -20.9 [-76.4, 34.4] | keep 4 |
| threatExtension off | -4.6 [-52.2, 44.0] | inconclusive; keep on (safety rationale), retest at longer time |
| LMR off | -20.9 [-70.5, 28.6] | keep LMR on |
| nullMove on | -13.9 [-68.5, 40.4] | keep off |
| qsearch off | -30.2 [-85.1, 24.3] | keep on |

Only the hanging-piece result is significant at this sample size. Revisit the others at longer time controls
once the evaluation is tuned.

## 2026-10-07 — Speed pass 2 rejected

GPT speed pass 2 (single preview pass per node, shotAfter, lazy threat cache) gave identical search results and
no speedup in an interleaved A/B (depth 3 on 10 openings: ~4.5-6.7 s both). Diff archived outside the repo
(~/projects/khet-recovery/rejected/speed-pass-2.diff). Quiet-host speed: ~100k nodes/s; evaluation is ~30% of
time.

## 2026-10-07 — External benchmark: vs jkugs/khetai (MIT, C, alpha-beta + Zobrist)

Our engine (default parameters, untuned, commit after levels merge) at 500 ms per move vs khetai at 500 ms
(local millisecond-timing patch, `external/bridge/CHANGES.md`), 60 games over 30 opening pairs, 2 workers on a
loaded host: **54 W / 0 D / 6 L, +382 Elo [259, 542]**. Of the 54 wins, 51 were Pharaoh kills and 3 were
khetai time forfeits (its clock is checked only between iterations; an iteration overran 500 ms by more than
10 s). Excluding forfeits: 51 W / 6 L. khetai searched about one ply deeper on average (its depth ~3.8-4.3 vs
ours ~2.3-3.9), so the margin comes from evaluation and tactics (win-in-1 checks, hanging-piece term), not depth.
An earlier partial run (crashed on the same timeout before the forfeit fix) stood at 17 W / 3 D / 3 L.
Raw results: local `tools/results/khetai/m500c.jsonl`.

## 2026-10-07 — Texel (static) tuning: rejected

Data: 3,000 self-play games at 2,000 nodes per move over 1,500 fresh openings; 65,523 quiet positions labelled
by game result (side-to-move perspective; checked). Tool: `tools/texel-linear.ts` (features precomputed, Adam,
held-out validation; block split by game added after fit 1 leaked same-game positions into validation).

| Candidate | Validation MSE (start -> fit) | Match vs default, 20k nodes/move | Verdict |
|---|---|---|---|
| fit 1: all 417 weights incl. piece-square tables | 0.1777 -> 0.1728 (leaky split) | -121.8 [-182.8, -64.9], 92 games, SPRT H0 | rejected |
| fit 2: scalars only, block split | 0.1722 -> 0.1696 | -146.5 [-218.0, -77.1], 128 games, SPRT H0 | rejected |
| fit 2 half-step (midpoint default/fit) | n/a | -46.1 [-89.1, -3.3], 220 games, SPRT H0 | rejected |

The static fit's direction is consistently worse in play: it raises hanging-piece penalties (-45 -> -100),
tempo (5 -> 23), exposure terms, and makes scarab mobility strongly negative. Working hypothesis: the labels
reflect the weak 2,000-node generator, so the fit learns that generator's weaknesses (positions with hanging
pieces lose at depth 2 but are defensible for a deeper search). Default parameters stay. Next: game-based tuning
(SPSA) on a few scalars at the target search depth, as a long background job.

## 2026-10-07 — Level calibration, round 1 (initial level table)

Adjacent-level matches, 2 workers, loaded host (`tools/calibrate-levels.sh`):

| Pair | Games | W/D/L (higher level first) | Elo |
|---|---|---|---|
| L2 vs L1 | 60 | 51/9/0 | +436 [311, 569] |
| L3 vs L2 | 60 | 53/1/6 | +366 [251, 514] |
| L4 vs L3 | 40 | 40/0/0 | >= +399 |
| L5 vs L4 | 30 | 20/3/7 | +161 [24, 317] |

Problems: steps are too large at the bottom, and L3 is crippled: its softmax noise uses full-window root
scoring of every root move, so at 300 ms it averaged depth 2.1 vs L4's 3.6. Fix: cheap root noise (a seeded
per-root-move score offset applied inside the normal search), then recalibrate.

## 2026-10-08 — Level calibration, round 2 (root noise, five levels)

| Pair | Games | W/D/L | Elo |
|---|---|---|---|
| L2 vs L1 | 40 | 36/4/0 | +512 [305, 757] |
| L3 vs L2 | 40 | 38/2/0 | +636 [351, 944] |
| L4 vs L3 | 40 | 37/1/2 | +470 [282, 717] |
| L5 vs L4 | 30 | 20/6/4 | +207 [96, 332] |

The span from L1 to L5 is about 1,800 Elo; five levels give ~450-Elo cliffs (a player who splits with one
level scores ~7% against the next). Decision (Khet SME): ten levels targeting ~200 Elo steps
(Novice, Beginner, Casual, Apprentice, Club, Strong, Expert, Master, Grandmaster, Pharaoh). Round 3 calibrates
all nine adjacent pairs.

## 2026-10-08 — Level calibration, round 3 (ten levels)

40 games per adjacent pair, 2 workers, loaded host:

| Pair | W/D/L | Elo [95%] |
|---|---|---|
| L2 vs L1 | 26/8/6 | +191 [80, 302] |
| L3 vs L2 | 29/5/6 | +228 [136, 337] |
| L4 vs L3 | 17/17/6 | +98 [29, 176] |
| L5 vs L4 | 29/8/3 | +269 [153, 409] |
| L6 vs L5 | 34/2/4 | +338 [208, 500] |
| L7 vs L6 | 33/1/6 | +285 [158, 447] |
| L8 vs L7 | 25/8/7 | +168 [56, 289] |
| L9 vs L8 | 20/9/11 | +80 [-34, 194] |
| L10 vs L9 | 19/14/7 | +108 [22, 203] |

Monotonic; span about 1,750 Elo. Adjustments for v1: L4 noise 80 -> 60, L6 noise 25 -> 50, L8 600 -> 500 ms,
L10 3000 -> 5000 ms. The top levels are limited by search speed: on a fast, idle device they search deeper than
on the loaded server. Pairs touching changed levels are re-verified in round 4.

## 2026-10-08 — Level calibration, round 4 (re-verify adjusted pairs)

| Pair | W/D/L | Elo [95%] |
|---|---|---|
| L4 vs L3 | 30/5/5 | +255 [153, 381] |
| L5 vs L4 | 21/13/6 | +137 [57, 228] |
| L6 vs L5 | 27/10/3 | +241 [136, 362] |
| L7 vs L6 | 39/0/1 | +636 [342, 1134] |
| L8 vs L7 | 22/7/11 | +98 [-17, 211] |
| L10 vs L9 | 28/8/4 | +241 [129, 366] |

L6 at noise 50 became too weak. Adjustment: L5 noise 30 -> 10, L6 noise 50 -> 30; round 5 re-verifies L4..L7.

## 2026-10-08 — Level calibration, round 5 and v1 ladder

| Pair | W/D/L | Elo [95%] |
|---|---|---|
| L5 vs L4 | 30/6/4 | +269 [145, 414] |
| L6 vs L5 | 28/6/6 | +215 [125, 325] |
| L7 vs L6 | 35/1/4 | +359 [219, 538] |

**v1 ladder** (chained from the latest measurement of each adjacent pair; each step +/- ~100 at 40 games):
L1 Novice 0, L2 Beginner ~190, L3 Casual ~420, L4 Apprentice ~670, L5 Club ~940, L6 Strong ~1160,
L7 Expert ~1520, L8 Master ~1620, L9 Grandmaster ~1700, L10 Pharaoh ~1940 (self-play Elo, L1 = 0; not a human
rating scale). Known soft spots: L7->L8 and L8->L9 are small steps (time doubling gains little on the loaded
host); L6->L7 is the largest. Revisit after SPSA tuning changes the engine's strength curve.
