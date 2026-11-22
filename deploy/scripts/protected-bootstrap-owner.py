#!/usr/bin/env python3
"""Own native descendants AND uncertain PostgreSQL work through completion.

An ACTIVE durable record also blocks a replacement after whole-container death.
There is deliberately no expiry, forced takeover, SQL termination, or reset.
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit
from importlib.machinery import SourceFileLoader

sys.dont_write_bytecode = True
state_api = SourceFileLoader('bootstrap_state', str(Path(__file__).with_name('protected-bootstrap-state.py'))).load_module()


def require(value):
    if not value:
        raise RuntimeError('BOOTSTRAP_NATIVE_AUTHORITY_UNPROVEN')


def run():
    require(sys.platform == 'linux' and len(sys.argv) == 4)
    directory = Path(os.environ['RECOVERY_COORDINATION_DIR'])
    lock = Path(os.environ['BACKEND_CONTROL_LOCK_FILE'])
    inherited, named = os.fstat(9), lock.stat()
    require(lock.resolve(strict=True) == lock and stat.S_ISREG(named.st_mode) and named.st_nlink == 1
            and named.st_uid == os.getuid() and not named.st_mode & 0o022
            and (inherited.st_dev, inherited.st_ino) == (named.st_dev, named.st_ino))
    require(any(re.fullmatch(r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                            + str(named.st_ino) + r'\s+0\s+EOF\s*', line)
                for line in Path('/proc/self/fdinfo/9').read_text().splitlines()))
    require(os.environ.get('DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP') == 'true')
    owner = json.loads(os.environ['SABALAN_BOOTSTRAP_OWNER_JSON'])
    require(all(isinstance(owner.get(key), str) and 0 < len(owner[key]) <= 256
                for key in ['deploymentId', 'releaseId', 'leaseToken']))
    state_api.assert_quiescent(directory)
    # A previous attempt is retained for inspection, never overwritten/reused.
    require(state_api.read_state(directory) is None)
    require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0)  # PR_SET_CHILD_SUBREAPER
    source = urlsplit(os.environ['DATABASE_URL'])
    query = parse_qsl(source.query, keep_blank_values=True)
    require(source.scheme in ['postgres', 'postgresql'] and source.hostname and source.path.startswith('/')
            and not source.fragment and not any(key == 'options' for key, _ in query))
    for key in ['connection_limit', 'pool_timeout']:
        values = [value for name, value in query if name == key]
        require(len(values) == 1 and values[0].isdigit() and 0 < int(values[0]) <= 120)
    require(len([value for name, value in query if name == 'application_name']) <= 1)
    namespace = 'sabalan-bootstrap-' + hashlib.sha256(json.dumps(owner, sort_keys=True).encode()).hexdigest()[:32]
    child_env = dict(os.environ)
    child_env['DATABASE_URL'] = urlunsplit((source.scheme, source.netloc, source.path,
        urlencode([(key, value) for key, value in query if key != 'application_name'] + [('application_name', namespace)]), ''))
    pg_env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    pg_env.update(PGHOST=source.hostname, PGPORT=str(source.port or 5432), PGDATABASE=unquote(source.path[1:]),
                  PGUSER=unquote(source.username or ''), PGPASSWORD=unquote(source.password or ''),
                  PGAPPNAME='sabalan-bootstrap-observer', PGCONNECT_TIMEOUT='5',
                  PGOPTIONS='-c statement_timeout=5000 -c lock_timeout=250')
    query_sql = """SELECT json_build_object('database',current_database(),'oid',d.oid::text,'system',c.system_identifier::text,
      'visible',r.rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'),
      'sessions',(SELECT count(*) FROM pg_stat_activity WHERE datid=d.oid AND application_name='""" + namespace + """'),
      'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()))
      FROM pg_database d CROSS JOIN pg_control_system() c CROSS JOIN pg_roles r
      WHERE d.datname=current_database() AND r.rolname=current_user"""

    def observation():
        value = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', query_sql],
                               env=pg_env, stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
        require(value.returncode == 0 and len(value.stdout) < 16384)
        result = json.loads(value.stdout)
        require(result['visible'] is True and result['database'] == pg_env['PGDATABASE'])
        return result

    initial = observation()
    require(initial['sessions'] == 0 and initial['prepared'] == 0)
    file = directory / 'deployment-bootstrap-native.json'
    record = dict(format='sabalan-bootstrap-native/v1', phase='ACTIVE', deploymentId=owner['deploymentId'],
                  releaseId=owner['releaseId'], namespace=namespace, identity={key: initial[key] for key in ['database', 'oid', 'system']},
                  pid=os.getpid(), bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                  pidNamespace=os.readlink('/proc/self/ns/pid'), startTicks=Path('/proc/self/stat').read_text().split(') ', 1)[1].split()[19])
    active = (json.dumps(record, sort_keys=True) + '\n').encode()
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        require(os.write(fd, active) == len(active)); os.fsync(fd)
        active_identity = (os.fstat(fd).st_dev, os.fstat(fd).st_ino)
    finally:
        os.close(fd)
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    os.fsync(directory_fd)
    # After ACTIVE publication every uncertainty retains both the native lock
    # and durable refusal. Even logging failure must not release ownership.
    try:
        cancelled = False

        def cancel(_number, _frame):
            nonlocal cancelled
            cancelled = True

        for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGPIPE]:
            signal.signal(number, cancel)
        child = subprocess.Popen([sys.argv[1], sys.argv[2], 'migrate', 'deploy', '--schema', sys.argv[3]],
                                 env=child_env, stdin=subprocess.DEVNULL, pass_fds=(9,))
        root_pid, root_status, deadline = child.pid, None, time.monotonic() + 840
        failed = False
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
            if cancelled or time.monotonic() >= deadline or root_status is not None:
                failed = True
                for raw in Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text().split():
                    owned = int(raw)
                    # An unreaped direct child cannot have its PID reused.
                    seen, status = os.waitpid(owned, os.WNOHANG)
                    if seen:
                        if seen == root_pid:
                            root_status = os.waitstatus_to_exitcode(status); child.returncode = root_status
                    else:
                        try:
                            os.kill(owned, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
            time.sleep(0.01)
        require(root_status is not None)
        # Reaped engine processes can leave PostgreSQL executing a command.
        # Fresh SQL observations continue under FD9; timeout is never takeover.
        while True:
            current = observation()
            require(all(current[key] == initial[key] for key in ['database', 'oid', 'system']))
            if current['sessions'] == 0 and current['prepared'] == 0:
                break
            time.sleep(0.05)
        require(state_api.read_state(directory) == json.loads(active))
        current_stat = os.lstat(file)
        require((current_stat.st_dev, current_stat.st_ino) == active_identity)
        record.update(phase='QUIESCENT', nativeReaped=True, databaseQuiet=True,
                      nativeStatus=root_status, failed=failed)
        temporary = directory / ('deployment-bootstrap-native.' + str(os.getpid()) + '.tmp')
        out = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            data = (json.dumps(record, sort_keys=True) + '\n').encode()
            require(os.write(out, data) == len(data)); os.fsync(out)
        finally:
            os.close(out)
        os.replace(temporary, file); os.fsync(directory_fd)
        return 0 if root_status == 0 and not failed else 125
    except BaseException:
        try:
            os.write(2, b'BOOTSTRAP_NATIVE_COMPLETION_UNPROVEN\n')
        finally:
            while True:
                signal.pause()
    finally:
        os.close(directory_fd)


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception:
        print('BOOTSTRAP_NATIVE_AUTHORITY_UNPROVEN', file=sys.stderr)
        sys.exit(1)
