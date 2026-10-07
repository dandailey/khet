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
