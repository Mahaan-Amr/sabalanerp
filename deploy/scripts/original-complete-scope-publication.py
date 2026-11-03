"""File-only publication via the existing retained jobs writer. No key change,
overwrite, cleanup, actor start or portable admission is provided here."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys


def require(value):
    if not value:
        raise RuntimeError('ORIGINAL_COMPLETE_SCOPE_PUBLICATION_REFUSED')


def snapshot(directory):
    require(directory.resolve(strict=True) == directory)
    parent = directory.stat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == 0 and not parent.st_mode & 0o022)
    output = {}
    for file in sorted(directory.iterdir()):
        value = file.lstat()
        require(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_nlink == 1
                and not value.st_mode & 0o022 and 0 < value.st_size <= 65536)
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            raw = os.read(fd, 65537)
            after = os.fstat(fd)
            fields = ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns']
            require(len(raw) == before.st_size and all(getattr(before, k) == getattr(after, k) == getattr(file.lstat(), k) for k in fields))
            output[file.name] = dict(sha256=hashlib.sha256(raw).hexdigest(), identity=[str(getattr(before, k)) for k in fields])
        finally:
            os.close(fd)
    require(len(output) <= 4096)
    return output


def publish(directory, request):
    require(set(request) == {'operation', 'grants', 'trustSha256'} and re.fullmatch(r'[a-f0-9]{32}', request['operation']))
    before = snapshot(directory)
    require(before['qualification-controller-public-key.pem']['sha256'] == request['trustSha256'])
    require((directory / 'qualification-controller-public-key.pem').stat().st_mode & 0o777 == 0o444)
    grants = request['grants']
    require(len(grants) == 3 and len({g['name'] for g in grants}) == 3)
    prepared = []
    for grant in grants:
        require(set(grant) == {'name', 'rawBase64', 'sha256'} and re.fullmatch(r'[a-f0-9]{64}\.json', grant['name']))
        require(grant['name'] not in before)
        raw = base64.b64decode(grant['rawBase64'], validate=True)
        require(0 < len(raw) <= 16384 and hashlib.sha256(raw).hexdigest() == grant['sha256'])
        scope = json.loads(raw)
        require(scope['runtimeId'] + '.json' == grant['name'] and scope['releaseId'] == 'qa-complete-' + request['operation'])
        require(scope['coordinationDirectory'] == '/app/runtime-authority/application-native-' + request['operation'] + '/restored-complete-app/coherent-private/coordination')
        prepared.append((directory / grant['name'], raw))
    for file, raw in prepared:
        fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        try:
            offset = 0
            while offset < len(raw):
                count = os.write(fd, raw[offset:])
                require(count > 0)
                offset += count
            os.fsync(fd)
        finally:
            os.close(fd)
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
    after = snapshot(directory)
    require(set(after) == set(before) | {g['name'] for g in grants})
    require(all(after[k] == v for k, v in before.items()))
    require(all(after[g['name']]['sha256'] == g['sha256'] for g in grants))
    return dict(published=[dict(name=g['name'], sha256=g['sha256']) for g in grants],
                originalTrustPreserved=True, originalEntriesPreserved=len(before), productionAdmission=False)


if __name__ == '__main__':
    require(sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize)
    os.umask(0o077)
    raw = sys.stdin.buffer.read(65537)
    require(0 < len(raw) <= 65536)
    print(json.dumps(publish(Path('/app/jobs-authority'), json.loads(raw)), separators=(',', ':')))
