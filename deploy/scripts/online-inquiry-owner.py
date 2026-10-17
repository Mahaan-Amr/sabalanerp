#!/usr/bin/env python3
"""Private native Inquiry owner; no PostgreSQL credentials or public admission.

The shared platform scope pins the common admission locks/cluster identity.
SQLite identity is additionally pinned in this distinct native claim. A host
controller must corroborate the actual container, image and database mount.
This entry point cannot reuse a consumed grant or certify backend SQL closure.
"""
import ctypes
import fcntl
import hashlib
import importlib.util
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

sys.dont_write_bytecode = True


def require(value):
    if not value:
        raise RuntimeError('INQUIRY_NATIVE_OWNERSHIP_UNPROVEN')


def helper(name):
    file = Path(__file__).resolve(strict=True).parent / (name + '.py')
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sqlite_identity():
    url = os.environ.get('DATABASE_URL', '')
    require(url.startswith('file:/') and not any(character in url for character in ['?', '#', '%', '\\', '\x00']))
    file = url[5:]
    require(os.path.normpath(file) == file and os.path.realpath(file) == file)
    parent = os.lstat(str(Path(file).parent))
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.getuid() and not parent.st_mode & 0o022)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        value, named = os.fstat(fd), os.lstat(file)
        require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1 and value.st_uid == os.getuid()
                and not value.st_mode & 0o022 and (value.st_dev, value.st_ino) == (named.st_dev, named.st_ino)
                and os.read(fd, 16) == b'SQLite format 3\x00')
        return dict(file=file, device=str(value.st_dev), inode=str(value.st_ino), ownerUid=value.st_uid)
    finally:
        os.close(fd)


