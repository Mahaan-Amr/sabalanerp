#define _GNU_SOURCE
#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <grp.h>
#include <dirent.h>
#include <signal.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>

#if defined(__x86_64__)
#define EXPECTED_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define EXPECTED_ARCH AUDIT_ARCH_AARCH64
#else
#error Unsupported recovery sandbox syscall architecture
#endif

#define DENY(number) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, number, 0, 1), BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM)
#define ARG(index) (offsetof(struct seccomp_data, args) + (index) * 8)

static void fail(const char *reason) { perror(reason); _exit(125); }

static void confine(void) {
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, arch)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, EXPECTED_ARCH, 1, 0),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, nr)),
#if defined(__x86_64__)
    /* Reject the x32 ABI, whose syscall numbers bypass native comparisons. */
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K, 0x40000000U, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif
    DENY(__NR_connect), DENY(__NR_sendmsg), DENY(__NR_sendmmsg), DENY(__NR_recvmsg), DENY(__NR_recvmmsg),
    DENY(__NR_ptrace), DENY(__NR_process_vm_readv), DENY(__NR_process_vm_writev),
    DENY(__NR_mount), DENY(__NR_umount2), DENY(__NR_chroot), DENY(__NR_pivot_root), DENY(__NR_unshare), DENY(__NR_setns),
    DENY(__NR_bpf), DENY(__NR_perf_event_open), DENY(__NR_keyctl), DENY(__NR_add_key), DENY(__NR_request_key),
    DENY(__NR_open_by_handle_at),
#ifdef __NR_pidfd_getfd
    DENY(__NR_pidfd_getfd),
#endif
    /* Descendants may bind SIGKILL to their real parent, but cannot clear or
       weaken the launcher's parent-death contract after it has been installed. */
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_prctl, 0, 5),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARG(0)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, PR_SET_PDEATHSIG, 0, 3),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARG(1)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, SIGKILL, 1, 0),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, nr)),
    /* Keep same-UID /proc root inspection available to the cleanup process. */
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_prctl, 0, 5),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARG(0)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, PR_SET_DUMPABLE, 0, 3),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARG(1)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, 1, 1, 0),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, nr)),
#ifdef __NR_io_uring_setup
    DENY(__NR_io_uring_setup), DENY(__NR_io_uring_register), DENY(__NR_io_uring_enter),
#endif
    /* A server only needs its private filesystem Unix listener, never IP sockets. */
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_socket, 0, 4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARG(0)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, AF_UNIX, 1, 0),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_socketpair, 0, 4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARG(0)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, AF_UNIX, 1, 0),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    /* send() uses sendto with a NULL destination. Block addressed datagrams,
       including abstract Unix destinations that would escape a filesystem jail. */
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, __NR_sendto, 0, 6),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARG(4)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, 0, 0, 3),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS, ARG(4) + 4),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, 0, 0, 1),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog program = { .len = sizeof(filter) / sizeof(filter[0]), .filter = filter };
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) fail("recovery seccomp");
}

