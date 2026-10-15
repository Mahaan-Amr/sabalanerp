/* Linux recovery-command owner. No command is complete until all descendants
 * have been reaped. Only unreaped, direct children are signalled: never a name,
 * guessed PID, shared process group, or unrelated container process. */
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t cancelled;
static void cancel(int signal_number) { (void)signal_number; cancelled = 1; }
static double now(void) {
    struct timespec value;
    if (clock_gettime(CLOCK_MONOTONIC, &value)) _exit(126);
    return (double)value.tv_sec + (double)value.tv_nsec / 1000000000;
}

static int kill_owned_children(void) {
    char name[128];
    snprintf(name, sizeof(name), "/proc/self/task/%ld/children", (long)getpid());
    FILE *children = fopen(name, "r");
    if (!children) return -1;
    long child;
    while (fscanf(children, "%ld", &child) == 1) {
        int status;
        /* A living direct child cannot have its PID reused until we reap it.
         * If waitpid reaps it here, do not signal that former PID. */
        pid_t observed = waitpid((pid_t)child, &status, WNOHANG);
        if (observed == 0 && kill((pid_t)child, SIGKILL) && errno != ESRCH) {
            fclose(children);
            return -1;
        }
        if (observed < 0 && errno != ECHILD && errno != EINTR) {
            fclose(children);
            return -1;
        }
    }
    int failed = ferror(children);
    fclose(children);
    return failed ? -1 : 0;
}

int main(int argc, char **argv) {
    if (argc < 4) return 126;
    char *end;
    long seconds = strtol(argv[1], &end, 10);
    if (*end || seconds < 1 || seconds > 1800 || strlen(argv[2]) > 120
        || strspn(argv[2], "abcdefghijklmnopqrstuvwxyz0123456789-") != strlen(argv[2])) return 126;
    if (prctl(PR_SET_CHILD_SUBREAPER, 1)) return 126;
    struct sigaction action = {0};
    action.sa_handler = cancel;
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGTERM, &action, NULL) || sigaction(SIGINT, &action, NULL)
        || sigaction(SIGHUP, &action, NULL) || sigaction(SIGPIPE, &action, NULL)) return 126;
    pid_t main_child = fork();
    if (main_child < 0) return 126;
    if (!main_child) {
        /* exec restores caught handlers to defaults. All native descendants,
         * including double-forked/session-detached ones, return to our subreaper. */
        execvp(argv[3], argv + 3);
        _exit(127);
    }
    double deadline = now() + seconds;
    int result = 125, main_done = 0, stopping = 0;
    for (;;) {
        if (!stopping && (cancelled || now() >= deadline)) {
            result = 124;
            stopping = 1;
        }
        int status;
        pid_t child = waitpid(-1, &status, WNOHANG);
        if (child > 0) {
            if (child == main_child) {
                main_done = 1;
                if (!stopping) result = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
            }
            continue;
        }
        if (child < 0 && errno == ECHILD) break;
        if (child < 0 && errno != EINTR) {
            /* No completion receipt on an unverifiable ownership failure. */
            return 126;
        }
        if (main_done && !stopping) {
            result = 125;
            stopping = 1;
        }
        if (stopping && kill_owned_children()) return 126;
        struct timespec pause = {0, 10000000};
        nanosleep(&pause, NULL);
    }
    fprintf(stderr, "\nSABALAN_NATIVE_REAPED %s %d\n", argv[2], result);
    return result;
}
