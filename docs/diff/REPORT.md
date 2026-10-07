# Khet differential verification

Run date: 2026-10-07. Runtime: Node v22.22.2. Seed: `3523158054` (Mulberry32).

## Method and reproduction

`--setup all` cycles Classic, Imhotep, Dynasty, distributing games evenly. Each game starts from its named setup with Silver to move. At every ply the sorted legal text moves are compared first. Select uniformly from the fast engine’s generated moves; with probability 0.3 select uniformly from moves whose shot destroys a piece, if any exist. There is no restriction against self-kills. Stop at a winner, repetition draw, 300 plies, or the first fast/reference disagreement. The cap is a harness draw, separate from either engine’s result.

After the chosen action, compare the mover’s laser path, actual fast-board destroyed square against reference destruction, result, and canonical pieces/orientations/side. Pharaoh orientation is 0; square indices are row*10+col. The action preview restores the public board before makeMove and leaves hash/history untouched. It supplies tactical selection and the shot path; destruction is read from makeMove’s resulting board.

**Laser normalisation:** remove the fast trace’s first element (the emitter). Reference and both legacy adapters already omit it. Retain every visited in-board square after the emitter, in order, including repeated visits and the stopping square. Omit off-board endpoints. Absorption and board exits have destroyed square -1.

**Legacy comparison:** every fast turn is projected into the chosen adapter’s native board representation, using its README’s mapping (Scarab / -> NE, backslash -> SW). Run the adapter’s own legal generator and, if it accepts the chosen fast move, its own apply-and-fire operation. Keep its native returned state for that comparison, including winner/currentPlayer; begin the next comparison from the next fast position. This compares the same input and avoids cascading divergences. Legacy generators are compared in full, including AI +@facing extensions. A rejected fast move counts through the legal-moves category; post-move comparisons are unavailable for that turn, rather than fabricated. Repetition history is absent from native legacy states. This campaign did not reach repetitions.

The adapters only supply a native Classic start. Check that native start separately in each Classic game (counts included in the table); use the common-input projection for turns from all three spec setups. Native-start examples reproduce by comparing newGame("classic") with the adapter’s legacyNewGame(), without applying moves. Main’s three legal-moves examples repeat its deterministic native-start error in different games.

Each example records setup, zero-based game number, full move prefix, pre-turn KFEN and local moves, category, and both values. For a turn, the KFEN plus local move is the short common-input reproduction; replay the full prefix from setup when repetition history matters. A legal-moves example has no local move. The prefix ends exactly at the offending comparison. Full machine-readable results and examples are in [reference.json](reference.json), [legacy-main.json](legacy-main.json), and [legacy-ai.json](legacy-ai.json).

## Campaign counts

| Comparison | Games | Classic / Imhotep / Dynasty | Plies | Fast/reference disagreements |
| --- | ---: | --- | ---: | ---: |
| reference | 10,000 | 3334 / 3333 / 3333 | 113,252 | 0 |
| legacy-main | 2,000 | 667 / 667 / 666 | 22,812 | 0 |
| legacy-ai | 2,000 | 667 / 667 / 666 | 22,812 | 0 |

The 10,000-game reference run had 49,726 destroying shots and 32,994 selections from the tactical subset. Silver won 4,719 games and Red won 5,281; no repetition or cap draws. All games ended by a Pharaoh loss. Self-kills are allowed, so these tactical-biased random games are short (average 11.3252 plies). This samples rules behavior; it does not measure playing strength.

**Every fast/reference disagreement: none.** No rules-behavior changes were made to either engine, and no legacy files were edited.

## Legacy categories

| Category | Main | AI |
| --- | ---: | ---: |
| legal moves | 667 | 23,479 |
| laser | 0 | 11,694 |
| destroyed | 0 | 4,069 |
| result | 320 | 546 |
| position | 2,667 | 5,744 |

Main: 22,812 common-input turns, 22,812 applications, 0 unavailable applications, 667 native-start checks. AI: 22,812 common-input turns, 20,652 applications, 2,160 unavailable applications, 667 native-start checks. Counts are mismatching observations per category, not unique bugs or games; one turn may contribute to several categories.

## Analysis against the specification

Main: all 667 legal-moves mismatches come from the native Classic scarab colors/orientations, which differ from section 6. Projected turns had no legal-moves, laser, or destruction mismatch in this sample. The 320 result mismatches award the win to the victim of an enemy-Pharaoh hit, contrary to sections 3 and 5. The 2,667 position mismatches comprise 667 native-layout differences and 2,000 terminal turns where currentPlayer stays with the shooter instead of switching as the new engine APIs do. Winner errors are rules violations; terminal-side bookkeeping is an API difference after play has ended. Known reserved-square swap bugs from the legacy README were not encountered here.

