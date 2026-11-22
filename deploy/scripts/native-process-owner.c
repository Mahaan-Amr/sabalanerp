/* Linux recovery-command owner. No command is complete until all descendants
 * have been reaped. Only unreaped, direct children are signalled: never a name,
 * guessed PID, shared process group, or unrelated container process. */
#define _GNU_SOURCE
#include <errno.h>
#include <ftw.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/statvfs.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t cancelled;
static const char *storage_root;
static unsigned long long storage_limit, storage_reserve, storage_bytes, storage_members;
static dev_t storage_device;
static ino_t storage_inode;

static int count_storage(const char *name, const struct stat *value, int type, struct FTW *walk) {
    (void)name; (void)walk;
    if (++storage_members > 250000 || (type != FTW_F && type != FTW_D && type != FTW_DP)) return 1;
    if (type == FTW_F) {
        if (value->st_size < 0 || (unsigned long long)value->st_size > storage_limit - storage_bytes) return 1;
        storage_bytes += (unsigned long long)value->st_size;
    }
    return 0;
}

static int storage_ok(void) {
    if (!storage_root) return 1;
    struct stat root;
    struct statvfs capacity;
    if (lstat(storage_root, &root) || !S_ISDIR(root.st_mode) || root.st_uid != getuid()
        || (root.st_mode & 077) || root.st_dev != storage_device || root.st_ino != storage_inode
        || statvfs(storage_root, &capacity) || !capacity.f_frsize
        || capacity.f_bavail < storage_reserve / capacity.f_frsize + (storage_reserve % capacity.f_frsize != 0)) return 0;
    storage_bytes = storage_members = 0;
    return nftw(storage_root, count_storage, 16, FTW_PHYS | FTW_MOUNT) == 0;
}

static int storage_configuration(void) {
    storage_root = getenv("SABALAN_NATIVE_STORAGE_ROOT");
    const char *limit = getenv("SABALAN_NATIVE_STORAGE_MAX_BYTES");
    const char *reserve = getenv("SABALAN_NATIVE_STORAGE_RESERVE_BYTES");
    if (!storage_root && !limit && !reserve) return 1;
    if (!storage_root || !limit || !reserve || storage_root[0] != '/' || !*limit || !*reserve
        || strspn(limit,"0123456789") != strlen(limit) || strspn(reserve,"0123456789") != strlen(reserve)) return 0;
    char *end;
    errno = 0; storage_limit = strtoull(limit, &end, 10);
    if (errno || *end || storage_limit < 1024) return 0;
    errno = 0; storage_reserve = strtoull(reserve, &end, 10);
    if (errno || *end || storage_reserve < 1024 * 1024) return 0;
    char resolved[PATH_MAX]; struct stat root;
    if (!realpath(storage_root, resolved) || strcmp(storage_root, resolved) || lstat(storage_root, &root)
        || !S_ISDIR(root.st_mode) || root.st_uid != getuid() || (root.st_mode & 077)) return 0;
    storage_device = root.st_dev; storage_inode = root.st_ino;
    return storage_ok();
}
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
    if (!storage_configuration()) return 126;
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
    double storage_check = now();
    for (;;) {
        if (!stopping && now() >= storage_check) {
            storage_check = now() + 0.2;
            if (!storage_ok()) { result = 123; stopping = 1; }
        }
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
    /* A short command can finish between polls. Its final bytes/headroom must
     * still satisfy the same budget before a successful receipt is issued. */
    if (result == 0 && !storage_ok()) result = 123;
    fprintf(stderr, "\nSABALAN_NATIVE_REAPED %s %d\n", argv[2], result);
    return result;
}
