"""Run the immutable seal-only Node descendant under the original capture OFDs.

No descriptor reopening, application work stand-in, live writes, retry, signal
termination, or release admission. An unfinished descendant remains owned by
the capture guardian; an uncertain result cannot reopen admission.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess


def require(value):
    if not value:
        raise RuntimeError('NATIVE_VERSIONED_SEALER_UNPROVEN')


def identity(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, value.st_uid, value.st_mode, value.st_nlink)


def program(configuration, sources):
    require(isinstance(configuration, dict) and set(configuration) == {'script', 'sha256', 'stores'}
            and isinstance(configuration['script'], str)
            and isinstance(configuration['sha256'], str) and re.fullmatch(r'[a-f0-9]{64}', configuration['sha256'])
            and isinstance(configuration['stores'], list) and len(configuration['stores']) == len(sources))
    for source, store in zip(sources, configuration['stores']):
        require(isinstance(store, dict) and set(store) == {'name', 'device', 'inode'} and store['name'] == source['name']
                and all(isinstance(store[key], str) and re.fullmatch(r'[1-9][0-9]{0,24}', store[key]) for key in ['device', 'inode']))
        directory = Path(source['storeRoot'])
        value = directory.lstat()
        require(directory.is_absolute() and directory.resolve(strict=True) == directory
                and stat.S_ISDIR(value.st_mode) and value.st_uid == os.geteuid() and not value.st_mode & 0o077
                and str(value.st_dev) == store['device'] and str(value.st_ino) == store['inode'])
    file = Path(configuration['script'])
    require(file.is_absolute() and file.resolve(strict=True) == file)
    parent = file.parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.geteuid() and not parent.st_mode & 0o077)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid() and before.st_nlink == 1
                and before.st_mode & 0o777 == 0o400 and 0 < before.st_size <= 16 * 1024 * 1024)
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(16 * 1024 * 1024 + 1)
        require(identity(before) == identity(os.fstat(fd)) == identity(file.lstat())
                and len(raw) == before.st_size and hashlib.sha256(raw).hexdigest() == configuration['sha256'])
        return str(file), identity(before)
    finally:
        os.close(fd)


def run(scope_file, scope_sha256, scope, descriptors, directory_fd):
    script, original = program(scope['sealer'], scope['sources'])
    require(tuple(descriptors) == (9, 10, 11, 12))
    output = os.open('sealer.stdout', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400, dir_fd=directory_fd)
    errors = os.open('sealer.stderr', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400, dir_fd=directory_fd)
    try:
        child = subprocess.Popen(['/usr/local/bin/node', script, str(scope_file), scope_sha256],
                                 env=os.environ, pass_fds=tuple(descriptors), stdin=subprocess.DEVNULL,
                                 stdout=output, stderr=errors)
        # Never kill a slow sealer and call it complete. The native guardian
        # owns this descendant even if this worker/controller disappears.
        status = child.wait()
        os.fsync(output)
        os.fsync(errors)
        os.fsync(directory_fd)
        require(status == 0 and program(scope['sealer'], scope['sources']) == (script, original))
        require(os.fstat(output).st_size <= 262144 and os.fstat(errors).st_size <= 16384)
    finally:
        os.close(output)
        os.close(errors)
    output = os.open('sealer.stdout', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    try:
        raw = os.read(output, 262145)
        require(0 < len(raw) <= 262144)
        result = json.loads(raw)
        require(isinstance(result, dict) and set(result) == {'phase', 'versionedCuts'} and result['phase'] == 'SEALED')
        return result['versionedCuts']
    finally:
        os.close(output)