AI: all 22,812 projected legal generators differed, plus 667 native starts. Its perimeter restrictions contradict sections 1/4.1; extra rotations contradict 4.3/4.4, and native Classic placements contradict section 6. The recorded laser/destruction examples demonstrate the pyramid reflection direction error: section 3 requires exit through the other mirrored face, while AI uses its opposite. Its shield handling also conflicts with the section 3 Anubis absorption rule (documented in the preserved legacy implementation). Result examples show a fast/reference Pharaoh loss while the AI beam stops earlier and reports no result; these are consequences of its beam interactions. Native positions differ initially and after incorrect destruction or terminal-side bookkeeping. Some enemy-kill results additionally reflect the preserved wrong-winner rule. The examples below and raw JSON provide concrete values; these category totals do not distinguish every underlying cause.

## Perft

Leaf counts exclude branches that end before the requested depth. Depth 0 is 1; terminal positions at positive depth contribute 0. Both engines independently generated the following counts, recorded in [perft.json](../../packages/khet-engine/test/perft.json).

| Setup | Fast depths 1 / 2 / 3 | Reference depths 1 / 2 / 3 | Reference depth-3 seconds |
| --- | --- | --- | ---: |
| classic | 77 / 5,920 / 449,414 | 77 / 5,920 / 449,414 | 0.312 |
| imhotep | 73 / 5,343 / 385,986 | 73 / 5,343 / 385,986 | 0.267 |
| dynasty | 70 / 4,854 / 331,511 | 70 / 4,854 / 331,511 | 0.175 |

Every reference depth-3 traversal took less than 60 seconds, so all depths 1..3 are asserted live in the tests.

## Validation and commands

`tsc -p tsconfig.json`: PASS. `npm test`: 9 files passed, 0 failed. Detailed package test run: 266 tests passed, 0 failed. The differential test runs 300 games per setup (900 total), with zero disagreements; setup count/symmetry tests cover both packages. See [validation.txt](validation.txt) for summary lines. Existing unknown-setup fixtures were renamed to "unknown" because Imhotep and Dynasty are now supported.

```sh
node tools/difftest.ts --games 10000 --seed 3523158054 --setup all --legacy none --out docs/diff/reference.json --perft-out packages/khet-engine/test/perft.json
node tools/difftest.ts --games 2000 --seed 3523158054 --setup all --legacy main --out docs/diff/legacy-main.json
node tools/difftest.ts --games 2000 --seed 3523158054 --setup all --legacy ai --out docs/diff/legacy-ai.json
npm run typecheck
npm test
node --test --experimental-test-isolation=none --test-concurrency=1 "packages/*/test/*.test.ts"
```

`--perft-out` is an optional extension that always measures depths 1..3 for both engines. `--out` writes JSON to the given file and creates its parent directory. Reference disagreements produce exit status 1 after completing all requested games; legacy disagreements remain diagnostic.

## Legacy example reproductions

### legacy-main

#### legal moves

