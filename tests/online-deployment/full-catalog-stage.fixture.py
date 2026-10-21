"""Original-host fixed source staging only. No database or runtime admission."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


def check(value, code):
    if not value:
        raise RuntimeError(code)


def hint_staged_file(target, original):
    """Hint only this freshly written, verified inode; no cache credit."""
    identity = lambda value: (value.st_dev, value.st_ino, value.st_uid, value.st_gid,
                              value.st_mode, value.st_nlink, value.st_size,
                              value.st_mtime_ns, value.st_ctime_ns)
    fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        check(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
              and before.st_nlink == 1 and before.st_mode & 0o777 == 0o400
              and identity(before) == identity(original) == identity(target.lstat()),
              'CATALOG_STAGE_CACHE_IDENTITY')
        os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
        check(identity(os.fstat(fd)) == identity(before) == identity(target.lstat()),
              'CATALOG_STAGE_CACHE_METADATA_CHANGED')
    finally:
        os.close(fd)


root = Path(sys.argv[1])
check(len(sys.argv) == 3 and re.fullmatch(r'/app/online-runtime-acceptance/application-native-[a-f0-9]{32}', str(root)), 'CATALOG_STAGE_ROOT')
expected_sha = sys.argv[2]
check(re.fullmatch(r'[a-f0-9]{64}', expected_sha), 'CATALOG_STAGE_DIGEST')
root_identity = root.lstat()
check(root.resolve(strict=True) == root and stat.S_ISDIR(root_identity.st_mode)
      and root_identity.st_uid == os.getuid() and root_identity.st_mode & 0o777 == 0o700, 'CATALOG_STAGE_ROOT_IDENTITY')
manifest_file = root / 'full-catalog-source-manifest.json'
fd = os.open(manifest_file, os.O_RDONLY | os.O_NOFOLLOW)
try:
    observed = os.fstat(fd)
    check(stat.S_ISREG(observed.st_mode) and observed.st_nlink == 1 and observed.st_size <= 8 * 1024**2
          and observed.st_mode & 0o777 == 0o400 and observed.st_uid == os.getuid(), 'CATALOG_STAGE_MANIFEST_IDENTITY')
    with os.fdopen(os.dup(fd), 'rb') as stream:
        raw = stream.read(8 * 1024**2 + 1)
finally:
    os.close(fd)
check(hashlib.sha256(raw).hexdigest() == expected_sha, 'CATALOG_STAGE_MANIFEST_CHANGED')
manifest = json.loads(raw)
check(manifest['format'] == 'sabalan-full-catalog-source/v1' and re.fullmatch(r'[a-f0-9]{32}', manifest['operation']), 'CATALOG_STAGE_FORMAT')
entries = manifest['entries']
check(isinstance(entries, list) and 1 <= len(entries) <= 8192 and len(entries) == len(manifest['files']), 'CATALOG_STAGE_COUNT')
entries = sorted(entries, key=lambda entry: entry['relativePath'])
names = [entry['relativePath'] for entry in entries]
check(names == sorted(names) and len(set(names)) == len(names) and 'source-manifest.json' not in names, 'CATALOG_STAGE_ORDER')
total = 0
for entry in entries:
    name = entry['relativePath']
    check(isinstance(name, str) and name and not name.startswith('/') and '\\' not in name
          and all(part not in ('', '.', '..') for part in name.split('/')), 'CATALOG_STAGE_MEMBER')
    check(type(entry['bytes']) is int and entry['bytes'] >= 0 and entry['mode'] == 0o400
          and re.fullmatch(r'[a-f0-9]{64}', entry['sha256']), 'CATALOG_STAGE_ENTRY')
    check(manifest['files'][name] == dict(bytes=entry['bytes'], sha256=entry['sha256']), 'CATALOG_STAGE_INVENTORY')
    total += entry['bytes']
check(total <= 256 * 1024**2, 'CATALOG_STAGE_BYTES')
app = root / 'full-catalog'
app.mkdir(mode=0o700)
stream = sys.stdin.buffer
for entry in entries:
    target = app / entry['relativePath']
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    digest = hashlib.sha256()
    try:
        remaining = entry['bytes']
        while remaining:
            data = stream.read(min(262144, remaining))
            check(bool(data), 'CATALOG_STAGE_INPUT_SHORT')
            digest.update(data)
            offset = 0
            while offset < len(data):
                offset += os.write(fd, data[offset:])
            remaining -= len(data)
        check(digest.hexdigest() == entry['sha256'], 'CATALOG_STAGE_INPUT_CHANGED')
        os.fsync(fd)
        actual = os.fstat(fd)
        check(actual.st_nlink == 1 and actual.st_size == entry['bytes'] and actual.st_mode & 0o777 == 0o400, 'CATALOG_STAGE_OUTPUT')
        hint_staged_file(target, actual)
    finally:
        os.close(fd)
check(stream.read(1) == b'', 'CATALOG_STAGE_INPUT_TRAILING')
with (app / 'source-manifest.json').open('xb') as stream:
    os.fchmod(stream.fileno(), 0o400)
    stream.write(raw)
    stream.flush()
    os.fsync(stream.fileno())
    hint_staged_file(app / 'source-manifest.json', os.fstat(stream.fileno()))
fd = os.open(app, os.O_RDONLY | os.O_DIRECTORY)
try:
    os.fsync(fd)
finally:
    os.close(fd)
print(json.dumps(dict(format='sabalan-original-full-catalog-stage/v1', operation=manifest['operation'],
    manifestSha256=expected_sha, files=len(entries), bytes=total, nativeRuntimeAuthority=False,
    databaseExecuted=False, directory=str(app), cacheHint=dict(
        method='READONLY_POSIX_FADV_DONTNEED', hintedFiles=len(entries) + 1,
        hintedBytes=total + len(raw), cacheCreditUsed=False,
        bytesChanged=False, filesDeleted=False))))
