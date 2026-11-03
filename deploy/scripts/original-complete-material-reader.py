"""Fixed operation material files only. No command, path, SQL, key or process
selector. The enclosing original controller still owns lease/reader admission."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

MAXIMUM = 8 * 1024**2
NAMES = {'request': 'complete-observation-request.json', 'ack': 'complete-observation-ack.json',
         'application': 'coherent-application-artifacts.json', 'inquiry-stage': 'inquiry-stage.json'}


def require(value):
    if not value:
        raise RuntimeError('ORIGINAL_COMPLETE_MATERIAL_REFUSED')


def directory_identity(directory):
    require(directory.resolve(strict=True) == directory)
    value = directory.lstat()
    require(stat.S_ISDIR(value.st_mode) and value.st_uid == 0 and value.st_mode & 0o777 == 0o700)
    return {key: str(getattr(value, field)) for key, field in [('device', 'st_dev'), ('inode', 'st_ino'), ('uid', 'st_uid'), ('mode', 'st_mode')]}


def read_file(file, mode=0o400, maximum=MAXIMUM, part=None):
    require(file.resolve(strict=True) == file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
                and before.st_mode & 0o777 == mode and 0 < before.st_size <= maximum)
        chunks, count, digest = [], 0, hashlib.sha256()
        while count < before.st_size:
            raw = os.read(fd, min(262144, before.st_size-count))
            require(raw)
            digest.update(raw)
            if part is None:
                chunks.append(raw)
            else:
                start, end = part*1024**2, (part+1)*1024**2
                if count < end and count+len(raw) > start:
                    chunks.append(raw[max(0,start-count):min(len(raw),end-count)])
            count += len(raw)
        require(os.read(fd, 1) == b'')
        after, named = os.fstat(fd), file.lstat()
        for key in ['st_dev', 'st_ino', 'st_uid', 'st_mode', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns']:
            require(getattr(before, key) == getattr(after, key) == getattr(named, key))
        selected = b''.join(chunks)
        value = dict(rawBase64=base64.b64encode(selected).decode(), bytes=len(selected), sha256=hashlib.sha256(selected).hexdigest())
        if part is not None:
            value['database'] = dict(file=str(file),size=count,sha256=digest.hexdigest(),part=part,eof=(part+1)*1024**2>=count)
        return value
    finally:
        os.close(fd)


def exchange(root, request):
    require(request['kind'] in ['read-request', 'read-ack', 'read-application', 'write-request', 'write-ack', 'read-inquiry-stage', 'read-inquiry-database'])
    require(set(request) == {'operation', 'kind', 'namespace', 'parent'} |
            ({'writeBase64'} if request['kind'].startswith('write-') else set()) |
            ({'part'} if request['kind'] == 'read-inquiry-database' else set()))
    require(re.fullmatch(r'[a-f0-9]{32}', request['operation']))
    parent = directory_identity(root.parent)
    if request.get('parent') is not None:
        require(request['parent'] == parent)
    if not os.path.lexists(root):
        require(request['kind'].startswith('read-') and request.get('namespace') is None)
        require(not os.path.lexists(root) and directory_identity(root.parent) == parent)
        return dict(parent=parent, namespace=None, value=None)
    namespace = directory_identity(root)
    if request.get('namespace') is not None:
        require(request['namespace'] == namespace)
    action, role = request['kind'].split('-', 1)
    if role == 'inquiry-database':
        require(type(request['part']) is int and 0 <= request['part'] < 64)
        descriptor = json.loads(base64.b64decode(read_file(root/'inquiry-stage.json')['rawBase64'], validate=True))
        require(descriptor['format'] == 'sabalan-original-complete-inquiry-stage/v1' and descriptor['operation'] == request['operation'])
        file = Path(descriptor['file'])
        expected = str(root.parent/'storage/recovery/work') + '/restore-complete-inquiry-' + request['operation'] + '-'
        require(str(file).startswith(expected) and re.fullmatch(r'[a-f0-9]{32}/payload/inquiry/inquiry\.db',str(file)[len(expected):]))
        value = read_file(file, mode=0o600, maximum=64*1024**2, part=request['part'])
        require(value['database']['size'] == descriptor['target']['size'] and value['database']['sha256'] == descriptor['target']['sha256'] and value['bytes'] > 0)
        require(directory_identity(root) == namespace and directory_identity(root.parent) == parent)
        return dict(parent=parent, namespace=namespace, value=value)
    file = root / NAMES[role]
    if action == 'write':
        require(role in ['request', 'ack'])
        raw = base64.b64decode(request['writeBase64'], validate=True)
        require(0 < len(raw) <= MAXIMUM)
        json.loads(raw)  # The JS fixed protocol separately checks public fields.
        fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
        try:
            offset = 0
            while offset < len(raw):
                count = os.write(fd, raw[offset:]); require(count > 0); offset += count
            os.fsync(fd)
        finally:
            os.close(fd)
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    elif not os.path.lexists(file):
        require(role != 'application')
        require(not os.path.lexists(file) and directory_identity(root) == namespace
                and directory_identity(root.parent) == parent)
        return dict(parent=parent, namespace=namespace, value=None)
    value = read_file(file)
    require(directory_identity(root) == namespace and directory_identity(root.parent) == parent)
    return dict(parent=parent, namespace=namespace, value=value)


if __name__ == '__main__':
    require(sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize)
    os.umask(0o077)
    raw = sys.stdin.buffer.read(12*1024**2+1)
    require(0 < len(raw) <= 12*1024**2)
    request = json.loads(raw)
    require(re.fullmatch(r'[a-f0-9]{32}', request['operation']))
    root = Path('/app/runtime-authority/application-native-' + request['operation'] + '/restored-complete-app/coherent-private')
    print(json.dumps(exchange(root, request), separators=(',', ':')))
