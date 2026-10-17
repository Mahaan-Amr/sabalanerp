#!/usr/bin/env python3
"""Retain native control ownership through descendant AND PostgreSQL completion.

No expiry, process-name lookup, SQL cancellation, forced termination or reset.
If the container itself dies, ACTIVE refuses a replacement before application
construction. A normal code rollback never restores an earlier database here.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import subprocess
import sys
import time
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit

sys.dont_write_bytecode = True


def require(value):
    if not value:
        raise RuntimeError('RUNTIME_NATIVE_AUTHORITY_UNPROVEN')


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def read_state(file):
    try:
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None, None
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
                and not before.st_mode & 0o077 and 0 < before.st_size <= 16384)
        raw = os.read(fd, 16385)
        after, named = os.fstat(fd), os.lstat(file)
        require(len(raw) <= 16384 and
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                and (before.st_dev, before.st_ino) == (named.st_dev, named.st_ino))
        return json.loads(raw), raw
    finally:
        os.close(fd)


def write_exclusive(file, raw):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        written = 0
        while written < len(raw):
            count = os.write(fd, raw[written:])
            require(count > 0)
            written += count
        os.fsync(fd)
    finally:
        os.close(fd)


def assert_closed(directory):
    previous, raw = read_state(directory / 'deployment-runtime-native.json')
    if previous is None:
        return None, None
    require(previous.get('format') == 'sabalan-runtime-native/v1' and previous.get('phase') == 'QUIESCENT'
            and previous.get('nativeReaped') is True and previous.get('databaseQuiet') is True
            and re.fullmatch(r'[a-f0-9]{48}', previous.get('instanceId', ''))
            and previous.get('namespace') == 'sabalan-rt-' + previous['instanceId']
            and re.fullmatch(r'[1-9][0-9]*', previous.get('clusterIdentifier', '')))
    birth = previous['guardian']
    require(isinstance(birth['pid'], int) and birth['pid'] > 0
            and re.fullmatch(r'[1-9][0-9]*', birth['startTicks']))
    if (birth['bootId'] == Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            and birth['pidNamespace'] == os.readlink('/proc/self/ns/pid')):
        try:
            fields = Path('/proc/' + str(birth['pid']) + '/stat').read_text().rsplit(') ', 1)[1].split()
        except FileNotFoundError:
            fields = None
        require(fields is None or fields[19] != birth['startTicks'] or fields[0] == 'Z')
    return previous, raw


def assert_control_lock(directory):
    require(os.environ.get('BACKEND_CONTROL_LOCK_FD') == '9')
    require(directory.is_absolute() and directory.resolve(strict=True) == directory)
    parent = directory.lstat()
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.getuid() and not parent.st_mode & 0o022)
    lock = directory / 'deployment-runtime-control.lock'
    inherited, named = os.fstat(9), lock.lstat()
    require(os.environ.get('BACKEND_CONTROL_LOCK_FILE') == str(lock) and lock.resolve(strict=True) == lock
            and stat.S_ISREG(named.st_mode) and named.st_nlink == 1 and named.st_uid == os.getuid()
            and not named.st_mode & 0o022 and (inherited.st_dev, inherited.st_ino) == (named.st_dev, named.st_ino))
    require(any(re.fullmatch(r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                            + str(named.st_ino) + r'\s+0\s+EOF\s*', line)
                for line in Path('/proc/self/fdinfo/9').read_text().splitlines()))
    return named


def assert_capture_gate():
    keys = ['BACKEND_CAPTURE_GATE_FD', 'BACKEND_CAPTURE_GATE_FILE',
            'BACKEND_CAPTURE_GATE_DEVICE', 'BACKEND_CAPTURE_GATE_INODE']
    if not any(key in os.environ for key in keys):
        return None
    require(all(os.environ.get(key) for key in keys)
            and os.environ.get('BACKEND_RUNTIME_ROLE') == 'control'
            and os.environ['BACKEND_CAPTURE_GATE_FD'] == '10')
    file = Path(os.environ['BACKEND_CAPTURE_GATE_FILE'])
    require(file.is_absolute() and file.name == 'deployment-write-admission.lock'
            and file.resolve(strict=True) == file)
    parent, named, inherited = file.parent.lstat(), file.lstat(), os.fstat(10)
    require(stat.S_ISDIR(parent.st_mode) and parent.st_uid == os.getuid() and not parent.st_mode & 0o022
            and stat.S_ISREG(named.st_mode) and named.st_uid == os.getuid() and not named.st_mode & 0o022
            and named.st_nlink == 1 and named.st_size == 0
            and (named.st_dev, named.st_ino) == (inherited.st_dev, inherited.st_ino)
            and str(named.st_dev) == os.environ['BACKEND_CAPTURE_GATE_DEVICE']
            and str(named.st_ino) == os.environ['BACKEND_CAPTURE_GATE_INODE'])
    require(any(re.fullmatch(r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                            + str(named.st_ino) + r'\s+0\s+EOF\s*', line)
                for line in Path('/proc/self/fdinfo/10').read_text().splitlines()))
    return dict(file=str(file), device=str(named.st_dev), inode=str(named.st_ino), descriptor=10)


def run():
    require(sys.platform == 'linux' and len(sys.argv) > 1)
    directory = Path(os.environ.get('RECOVERY_COORDINATION_DIR', '/app/recovery-coordination'))
    named = assert_control_lock(directory)
    if sys.argv[1:] == ['--assert-closed']:
        assert_closed(directory)
        return 0
    role = os.environ.get('BACKEND_RUNTIME_ROLE', 'standalone')
    require(role in ['standalone', 'control'])
    capture_gate = assert_capture_gate()
    file = directory / 'deployment-runtime-native.json'
    previous, previous_raw = assert_closed(directory)
    require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0)  # PR_SET_CHILD_SUBREAPER
    source = urlsplit(os.environ['DATABASE_URL'])
    query = parse_qsl(source.query, keep_blank_values=True)
    require(source.scheme in ['postgres', 'postgresql'] and source.hostname and len(source.path) > 1
            and source.username and not source.fragment
            and all(key in ['schema', 'connection_limit', 'pool_timeout', 'application_name'] for key, _ in query))
    for key, maximum in [('connection_limit', 128), ('pool_timeout', 120)]:
        values = [value for name, value in query if name == key]
        require(len(values) == 1 and re.fullmatch(r'[1-9][0-9]*', values[0]) and int(values[0]) <= maximum)
    require(len([value for name, value in query if name == 'application_name']) <= 1)
    instance_id = secrets.token_hex(24)
    namespace = 'sabalan-rt-' + instance_id  # 59 bytes, below PostgreSQL's 63-byte limit.
    child_env = dict(os.environ)
    # Native recovery tools inherit the same namespace even when constructing
    # host/dbname arguments instead of passing the Prisma URI. Do not allow a
    # pre-existing PGOPTIONS/PGSERVICE to silently replace connection identity.
    for key in list(child_env):
        if key.startswith('PG'):
            del child_env[key]
    child_env['PGAPPNAME'] = namespace
    child_env['DATABASE_URL'] = urlunsplit((source.scheme, source.netloc, source.path,
        urlencode([(key, value) for key, value in query if key != 'application_name'] + [('application_name', namespace)]), ''))
    # Observe the entire cluster. System Recovery deliberately renames databases;
    # namespace-scoped work must remain visible through that rename, including
    # commands still executing against the former database after client death.
    pg_env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    pg_env.update(PGHOST=source.hostname, PGPORT=str(source.port or 5432), PGDATABASE='postgres',
                  PGUSER=unquote(source.username or ''), PGPASSWORD=unquote(source.password or ''),
                  PGAPPNAME='sabalan-native-runtime-observer', PGCONNECT_TIMEOUT='5',
                  PGOPTIONS='-c statement_timeout=5000 -c lock_timeout=250 -c default_transaction_read_only=on')
    requested_database = unquote(source.path[1:])
    database_literal = requested_database.replace("'", "''")
    sql = """SELECT json_build_object('system',c.system_identifier::text,
      'visible',r.rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'),
      'sourceOid',(SELECT oid::text FROM pg_database WHERE datname='""" + database_literal + """'),
      'sessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name='""" + namespace + """'),
      'prepared',(SELECT count(*) FROM pg_prepared_xacts))
      FROM pg_control_system() c CROSS JOIN pg_roles r WHERE r.rolname=current_user"""

    def observation():
        value = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                               env=pg_env, stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
        require(value.returncode == 0 and len(value.stdout) < 16384)
        result = json.loads(value.stdout)
        require(result['visible'] is True and re.fullmatch(r'[1-9][0-9]*', result['system'])
                and isinstance(result['sessions'], int) and result['sessions'] >= 0
                and isinstance(result['prepared'], int) and result['prepared'] >= 0)
        return result

    initial = observation()
    # The protected preflight deliberately repairs an interrupted database
    # rename before the application pool opens. The current name may briefly
    # be absent; native ownership and observation remain bound to this cluster.
    require(initial['sessions'] == 0 and initial['prepared'] == 0)
    if previous is not None:
        require(previous.get('clusterIdentifier') == initial['system'])
        # The persisted native closure is necessary, never a substitute for a
        # fresh SQL observation before reusing control after a prior runtime.
        old_sql = sql.replace(namespace, previous['namespace'])
        old = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', old_sql],
                             env=pg_env, stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
        require(old.returncode == 0 and len(old.stdout) < 16384)
        old_work = json.loads(old.stdout)
        require(old_work['visible'] is True and old_work['system'] == initial['system']
                and old_work['sessions'] == 0 and old_work['prepared'] == 0)
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    previous_sha = hashlib.sha256(previous_raw).hexdigest() if previous_raw else None
    if previous_raw:
        history = directory / 'deployment-runtime-history'
        try:
            history.mkdir(mode=0o700)
        except FileExistsError:
            pass
        value = history.lstat()
        require(history.resolve(strict=True) == history and stat.S_ISDIR(value.st_mode)
                and value.st_uid == os.getuid() and not value.st_mode & 0o077)
        archived = history / (previous_sha + '.json')
        try:
            write_exclusive(archived, previous_raw)
        except FileExistsError:
            require(read_state(archived)[1] == previous_raw)
        archive_fd = os.open(history, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(archive_fd)
        finally:
            os.close(archive_fd)
    record = dict(format='sabalan-runtime-native/v1', phase='ACTIVE', role=role, instanceId=instance_id,
                  namespace=namespace, clusterIdentifier=initial['system'],
                  initialDatabase=dict(name=requested_database, oid=initial['sourceOid']),
                  connection=dict(host=source.hostname, port=source.port or 5432, user=unquote(source.username)),
                  guardian=dict(pid=os.getpid(), bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                    pidNamespace=os.readlink('/proc/self/ns/pid'),
                    startTicks=Path('/proc/self/stat').read_text().rsplit(') ', 1)[1].split()[19]),
                  lock=dict(device=str(named.st_dev), inode=str(named.st_ino)), previousSha256=previous_sha,
                  commandSha256=hashlib.sha256(encode(sys.argv[1:])).hexdigest())
    active = encode(record)
    if capture_gate is not None:
        record['captureGate'] = capture_gate
        active = encode(record)
    temporary = directory / ('deployment-runtime-native.' + instance_id + '.tmp')
    write_exclusive(temporary, active)
    # From the first attempted ACTIVE publication onward every uncertainty is a
    # retained native hold, even if a directory sync or later logging fails.
    try:
        require(read_state(file)[1] == previous_raw)
        os.replace(temporary, file)
        os.fsync(directory_fd)
        active_stat = file.lstat()
        cancelled = False

        def cancel(_number, _frame):
            nonlocal cancelled
            cancelled = True

        for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGPIPE]:
            signal.signal(number, cancel)
        child_env.update(BACKEND_NATIVE_POSTGRES_APPLICATION_NAME=namespace,
                         BACKEND_NATIVE_AUTHORITY_FILE=str(file),
                         BACKEND_NATIVE_CLAIM_SHA256=hashlib.sha256(active).hexdigest())
        child = subprocess.Popen(sys.argv[1:], env=child_env, pass_fds=(9, 10) if capture_gate else (9,))
        root_pid, root_status, signalled = child.pid, None, set()
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                break
            if pid:
                if pid == root_pid:
                    root_status = os.waitstatus_to_exitcode(status)
                    child.returncode = root_status
                continue
            if cancelled:
                for raw in Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text().split():
                    owned = int(raw)
                    if owned in signalled:
                        continue
                    # The child is still unreaped: its PID cannot be reused.
                    seen, status = os.waitpid(owned, os.WNOHANG)
                    if seen:
                        if seen == root_pid:
                            root_status = os.waitstatus_to_exitcode(status)
                            child.returncode = root_status
                    else:
                        try:
                            os.kill(owned, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        signalled.add(owned)
            time.sleep(0.01)
        require(root_status is not None)
        while True:
            current = observation()
            require(current['system'] == initial['system'])
            if current['sessions'] == 0 and current['prepared'] == 0:
                break
            time.sleep(0.05)
        require(read_state(file)[1] == active)
        require(assert_capture_gate() == capture_gate)
        current_stat = file.lstat()
        require((current_stat.st_dev, current_stat.st_ino) == (active_stat.st_dev, active_stat.st_ino))
        record.update(phase='QUIESCENT', nativeReaped=True, databaseQuiet=True, nativeStatus=root_status,
                      stoppedBySignal=cancelled)
        write_exclusive(temporary, encode(record))
        os.replace(temporary, file)
        os.fsync(directory_fd)
        return root_status if 0 <= root_status <= 125 else 125
    except BaseException:
        try:
            os.write(2, b'RUNTIME_NATIVE_COMPLETION_UNPROVEN\n')
        finally:
            # Do not release FD9 on unproven completion or forward another
            # signal into guessed work. The durable ACTIVE record also stays.
            for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGPIPE]:
                signal.signal(number, lambda _number, _frame: None)
            while True:
                signal.pause()
    finally:
        os.close(directory_fd)


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception:
        print('RUNTIME_NATIVE_AUTHORITY_UNPROVEN', file=sys.stderr)
        sys.exit(75)