static struct stat checked_root(const char *path) {
  char resolved[4096], parent[4096];
  struct stat root, outer;
  if (strlen(path) != 20 || strncmp(path, "/tmp/sbr-", 9) || strcmp(path + 15, "/root")
      || !realpath(path, resolved) || strcmp(path, resolved)) fail("recovery private root path");
  for (int index = 9; index < 15; index++) {
    char c = path[index];
    if (!((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'))) fail("recovery root nonce");
  }
  memcpy(parent, path, 15); parent[15] = '\0';
  if (stat(path, &root) || stat(parent, &outer) || !S_ISDIR(root.st_mode) || !S_ISDIR(outer.st_mode)
      || root.st_uid != 0 || outer.st_uid != 0 || (outer.st_mode & 0777) != 0700 || (root.st_mode & 0022)) fail("recovery root ownership");
  return root;
}

static int stop_private(struct stat root) {
  /* Docker root need not have CAP_SYS_PTRACE. Match the server's unprivileged
     identity before inspecting /proc/PID/root; pidfds prevent PID-reuse kills. */
  if (setgroups(0, NULL) || setgid(65532) || setuid(65532)) fail("recovery cleanup identity");
  for (int attempt = 0; attempt < 60; attempt++) {
    DIR *directory = opendir("/proc");
    if (!directory) fail("recovery cleanup proc");
    struct dirent *entry;
    int remaining = 0;
    while ((entry = readdir(directory)) != NULL) {
      char *end;
      long pid = strtol(entry->d_name, &end, 10);
      if (*end || pid <= 0 || pid == getpid()) continue;
      int descriptor = syscall(SYS_pidfd_open, (pid_t)pid, 0);
      if (descriptor < 0) { if (errno == ESRCH || errno == ENOENT) continue; fail("recovery cleanup pidfd"); }
      char pathname[128];
      snprintf(pathname, sizeof(pathname), "/proc/%ld/root", pid);
      struct stat candidate;
      int inspected = stat(pathname, &candidate);
      if (inspected && errno != ESRCH && errno != ENOENT) {
        /* Never report success if a same-UID process conceals its root. */
        snprintf(pathname, sizeof(pathname), "/proc/%ld/status", pid);
        FILE *status = fopen(pathname, "r");
        if (status) {
          char line[512]; unsigned int uid;
          while (fgets(line, sizeof(line), status)) {
            if (sscanf(line, "Uid: %u", &uid) == 1 && uid == 65532) fail("recovery descendant root hidden");
          }
          fclose(status);
        }
      }
      if (!inspected && candidate.st_dev == root.st_dev && candidate.st_ino == root.st_ino) {
        remaining++;
        if (syscall(SYS_pidfd_send_signal, descriptor, attempt < 20 ? SIGTERM : SIGKILL, NULL, 0) && errno != ESRCH) fail("recovery cleanup signal");
      }
      close(descriptor);
    }
    closedir(directory);
    if (!remaining) return 0;
    usleep(100000);
  }
  fputs("recovery sandbox descendants remain\n", stderr);
  return 125;
}

int main(int argc, char **argv) {
  if ((argc != 2 && !(argc == 3 && !strcmp(argv[1], "--stop"))) || getuid() != 0 || geteuid() != 0) {
    fputs("recovery sandbox requires its private root\n", stderr); return 125;
  }
  const char *rootpath = argv[argc - 1];
  struct stat root = checked_root(rootpath);
  if (argc == 3) return stop_private(root);
  const char *parent_text = getenv("SABALAN_RECOVERY_PARENT_PID");
  char *end;
  long parent = parent_text ? strtol(parent_text, &end, 10) : 0;
  if (!parent_text || !*parent_text || *end || parent < 1 || (long)getppid() != parent) fail("recovery parent identity");
  /* libuv closes non-stdio descriptors as well; enforce it at the native seam. */
  if (syscall(SYS_close_range, 3U, ~0U, 0U) != 0) fail("recovery close descriptors");
  if (chroot(rootpath) || chdir("/")) fail("recovery chroot");
  if (setgroups(0, NULL) || setgid(65532) || setuid(65532)) fail("recovery drop identity");
  /* setuid/setgid clear PDEATHSIG. Arm it only after both, then close the
     parent-exit race using the root Node process identity supplied at spawn. */
  if (prctl(PR_SET_PDEATHSIG, SIGKILL) || (long)getppid() != parent) fail("recovery parent death signal");
  confine();
  char *const arguments[] = { "/usr/local/bin/postgres", "-D", "/data", "-k", "/run",
    "-c", "listen_addresses=", "-c", "unix_socket_permissions=0700", "-c", "ssl=off",
    "-c", "shared_preload_libraries=", "-c", "session_preload_libraries=", "-c", "local_preload_libraries=",
    "-c", "logging_collector=off", "-c", "autovacuum=off", "-c", "max_connections=12",
    "-c", "max_worker_processes=0", "-c", "max_parallel_workers=0", "-c", "dynamic_shared_memory_type=mmap", NULL };
  char *const environment[] = { "LANG=C", "LC_ALL=C", "TZ=UTC", "HOME=/data", NULL };
  execve(arguments[0], arguments, environment);
  fail("recovery postgres exec");
}
