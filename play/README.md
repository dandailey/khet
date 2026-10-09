# Khet engine playground

From the repository root:

```sh
npm run play:dev
npm run play:build
npx tsc -p tsconfig.json
npx tsc -p play/tsconfig.json
npm run play:test
```

The build produces only `play/dist/index.html`. CSS, JavaScript, SVG pieces and
the worker are embedded; the file can be opened directly without a server or
runtime network requests. The custom Vite plugin fails the build if any extra
asset or chunk would remain.

Select your piece and a marked destination. Dashed targets are Scarab swaps.
The rotation buttons inside the board frame and Q/E offer only legal rotations.
Light pieces are Silver, coral pieces are Red; reserved squares use those tints.
The highlighted edge of a Pyramid is its mirror, the Anubis bar is its shield,
and the Sphinx arrow points along its firing direction.

`src/controller.ts` owns game flow without DOM access. It keeps engine history
for repetition and undo; the action preview exists to trace and display the laser
before its victim disappears. `src/worker-logic.ts` implements KEI strings and is
called by both `src/ai-worker.ts` and the Node smoke tests. Search receives the
initial KFEN plus all played moves, `level`, and a matching `movetime` budget.

Undo removes the last human action and any AI reply, including a pending shot or
search. With Red, the AI's opening Silver move remains. Watch mode undoes up to
two plies and then resumes. New game, load and undo terminate the active worker,
so stale search results cannot change the board. Hint searches the human turn
at level 3 and highlights the origin and target (or the piece for a rotation).

If `bestMove` throws an error containing “not implemented”, the worker picks a
random legal move, excluding moves that lose by self-kill whenever alternatives
exist. The UI labels this fallback. Other search failures are reported instead
of silently falling back. Fallback has no search depth or strength levels and
returns immediately; the supplied time budgets apply when real search exists.

KFEN does not encode repetition history. Loading a position begins a new history,
with no moves available to undo. Search is synchronous inside the worker; UI
cancellation terminates it because a queued KEI `stop` cannot interrupt a running
synchronous call. No tournament ply cap is imposed on the UI.
