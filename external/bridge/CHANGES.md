# Local changes to jkugs/khetai

`khetai_lib.c` and `khetai_lib.h` are copies of
`external/khetai/ext/khetai/khetai_lib.c` and `.h`. The upstream copy is untouched.
The MIT notice is preserved in `LICENSE.txt`. No upstream build scripts, Ruby,
drivers, or other executables are invoked. The build compiles only our CLI and
these two copied core files.

Every difference in the copied library:

1. `start_time` changes from `time_t` to `int64_t` in the source and header.
   `set_time_parameters` takes `int64_t` for its start argument. `max_time`
   retains its `int` type but now represents milliseconds.
2. The single alpha-beta loop deadline expression changes from
   `time(NULL) - start_time < max_time` to
   `monotonic_millis() - start_time < max_time`. The added helper uses
   `clock_gettime(CLOCK_MONOTONIC)` and converts seconds/nanoseconds to integer
   milliseconds. A clock failure aborts. The build defines
   `_POSIX_C_SOURCE=200809L` to expose that API.
3. `hashes` grows from `MAX_DEPTH` to `MAX_DEPTH + 1` entries. `make_move`
   writes the post-move hash at index 25 when searching depth 25; upstream's
   25-entry allocation is out of bounds. Undo arrays still need only 25 entries.
   This changes storage capacity, not the search algorithm.
4. The added diagnostic `bridge_laser_end` records the last on-board index in
   the existing `fire_laser` loop. It does not change traversal or destruction.
   The `bridge_laser` wrapper sets the firing side and starting endpoint, invokes
   the original `fire_laser`, and reports the capture from its original undo
   records and the observed endpoint. The wrapper destroys the hit piece locally;
   the next command reloads the board.
5. The added `bridge_moves` wrapper exposes the existing `find_valid_moves`
   generator for verification, without filtering its output.
6. The added `bridge_reset` wrapper resets undo records, hash indices/history,
   checkmate, side/starter, initial depth, laser endpoint, Pharaoh locations,
   and both tracker reverse maps. It resets `rand` with `srand(1)` for repeatable
   evaluation noise between independent requests. Header declarations are added
   for the four helpers/wrappers.

No other library changes were made. Alpha-beta, evaluation, move generation,
reflection tables, reserved squares, transposition lookup/replacement, and move
make/unmake logic retain their upstream behavior, including the reported swap
rule differences.

## State between commands

`init_zobrist()` runs once on CLI startup; keys and the turn key remain stable.
Every valid command calls `bridge_reset(side)` followed by upstream
`setup_board()`. The latter reloads all 120 squares, rebuilds piece trackers,
sets the initial hash, and clears every field of every transposition entry.
Thus no board, undo, random-evaluation, or transposition state leaks from an
earlier search/laser command or game. The table remains available between
iterative-deepening iterations of one `go` command.

## New CLI behavior (outside the copied search)

`khetai_cli.c` provides a persistent line protocol. It accepts 80 row-major
tokens or all 120 padded tokens and validates token spelling, padding, side,
limits, reservations, fixed corner emitters, and standard piece inventories
(per side: at most 2 Anubis, 7 pyramids, 2 scarabs, 1 Pharaoh, 1 Sphinx; both
Pharaohs and Sphinxes required). This bounds the original fixed-size trackers
and move buffers. It is intended for nonterminal standard Khet positions.

The CLI performs iterative deepening with the millisecond clock. Unlike the
example driver's one-iteration lag, it keeps the newest completed iteration,
discards an iteration that crosses the deadline, and reports its completed
depth. If no iteration finishes, it returns the first generated move with depth
0. It does not apply the returned move. These are driver decisions, not changes
to the copied search. The original root loop has no deadline check, so finishing
its remaining root children can slightly exceed the budget. Board loading and
the roughly 96 MiB table reset occur before the search clock starts.

`laser <side> <board...>` returns `laser <destroyed> end <last-on-board>`;
`destroyed=-1` means absorption or exit. Both reported squares use padded C
indices; an exiting beam ends at its last on-board square, matching our trace.
`moves <side> <board...>` returns `moves <count> <start,end,rotation>...` using
the unmodified generator. Invalid requests produce `error invalid-request` and
leave the process available for the next request.

The gcc build currently emits two upstream warnings: the existing
`setup_board` declaration/definition array-bound mismatch and unused
`get_board_hash`. Neither was edited merely to silence a warning.
