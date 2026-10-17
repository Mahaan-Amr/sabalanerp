"""Native identity inputs from a genuinely read-only, unaliased host grant.

This does not admit public work, validate a release, grant worker ownership or
certify recovery. Native descriptors, SQL identity and release admission must
still be proven by their owners. There is no flag-based fallback.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

KEYS = ['BACKEND_ONLINE_SCOPE_FILE', 'BACKEND_ONLINE_SCOPE_SHA256']
HASH = r'[a-f0-9]{64}'


def require(value):
    if not value:
        raise RuntimeError('ONLINE_RUNTIME_SCOPE_UNPROVEN')


def exact(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def identity(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, value.st_mode, value.st_uid, value.st_nlink)


def private_directory(directory):
    require(isinstance(directory, str) and directory.startswith('/') and os.path.normpath(directory) == directory
            and os.path.realpath(directory) == directory)
    value = os.lstat(directory)
    require(stat.S_ISDIR(value.st_mode) and value.st_uid == os.getuid() and not value.st_mode & 0o022)


def named_lock(value, expected_path):
    require(exact(value, ['file', 'device', 'inode', 'ownerUid']) and value['file'] == expected_path
            and all(isinstance(value[key], str) and re.fullmatch(r'[1-9][0-9]{0,24}', value[key]) for key in ['device', 'inode'])
            and type(value['ownerUid']) is int and value['ownerUid'] == os.getuid())
    private_directory(str(Path(expected_path).parent))
    require(os.path.realpath(expected_path) == expected_path)
    fd = os.open(expected_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        current, named = os.fstat(fd), os.lstat(expected_path)
        require(stat.S_ISREG(current.st_mode) and current.st_nlink == 1 and current.st_size == 0
                and current.st_uid == value['ownerUid'] and not current.st_mode & 0o022
                and str(current.st_dev) == value['device'] and str(current.st_ino) == value['inode']
                and identity(current) == identity(named))
    finally:
        os.close(fd)


def unescape_mount(value):
    return re.sub(r'\\([0-7]{3})', lambda match: chr(int(match[1], 8)), value)


def beneath(file, directory):
    return file == directory or file.startswith(directory.rstrip('/') + '/')


def mount_snapshot():
    with open('/proc/self/mountinfo', 'rb') as stream:
        data = stream.read(262145)
    require(0 < len(data) <= 262144)
    return data


def readonly_mount(file, descriptor, value):
    mounts = []
    snapshot = mount_snapshot()
    namespace = os.readlink('/proc/self/ns/mnt')
    for line in snapshot.decode('utf8').splitlines():
        before, separator, _after = line.partition(' - ')
        fields = before.split(' ')
        require(separator and len(fields) >= 6 and fields[0].isdigit()
                and re.fullmatch(r'[0-9]+:[0-9]+', fields[2]))
        root, target = map(unescape_mount, fields[3:5])
        require(root.startswith('/') and target.startswith('/'))
        mounts.append(dict(id=fields[0], device=fields[2], root=root,
                           target=target, options=set(fields[5].split(','))))
    covering = [mount for mount in mounts if beneath(file, mount['target'])]
    require(covering)
    selected = max(covering, key=lambda mount: len(mount['target']))
    require('ro' in selected['options'] and 'rw' not in selected['options']
            and selected['device'] == str(os.major(value.st_dev)) + ':' + str(os.minor(value.st_dev)))
    underlying = os.path.normpath(os.path.join(selected['root'], os.path.relpath(file, selected['target'])))
    # Checking only the read-only target is insufficient: the same volume can
    # simultaneously be writable through another mount in this container.
    require(not any(mount['device'] == selected['device'] and 'rw' in mount['options']
                    and beneath(underlying, mount['root']) for mount in mounts))
    with open('/proc/self/fdinfo/' + str(descriptor), encoding='ascii') as stream:
        match = re.search(r'^mnt_id:\s+([0-9]+)\s*$', stream.read(), re.M)
    require(match and match[1] == selected['id'])
    require(mount_snapshot() == snapshot and os.readlink('/proc/self/ns/mnt') == namespace)
    return dict(mountId=selected['id'], mountNamespace=namespace, mountInfoSha256=hashlib.sha256(snapshot).hexdigest())


def _load(environment):
    require(all(isinstance(environment.get(key), str) and environment[key] for key in KEYS)
            and re.fullmatch(HASH, environment[KEYS[1]]))
    file = environment[KEYS[0]]
    require(re.fullmatch(r'/run/sabalan-online/' + HASH + r'\.json', file)
            and os.path.realpath(file) == file)
    private_directory(str(Path(file).parent))
    descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
                and before.st_mode & 0o777 == 0o400 and 0 < before.st_size <= 16384)
        data = os.read(descriptor, 16385)
        require(len(data) == before.st_size and identity(before) == identity(os.fstat(descriptor))
                and identity(before) == identity(os.lstat(file)))
        require(hashlib.sha256(data).hexdigest() == environment[KEYS[1]])
        mount = readonly_mount(file, descriptor, before)
        scope = json.loads(data)
        require(exact(scope, ['format', 'runtimeId', 'releaseId', 'manifestSha256', 'sourceCommit', 'image',
                              'nonce', 'purpose', 'role', 'coordinationDirectory', 'nativeDirectory',
                              'boundaryDirectory', 'gate', 'interlock', 'worker', 'database'])
                and scope['format'] == 'sabalan-online-runtime-scope/v1'
                and isinstance(scope['runtimeId'], str) and re.fullmatch(HASH, scope['runtimeId'])
                and file == '/run/sabalan-online/' + scope['runtimeId'] + '.json'
                and isinstance(scope['releaseId'], str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}', scope['releaseId'])
                and isinstance(scope['manifestSha256'], str) and re.fullmatch(HASH, scope['manifestSha256'])
                and isinstance(scope['nonce'], str) and re.fullmatch(HASH, scope['nonce'])
                and isinstance(scope['sourceCommit'], str) and re.fullmatch(r'[a-f0-9]{40}', scope['sourceCommit'])
                and isinstance(scope['image'], str) and re.fullmatch(r'sha256:' + HASH, scope['image']))
        require(scope['purpose'] in ['http', 'jobs', 'capture']
                and scope['role'] == ('serving' if scope['purpose'] == 'http' else 'control')
                and environment.get('BACKEND_RUNTIME_ROLE') == scope['role'])
        directory = scope['coordinationDirectory']
        private_directory(directory)
        require(environment.get('RECOVERY_COORDINATION_DIR', '/app/recovery-coordination') == directory
                and scope['nativeDirectory'] == directory + '/online/native/' + scope['runtimeId']
                and scope['boundaryDirectory'] == directory + '/online/work/' + scope['runtimeId'])
        for name in ['nativeDirectory', 'boundaryDirectory']:
            private_directory(scope[name])
        named_lock(scope['gate'], directory + '/deployment-write-admission.lock')
        named_lock(scope['interlock'], directory + '/deployment-runtime-control.lock')
        if scope['purpose'] == 'http':
            require(scope['worker'] is None)
        else:
            named_lock(scope['worker'], directory + '/deployment-online-worker.lock')
        require(exact(scope['database'], ['systemIdentifier', 'name'])
                and isinstance(scope['database']['systemIdentifier'], str)
                and re.fullmatch(r'[1-9][0-9]{0,24}', scope['database']['systemIdentifier'])
                and isinstance(scope['database']['name'], str)
                and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', scope['database']['name']))
        require((json.dumps(scope, sort_keys=True, separators=(',', ':')) + '\n').encode('ascii') == data
                and identity(before) == identity(os.fstat(descriptor))
                and identity(before) == identity(os.lstat(file))
                and hashlib.sha256(mount_snapshot()).hexdigest() == mount['mountInfoSha256']
                and os.readlink('/proc/self/ns/mnt') == mount['mountNamespace'])
        helper = Path(__file__)
        require(helper.resolve(strict=True) == helper and helper.stat().st_size <= 131072)
        return dict(scope=scope, file=file, sha256=environment[KEYS[1]], **mount,
                    device=str(before.st_dev), inode=str(before.st_ino), helperSha256=hashlib.sha256(helper.read_bytes()).hexdigest())
    finally:
        os.close(descriptor)


def load_scope(environment):
    if not any(key in environment for key in KEYS):
        return None
    try:
        return _load(environment)
    except Exception:
        raise RuntimeError('ONLINE_RUNTIME_SCOPE_UNPROVEN') from None


if __name__ == '__main__':
    import sys
    try:
        require(len(sys.argv) == 1)
        loaded = load_scope(os.environ)
        require(loaded is not None)
        print(json.dumps(loaded, sort_keys=True, separators=(',', ':')))
    except Exception:
        print('ONLINE_RUNTIME_SCOPE_UNPROVEN', file=sys.stderr)
        sys.exit(75)
