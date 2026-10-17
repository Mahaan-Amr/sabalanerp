#!/usr/bin/env python3
"""Private native-owned PostgreSQL/file/SQLite component capture.

The controller must close and prove all application/worker/Inquiry admission
before acquiring the frozen write gate. This worker inherits that gate and its
native guardian, never creates serving authority, and publishes only a local
component awaiting native closure and independent recovery verification.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import select
import stat
import subprocess
import sys
import time

sys.dont_write_bytecode = True
os.umask(0o077)


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


files = load('file_generations', 'recovery-file-generations.py')
postgres = load('database_freeze', 'recovery-database-freeze.py')


def source_identity(file):
    value = file.lstat()
    return {'device': str(value.st_dev), 'inode': str(value.st_ino)}


def read_scope(file):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        value = os.fstat(fd)
        if (not stat.S_ISREG(value.st_mode) or value.st_uid != os.geteuid()
                or value.st_nlink != 1 or value.st_mode & 0o222 or not 0 < value.st_size <= 262144):
            raise RuntimeError('COHERENT_CAPTURE_SCOPE_UNSAFE')
        raw = os.read(fd, 262145)
        after, named = os.fstat(fd), file.lstat()
        if ((value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                or (value.st_dev, value.st_ino) != (named.st_dev, named.st_ino)):
            raise RuntimeError('COHERENT_CAPTURE_SCOPE_CHANGED')
        os.fsync(fd)
        return json.loads(raw), hashlib.sha256(raw).hexdigest()
    finally:
        os.close(fd)


def run():
    if len(sys.argv) != 2:
        raise RuntimeError('COHERENT_CAPTURE_SCOPE_REQUIRED')
    scope_file = Path(sys.argv[1])
    if not scope_file.is_absolute() or scope_file.resolve(strict=True) != scope_file:
        raise RuntimeError('COHERENT_CAPTURE_SCOPE_UNSAFE')
    scope, scope_sha = read_scope(scope_file)
    if (set(scope) != {'format', 'captureId', 'handshake', 'systemIdentifier', 'databaseName',
                      'storeRoot', 'sources', 'inquiry', 'logicalDump'}
            or scope['format'] != 'sabalan-coherent-capture-scope/v1'
            or not re.fullmatch(r'[a-f0-9]{64}', scope['captureId'])
            or not re.fullmatch(r'[a-f0-9]{64}', scope['handshake'])
            or not re.fullmatch(r'[1-9][0-9]{0,24}', scope['systemIdentifier'])
            or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', scope['databaseName'])
            or not isinstance(scope['logicalDump'], bool)):
        raise RuntimeError('COHERENT_CAPTURE_SCOPE_INVALID')
    work = scope_file.parent
    files.private_directory(str(work))
    if sorted(os.listdir(work)) != [scope_file.name]:
        raise RuntimeError('COHERENT_CAPTURE_ALREADY_ATTEMPTED')
    namespace = postgres.native_capture_namespace(os.environ['DATABASE_URL'], 10)
    native_descriptors = postgres.native_capture_descriptors(os.environ['DATABASE_URL'], 10)
    if namespace is None:
        raise RuntimeError('COHERENT_CAPTURE_NATIVE_OWNER_REQUIRED')
    gate = os.fstat(10)
    store = files.FileGenerations(scope['storeRoot'], 10, gate.st_dev, gate.st_ino)
    fd = os.open(work, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    diagnostic = os.open(work / 'native.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    boundary, completed = None, False
    started = time.monotonic()
    try:
        files.publish_record(fd, 'intent.json', {'format': 'sabalan-coherent-capture-intent/v1',
            'captureId': scope['captureId'], 'scopeSha256': scope_sha,
            'nativeClaimSha256': os.environ['BACKEND_NATIVE_CLAIM_SHA256'], 'namespace': namespace})
        boundary = postgres.DatabaseFreeze(os.environ['DATABASE_URL'], 10, store.assert_gate, diagnostic)
        database = boundary.acquire(scope['systemIdentifier'], scope['databaseName'])
        print(json.dumps({'phase': 'FROZEN', 'handshake': scope['handshake'], 'relations': database['relations']}), flush=True)
        if not select.select([sys.stdin.buffer], [], [], 10)[0]:
            raise RuntimeError('COHERENT_CAPTURE_CONTROLLER_ACK_MISSING')
        acknowledgement = sys.stdin.buffer.readline(1024)
        if json.loads(acknowledgement) != {'phase': 'BEGIN_CAPTURE', 'handshake': scope['handshake']}:
            raise RuntimeError('COHERENT_CAPTURE_CONTROLLER_ACK_INVALID')
        store.assert_owner()
        boundary.assert_frozen()
        inquiry = scope['inquiry']
        if (not isinstance(inquiry, dict) or set(inquiry) != {'path', 'device', 'inode'}
                or not Path(inquiry['path']).is_absolute()
                or str(Path(inquiry['path']).resolve(strict=True)) != inquiry['path']
                or not stat.S_ISREG(Path(inquiry['path']).lstat().st_mode)
                or source_identity(Path(inquiry['path'])) != {key: inquiry[key] for key in ('device', 'inode')}):
            raise RuntimeError('COHERENT_CAPTURE_INQUIRY_SOURCE_CHANGED')
        snapshot_root = work / 'inquiry'
        files.private_directory(str(snapshot_root), create=True)
        snapshot_file = snapshot_root / 'inquiry.db'
        if "'" in str(snapshot_file) or any(ord(char) < 32 for char in str(snapshot_file)):
            raise RuntimeError('COHERENT_CAPTURE_STAGE_PATH_INVALID')
        result = subprocess.run(['sqlite3', '-readonly', inquiry['path'], ".backup '" + str(snapshot_file) + "'"],
                                pass_fds=native_descriptors, stdout=subprocess.PIPE, stderr=diagnostic)
        if result.returncode != 0 or source_identity(Path(inquiry['path'])) != {key: inquiry[key] for key in ('device', 'inode')}:
            raise RuntimeError('COHERENT_CAPTURE_INQUIRY_BACKUP_FAILED')
        check = subprocess.run(['sqlite3', '-readonly', str(snapshot_file), 'PRAGMA integrity_check;'],
                               pass_fds=native_descriptors, stdout=subprocess.PIPE, stderr=diagnostic)
        if check.returncode != 0 or check.stdout.strip() != b'ok':
            raise RuntimeError('COHERENT_CAPTURE_INQUIRY_INTEGRITY_FAILED')
        sqlite_root_identity = source_identity(snapshot_root)
        generation = store.capture(scope['sources'] + [dict(sqlite_root_identity, name='inquiry', path=str(snapshot_root))], scope['captureId'])
        dump_evidence = None
        if scope['logicalDump']:
            rows = boundary.command("SELECT json_build_object('snapshot',pg_export_snapshot())::text;")
            if len(rows) != 1 or not re.fullmatch(r'[0-9A-F]+-[0-9A-F]+-[0-9]+', rows[0]['snapshot']):
                raise RuntimeError('COHERENT_CAPTURE_SQL_SNAPSHOT_UNPROVEN')
            dump_fd = os.open(work / 'main.dump', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                result = subprocess.run(['pg_dump', '-Fc', '--no-owner', '--no-privileges', '--snapshot=' + rows[0]['snapshot']],
                                        env=boundary.environment, pass_fds=native_descriptors, stdout=dump_fd, stderr=diagnostic)
                if result.returncode != 0:
                    raise RuntimeError('COHERENT_CAPTURE_SQL_DUMP_FAILED')
                os.fsync(dump_fd)
            finally:
                os.close(dump_fd)
            digest = hashlib.sha256()
            with (work / 'main.dump').open('rb') as data:
                while chunk := data.read(262144):
                    digest.update(chunk)
            dump_evidence = {'file': 'main.dump', 'bytes': (work / 'main.dump').stat().st_size, 'sha256': digest.hexdigest()}
        point = boundary.restore_point(scope['captureId'][:48])
        boundary.close(commit=True)
        boundary = None
        if read_scope(scope_file)[1] != scope_sha:
            raise RuntimeError('COHERENT_CAPTURE_SCOPE_CHANGED')
        result = {'format': 'sabalan-coherent-component/v1', 'phase': 'CAPTURED_AWAITING_NATIVE_CLOSURE',
                  'captureId': scope['captureId'], 'scopeSha256': scope_sha,
                  'nativeClaimSha256': os.environ['BACKEND_NATIVE_CLAIM_SHA256'],
                  'database': database, 'restorePoint': point, 'fileGenerationSha256': generation['sha256'],
                  'logicalDump': dump_evidence, 'captureBoundaryMs': round((time.monotonic() - started) * 1000),
                  'productionRecoveryPoint': False}
        files.publish_record(fd, 'captured.json', result)
        completed = True
        print(json.dumps({'phase': result['phase'], 'captureId': scope['captureId']}), flush=True)
    finally:
        # The native guardian retains FD9 AND FD10 through every descendant and
        # tagged PostgreSQL backend even if this worker dies or cleanup fails.
        # An intent/failure is never independently healthy or automatically reset.
        if boundary is not None and not boundary.closed:
            boundary.close(commit=False)
        os.close(diagnostic)
        os.close(fd)
    return 0 if completed else 1


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception:
        print('COHERENT_CAPTURE_COMPONENT_UNPROVEN', file=sys.stderr)
        sys.exit(75)
