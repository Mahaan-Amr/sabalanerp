#!/usr/bin/env python3
"""Fixed initial-baseline guardian. Owns EX and original Node/SQL to closure.

Failure after ACTIVE holds this SAME guardian; no replacement, expiry, kill,
resume, record deletion or status-file adoption is implemented.
"""
import ctypes
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit, unquote

sys.dont_write_bytecode = True


def require(value):
    if not value:
        raise RuntimeError('PROTECTED_FILE_ADOPTION_NATIVE_UNPROVEN')


def birth(pid):
    return dict(pid=pid, bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                pidNamespace=os.readlink('/proc/' + str(pid) + '/ns/pid'),
                startTicks=Path('/proc/' + str(pid) + '/stat').read_text().rsplit(') ', 1)[1].split()[19])


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def held_gate(fd, file):
    value, named = os.fstat(fd), file.lstat()
    require(file.resolve(strict=True) == file and stat.S_ISREG(value.st_mode) and value.st_nlink == 1
            and value.st_uid == 0 and not value.st_mode & 0o022 and value.st_size == 0
            and (value.st_dev, value.st_ino) == (named.st_dev, named.st_ino))
    require(any(re.fullmatch(r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                            + str(value.st_ino) + r'\s+0\s+EOF\s*', line)
                for line in Path('/proc/self/fdinfo/' + str(fd)).read_text().splitlines()))


def run():
    require(sys.platform == 'linux' and os.getuid() == 0 and len(sys.argv) == 1
            and os.environ.get('BACKEND_RUNTIME_ROLE') == 'control')
    directory = Path(os.environ.get('RECOVERY_COORDINATION_DIR', '/app/recovery-coordination'))
    require(str(directory) == '/app/recovery-coordination' and directory.resolve(strict=True) == directory)
    held_gate(9, directory / 'deployment-runtime-control.lock')
    spec = importlib.util.spec_from_file_location('file_adoption_state', Path(__file__).with_name('protected-file-adoption-state.py'))
    state = importlib.util.module_from_spec(spec); spec.loader.exec_module(state); state.assert_quiescent(directory)
    file = directory / 'deployment-file-adoption-native.json'
    # Even a completed previous baseline is not replayed/replaced.
    require(not file.exists())
    gate_file = directory / 'deployment-write-admission.lock'
    gate = os.open(gate_file, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    if gate != 10:
        os.dup2(gate, 10); os.close(gate)
    fcntl.flock(10, fcntl.LOCK_EX | fcntl.LOCK_NB); held_gate(10, gate_file)
    require(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0)
    owner = {key: os.environ['DEPLOYMENT_' + suffix] for key, suffix in
             [('deploymentId', 'ID'), ('releaseId', 'RELEASE_ID'), ('leaseToken', 'LEASE_TOKEN')]}
    require(all(isinstance(value, str) and 0 < len(value) <= 256 for value in owner.values()))
    operation = hashlib.sha256(encoded(owner)).hexdigest()
    namespace = 'sabalan-file-adopt-' + operation[:32]
    source = urlsplit(os.environ['DATABASE_URL']); query = parse_qsl(source.query, keep_blank_values=True)
    require(source.scheme in ('postgres', 'postgresql') and source.hostname and source.path.startswith('/')
            and not source.fragment and not any(key == 'options' for key, _ in query))
    for key in ['connection_limit', 'pool_timeout']:
        values = [value for name, value in query if name == key]
        require(len(values) == 1 and values[0].isdigit() and 0 < int(values[0]) <= 120)
    environment = dict(os.environ)
    environment['DATABASE_URL'] = urlunsplit((source.scheme, source.netloc, source.path,
        urlencode([(key, value) for key, value in query if key != 'application_name'] + [('application_name', namespace)]), ''))
    environment['PROTECTED_FILE_ADOPTION_CAPTURE_ID'] = operation
    pg = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    pg.update(PGHOST=source.hostname, PGPORT=str(source.port or 5432), PGDATABASE=unquote(source.path[1:]),
              PGUSER=unquote(source.username or ''), PGPASSWORD=unquote(source.password or ''),
              PGAPPNAME='sabalan-file-adoption-observer', PGCONNECT_TIMEOUT='5',
              PGOPTIONS='-c statement_timeout=5000 -c lock_timeout=250')
    sql = """SELECT json_build_object('database',current_database(),'oid',d.oid::text,'system',c.system_identifier::text,
      'visible',r.rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'),
      'sessions',(SELECT count(*) FROM pg_stat_activity WHERE datid=d.oid AND application_name='""" + namespace + """'),
      'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()))
      FROM pg_database d CROSS JOIN pg_control_system() c CROSS JOIN pg_roles r
      WHERE d.datname=current_database() AND r.rolname=current_user"""

    def observation():
        observed = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
                                  env=pg, stdin=subprocess.DEVNULL, capture_output=True, timeout=10)
        require(observed.returncode == 0 and len(observed.stdout) < 16384)
        value = json.loads(observed.stdout); require(value['visible'] is True and value['database'] == pg['PGDATABASE'])
        held_gate(9, directory / 'deployment-runtime-control.lock'); held_gate(10, gate_file)
        return value

    initial = observation(); require(initial['sessions'] == 0 and initial['prepared'] == 0)
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)

    def publish(target, value):
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            raw = encoded(value); require(os.write(fd, raw) == len(raw)); os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(directory_fd)

    record = dict(format='sabalan-protected-file-adoption-native/v1', phase='ACTIVE', operation=operation,
                  namespace=namespace, guardian=birth(os.getpid()), child=None,
                  identity={key: initial[key] for key in ['database', 'oid', 'system']})
    publish(file, record)
    cancelled = False

    def cancel(_number, _frame):
        nonlocal cancelled
        cancelled = True

    for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP, signal.SIGPIPE]:
        signal.signal(number, cancel)
    try:
        child = subprocess.Popen(['/usr/local/bin/node', '/app/dist/scripts/protected-file-baseline.js', 'adopt-initial-file-baseline'],
                                 env=environment, stdin=subprocess.PIPE, pass_fds=(9, 10))
        record['child'] = birth(child.pid)
        active = directory / ('deployment-file-adoption-native.' + operation + '.active.json')
        publish(active, record)
        # Preserve the initial record and publish this original child's identity.
        temporary = directory / ('deployment-file-adoption-native.' + operation + '.tmp')
        publish(temporary, record); os.replace(temporary, file); os.fsync(directory_fd)
        child.stdin.write(b'RUN\n'); child.stdin.close()
        code = child.wait()
        while True:
            try:
                pid, _status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                break
            if pid == 0:
                time.sleep(.05)
        while True:
            current = observation()
            require(all(current[key] == initial[key] for key in ['database', 'oid', 'system']))
            if current['sessions'] == 0 and current['prepared'] == 0:
                break
            time.sleep(.05)
        require(json.loads(file.read_bytes()) == record)
        record.update(phase='QUIESCENT', nativeReaped=True, databaseQuiet=True, nativeStatus=code, failed=code != 0 or cancelled)
        temporary = directory / ('deployment-file-adoption-native.' + operation + '.completed.tmp')
        publish(temporary, record); os.replace(temporary, file); os.fsync(directory_fd)
        return 0 if code == 0 and not cancelled else 1
    except BaseException:
        os.write(2, b'PROTECTED_FILE_ADOPTION_COMPLETION_UNPROVEN\n')
        while True:
            signal.pause()


if __name__ == '__main__':
    try:
        sys.exit(run())
    except Exception:
        print('PROTECTED_FILE_ADOPTION_NATIVE_UNPROVEN', file=sys.stderr)
        sys.exit(1)
