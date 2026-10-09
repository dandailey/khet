#define _POSIX_C_SOURCE 200809L
#include "khetai_lib.h"
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int integer(const char *s, int min, int max, int *out) {
    char *end;
    errno = 0;
    long value = strtol(s, &end, 10);
    if (errno || !*s || *end || value < min || value > max) return 0;
    *out = (int)value;
    return 1;
}

// Reject inputs outside the original fixed arrays / standard Khet inventory.
static int load_board(char **tokens, int count, enum Player side) {
    if (count != 80 && count != 120) return 0;
    char *padded[120];
    for (int i = 0; i < 120; i++) padded[i] = "--";
    for (int i = 0; i < count; i++)
        padded[count == 80 ? 13 + i % 10 + i / 10 * 12 : i] = tokens[i];
    int inventory[2][5] = {{0}};
    const int limits[5] = {2, 7, 2, 1, 1};
    for (int i = 0; i < 120; i++) {
        const char *s = padded[i];
        if (!strcmp(s, "--")) continue;
        if (!on_board[i] || strlen(s) != 2 || s[1] < '0' || s[1] > '3') return 0;
        const char alphabet[] = "apsxlAPSXL";
        const char *letter = strchr(alphabet, s[0]);
        if (!letter) return 0;
        int n = (int)(letter - alphabet), owner = n / 5, type = n % 5;
        if (++inventory[owner][type] > limits[type] || !can_move[owner][i]) return 0;
        if (type == 4 && (i != sphinx_loc[owner] ||
            (owner == SILVER ? s[1] != '0' && s[1] != '3' : s[1] != '1' && s[1] != '2'))) return 0;
    }
    for (int p = 0; p < 2; p++) if (inventory[p][3] != 1 || inventory[p][4] != 1) return 0;
    bridge_reset(side);
    setup_board(padded); // Also clears the complete transposition table.
    return 1;
}

int main(void) {
    init_zobrist(); // Stable keys for the lifetime of this process.
    char line[4096];
    while (fgets(line, sizeof line, stdin)) {
        if (!strchr(line, '\n') && !feof(stdin)) {
            int c; while ((c = getchar()) != '\n' && c != EOF) {}
            puts("error line-too-long"); fflush(stdout); continue;
        }
        char *tokens[128], *save;
        int count = 0;
        for (char *s = strtok_r(line, " \t\r\n", &save); s && count < 128; s = strtok_r(NULL, " \t\r\n", &save)) tokens[count++] = s;
        int side, depth = 0, millis = 0;
        int go = count > 0 && !strcmp(tokens[0], "go");
        int laser = count > 0 && !strcmp(tokens[0], "laser");
        int moves = count > 0 && !strcmp(tokens[0], "moves");
        int prefix = go ? 4 : 2;
        if ((!go && !laser && !moves) || count < prefix || !integer(tokens[1], 0, 1, &side) ||
            (go && (!integer(tokens[2], 1, MAX_DEPTH, &depth) || !integer(tokens[3], 1, INT_MAX, &millis))) ||
            !load_board(tokens + prefix, count - prefix, side)) {
            puts("error invalid-request"); fflush(stdout); continue;
        }
        if (laser) {
            int hit, end; bridge_laser(side, &hit, &end);
            printf("laser %d end %d\n", hit, end);
        } else {
            Move valid[NUM_VALID_MOVES] = {0};
            int n = bridge_moves(side, valid);
            if (moves) {
                printf("moves %d", n);
                for (int i = 0; i < n; i++) printf(" %d,%d,%d", get_start(valid[i]), get_end(valid[i]), get_rotation(valid[i]));
                putchar('\n');
            } else {
                Move best = n ? valid[0] : 0;
                int completed = 0;
                int64_t start = monotonic_millis();
                set_time_parameters(millis, start);
                for (int d = 1; n && d <= depth && monotonic_millis() - start < millis; d++) {
                    Move current = alphabeta_root(d, side);
                    // Timed-out iterations contain partial scores; retain the last completed result.
                    if (monotonic_millis() - start >= millis) break;
                    if (current) { best = current; completed = d; }
                }
                printf("move %d %d %d depth %d\n", get_start(best), get_end(best), get_rotation(best), completed);
            }
        }
        fflush(stdout);
    }
    return ferror(stdin) ? 1 : 0;
}