Example 1: game 0, classic, legacy native start.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0","localMoves":[],"moves":[],"item":"legal moves","fast":["c1+","c1-","c1-b1","c1-b2","c1-c2","c1-d2","c4+","c4-","c4-b3","c4-b4","c4-b5","c4-c3","c4-d3","c4-d4","c4-d5","c5+","c5-","c5-b4","c5-b5","c5-b6","c5-c6","c5-d4","c5-d5","d1+","d1-","d1-c2","d1-d2","d1-e2","d6+","d6-","d6-c6","d6-d5","d6-d7","d6-e6","d6-e7","e1-d2","e1-e2","e1-f2","e4+","e4-d3","e4-d4","e4-d5","e4-e3","e4-f3","f1+","f1-","f1-e2","f1-f2","f1-g1","f1-g2","f4+","f4-e3","f4-f3","f4-g4","f4-g5","f4xg3","h2+","h2-","h2-g1","h2-g2","h2-h1","h2-h3","h2-i2","h2-i3","j1+","j4+","j4-","j4-i3","j4-i4","j4-i5","j4-j3","j5+","j5-","j5-i4","j5-i5","j5-i6","j5-j6"],"other":["c1+","c1-","c1-b1","c1-b2","c1-c2","c1-d2","c4+","c4-","c4-b3","c4-b4","c4-b5","c4-c3","c4-d3","c4-d4","c4-d5","c5+","c5-","c5-b4","c5-b5","c5-b6","c5-c6","c5-d4","c5-d5","d1+","d1-","d1-c2","d1-d2","d1-e2","d6+","d6-","d6-c6","d6-d5","d6-d7","d6-e6","d6-e7","e1-d2","e1-e2","e1-f2","e5+","e5-d4","e5-d5","e5-e6","e5-f6","e5xd6","f1+","f1-","f1-e2","f1-f2","f1-g1","f1-g2","f5+","f5-e6","f5-f6","f5-g4","f5-g5","f5-g6","h2+","h2-","h2-g1","h2-g2","h2-h1","h2-h3","h2-i2","h2-i3","j1+","j4+","j4-","j4-i3","j4-i4","j4-i5","j4-j3","j5+","j5-","j5-i4","j5-i5","j5-i6","j5-j6"]}
```

Example 2: game 3, classic, legacy native start.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0","localMoves":[],"moves":[],"item":"legal moves","fast":["c1+","c1-","c1-b1","c1-b2","c1-c2","c1-d2","c4+","c4-","c4-b3","c4-b4","c4-b5","c4-c3","c4-d3","c4-d4","c4-d5","c5+","c5-","c5-b4","c5-b5","c5-b6","c5-c6","c5-d4","c5-d5","d1+","d1-","d1-c2","d1-d2","d1-e2","d6+","d6-","d6-c6","d6-d5","d6-d7","d6-e6","d6-e7","e1-d2","e1-e2","e1-f2","e4+","e4-d3","e4-d4","e4-d5","e4-e3","e4-f3","f1+","f1-","f1-e2","f1-f2","f1-g1","f1-g2","f4+","f4-e3","f4-f3","f4-g4","f4-g5","f4xg3","h2+","h2-","h2-g1","h2-g2","h2-h1","h2-h3","h2-i2","h2-i3","j1+","j4+","j4-","j4-i3","j4-i4","j4-i5","j4-j3","j5+","j5-","j5-i4","j5-i5","j5-i6","j5-j6"],"other":["c1+","c1-","c1-b1","c1-b2","c1-c2","c1-d2","c4+","c4-","c4-b3","c4-b4","c4-b5","c4-c3","c4-d3","c4-d4","c4-d5","c5+","c5-","c5-b4","c5-b5","c5-b6","c5-c6","c5-d4","c5-d5","d1+","d1-","d1-c2","d1-d2","d1-e2","d6+","d6-","d6-c6","d6-d5","d6-d7","d6-e6","d6-e7","e1-d2","e1-e2","e1-f2","e5+","e5-d4","e5-d5","e5-e6","e5-f6","e5xd6","f1+","f1-","f1-e2","f1-f2","f1-g1","f1-g2","f5+","f5-e6","f5-f6","f5-g4","f5-g5","f5-g6","h2+","h2-","h2-g1","h2-g2","h2-h1","h2-h3","h2-i2","h2-i3","j1+","j4+","j4-","j4-i3","j4-i4","j4-i5","j4-j3","j5+","j5-","j5-i4","j5-i5","j5-i6","j5-j6"]}
```

