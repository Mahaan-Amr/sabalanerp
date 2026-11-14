#!/usr/bin/env python3
"""One-use, exact-target cleanup of inactive backup-host QA artifacts."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

ROOT = Path('/root/sabalan-recovery-private')
ROOT_ID = (64513, 281)
KEY = ROOT / 'remote-recovery-private.pem'
KEY_ID = (64513, 8255)
KEY_SHA = '53f04770a79b7683e4575f2be6aa2d1fd7ee01594bb9a707ffcd7cdb0692e38d'
ACTIVE = ROOT / 'drill-f20a3622-20261106'
ACTIVE_ID = (64513, 34582)
ACTIVE_CONTAINER = '3efbefec69bc5429311db02aca06ac6280c8612343431cca2f7bfc1b1d79b02b'
TARGETS = {
    'drill-f20a3622-schema-seeded-20261106': (281345, 1132871680),
    'drill-f20a3622-patched-full-20261106': (412003, 1132089344),
    'drill-f20a3622-business-probe-20261106': (290541, 56131584),
    'drill-f20a3622-patched-proof-20261106': (405392, 56107008),
    'transfer-4cfbdd88cfe54238a827d55548577e90': (22400, 1242963968),
    'native-qa': (7433, 1566597120),
    'physical-replay-r4-20261015': (13145, 335503360),
    'release-source-f20a3622': (9715, 177582080),
}
INTENT = Path('/root/sabalan-private-cleanup-20261114-intent.json')
PROGRESS = Path('/root/sabalan-private-cleanup-20261114-progress.jsonl')
RESULT = Path('/root/sabalan-private-cleanup-20261114-result.json')
CHECKPOINTS = Path('/srv/sabalanerp-recovery/checkpoints')


def require(ok, reason):
    if not ok:
        raise RuntimeError(reason)


def identity(path, expected):
    item = path.lstat()
    require((item.st_dev, item.st_ino) == expected, f'IDENTITY_CHANGED: {path}')
    require(item.st_uid == 0 and item.st_nlink == 1 if stat.S_ISREG(item.st_mode) else item.st_uid == 0,
            f'OWNER_OR_LINK_CHANGED: {path}')
    require(not stat.S_ISLNK(item.st_mode), f'SYMLINK_TARGET: {path}')
    return item


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def disk_free():
    v = os.statvfs('/')
    return v.f_bavail * v.f_frsize


def allocated(path):
    result = subprocess.run(['/usr/bin/du', '-sx', '-B1', str(path)],
                            capture_output=True, text=True, check=True, timeout=90)
    return int(result.stdout.split()[0])


def check_tree(path):
    for base, dirs, files in os.walk(path, topdown=True, followlinks=False):
        for name in dirs + files:
            child = Path(base) / name
            item = child.lstat()
            require(item.st_dev == ROOT_ID[0], f'CROSS_DEVICE: {child}')
            require(item.st_nlink == 1 if stat.S_ISREG(item.st_mode) else True,
                    f'HARDLINK: {child}')
            require(stat.S_ISREG(item.st_mode) or stat.S_ISDIR(item.st_mode), f'SPECIAL_FILE: {child}')


def mounts_and_open_paths(paths):
    prefixes = tuple(str(p) + '/' for p in paths)
    exact = {str(p) for p in paths}

    def selected(value):
        return value in exact or value.startswith(prefixes)

    with open('/proc/self/mountinfo', encoding='utf8') as source:
        for line in source:
            require(not selected(line.split()[4]), 'MOUNT_INSIDE_TARGET')
    for proc in os.scandir('/proc'):
        if not proc.name.isdigit():
            continue
        for suffix in ('cwd', 'root'):
            try:
                require(not selected(os.readlink(f'{proc.path}/{suffix}')), 'ACTIVE_PROCESS_PATH')
            except (FileNotFoundError, PermissionError, ProcessLookupError):
                pass
        try:
            descriptors = os.listdir(f'{proc.path}/fd')
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            continue
        for fd in descriptors:
            try:
                require(not selected(os.readlink(f'{proc.path}/fd/{fd}')), 'ACTIVE_PROCESS_FD')
            except (FileNotFoundError, PermissionError, ProcessLookupError):
                pass


def active_dependencies():
    identity(ROOT, ROOT_ID)
    key = identity(KEY, KEY_ID)
    require(stat.S_ISREG(key.st_mode) and (key.st_mode & 0o777) == 0o400,
            'RECOVERY_KEY_MODE_CHANGED')
    require(sha256(KEY) == KEY_SHA, 'RECOVERY_KEY_CHANGED')
    active = identity(ACTIVE, ACTIVE_ID)
    require(stat.S_ISDIR(active.st_mode), 'ACTIVE_DRILL_CHANGED')
    result = subprocess.run(['/usr/bin/docker', 'ps', '-q', '--no-trunc'],
                            capture_output=True, text=True, check=True, timeout=15)
    require(result.stdout.split() == [ACTIVE_CONTAINER], 'DOCKER_CENSUS_CHANGED')
    result = subprocess.run(['/usr/bin/docker', 'inspect', ACTIVE_CONTAINER],
                            capture_output=True, text=True, check=True, timeout=15)
    container = json.loads(result.stdout)[0]
    require(container['State']['Running'] and container['State']['Health']['Status'] == 'healthy',
            'ACTIVE_DRILL_NOT_HEALTHY')
    sources = {entry['Source'] for entry in container['Mounts']}
    require(sources == {str(ACTIVE / 'marker.sql'), str(ACTIVE / 'postgres')},
            'ACTIVE_DRILL_MOUNTS_CHANGED')
    require(len(list(CHECKPOINTS.glob('*/*.sabrec.json'))) == 9,
            'CANONICAL_CHECKPOINT_SET_CHANGED')


def preflight():
    require(os.geteuid() == 0 and shutil.rmtree.avoids_symlink_attacks,
            'ROOT_OR_FD_SAFE_DELETE_REQUIRED')
    require(not INTENT.exists() and not PROGRESS.exists() and not RESULT.exists(),
            'CLEANUP_ALREADY_STARTED')
    active_dependencies()
    paths = []
    for name, (inode, bytes_expected) in TARGETS.items():
        path = ROOT / name
        item = identity(path, (ROOT_ID[0], inode))
        require(stat.S_ISDIR(item.st_mode), f'NOT_DIRECTORY: {path}')
        check_tree(path)
        require(allocated(path) == bytes_expected, f'SIZE_CHANGED: {path}')
        paths.append(path)
    mounts_and_open_paths(paths)
    return {'format': 'sabalan-inactive-private-cleanup/v1',
            'root': str(ROOT), 'beforeFreeBytes': disk_free(),
            'targets': [{'path': str(ROOT / name), 'inode': inode, 'allocatedBytes': size}
                        for name, (inode, size) in TARGETS.items()],
            'preservedKeySha256': KEY_SHA, 'preservedActiveContainer': ACTIVE_CONTAINER,
            'preservedCheckpointSidecars': 9}


def exclusive_json(path, value):
    data = (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def execute(plan):
    exclusive_json(INTENT, plan)
    for target in plan['targets']:
        path = Path(target['path'])
        active_dependencies()
        identity(path, (ROOT_ID[0], target['inode']))
        check_tree(path)
        require(allocated(path) == target['allocatedBytes'], f'SIZE_CHANGED: {path}')
        mounts_and_open_paths([path])
        shutil.rmtree(path)
        require(not path.exists(), f'TARGET_REMAINS: {path}')
        with PROGRESS.open('a', encoding='utf8') as output:
            output.write(json.dumps({'removed': str(path), 'afterFreeBytes': disk_free()}, sort_keys=True) + '\n')
            output.flush()
            os.fsync(output.fileno())
    active_dependencies()
    after = disk_free()
    require(after > plan['beforeFreeBytes'], 'NO_CAPACITY_RECLAIMED')
    result = {'format': 'sabalan-inactive-private-cleanup-result/v1',
              'beforeFreeBytes': plan['beforeFreeBytes'], 'afterFreeBytes': after,
              'removed': [item['path'] for item in plan['targets']],
              'preservedKeySha256': KEY_SHA,
              'preservedActiveContainer': ACTIVE_CONTAINER,
              'preservedCheckpointSidecars': 9}
    exclusive_json(RESULT, result)
    return result


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2 and sys.argv[1] in ('--plan', '--execute-reviewed'),
                'MODE_REQUIRED')
        plan = preflight()
        print(json.dumps(plan if sys.argv[1] == '--plan' else execute(plan), sort_keys=True))
    except Exception as error:
        print(f'CLEANUP_REFUSED: {error}', file=sys.stderr)
        sys.exit(1)
