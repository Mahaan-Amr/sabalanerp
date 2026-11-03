"""Read-only conservation of one pinned local original, never ledger admission."""
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys


def require(value, code):
    if not value:
        raise RuntimeError(code)


def snapshot(file):
    file = Path(file)
    require(file.is_absolute() and file.resolve(strict=True) == file, 'ORIGINAL_PATH_UNSAFE')
    before = file.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, 'ORIGINAL_FILE_UNSAFE')
    descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(descriptor)
        fields = ('st_dev', 'st_ino', 'st_size', 'st_mode', 'st_uid', 'st_gid', 'st_mtime_ns', 'st_ctime_ns')
        require(all(getattr(before, k) == getattr(opened, k) for k in fields), 'ORIGINAL_REPLACED')
        digest = hashlib.sha256()
        while part := os.read(descriptor, 1024 * 1024):
            digest.update(part)
        require(all(getattr(before, k) == getattr(os.fstat(descriptor), k) == getattr(file.lstat(), k)
                    for k in fields), 'ORIGINAL_CHANGED')
    finally:
        os.close(descriptor)
    require(all(not os.path.lexists(str(file) + suffix) for suffix in ('-wal', '-shm', '-journal')),
            'ORIGINAL_SIDECAR_PRESENT')
    return dict(device=str(before.st_dev), inode=str(before.st_ino), size=str(before.st_size),
                mode=str(before.st_mode), uid=str(before.st_uid), gid=str(before.st_gid),
                mtimeNs=str(before.st_mtime_ns), ctimeNs=str(before.st_ctime_ns), sha256=digest.hexdigest())


def readonly_mount(file):
    # A conservation receipt detects changes; the mount must also prevent writes.
    require(bool(os.statvfs(file).f_flag & os.ST_RDONLY), 'ORIGINAL_MOUNT_WRITABLE')
    def unescape(value):
        return re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), value)
    rows = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        fields = line.split(' - ')[0].split()
        rows.append(dict(device=fields[2], root=unescape(fields[3]),
                         point=unescape(fields[4]), options=fields[5].split(',')))
    covers = lambda parent, child: child == parent or child.startswith(parent.rstrip('/') + '/')
    covering = [r for r in rows if covers(r['point'], str(file))]
    require(bool(covering), 'ORIGINAL_MOUNT_UNPROVEN')
    mount = max(covering, key=lambda r: len(r['point']))
    require('ro' in mount['options'], 'ORIGINAL_MOUNT_WRITABLE')
    for row in rows:
        if row['device'] == mount['device'] and (covers(row['root'], mount['root']) or covers(mount['root'], row['root'])):
            require('ro' in row['options'], 'ORIGINAL_WRITABLE_ALIAS')


def verify(file, contract, baseline):
    require(set(contract) == {'format', 'role', 'original', 'baselineSha256'}, 'CONSERVATION_CONTRACT_INVALID')
    require(contract['format'] == 'sabalan-local-inquiry-conservation/v1'
            and contract['role'] == 'CARRIER_READY_NOT_SERVING', 'CONSERVATION_CONTRACT_INVALID')
    raw = Path(baseline).read_bytes()
    require(hashlib.sha256(raw).hexdigest() == contract['baselineSha256'], 'BASELINE_BYTES_CHANGED')
    expected = json.loads(raw)
    before = snapshot(file)
    require(before == contract['original'], 'ORIGINAL_SNAPSHOT_CHANGED')
    readonly_mount(file)
    database = sqlite3.connect(Path(file).as_uri() + '?mode=ro&immutable=1', uri=True)
    try:
        database.execute('PRAGMA query_only=ON')
        require(database.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'ORIGINAL_INTEGRITY_FAILED')
        objects = [dict(zip(('type', 'name', 'table', 'sql'), row)) for row in database.execute(
            "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'")]
        def canonical(rows):
            return sorted([{**r, 'sql': re.sub(r'\s*([(),])\s*', r'\1',
                           re.sub(r'\s+', ' ', r['sql']).strip().removesuffix(';'))} for r in rows],
                          key=lambda r: r['type'] + ':' + r['name'])
        # This local role preserves exactly the pre-adoption business schema.
        # It never accepts an absent/corrupt ledger as canonical migration proof.
        require(canonical(objects) == canonical(expected['objects']), 'ORIGINAL_SCHEMA_CHANGED')
        require(database.execute('SELECT count(*) FROM Admin').fetchone()[0] > 0, 'ORIGINAL_ADMIN_ABSENT')
    finally:
        database.close()
    require(snapshot(file) == before, 'ORIGINAL_CHANGED')
    return dict(format='sabalan-local-inquiry-conservation-observation/v1',
                phase='CARRIER_READY_NOT_SERVING', canonicalDatabaseAdmitted=False,
                maintenanceReady=True, applicationReady=False, runtimeAccepted=False,
                applicationHealthy=False, originalUnchanged=True)


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 4 and sys.platform == 'linux', 'CONSERVATION_ARGUMENTS_INVALID')
        print(json.dumps(verify(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_bytes()), Path(sys.argv[3]))))
    except Exception:
        print('INQUIRY_CONSERVATION_FAILED', file=sys.stderr)
        sys.exit(1)