Example 3: game 6, classic, legacy native start.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0","localMoves":[],"moves":[],"item":"legal moves","fast":["c1+","c1-","c1-b1","c1-b2","c1-c2","c1-d2","c4+","c4-","c4-b3","c4-b4","c4-b5","c4-c3","c4-d3","c4-d4","c4-d5","c5+","c5-","c5-b4","c5-b5","c5-b6","c5-c6","c5-d4","c5-d5","d1+","d1-","d1-c2","d1-d2","d1-e2","d6+","d6-","d6-c6","d6-d5","d6-d7","d6-e6","d6-e7","e1-d2","e1-e2","e1-f2","e4+","e4-d3","e4-d4","e4-d5","e4-e3","e4-f3","f1+","f1-","f1-e2","f1-f2","f1-g1","f1-g2","f4+","f4-e3","f4-f3","f4-g4","f4-g5","f4xg3","h2+","h2-","h2-g1","h2-g2","h2-h1","h2-h3","h2-i2","h2-i3","j1+","j4+","j4-","j4-i3","j4-i4","j4-i5","j4-j3","j5+","j5-","j5-i4","j5-i5","j5-i6","j5-j6"],"other":["c1+","c1-","c1-b1","c1-b2","c1-c2","c1-d2","c4+","c4-","c4-b3","c4-b4","c4-b5","c4-c3","c4-d3","c4-d4","c4-d5","c5+","c5-","c5-b4","c5-b5","c5-b6","c5-c6","c5-d4","c5-d5","d1+","d1-","d1-c2","d1-d2","d1-e2","d6+","d6-","d6-c6","d6-d5","d6-d7","d6-e6","d6-e7","e1-d2","e1-e2","e1-f2","e5+","e5-d4","e5-d5","e5-e6","e5-f6","e5xd6","f1+","f1-","f1-e2","f1-f2","f1-g1","f1-g2","f5+","f5-e6","f5-f6","f5-g4","f5-g5","f5-g6","h2+","h2-","h2-g1","h2-g2","h2-h1","h2-h3","h2-i2","h2-i3","j1+","j4+","j4-","j4-i3","j4-i4","j4-i5","j4-j3","j5+","j5-","j5-i4","j5-i5","j5-i6","j5-j6"]}
```

#### laser

No disagreements observed; no reproductions.

#### destroyed

No disagreements observed; no reproductions.

#### result

Example 1: game 2, dynasty, legacy turn.

```json
{"beforeKFEN":"ss3p3as4/5f-c/p12/p13p35/p21c\\3P23/2C/4C\\P31/9P3/4F-5/3P4AnP1P12Sn r 13","localMoves":["g7-g6"],"moves":["f3-f2","g8-h7","j4-","g6-g7","j4-j5","e6-f5","e5-d6","h7-","d3-c4","f4-e4","f2-g1","f5-e6","j5-i4","g7-g6"],"item":"result","fast":"red","other":"silver"}
```

Example 2: game 23, dynasty, legacy turn.

```json
{"beforeKFEN":"ss3p3asp23/5f-4/p15c/3/p21p41P45/3c\\3C\\1P4/4AeP13P3/3C/F-5/3P1AeP13Sn s 8","localMoves":["h4+"],"moves":["d1+","f6-","e1+","e6-","e3+","f4-","d3-d2","c5xd4","h4+"],"item":"result","fast":"silver","other":"red"}
```

Example 3: game 29, dynasty, legacy turn.

```json
{"beforeKFEN":"ss3p3asp13/6f-c/2/p19/p21c/1P45/5p22C\\1/3C/6/4F-1P11P31/3P4AnP13Sn s 12","localMoves":["i2-j2"],"moves":["g5-h6","f7-g7","f3-g2","d4-d5","j3-i2","e6-","h6-i5","g8-","h4-i4","c5+","i5-h6","g6-h7","i2-j2"],"item":"result","fast":"silver","other":"red"}
```

#### position

Example 1: game 0, classic, legacy native start.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0","localMoves":[],"moves":[],"item":"position","fast":"silver|0:red:sphinx:2|4:red:anubis:2|5:red:pharaoh:0|6:red:anubis:2|7:red:pyramid:1|12:red:pyramid:2|23:silver:pyramid:3|30:red:pyramid:0|32:silver:pyramid:2|34:red:scarab:1|35:red:scarab:0|37:red:pyramid:1|39:silver:pyramid:3|40:red:pyramid:1|42:silver:pyramid:3|44:silver:scarab:0|45:silver:scarab:1|47:red:pyramid:0|49:silver:pyramid:2|56:red:pyramid:1|67:silver:pyramid:0|72:silver:pyramid:3|73:silver:anubis:0|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0","other":"silver|0:red:sphinx:2|4:red:anubis:2|5:red:pharaoh:0|6:red:anubis:2|7:red:pyramid:1|12:red:pyramid:2|23:silver:pyramid:3|30:red:pyramid:0|32:silver:pyramid:2|34:silver:scarab:0|35:silver:scarab:1|37:red:pyramid:1|39:silver:pyramid:3|40:red:pyramid:1|42:silver:pyramid:3|44:red:scarab:1|45:red:scarab:0|47:red:pyramid:0|49:silver:pyramid:2|56:red:pyramid:1|67:silver:pyramid:0|72:silver:pyramid:3|73:silver:anubis:0|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0"}
```

Example 2: game 0, classic, legacy turn.

```json
{"beforeKFEN":"se4f-asp22/2p37/3P46/p11P31c\\c/1p22/p2P42C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn r 3","localMoves":["f5-e6"],"moves":["j5+","a8+","c4-b4","f5-e6"],"item":"position","fast":"silver|0:red:sphinx:1|6:red:anubis:2|7:red:pyramid:1|12:red:pyramid:2|23:silver:pyramid:3|24:red:scarab:0|30:red:pyramid:0|32:silver:pyramid:2|34:red:scarab:1|37:red:pyramid:1|40:red:pyramid:1|41:silver:pyramid:3|44:silver:scarab:0|45:silver:scarab:1|47:red:pyramid:0|49:silver:pyramid:2|56:red:pyramid:1|67:silver:pyramid:0|72:silver:pyramid:3|73:silver:anubis:0|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0","other":"red|0:red:sphinx:1|6:red:anubis:2|7:red:pyramid:1|12:red:pyramid:2|23:silver:pyramid:3|24:red:scarab:0|30:red:pyramid:0|32:silver:pyramid:2|34:red:scarab:1|37:red:pyramid:1|40:red:pyramid:1|41:silver:pyramid:3|44:silver:scarab:0|45:silver:scarab:1|47:red:pyramid:0|49:silver:pyramid:2|56:red:pyramid:1|67:silver:pyramid:0|72:silver:pyramid:3|73:silver:anubis:0|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0"}
```