def run():
    require(sys.platform == 'linux' and len(sys.argv) > 1)
    require(not any(key.startswith(('INQUIRY_NATIVE_', 'BACKEND_CONTROL_', 'BACKEND_NATIVE_',
                                   'BACKEND_CAPTURE_', 'BACKEND_ONLINE_INTERLOCK_', 'BACKEND_ONLINE_WORKER_'))
                    for key in os.environ))
    # Inquiry must not acquire the PostgreSQL observer's credentials to imitate
    # backend closure. The SQLite engine lives in the owned native descendants.
    require(not any(key.startswith('PG') for key in os.environ))
    scope_module = helper('online-runtime-scope')
    common = helper('backend-runtime-owner')
    loaded = scope_module.load_scope(os.environ)
    require(loaded is not None)
    scope = loaded['scope']
    require(scope['format'] == 'sabalan-online-runtime-scope/v2' and scope['purpose'] == 'http'
            and scope['role'] == 'serving' and scope['worker'] is None)
    coordination, directory = Path(scope['coordinationDirectory']), Path(scope['nativeDirectory'])
    scope_module.private_directory(str(directory))
    # Legacy and bootstrap ownership must be retired by the host controller,
    # never inferred from a marker, process name or a supposedly quiet SQLite.
    def assert_legacy_retired():
        for name in ['deployment-runtime-native.json', 'deployment-bootstrap-native.json',
                     'restart-inquiry', 'inquiry-stopped']:
            require(not os.path.lexists(coordination / name))

    assert_legacy_retired()
    require(set(os.listdir(directory)) == {'deployment-runtime-control.lock'})
    database = sqlite_identity()
    acquired = []

    def lock(file, access, expected=None):
        require(os.path.realpath(file) == file)
        fd = os.open(file, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            value, named = os.fstat(fd), os.lstat(file)
            require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1 and value.st_size == 0
                    and value.st_uid == os.getuid() and not value.st_mode & 0o022
                    and (value.st_dev, value.st_ino) == (named.st_dev, named.st_ino))
            if expected:
                require(str(value.st_dev) == expected['device'] and str(value.st_ino) == expected['inode'])
            fcntl.flock(fd, access | fcntl.LOCK_NB)
            retained = fcntl.fcntl(fd, fcntl.F_DUPFD_CLOEXEC, 20)
            acquired.append(retained)
            return retained, value
        finally:
            os.close(fd)

    try:
        interlock, _ = lock(scope['interlock']['file'], fcntl.LOCK_SH, scope['interlock'])
        private_file = str(directory / 'deployment-runtime-control.lock')
        private, private_stat = lock(private_file, fcntl.LOCK_EX)
        os.dup2(private, 9, inheritable=True)
        os.dup2(interlock, 11, inheritable=True)
        for fd in acquired:
            os.close(fd)
        acquired.clear()
        os.environ.update(BACKEND_CONTROL_LOCK_FD='9', BACKEND_CONTROL_LOCK_FILE=private_file,
                          BACKEND_ONLINE_INTERLOCK_FD='11')
        locks = common.assert_online_locks(loaded)
        control = common.assert_control_lock(directory)
        require((control.st_dev, control.st_ino) == (private_stat.st_dev, private_stat.st_ino))
        # An intervening legacy owner may have released the kernel lock but
        # left durable ACTIVE evidence. Only this under-lock check is decisive.
        assert_legacy_retired()
        helper('online-capture-admission').CaptureAdmission(loaded).state()
        require(scope_module.load_scope(os.environ) == loaded and sqlite_identity() == database)
        require(set(os.listdir(directory)) == {'deployment-runtime-control.lock'})
        require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0)
        birth = dict(pid=os.getpid(), bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                     pidNamespace=os.readlink('/proc/self/ns/pid'),
                     startTicks=Path('/proc/self/stat').read_text().rsplit(') ', 1)[1].split()[19])
        record = dict(format='sabalan-inquiry-native/v1', phase='ACTIVE', guardian=birth,
                      onlineScope=loaded, onlineLocks=locks, sqlite=database,
                      lock=dict(device=str(control.st_dev), inode=str(control.st_ino)),
                      commandSha256=hashlib.sha256(common.encode(sys.argv[1:])).hexdigest())
        active = common.encode(record)
        temporary = directory / 'deployment-runtime-native.tmp'
        file = directory / 'deployment-runtime-native.json'
        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        # Any uncertainty from this attempted publication retains both locks.
        try:
            common.write_exclusive(temporary, active)
            require(set(os.listdir(directory)) == {'deployment-runtime-control.lock', temporary.name})
            os.rename(temporary, file)
            os.fsync(directory_fd)
            active_stat = file.lstat()
            cancelled = False

            def cancel(_number, _frame):
                nonlocal cancelled
                cancelled = True

            for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGPIPE]:
                signal.signal(number, cancel)
            environment = dict(os.environ, INQUIRY_NATIVE_AUTHORITY_FILE=str(file),
                               INQUIRY_NATIVE_CLAIM_SHA256=hashlib.sha256(active).hexdigest())
            child = subprocess.Popen(sys.argv[1:], env=environment, pass_fds=(9, 11))
            root_pid, root_status, signalled = child.pid, None, set()
            while True:
                try:
                    pid, status = os.waitpid(-1, os.WNOHANG)
                except ChildProcessError:
                    break
                if pid:
                    if pid == root_pid:
                        root_status = os.waitstatus_to_exitcode(status)
                        child.returncode = root_status
                    continue
                if cancelled:
                    for raw in Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text().split():
                        owned = int(raw)
                        if owned in signalled:
                            continue
                        seen, status = os.waitpid(owned, os.WNOHANG)
                        if seen:
                            if seen == root_pid:
                                root_status = os.waitstatus_to_exitcode(status)
                                child.returncode = root_status
                        else:
                            try:
                                os.kill(owned, signal.SIGTERM)
                            except ProcessLookupError:
                                pass
                            signalled.add(owned)
                time.sleep(0.01)
            require(root_status is not None and common.read_state(file)[1] == active)
            current = file.lstat()
            require((current.st_dev, current.st_ino) == (active_stat.st_dev, active_stat.st_ino)
                    and scope_module.load_scope(os.environ) == loaded and sqlite_identity() == database
                    and common.assert_online_locks(loaded) == locks)
            final = common.assert_control_lock(directory)
            require((final.st_dev, final.st_ino) == (control.st_dev, control.st_ino))
            record.update(phase='QUIESCENT', nativeReaped=True, sqliteNativeClosed=True,
                          nativeStatus=root_status, stoppedBySignal=cancelled,
                          activeClaimSha256=hashlib.sha256(active).hexdigest())
            common.write_exclusive(temporary, common.encode(record))
            os.replace(temporary, file)
            os.fsync(directory_fd)
            return 128 if cancelled else (root_status if root_status >= 0 else 128 + abs(root_status))
        except BaseException:
            for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGPIPE]:
                signal.signal(number, signal.SIG_IGN)
            try:
                print('INQUIRY_NATIVE_BOUNDARY_HELD', file=sys.stderr, flush=True)
            except BaseException:
                pass  # Unavailable logging can never release uncertain ownership.
            while True:
                time.sleep(60)
    finally:
        for fd in acquired:
            os.close(fd)


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception:
        print('INQUIRY_NATIVE_OWNERSHIP_UNPROVEN', file=sys.stderr)
        sys.exit(75)
