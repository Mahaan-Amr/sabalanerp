import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

test('the private PostgreSQL image includes no default cluster, shell, procfs or production filesystem', async () => {
  const root = path.resolve(__dirname, '../../../..');
  const [docker, assembly, native] = await Promise.all([
    fs.readFile(path.join(root, 'backend/Dockerfile'), 'utf8'),
    fs.readFile(path.join(root, 'backend/scripts/build-recovery-postgres-root.sh'), 'utf8'),
    fs.readFile(path.join(root, 'backend/scripts/recovery-postgres-sandbox.c'), 'utf8'),
  ]);
  assert.match(docker, /FROM \$\{RECOVERY_POSTGRES_IMAGE\} AS recovery-postgres/);
  assert.doesNotMatch(docker, /install[^\n]*postgresql-15/);
  assert.match(docker, /gcc -O2 -Wall -Wextra -Werror/);
  assert.match(docker, /COPY --from=recovery-postgres \/opt\/recovery-postgres-root/);
  assert.match(assembly, /su-exec postgres .*initdb/);
  assert.match(assembly, /--auth-local=trust --auth-host=reject/);
  assert.match(assembly, /test ! -e "\$root\/bin\/sh"/);
  assert.match(assembly, /test ! -e "\$root\/proc"/);
  assert.match(assembly, /test ! -e "\$root\/etc\/shadow"/);
  assert.match(native, /SYS_close_range, 3U/);
  assert.match(native, /setgroups\(0, NULL\).*setgid\(65532\).*setuid\(65532\)/);
  assert.match(native, /PR_SET_NO_NEW_PRIVS/);
  assert.match(native, /listen_addresses=/);
  assert.match(native, /execve\(arguments\[0\], arguments, environment\)/);
});

test('the kernel boundary blocks outgoing network and fd-passing bypasses and retires jail descendants using pidfds', async () => {
  const native = await fs.readFile(path.resolve(__dirname, '../../../scripts/recovery-postgres-sandbox.c'), 'utf8');
  for (const syscall of ['connect', 'sendmsg', 'sendmmsg', 'recvmsg', 'recvmmsg', 'io_uring_setup', 'io_uring_register',
    'io_uring_enter', 'ptrace', 'process_vm_readv', 'process_vm_writev', 'mount', 'chroot', 'unshare', 'setns', 'pidfd_getfd']) {
    assert.ok(native.includes(`DENY(__NR_${syscall})`), `${syscall} must remain denied`);
  }
  assert.match(native, /__NR_socket, 0, 4/);
  assert.match(native, /__NR_socketpair, 0, 4/);
  assert.equal((native.match(/AF_UNIX, 1, 0/g) || []).length, 2);
  assert.match(native, /__NR_sendto/);
  assert.match(native, /ARG\(4\) \+ 4/);
  assert.match(native, /SECCOMP_RET_KILL_PROCESS/);
  assert.match(native, /0x40000000U/);
  assert.ok(native.lastIndexOf('prctl(PR_SET_PDEATHSIG, SIGKILL)') > native.lastIndexOf('setgid(65532) || setuid(65532)'));
  assert.match(native, /getppid\(\) != parent/);
  assert.match(native, /SABALAN_RECOVERY_PARENT_PID/);
  assert.match(native, /SYS_pidfd_open/);
  assert.match(native, /candidate.st_dev == root.st_dev && candidate.st_ino == root.st_ino/);
  assert.match(native, /SYS_pidfd_send_signal/);
  assert.doesNotMatch(native, /DENY\(__NR_setsid\)/, 'PostgreSQL session children must be able to initialize');
});

test('owner archive extraction rejects every entry type other than regular files and directories', async () => {
  const source = await fs.readFile(path.resolve(__dirname, '../systemRecoveryEngine.ts'), 'utf8');
  assert.match(source, /line\.length > 0 && !\/\^\[-d\]\/\.test\(line\)/);
});