Example 3: game 1, imhotep, legacy turn.

```json
{"beforeKFEN":"ss4f-1as2/5as2c/1/3P4P21p13/1P33c/p4p22/p1P42P35/3C/2p21p11/1C\\1Aw6/4F-An3Sn r 17","localMoves":["a8+"],"moves":["c1-b2","a4-","e5-e6","i5-h5","j4+","i4-h4","e6-","f4-g5","d1-d2","e8-f7","e4xd3","h8-i7","e6+","h4-i3","d2-","g8-h8","b2+","a8+"],"item":"position","fast":"silver|0:red:sphinx:1|7:red:anubis:2|15:red:anubis:2|18:red:scarab:0|23:silver:pyramid:3|24:silver:pyramid:1|26:red:pyramid:0|31:silver:pyramid:2|35:red:scarab:0|36:red:pyramid:3|37:red:pyramid:1|40:red:pyramid:0|41:silver:pyramid:3|44:silver:pyramid:2|53:silver:scarab:0|56:red:pyramid:1|58:red:pyramid:0|61:silver:scarab:1|63:silver:anubis:3|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0","other":"red|0:red:sphinx:1|7:red:anubis:2|15:red:anubis:2|18:red:scarab:0|23:silver:pyramid:3|24:silver:pyramid:1|26:red:pyramid:0|31:silver:pyramid:2|35:red:scarab:0|36:red:pyramid:3|37:red:pyramid:1|40:red:pyramid:0|41:silver:pyramid:3|44:silver:pyramid:2|53:silver:scarab:0|56:red:pyramid:1|58:red:pyramid:0|61:silver:scarab:1|63:silver:anubis:3|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0"}
```

### legacy-ai

#### legal moves

