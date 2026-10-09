# Khet 2.0 rules spec + prior art (research for Khet SME)
Researched 2026-10-07. Web research only. Provenance tags: [OFF]=official-ish, [WIKI], [UBG]=ultraboardgames, [RP]=rulespal, [GH:x]=open-source code I read.

## 0. Source honesty
- I could NOT retrieve the official Innovention 2.0 rulebook PDF text. The only PDF I found (khet_rules_english.pdf inside github.com/stocyr/LaserChess/docs) is image-only (no text layer) and is likely the Khet 1.x sheet. There is a German student summary "KHET 2.0 Rules short.txt" in the same repo (agrees with below).
- Rules below are triangulated from: Wikipedia (https://en.wikipedia.org/wiki/Khet_(game)), UltraBoardGames (https://ultraboardgames.com/khet-the-laser-game/game-rules.php), RulesPal (https://rulespal.com/khet/rulebook), Nijssen/Uiterwijk paper+MSc (https://dke.maastrichtuniversity.nl/pim.nijssen/pub/bnaic09.pdf , .../msc.pdf; NOTE: Khet 1.0 rules), and code of 4 implementations (below).
- Setups: I did not find a published ASCII diagram of the official Imhotep/Dynasty cards. The setups below come from two independent open-source implementations that agree 100% (see section 2). Strongly recommend Daniel/SME eyeball one against the physical set or the booklet card.

## 1. Board, reserved squares, first mover
- 10 columns (A..J) x 8 rows (ranks 1..8). 80 squares: 10 Silver-only, 10 Red-only, 60 neutral [Nijssen 2.2; GH:rel1c].
- Silver moves first. [WIKI "silver always goes first"; UBG; RP; Nijssen "Silver always starts"]. (Original Deflexion: gold first.)
- Standard orientation (Silver at bottom, rank 1; Red at top, rank 8; file A on left):
  - Silver-only squares: entire J file (J1..J8; J1 is Silver's Sphinx square) + B1 + B8.  (10)
  - Red-only squares: entire A file (A1..A8; A8 is Red's Sphinx square) + I1 + I8.  (10)
  - Sources agree: [GH:rel1c board.cc SILVER_SQR_BB={B1,B8,J1..J8}, RED_SQR_BB={A1..A8,I1,I8}], [GH:kishannareshpal/laserchess Guide.md, same sets], [GH:alaingilbert code: silver-only = x==9 col or (x==1,y in {0,7}); red-only = x==0 or (x==8,y in {0,7})]. Wikipedia: "right file, left corners" (wording from Silver's side/ambiguous; fine).
  - Rule: a piece of one color may never move onto the other color's reserved squares. Own-color pieces may stand on neutral or own squares.
- Canonical grid used below: 10 cols x 8 rows, row0 = rank 8 (Red back rank, top), col0 = file A (left). So Red sphinx = (r0,c0), Silver sphinx = (r7,c9). Red-only: c0 all rows + (r0,c8),(r7,c8). Silver-only: c9 all rows + (r0,c1),(r7,c1).

## 2. Starting setups (26 pieces total, 13 per side: 1 Sphinx, 1 Pharaoh, 2 Anubis, 2 Scarab, 7 Pyramid)
Notation per cell: P=Pyramid, A=Anubis, C=Scarab, K=Pharaoh, X=Sphinx; second letter S/R=colour.
- P:NE = pyramid whose MIRROR faces the NE corner: a beam ENTERING the cell through its N side or its E side is reflected (S-moving beam entering via N side exits E; W-moving beam entering via E side exits N). A beam entering via S or W side KILLS it. (Line geometry on screen: NE- or SW-facing = "\\" diagonal; NW- or SE-facing = "/" diagonal.)
- A:N = Anubis whose shield (the only safe face) is on the N side; hit from N is absorbed (beam ends, no kill); hit from E/S/W kills.
- C:/ or C:bs = Scarab, double-sided diagonal mirror, "/" or "\" line (bs = backslash). Either orientation of the same diagonal is identical (180 deg symmetric), so only the diagonal matters.
- X:S = Sphinx firing direction (beam leaves the Sphinx square in that direction).
- K = Pharaoh (orientation irrelevant).

### Classic
```
      A       B       C       D       E       F       G       H       I       J      
r0/8  XR:S    .       .       .       AR:S    KR      AR:S    PR:SE   .       .      
r1/7  .       .       PR:SW   .       .       .       .       .       .       .      
r2/6  .       .       .       PS:NW   .       .       .       .       .       .      
r3/5  PR:NE   .       PS:SW   .       CR:bs   CR:/    .       PR:SE   .       PS:NW  
r4/4  PR:SE   .       PS:NW   .       CS:/    CS:bs   .       PR:NE   .       PS:SW  
r5/3  .       .       .       .       .       .       PR:SE   .       .       .      
r6/2  .       .       .       .       .       .       .       PS:NE   .       .      
r7/1  .       .       PS:NW   AS:N    KS      AS:N    .       .       .       XS:N   

```
### Imhotep
```
      A       B       C       D       E       F       G       H       I       J      
r0/8  XR:S    .       .       .       AR:S    KR      AR:S    CR:/    .       .      
r1/7  .       .       .       .       .       .       .       .       .       .      
r2/6  .       .       .       PS:NW   .       .       PR:NE   .       .       .      
r3/5  PR:NE   PS:SW   .       .       PS:SE   CR:/    .       .       PR:SE   PS:NW  
r4/4  PR:SE   PS:NW   .       .       CS:/    PR:NW   .       .       PR:NE   PS:SW  
r5/3  .       .       .       PS:SW   .       .       PR:SE   .       .       .      
r6/2  .       .       .       .       .       .       .       .       .       .      
r7/1  .       .       CS:/    AS:N    KS      AS:N    .       .       .       XS:N   

```
### Dynasty
```
      A       B       C       D       E       F       G       H       I       J      
r0/8  XR:S    .       .       .       PR:SW   AR:S    PR:SE   .       .       .      
r1/7  .       .       .       .       .       KR      .       .       .       .      
r2/6  PR:NE   .       .       .       PR:SW   AR:S    CR:/    .       .       .      
r3/5  PR:SE   .       CR:bs   .       PS:NW   .       PS:SE   .       .       .      
r4/4  .       .       .       PR:NW   .       PR:SE   .       CS:bs   .       PS:NW  
r5/3  .       .       .       CS:/    AS:N    PS:NE   .       .       .       PS:SW  
r6/2  .       .       .       .       KS      .       .       .       .       .      
r7/1  .       .       .       PS:NW   AS:N    PS:NE   .       .       .       XS:N   

```

Row labels: r<row0-index>/<rank>. Sanity checks I ran: each setup has 13 pieces/side with the right type counts; each is exactly 180-degree rotationally symmetric between colours (Red piece at (r,c) = Silver piece at (7-r,9-c) with directions reversed); no piece starts on an enemy-reserved square.

### Cross-check (what I actually did)
- Parsed github.com/rel1c/khet (C++, config/layouts.json "PKN" strings) and github.com/alaingilbert/khet (JS, levels/classic.js, imhotep.js, dynasty.js; mirror semantics derived from its laser code), converted both to the canonical grid and diffed cell-by-cell: ZERO differences in all three setups (types, colours, positions, pyramid mirror corners, Anubis shield side, scarab diagonal, sphinx direction). Script: research/tools/cmp.py (scratch).
- Derived orientation mapping (rel1c letter -> mirror corner): N=NE, E=SE, S=SW, W=NW. Anubis letter = shield side. Matches alaingilbert's numeric orientations: pyramid 0=SE,1=SW,2=NW,3=NE; anubis 0=S,1=W,2=N,3=E.
- Third source pykhet 0.18 (PyPI, ClassicGame only): all 26 positions and colours match (under an x-mirror, y=0 = Silver rank 1), Anubis/Sphinx/Pharaoh/Scarab consistent, BUT one Silver pyramid (pykhet (7,0), our C1) has orientation inconsistent with the other 13 mappings and with the 180-degree symmetry => likely a pykhet bug. Flag: do not use pykhet as ground truth.
- Typo flag: rel1c README example PKN for Classic ("...p1P1ss1s1P...") differs from its layouts.json ("...p1P1ss1p1P...") and its Classic ini; the json/ini version is the one that agrees with alaingilbert.
- Variants "Classic2/Imhotep2/Dynasty2" exist in both repos with scarab diagonals swapped (not official-named; ignore unless needed).
- Wikipedia/UBG/RP do not give explicit coordinates, so there is NO independent check against the official diagram. Two code bases could share an ancestor. Residual risk: moderate-low.

## 3. Pieces
- Pyramid: one diagonal mirror; reflects (90 deg) beams entering through its two mirrored sides; destroyed when hit on either of the other two sides. [WIKI "vulnerable from two of four sides"; UBG; code]
- Scarab (aka Djed): double-sided mirror, reflects a beam from any direction, can never be destroyed. Swap: may move to an adjacent square (8 directions) occupied by a Pyramid or Anubis of EITHER colour; the displaced piece goes to the scarab's old square. [UBG: "djed can move into a square occupied by a pyramid or an obelisk of either color"; RP; WIKI; German summary]. Cannot swap with Pharaoh, Sphinx or another Scarab [GH:alaingilbert, GH:rel1c movegen swappable = Anubis|Pyramid].  Swap is a MOVE (counts as the turn's move; no rotation as well).
  - Reserved-square interaction (swap displaces an ENEMY piece onto the scarab's old square): sources DISAGREE / silent. alaingilbert forbids a scarab standing on its own reserved square from swapping with an enemy piece (the enemy would land on a reserved square); rel1c only checks the scarab's DESTINATION against the mover's blocked set and does NOT check where the displaced piece lands (so it would allow it). UBG/RP/Wikipedia text is silent. Scarabs start on neutral squares and can walk onto own reserved squares, so it is reachable. Also the symmetric case: scarab's destination square being reserved for the enemy is forbidden (all agree, scarab is a piece). RECOMMEND: forbid (alaingilbert reading; consistent with "no piece of color X on color Y's reserved squares") and make the rule a flag; get Daniel to confirm with the official booklet if he has it.
- Anubis (Khet 2.0 replacement for the Obelisk): unmirrored; the shielded front absorbs the beam (beam ends, piece survives); hit on either side or the back = removed. No stacking in 2.0 (stacking was the Khet 1 Obelisk). [WIKI, all code]
- Pharaoh: no mirror; hit from any side by any beam => its owner loses immediately. Can move/rotate like others (rotation is a legal but pointless move; it only changes the move-list/position hash). [UBG, RP, Nijssen]
- Sphinx: fixed on its corner square (Silver J1, Red A8), cannot move; can be rotated 90 deg as the turn's action. Because it sits in a corner, only two facings point onto the board (Silver: N or W; Red: S or E). Official text I could reach says only "may be rotated in place"/"rotate 90 degrees" [WIKI, retail blurbs]; German summary says "nur in 2 Richtungen ausrichtbar" (only 2 directions). rel1c movegen emits exactly ONE sphinx move: flip to the other legal facing. DISAGREEMENT: alaingilbert's JS lets sphinx cycle all 4 facings (no restriction in code) - treat as bug/lax. Starting facing: Silver faces N (up the J file), Red faces S (down the A file); both fire along the board edge file - the beam leaves along the edge file. Sphinx is immune to lasers (beam hitting it, enemy's or own reflection, just ends) [retail/Wikipedia-type sources; alaingilbert: end=true, no kill; rel1c same by omission]. Can the Sphinx be swapped with by a Scarab? No.
- Beam passes into a hit-but-not-destroyed Anubis front / Sphinx / board edge: terminates. Beam hitting a destroyed piece's square: piece is removed after the beam ends (beam terminates at the first non-reflecting contact, so at most one piece dies per shot).

## 4. Turn structure
- Exactly one action: (a) move one own piece one square in any of 8 directions into an EMPTY square not reserved for the enemy, or (b) rotate one own piece 90 deg CW or CCW in place, or (c) Scarab swap (above), or (d) Sphinx rotate (b, restricted). Not move + rotate. [UBG, RP, Wikipedia]
- Then the mover MUST fire their own laser (only the mover's laser fires each turn; opponent's does not). No passing, no undo. [RP: "moves cannot be undone once hands leave the piece"]
- Laser kills any piece it hits on a non-reflective face "even if it is the player's own piece"; hitting your own Pharaoh = you lose. Hitting either Pharaoh ends the game; owner of the hit Pharaoh loses. [UBG quotes verbatim: "If it stops on any other piece, that piece is removed from the board (even if it is the player's own piece)"; "A player who hits his or her own pharaoh is out of luck"; RP: "The owner of the hit pharaoh loses, even if it's their own piece"]. Since the beam ends at its first kill, only one Pharaoh can be hit per turn - no mutual-simultaneous-loss case exists; the mover cannot hit both. Self-loss is real: moving a piece so that your own beam reflects into your own Pharaoh is a loss, so move generation must either allow it (rules-faithful) or prune it in search.
- Reflections happen at 90 deg only; the beam can loop through mirrors and cross squares multiple times; it can pass back over its own path; infinite loops cannot occur in a legal board? (Treat as possible-in-theory: the beam is deterministic from the Sphinx; a closed cycle would have to include the Sphinx square, which absorbs it, so a loop cannot start from the Sphinx... because mirror reflection is reversible, a path starting at the Sphinx can never enter a cycle. Safe, but cap steps defensively.)

## 5. Draws / move limits
- Threefold repetition: "If the same board arrangement appears for a third time in the same game, i.e. the same pieces of the same colors occupy the same squares in the same orientations, the player making the next move can declare a draw." [UBG verbatim; RP; WIKI "three-fold repetition is a draw"]. Official = CLAIMABLE by the side to move, not automatic. Nijssen's engine treats it as automatic draw and includes side-to-move in "same position".
- No move limit / fifty-move rule in any source I read. Nijssen average game length 68 moves, avg branching 69 (80 at start) [Khet 1 rules].
- Engines should add their own max-ply adjudication for self-play (Nijssen's MCTS used dmax=100 with 0.5 eval).

## 6. Prior art for AI
1. Nijssen & Uiterwijk, "Using Intelligent Search Techniques to Play the Game Khet", BNAIC 2009 + Nijssen MSc thesis (Maastricht). https://dke.maastrichtuniversity.nl/pim.nijssen/pub/bnaic09.pdf and /msc.pdf
   - First academic work. Rules are Khet 1.0 (obelisks with stacking, 14 pieces/side, 2 djeds, laser in the wall, no Anubis/Sphinx). State-space ~10^49 (their count), game-tree ~10^125 (b~69, d~68), i.e. chess-class.
   - Best: alpha-beta + transposition table + killer moves (2/ply) + "Qn-limited quiescence" (n=2 best, n=3 ok) (+ incremental move gen, aspiration delta 500 helpful). Plain quiescence explodes (16+ ply subtrees after a 2-ply search from the start; captures are laser-chained, one move can set up repeated captures). MCTS (UCT C=0.375, game-length cap 100, draw=0.5 on cap) lost EVERY game to the best alpha-beta at 60/300/1800 s (100/50/10 games).
   - Eval (basic): material only, piece values scaled by 100k-ish units (obelisk 10000/(Manhattan dist to pharaoh), stacked 25000, pyramid 75000, +5000 if a pyramid directs own laser into the board, djed largest). Authors admit eval is "pretty basic", strength "reasonable/strong amateur", no human/engine opponents to calibrate. No opening book. Search depth numbers per ply tabulated only as node counts; no clear "reached depth N" headline in what I read.
2. github.com/avivyaish/khetai - "Optimizing Alpha-beta-based Khet AI Agents" (Yaish & Zagury, 2016 course project; Python, uses an external "Khet SDK"). Alpha-beta, plus a heuristic-greedy move ordering variant (found WORSE than plain alpha-beta). Eval = piece count, mobility (available moves), protection around Pharaoh; weights tuned by GA and stochastic hill climbing (hill-climbing slightly won). No strength claim vs humans.
3. github.com/jkugs/khetai - C engine, board in packed 8-bit cells, alpha-beta + Zobrist, depth 2-25 / time-limit configurable; claims search only reaches 4-5 ply in 5 s from the opening (per his post, r/ComputerChess "khet laser chess"). Has Ruby gem + SDL3/WASM GUI (https://jkugs.github.io/) - usable as a quick sparring opponent via KhetAI.move(). Rules compliance unverified by me.
4. github.com/tyler-a-cox/khet_python (alpha-beta bot), github.com/xelahalo/khet (Python AI), pykhet 0.18 on PyPI (MinmaxSolver; see bug flag above), github.com/rel1c/khet (C++ bitboard movegen + gtest; best movegen reference, with PKN notation; no search that I saw). None claims strength.
5. Commercial: Khet 2X app / Steam "Khet" have AI of unknown design; no published strength.
6. NOT found: any Stanford CS221/229 report, any published MCTS-beats-alpha-beta result, any NN/AlphaZero-style Khet work, any perft tables, any Elo-rated engine. Treat "state of the art" as ~2009 alpha-beta + TT + killers + limited quiescence; the field is wide open.

### Pitfalls worth knowing
- Captures are not moves: the capturing is a side effect of the mover's laser; a quiet move (rotate a distant pyramid) can open a long beam. Quiescence on "captures" is non-obvious; Nijssen needed a depth cap (Qn). Consider "is the last laser shot decisive/capturing" extensions rather than classic QS.
- Self-hit moves: legal and can lose on the spot; your generator must simulate the beam before accepting, and the search must score "my own Pharaoh dies" as a loss for the mover.
- Zobrist/TT keys need piece type, colour, square AND orientation (Scarab only 2 distinct orientations: use 2 states to avoid false distinct positions; Pharaoh orientation should be canonicalised to 0 for repetition/TT purposes, but the OFFICIAL repetition rule literally says "same orientations": decide deliberately). Include side to move.
- Orientation canonicalisation: a Scarab rotation by 90 deg (either direction) toggles its diagonal, so CW == CCW (dedupe in movegen); a 180 deg is identity. Pharaoh rotations are no-ops that still burn a tempo and fire the laser (a "pass with laser"). Sphinx has exactly 1 rotation move.
- Pass-like moves (Pharaoh rotate) matter in zugzwang-ish endgames; dropping them changes the game.
- Source disagreements to resolve before freezing the engine: (1) Scarab swap vs reserved squares (sec 3), (2) Sphinx legal facings (2 vs 4), (3) repetition: claimable vs automatic, (4) Khet 1 vs 2 papers (Obelisk/stacking/laser position differ, so Nijssen's numbers don't transfer 1:1), (5) pykhet C1 pyramid orientation.
- Rule 'Silver first' holds, but alaingilbert's game starts with "player":"red" - the JS app's own convention (its engine fires Red's sphinx when "red" is current), not the official rule.
