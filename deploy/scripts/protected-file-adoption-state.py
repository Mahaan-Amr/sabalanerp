"""Read-only refusal for interrupted protected file adoption. No reset CLI."""
import json
import os
from pathlib import Path
import stat


def assert_quiescent(directory):
    file = Path(directory) / 'deployment-file-adoption-native.json'
    try:
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1 \
                or before.st_mode & 0o077 or not 0 < before.st_size <= 16384 or file.resolve(strict=True) != file:
            raise RuntimeError('PROTECTED_FILE_ADOPTION_COMPLETION_UNPROVEN')
        raw = os.read(fd, 16385)
        fields = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_mode, value.st_uid, value.st_nlink)
        if fields(before) != fields(os.fstat(fd)) or fields(before) != fields(file.lstat()):
            raise RuntimeError('PROTECTED_FILE_ADOPTION_COMPLETION_UNPROVEN')
        value = json.loads(raw)
        if value.get('format') != 'sabalan-protected-file-adoption-native/v1' or value.get('phase') != 'QUIESCENT' \
                or value.get('nativeReaped') is not True or value.get('databaseQuiet') is not True \
                or type(value.get('nativeStatus')) is not int:
            raise RuntimeError('PROTECTED_FILE_ADOPTION_COMPLETION_UNPROVEN')
    finally:
        os.close(fd)


if __name__ == '__main__':
    assert_quiescent(os.environ.get('RECOVERY_COORDINATION_DIR', '/app/recovery-coordination'))