Example 1: game 0, classic, legacy native start.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0","localMoves":[],"moves":[],"item":"legal moves","fast":["c1+","c1-","c1-b1","c1-b2","c1-c2","c1-d2","c4+","c4-","c4-b3","c4-b4","c4-b5","c4-c3","c4-d3","c4-d4","c4-d5","c5+","c5-","c5-b4","c5-b5","c5-b6","c5-c6","c5-d4","c5-d5","d1+","d1-","d1-c2","d1-d2","d1-e2","d6+","d6-","d6-c6","d6-d5","d6-d7","d6-e6","d6-e7","e1-d2","e1-e2","e1-f2","e4+","e4-d3","e4-d4","e4-d5","e4-e3","e4-f3","f1+","f1-","f1-e2","f1-f2","f1-g1","f1-g2","f4+","f4-e3","f4-f3","f4-g4","f4-g5","f4xg3","h2+","h2-","h2-g1","h2-g2","h2-h1","h2-h3","h2-i2","h2-i3","j1+","j4+","j4-","j4-i3","j4-i4","j4-i5","j4-j3","j5+","j5-","j5-i4","j5-i5","j5-i6","j5-j6"],"other":["d1+","d1+@E","d1+@N","d1+@S","d1+@SE","d1+@W","d1-","d1-c2","d1-d2","d1-e2","d4+","d4+@E","d4+@N","d4+@S","d4+@SE","d4+@W","d4-","d4-c3","d4-c4","d4-c5","d4-d3","d4-e3","d5+","d5+@E","d5+@N","d5+@NE","d5+@S","d5+@W","d5-","d5-c4","d5-c5","d5-c6","d5-e6","d6+","d6+@E","d6+@N","d6+@S","d6+@SE","d6+@W","d6-","d6-c5","d6-c6","d6-d7","d6-e6","d6-e7","e1+","e1+@NE","e1+@NW","e1+@S","e1+@SE","e1+@SW","e1-","e1-d2","e1-e2","e1-f2","e4+","e4+@NE","e4+@SW","e4-d3","e4-e3","e4-f3","e4xd4","e4xd5","f1-e2","f1-f2","f4+","f4+@NW","f4+@SE","f4-e3","f4-f3","f4-g4","f4-g5","f4xg3","g1+","g1+@NE","g1+@NW","g1+@S","g1+@SE","g1+@SW","g1-","g1-f2","g1-h2","g2+","g2+@E","g2+@N","g2+@S","g2+@SW","g2+@W","g2-","g2-f2","g2-f3","g2-h2","g2-h3","j1+","j4+","j4+@E","j4+@N","j4+@NE","j4+@S","j4+@W","j4-","j4-i3","j4-i4","j4-i5","j5+","j5+@E","j5+@N","j5+@S","j5+@SE","j5+@W","j5-","j5-i4","j5-i5","j5-i6"]}
```

Example 2: game 0, classic, legacy turn.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0","localMoves":[],"moves":[],"item":"legal moves","fast":["c1+","c1-","c1-b1","c1-b2","c1-c2","c1-d2","c4+","c4-","c4-b3","c4-b4","c4-b5","c4-c3","c4-d3","c4-d4","c4-d5","c5+","c5-","c5-b4","c5-b5","c5-b6","c5-c6","c5-d4","c5-d5","d1+","d1-","d1-c2","d1-d2","d1-e2","d6+","d6-","d6-c6","d6-d5","d6-d7","d6-e6","d6-e7","e1-d2","e1-e2","e1-f2","e4+","e4-d3","e4-d4","e4-d5","e4-e3","e4-f3","f1+","f1-","f1-e2","f1-f2","f1-g1","f1-g2","f4+","f4-e3","f4-f3","f4-g4","f4-g5","f4xg3","h2+","h2-","h2-g1","h2-g2","h2-h1","h2-h3","h2-i2","h2-i3","j1+","j4+","j4-","j4-i3","j4-i4","j4-i5","j4-j3","j5+","j5-","j5-i4","j5-i5","j5-i6","j5-j6"],"other":["c1+","c1+@E","c1+@N","c1+@S","c1+@SE","c1+@W","c1-","c1-b2","c1-c2","c1-d2","c4+","c4+@E","c4+@N","c4+@S","c4+@SE","c4+@W","c4-","c4-b3","c4-b4","c4-b5","c4-c3","c4-d3","c4-d4","c4-d5","c5+","c5+@E","c5+@N","c5+@NE","c5+@S","c5+@W","c5-","c5-b4","c5-b5","c5-b6","c5-c6","c5-d4","c5-d5","d1+","d1+@NE","d1+@NW","d1+@S","d1+@SE","d1+@SW","d1-","d1-c2","d1-d2","d1-e2","d6+","d6+@E","d6+@N","d6+@S","d6+@SE","d6+@W","d6-","d6-c6","d6-d5","d6-d7","d6-e6","d6-e7","e1-d2","e1-e2","e1-f2","e4+","e4+@NW","e4+@SE","e4-d3","e4-d4","e4-d5","e4-e3","e4-f3","f1+","f1+@NE","f1+@NW","f1+@S","f1+@SE","f1+@SW","f1-","f1-e2","f1-f2","f1-g2","f4+","f4+@NW","f4+@SE","f4-e3","f4-f3","f4-g4","f4-g5","f4xg3","h2+","h2+@E","h2+@N","h2+@S","h2+@SW","h2+@W","h2-","h2-g2","h2-h3","h2-i2","h2-i3","j1+","j4+","j4+@E","j4+@N","j4+@NE","j4+@S","j4+@W","j4-","j4-i3","j4-i4","j4-i5","j5+","j5+@E","j5+@N","j5+@S","j5+@SE","j5+@W","j5-","j5-i4","j5-i5","j5-i6"]}
```

Example 3: game 0, classic, legacy turn.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p22/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn r 1","localMoves":[],"moves":["j5+"],"item":"legal moves","fast":["a4+","a4-","a4-a3","a4-b3","a4-b4","a4-b5","a5+","a5-","a5-a6","a5-b4","a5-b5","a5-b6","a8+","c7+","c7-","c7-b6","c7-b7","c7-c6","c7-c8","c7-d7","c7-d8","e5+","e5-d4","e5-d5","e5-e6","e5-f6","e5xd6","e8+","e8-","e8-d7","e8-d8","e8-e7","e8-f7","f5+","f5-e6","f5-f6","f5-g4","f5-g5","f5-g6","f8-e7","f8-f7","f8-g7","g3+","g3-","g3-f2","g3-f3","g3-g2","g3-g4","g3-h3","g8+","g8-","g8-f7","g8-g7","g8-h7","h4+","h4-","h4-g4","h4-g5","h4-h3","h4-i3","h4-i4","h4-i5","h5+","h5-","h5-g4","h5-g5","h5-g6","h5-h6","h5-i4","h5-i5","h5-i6","h8+","h8-","h8-g7","h8-h7","h8-i7","h8-i8"],"other":["a4+","a4+@E","a4+@N","a4+@NW","a4+@S","a4+@W","a4-","a4-b3","a4-b4","a4-b5","a5+","a5+@E","a5+@N","a5+@S","a5+@SW","a5+@W","a5-","a5-b4","a5-b5","a5-b6","a8+","c7+","c7+@E","c7+@N","c7+@NE","c7+@S","c7+@W","c7-","c7-b6","c7-b7","c7-c6","c7-d7","e5+","e5+@NW","e5+@SE","e5-d4","e5-d5","e5-e6","e5-f6","e5xd6","e8+","e8+@N","e8+@NE","e8+@NW","e8+@SE","e8+@SW","e8-","e8-d7","e8-e7","e8-f7","f5+","f5+@NW","f5+@SE","f5-e6","f5-f6","f5-g4","f5-g5","f5-g6","f8-e7","f8-f7","f8-g7","g3+","g3+@E","g3+@N","g3+@NW","g3+@S","g3+@W","g3-","g3-f2","g3-f3","g3-g2","g3-g4","g3-h3","g8+","g8+@N","g8+@NE","g8+@NW","g8+@SE","g8+@SW","g8-","g8-f7","g8-g7","g8-h7","h4+","h4+@E","h4+@N","h4+@S","h4+@SW","h4+@W","h4-","h4-g4","h4-g5","h4-h3","h4-i3","h4-i4","h4-i5","h5+","h5+@E","h5+@N","h5+@NW","h5+@S","h5+@W","h5-","h5-g4","h5-g5","h5-g6","h5-h6","h5-i4","h5-i5","h5-i6","h8+","h8+@E","h8+@N","h8+@NW","h8+@S","h8+@W","h8-","h8-g7","h8-h7","h8-i7"]}
```

#### laser

Example 1: game 0, classic, legacy turn.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0","localMoves":["j5+"],"moves":["j5+"],"item":"laser","fast":[69,59,49,48,47,37,38,39],"other":[69,59,49]}
```

