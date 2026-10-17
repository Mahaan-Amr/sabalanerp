#!/usr/bin/env python3
"""Bounded native WAL stream component, with no slot or publication authority.

The caller must hold this pre-provisioned capture's FD9. Unknown native or SQL
completion retains that lock and ACTIVE evidence. No automatic takeover exists.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import time
from urllib.parse import parse_qsl, unquote, urlsplit


def require(value, code):
    if not value:
        raise RuntimeError(code)


def lsn(value):
    require(isinstance(value, str) and re.fullmatch(r'(0|[1-9A-F][0-9A-F]{0,7})/(0|[1-9A-F][0-9A-F]{0,7})', value), 'WAL_STREAM_LSN_INVALID')
    high, low = value.split('/')
    return (int(high, 16) << 32) | int(low, 16)


def digest(file):
    value = hashlib.sha256()
    with file.open('rb') as source:
        while chunk := source.read(256 * 1024):
            value.update(chunk)
    return value.hexdigest()


def run():
    require(sys.platform == 'linux' and len(sys.argv) == 2, 'WAL_STREAM_LINUX_REQUIRED')
    file = Path(sys.argv[1])
    require(file.is_absolute() and file.resolve(strict=True) == file, 'WAL_STREAM_CONFIGURATION_INVALID')
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1 and value.st_uid == os.getuid()
                and not value.st_mode & 0o022 and 0 < value.st_size <= 32768, 'WAL_STREAM_CONFIGURATION_INVALID')
        encoded = os.read(fd, 32769)
        after = os.fstat(fd)
        require((value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'WAL_STREAM_CONFIGURATION_CHANGED')
        configuration = json.loads(encoded)
    finally:
        os.close(fd)
    root = Path(configuration['root'])
    require(root.is_absolute() and root.resolve(strict=True) == root and file.parent == root, 'WAL_STREAM_ROOT_INVALID')
    value = root.stat()
    require(stat.S_ISDIR(value.st_mode) and value.st_uid == os.getuid() and not value.st_mode & 0o077, 'WAL_STREAM_ROOT_INVALID')
    lock = root / 'receiver.lock'
    inherited, named = os.fstat(9), os.lstat(lock)
    require(stat.S_ISREG(named.st_mode) and named.st_nlink == 1 and named.st_uid == os.getuid()
            and not named.st_mode & 0o022 and lock.resolve(strict=True) == lock
            and (inherited.st_dev, inherited.st_ino) == (named.st_dev, named.st_ino), 'WAL_STREAM_OWNERSHIP_REQUIRED')
    require(any(re.fullmatch(r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                + str(named.st_ino) + r'\s+0\s+EOF\s*', row) for row in Path('/proc/self/fdinfo/9').read_text().splitlines()),
            'WAL_STREAM_OWNERSHIP_REQUIRED')
    namespace = configuration['namespace']
    require(isinstance(namespace, str) and re.fullmatch(r'sabalan-wal-[a-f0-9]{32}', namespace), 'WAL_STREAM_NAMESPACE_INVALID')
    replication_user = configuration['replicationUser']
    require(isinstance(replication_user, str) and re.fullmatch(r'sabalan_wal_[a-f0-9]{32}', replication_user), 'WAL_STREAM_REPLICATION_USER_REQUIRED')
    secret_file = root / 'replication-password'
    secret_fd = os.open(secret_file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        value = os.fstat(secret_fd)
        require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1 and value.st_uid == os.getuid()
                and not value.st_mode & 0o077 and value.st_size == 64, 'WAL_STREAM_REPLICATION_SECRET_INVALID')
        replication_password = os.read(secret_fd, 65).decode('ascii')
        require(re.fullmatch(r'[a-f0-9]{64}', replication_password), 'WAL_STREAM_REPLICATION_SECRET_INVALID')
    finally:
        os.close(secret_fd)
    segment = configuration['segmentBytes']; timeline = configuration['timeline']
    start, end = lsn(configuration['startLsn']), lsn(configuration['endLsn'])
    require(isinstance(segment, int) and 1024 ** 2 <= segment <= 1024 ** 3 and segment & (segment - 1) == 0
            and isinstance(timeline, int) and 0 < timeline <= 0xffffffff
            and start < end and end % segment == 0 and 1 <= (end - 1) // segment - start // segment + 1 <= 8,
            'WAL_STREAM_RANGE_INVALID')
    maximum_bytes = ((end - 1) // segment - start // segment + 2) * segment
    require(shutil.disk_usage(root).free >= maximum_bytes + 512 * 1024 ** 2, 'WAL_STREAM_CAPACITY_REQUIRED')
    source = urlsplit(os.environ['DATABASE_URL']); query = parse_qsl(source.query, keep_blank_values=True)
    require(source.scheme in ['postgres', 'postgresql'] and source.hostname and not source.fragment
            and unquote(source.path[1:]) == configuration['databaseName']
            and all(key in ['schema', 'application_name', 'connection_limit', 'pool_timeout'] for key, _ in query), 'WAL_STREAM_DATABASE_URL_INVALID')
    for key in ['connection_limit', 'pool_timeout']:
        values = [item for name, item in query if name == key]
        require(len(values) == 1 and values[0].isdigit() and 0 < int(values[0]) <= 120, 'WAL_STREAM_POOL_BOUNDS_REQUIRED')
    environment = {key: item for key, item in os.environ.items() if not key.startswith('PG')}
    environment.update(PGHOST=source.hostname, PGPORT=str(source.port or 5432), PGUSER=unquote(source.username or ''),
                       PGPASSWORD=unquote(source.password or ''), PGDATABASE=configuration['databaseName'], PGCONNECT_TIMEOUT='5')
    observer_environment = dict(environment, PGAPPNAME='sabalan-wal-observer', PGOPTIONS='-c statement_timeout=5000 -c lock_timeout=250')
    query_sql = """SELECT json_build_object('databaseName',current_database(),'databaseOid',d.oid::text,
      'systemIdentifier',c.system_identifier::text,'timeline',(pg_control_checkpoint()).timeline_id,
      'segmentBytes',pg_size_bytes(current_setting('wal_segment_size')),'version',current_setting('server_version_num'),
      'currentLsn',pg_current_wal_insert_lsn(),
      'visible',r.rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'),
      'sessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name='""" + namespace + """'),
      'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()))
      FROM pg_database d CROSS JOIN pg_control_system() c CROSS JOIN pg_roles r
      WHERE d.datname=current_database() AND r.rolname=current_user"""

    def profile():
        result = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', query_sql],
                                env=observer_environment, stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
        require(result.returncode == 0 and len(result.stdout) < 16384, 'WAL_STREAM_OBSERVATION_FAILED')
        result = json.loads(result.stdout)
        require(result['visible'] is True and 150000 <= int(result['version']) < 160000
                and all(result[key] == configuration[key] for key in ['databaseName', 'databaseOid', 'systemIdentifier', 'timeline', 'segmentBytes']),
                'WAL_STREAM_SOURCE_IDENTITY_CHANGED')
        return result

    before = profile()
    require(before['sessions'] == 0 and before['prepared'] == 0
            and start // segment == lsn(before['currentLsn']) // segment, 'WAL_STREAM_START_UNPROVEN')
    binary = Path('/usr/lib/postgresql/15/bin/pg_receivewal')
    require(binary.resolve(strict=True) == binary, 'WAL_STREAM_NATIVE_BINARY_REQUIRED')
    with binary.open('rb') as stream:
        require(stream.read(4) == b'\x7fELF', 'WAL_STREAM_NATIVE_BINARY_REQUIRED')
    require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, 'WAL_STREAM_SUBREAPER_REQUIRED')
    wal = root / 'wal'; wal.mkdir(mode=0o700)
    state_file = root / 'capture-state.json'
    active = dict(phase='ACTIVE', namespace=namespace, configurationSha256=hashlib.sha256(encoded).hexdigest(),
                  source=before, pid=os.getpid(), bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                  pidNamespace=os.readlink('/proc/self/ns/pid'), startTicks=Path('/proc/self/stat').read_text().split(') ', 1)[1].split()[19])
    state_bytes = (json.dumps(active, sort_keys=True) + '\n').encode()
    fd = os.open(state_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        require(os.write(fd, state_bytes) == len(state_bytes), 'WAL_STREAM_STATE_WRITE_FAILED'); os.fsync(fd)
        state_identity = (os.fstat(fd).st_dev, os.fstat(fd).st_ino)
    finally:
        os.close(fd)
    directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW); os.fsync(directory_fd)
    closure_proven = False
    try:
        cancelled = False

        def cancel(_number, _frame):
            nonlocal cancelled
            cancelled = True

        for number in [signal.SIGINT, signal.SIGTERM, signal.SIGHUP, signal.SIGPIPE]:
            signal.signal(number, cancel)
        environment.update(PGAPPNAME=namespace, PGUSER=replication_user, PGPASSWORD=replication_password)
        with (root / 'receiver-native.log').open('xb') as log:
            os.chmod(log.name, 0o600)
            process = subprocess.Popen([str(binary), '--directory=' + str(wal), '--endpos=' + configuration['endLsn'],
                                        '--no-password', '--no-loop', '--synchronous', '--status-interval=1'],
                                       env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=log, pass_fds=(9,))
            root_pid, root_status, deadline, stopping = process.pid, None, time.monotonic() + 840, None
            failed = False
            while True:
                try:
                    pid, status = os.waitpid(-1, os.WNOHANG)
                except ChildProcessError:
                    break
                if pid:
                    if pid == root_pid:
                        root_status = os.waitstatus_to_exitcode(status); process.returncode = root_status
                    continue
                if cancelled or time.monotonic() >= deadline or root_status is not None \
                        or shutil.disk_usage(root).free < 256 * 1024 ** 2:
                    failed = True
                    if stopping is None: stopping = time.monotonic()
                    for raw in Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text().split():
                        owned = int(raw); seen, status = os.waitpid(owned, os.WNOHANG)
                        if seen:
                            if seen == root_pid:
                                root_status = os.waitstatus_to_exitcode(status); process.returncode = root_status
                        else:
                            try:
                                os.kill(owned, signal.SIGTERM if time.monotonic() - stopping < 10 else signal.SIGKILL)
                            except ProcessLookupError:
                                pass
                time.sleep(0.02)
            require(root_status is not None, 'WAL_STREAM_NATIVE_COMPLETION_UNPROVEN')
            log.flush(); os.fsync(log.fileno())
        while True:
            after = profile()
            if after['sessions'] == 0 and after['prepared'] == 0: break
            time.sleep(0.05)
        require((state_file.stat().st_dev, state_file.stat().st_ino) == state_identity
                and state_file.read_bytes() == state_bytes, 'WAL_STREAM_STATE_CHANGED')
        closure_proven = True
        require(root_status == 0 and not failed and not cancelled, 'WAL_STREAM_NATIVE_FAILED')
        segments = []
        for index in range(start // segment, end // segment):
            per_log = 0x100000000 // segment
            name = f'{timeline:08X}{index // per_log:08X}{index % per_log:08X}'
            item = wal / name; observed = item.lstat()
            require(stat.S_ISREG(observed.st_mode) and observed.st_nlink == 1 and observed.st_uid == os.getuid()
                    and not observed.st_mode & 0o077 and observed.st_size == segment, 'WAL_STREAM_COMPLETE_SEGMENT_REQUIRED')
            with item.open('rb') as stream: os.fsync(stream.fileno())
            fingerprint = digest(item); final = item.lstat()
            require((observed.st_dev, observed.st_ino, observed.st_size, observed.st_mtime_ns, observed.st_ctime_ns) ==
                    (final.st_dev, final.st_ino, final.st_size, final.st_mtime_ns, final.st_ctime_ns), 'WAL_STREAM_SEGMENT_CHANGED')
            segments.append(dict(name=name, bytes=segment, sha256=fingerprint))
        wal_fd = os.open(wal, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(wal_fd)
        finally: os.close(wal_fd)
        result = dict(phase='COMPLETE', namespace=namespace, source=before,
                      startLsn=configuration['startLsn'], endLsn=configuration['endLsn'], segments=segments,
                      nativeReaped=True, databaseQuiet=True, nativeStatus=root_status,
                      configurationSha256=hashlib.sha256(encoded).hexdigest(), nativeLogSha256=digest(root / 'receiver-native.log'))
        temporary = root / 'capture-complete.json'
        with temporary.open('x') as stream:
            os.chmod(temporary, 0o600); json.dump(result, stream, sort_keys=True); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, state_file); os.fsync(directory_fd)
        print(json.dumps(result), flush=True)
        return 0
    except BaseException:
        if closure_proven:
            try:
                failed_state = dict(phase='FAILED', namespace=namespace, nativeReaped=True, databaseQuiet=True,
                                    nativeStatus=root_status, source=before, configurationSha256=hashlib.sha256(encoded).hexdigest())
                temporary = root / 'capture-failed.json'
                with temporary.open('x') as stream:
                    os.chmod(temporary, 0o600); json.dump(failed_state, stream, sort_keys=True); stream.flush(); os.fsync(stream.fileno())
                os.replace(temporary, state_file); os.fsync(directory_fd)
                print('WAL_STREAM_COMPONENT_FAILED', file=sys.stderr)
                return 1
            except BaseException:
                pass
        try: os.write(2, b'WAL_STREAM_COMPLETION_UNPROVEN\n')
        finally:
            while True: signal.pause()
    finally:
        os.close(directory_fd)


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception:
        print('WAL_STREAM_PRECONDITION_FAILED', file=sys.stderr)
        sys.exit(1)
