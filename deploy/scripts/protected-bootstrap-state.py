"""Read-only fail-closed guard for a possibly interrupted native bootstrap."""
import json
import os
from pathlib import Path
import stat
import sys


def read_state(directory):
    file = Path(directory) / 'deployment-bootstrap-native.json'
    try:
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != os.getuid() \
                or before.st_mode & 0o022 or not 0 < before.st_size <= 16384 or file.resolve(strict=True) != file:
            raise RuntimeError('BOOTSTRAP_NATIVE_STATE_UNPROVEN')
        data = os.read(fd, 16385)
        after, named = os.fstat(fd), os.lstat(file)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != \
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) \
                or (named.st_dev, named.st_ino) != (before.st_dev, before.st_ino) or after.st_nlink != 1:
            raise RuntimeError('BOOTSTRAP_NATIVE_STATE_UNPROVEN')
        value = json.loads(data)
        if not isinstance(value, dict):
            raise RuntimeError('BOOTSTRAP_NATIVE_STATE_UNPROVEN')
        return value
    finally:
        os.close(fd)


def assert_quiescent(directory):
    state = read_state(directory)
    if state is not None and (state.get('format') != 'sabalan-bootstrap-native/v1'
            or state.get('phase') != 'QUIESCENT' or state.get('nativeReaped') is not True
            or state.get('databaseQuiet') is not True):
        raise RuntimeError('BOOTSTRAP_NATIVE_COMPLETION_UNPROVEN')
    return state


if __name__ == '__main__':
    try:
        assert_quiescent(os.environ.get('RECOVERY_COORDINATION_DIR', '/app/recovery-coordination'))
    except Exception:
        print('BOOTSTRAP_NATIVE_COMPLETION_UNPROVEN', file=sys.stderr)
        sys.exit(75)