Example 2: game 0, classic, legacy turn.

```json
{"beforeKFEN":"se4f-asp22/2p37/3P46/p11P31c\\c/1p22/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 2","localMoves":["c4-b4"],"moves":["j5+","a8+","c4-b4"],"item":"laser","fast":[69,59,49,48,47,37,38,39],"other":[69,59,49]}
```

Example 3: game 1, imhotep, legacy turn.

```json
{"beforeKFEN":"ss3asf-asc/2/10/3P42p13/p1P32P2c/2p2P4/p2P42C/p42p1P3/3P32p23/10/2C/AnF-An3Sn s 0","localMoves":["c1-b2"],"moves":["c1-b2"],"item":"laser","fast":[69,59,49,48,38,39,29,19,9],"other":[69,59,49]}
```

#### destroyed

Example 1: game 0, classic, legacy turn.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0","localMoves":["j5+"],"moves":["j5+"],"item":"destroyed","fast":39,"other":-1}
```

Example 2: game 1, imhotep, legacy turn.

```json
{"beforeKFEN":"ss3asf-asc/2/10/3P42p13/p1P32P2c/2p2P4/p2P42C/p42p1P3/3P32p23/1C/8/3AnF-An3Sn r 1","localMoves":["a4-"],"moves":["c1-b2","a4-"],"item":"destroyed","fast":30,"other":-1}
```

Example 3: game 2, dynasty, legacy turn.

```json
{"beforeKFEN":"ss3p3asp23/5f-4/p13p3asc/3/p21c\\1P41P23/3p41p21C\\1P4/3C/AnP13P3/4F-5/3P4AnP13Sn s 0","localMoves":["f3-f2"],"moves":["f3-f2"],"item":"destroyed","fast":54,"other":-1}
```

#### result

Example 1: game 2, dynasty, legacy turn.

```json
{"beforeKFEN":"ss3p3as4/5f-c/p12/p13p35/p21c\\3P23/2C/4C\\P31/9P3/4F-5/3P4AnP1P12Sn r 13","localMoves":["g7-g6"],"moves":["f3-f2","g8-h7","j4-","g6-g7","j4-j5","e6-f5","e5-d6","h7-","d3-c4","f4-e4","f2-g1","f5-e6","j5-i4","g7-g6"],"item":"result","fast":"red","other":null}
```

Example 2: game 11, dynasty, legacy turn.

```json
{"beforeKFEN":"se9/4p3f-4/p15c/3/p23P42C\\2/1c\\3p24/2p4C/An3P41/4F-5/3P4AnP13Sw s 10","localMoves":["e2-f3"],"moves":["j3-","e6-d5","j4-i3","d4-c3","j1+","a8+","j3-i4","e8-e7","h4-h5","c5-b4","e2-f3"],"item":"result","fast":"red","other":null}
```

Example 3: game 23, dynasty, legacy turn.

```json
{"beforeKFEN":"ss3p3asp23/5f-4/p15c/3/p21p41P45/3c\\3C\\1P4/4AeP13P3/3C/F-5/3P1AeP13Sn s 8","localMoves":["h4+"],"moves":["d1+","f6-","e1+","e6-","e3+","f4-","d3-d2","c5xd4","h4+"],"item":"result","fast":"silver","other":null}
```

#### position

Example 1: game 0, classic, legacy native start.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0","localMoves":[],"moves":[],"item":"position","fast":"silver|0:red:sphinx:2|4:red:anubis:2|5:red:pharaoh:0|6:red:anubis:2|7:red:pyramid:1|12:red:pyramid:2|23:silver:pyramid:3|30:red:pyramid:0|32:silver:pyramid:2|34:red:scarab:1|35:red:scarab:0|37:red:pyramid:1|39:silver:pyramid:3|40:red:pyramid:1|42:silver:pyramid:3|44:silver:scarab:0|45:silver:scarab:1|47:red:pyramid:0|49:silver:pyramid:2|56:red:pyramid:1|67:silver:pyramid:0|72:silver:pyramid:3|73:silver:anubis:0|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0","other":"silver|0:red:sphinx:2|4:red:anubis:2|5:red:pharaoh:0|6:red:anubis:2|9:red:pyramid:1|12:red:pyramid:2|23:silver:pyramid:3|31:red:pyramid:0|33:silver:pyramid:2|34:red:scarab:0|35:red:scarab:0|37:red:pyramid:1|39:silver:pyramid:3|41:red:pyramid:1|43:silver:pyramid:3|44:silver:scarab:0|45:silver:scarab:0|47:red:pyramid:0|49:silver:pyramid:2|56:red:pyramid:1|66:silver:pyramid:0|73:silver:pyramid:3|74:silver:anubis:0|75:silver:pharaoh:0|76:silver:anubis:0|79:silver:sphinx:0"}
```

