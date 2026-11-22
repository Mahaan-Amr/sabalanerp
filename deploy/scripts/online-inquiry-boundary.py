"""Read-only Inquiry incarnation checks for the owned global census.

The caller holds the real exclusive write gate and checks every work journal.
SQLite identity here is neither a snapshot nor host/image admission. Never
interpret this distinct claim as PostgreSQL descendant/SQL completion.
"""
import hashlib
import os
from pathlib import Path
import re
import stat


def require(value):
    if not value:
        raise RuntimeError('ONLINE_INQUIRY_BOUNDARY_UNPROVEN')


def exact(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def sqlite_identity(database):
    require(exact(database, ['file', 'device', 'inode', 'ownerUid', 'databaseUrlSha256'])
            and isinstance(database['file'], str) and database['file'].startswith('/')
            and all(isinstance(database[key], str) and re.fullmatch(r'[1-9][0-9]{0,24}', database[key]) for key in ['device', 'inode'])
            and type(database['ownerUid']) is int and database['ownerUid'] == os.getuid()
            and isinstance(database['databaseUrlSha256'], str) and re.fullmatch(r'[a-f0-9]{64}', database['databaseUrlSha256']))
    file = Path(database['file'])
    require(str(file) == database['file'] and file.resolve(strict=True) == file)
    parent = file.parent.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.getuid() and not parent.st_mode & 0o022)
    descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        value, named = os.fstat(descriptor), file.lstat()
        identity = lambda item: (item.st_dev, item.st_ino, item.st_uid, item.st_mode, item.st_nlink)
        require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1 and value.st_uid == database['ownerUid']
                and not value.st_mode & 0o022 and str(value.st_dev) == database['device']
                and str(value.st_ino) == database['inode'] and identity(value) == identity(named)
                and os.read(descriptor, 16) == b'SQLite format 3\x00')
        return identity(value)
    finally:
        os.close(descriptor)


def inspect_native(native, raw, loaded, locked, admission, encode):
    scope = loaded['scope']
    base = ['format', 'phase', 'guardian', 'onlineScope', 'onlineLocks', 'sqlite', 'lock', 'commandSha256']
    closing = ['nativeReaped', 'sqliteNativeClosed', 'nativeStatus', 'stoppedBySignal', 'activeClaimSha256']
    require(native.get('phase') in ['ACTIVE', 'QUIESCENT'])
    closed = native['phase'] == 'QUIESCENT'
    require(exact(native, base + (closing if closed else [])) and native['format'] == 'sabalan-inquiry-native/v2'
            and isinstance(native['onlineScope'], dict)
            and all(native['onlineScope'].get(key) == loaded[key] for key in ['scope', 'sha256', 'file', 'device', 'inode', 'helperSha256'])
            and scope['purpose'] == 'http' and scope['role'] == 'serving'
            and scope['worker'] is None
            and native['onlineLocks'] == dict(interlock=dict(scope['interlock'], descriptor=11))
            and exact(native['lock'], ['device', 'inode'])
            and isinstance(native['commandSha256'], str) and re.fullmatch(r'[a-f0-9]{64}', native['commandSha256'])
            and admission.valid_capture(dict(runtimeId=scope['runtimeId'], scopeSha256=loaded['sha256'], guardian=native['guardian'])))
    database_identity = sqlite_identity(native['sqlite'])
    if not closed:
        require(locked)
        return hashlib.sha256(raw).hexdigest(), database_identity
    require(not locked and native['nativeReaped'] is True and native['sqliteNativeClosed'] is True
            and type(native['nativeStatus']) is int and type(native['stoppedBySignal']) is bool)
    birth = native['guardian']
    if (birth['bootId'] == Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            and birth['pidNamespace'] == os.readlink('/proc/self/ns/pid')):
        try:
            fields = Path('/proc/' + str(birth['pid']) + '/stat').read_text().rsplit(') ', 1)[1].split()
        except FileNotFoundError:
            fields = None
        require(fields is None or fields[19] != birth['startTicks'] or fields[0] == 'Z')
    active = {key: value for key, value in native.items() if key not in closing}
    active['phase'] = 'ACTIVE'
    sha = hashlib.sha256(encode(active)).hexdigest()
    require(sha == native['activeClaimSha256'])
    return sha, database_identity


def assert_capture_source(boundary, source):
    """A census of one Inquiry file cannot justify backing up another file."""
    require(exact(source, ['path', 'device', 'inode']))
    for runtime in boundary['runtimes']:
        if runtime.get('engine') == 'sqlite':
            database = runtime['sqlite']
            require(source == dict(path=database['file'], device=database['device'], inode=database['inode']))