Example 2: game 0, classic, legacy turn.

```json
{"beforeKFEN":"ss3asf-asp22/2p37/3P46/p11P31c\\c/1p21P4/p21P41C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn s 0","localMoves":["j5+"],"moves":["j5+"],"item":"position","fast":"red|0:red:sphinx:2|4:red:anubis:2|5:red:pharaoh:0|6:red:anubis:2|7:red:pyramid:1|12:red:pyramid:2|23:silver:pyramid:3|30:red:pyramid:0|32:silver:pyramid:2|34:red:scarab:1|35:red:scarab:0|37:red:pyramid:1|40:red:pyramid:1|42:silver:pyramid:3|44:silver:scarab:0|45:silver:scarab:1|47:red:pyramid:0|49:silver:pyramid:2|56:red:pyramid:1|67:silver:pyramid:0|72:silver:pyramid:3|73:silver:anubis:0|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0","other":"red|0:red:sphinx:2|4:red:anubis:2|5:red:pharaoh:0|6:red:anubis:2|7:red:pyramid:1|12:red:pyramid:2|23:silver:pyramid:3|30:red:pyramid:0|32:silver:pyramid:2|34:red:scarab:1|35:red:scarab:0|37:red:pyramid:1|39:silver:pyramid:0|40:red:pyramid:1|42:silver:pyramid:3|44:silver:scarab:0|45:silver:scarab:1|47:red:pyramid:0|49:silver:pyramid:2|56:red:pyramid:1|67:silver:pyramid:0|72:silver:pyramid:3|73:silver:anubis:0|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0"}
```

Example 3: game 0, classic, legacy turn.

```json
{"beforeKFEN":"se4f-asp22/2p37/3P46/p11P31c\\c/1p22/p2P42C/C\\1p11P3/6p23/7P12/2P4AnF-An3Sn r 3","localMoves":["f5-e6"],"moves":["j5+","a8+","c4-b4","f5-e6"],"item":"position","fast":"silver|0:red:sphinx:1|6:red:anubis:2|7:red:pyramid:1|12:red:pyramid:2|23:silver:pyramid:3|24:red:scarab:0|30:red:pyramid:0|32:silver:pyramid:2|34:red:scarab:1|37:red:pyramid:1|40:red:pyramid:1|41:silver:pyramid:3|44:silver:scarab:0|45:silver:scarab:1|47:red:pyramid:0|49:silver:pyramid:2|56:red:pyramid:1|67:silver:pyramid:0|72:silver:pyramid:3|73:silver:anubis:0|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0","other":"red|0:red:sphinx:1|6:red:anubis:2|7:red:pyramid:1|12:red:pyramid:2|23:silver:pyramid:3|24:red:scarab:0|30:red:pyramid:0|32:silver:pyramid:2|34:red:scarab:1|37:red:pyramid:1|40:red:pyramid:1|41:silver:pyramid:3|44:silver:scarab:0|45:silver:scarab:1|47:red:pyramid:0|49:silver:pyramid:2|56:red:pyramid:1|67:silver:pyramid:0|72:silver:pyramid:3|73:silver:anubis:0|74:silver:pharaoh:0|75:silver:anubis:0|79:silver:sphinx:0"}
```

