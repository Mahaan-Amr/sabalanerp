#!/usr/bin/env python3
"""Actual sole Prisma pool/native descendants/SQL/FD9, existing local PG only."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import stat
import subprocess
import sys
import time
from urllib.parse import unquote, urlsplit, urlunsplit


def require(value, message='NATIVE_OWNER_ACCEPTANCE_FAILED'):
    if not value:
        raise RuntimeError(message)


root = Path(sys.argv[1])
require(str(root).startswith('/app/online-runtime-acceptance/native-owner-') and root.resolve(strict=True) == root)
url = urlsplit(os.environ['DATABASE_URL'])
require(url.hostname == 'postgres' and unquote(url.path[1:]) == 'sabalanerp')
database = 'sabalanerp_concurrency_' + secrets.token_hex(8)
pg_env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
pg_env.update(PGHOST=url.hostname, PGPORT=str(url.port or 5432), PGUSER=unquote(url.username),
              PGPASSWORD=unquote(url.password), PGDATABASE='postgres', PGAPPNAME='native-owner-acceptance-observer',
              PGOPTIONS='-c statement_timeout=5000 -c lock_timeout=250', PGCONNECT_TIMEOUT='5')


def sql(query, selected='postgres'):
    value = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', query],
                           env=dict(pg_env, PGDATABASE=selected), capture_output=True, timeout=10)
    require(value.returncode == 0, 'ACCEPTANCE_SQL_FAILED')
    return value.stdout.decode().strip()


def wait_for(predicate, seconds=12):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.025)
    raise RuntimeError('ACCEPTANCE_COMPLETION_DEADLINE')


def available(directory):
    return subprocess.run(['flock', '--exclusive', '--nonblock', str(directory / 'deployment-runtime-control.lock'),
                           '/usr/bin/true'], capture_output=True).returncode == 0


sql('CREATE DATABASE "' + database + '"')
sql('CREATE TABLE native_owner_probe (id text PRIMARY KEY, amount numeric(24,8), quantity numeric(24,8))', database)
reports = []
holders = []
proven = False
try:
    for mode in ['normal', 'native-descendant', 'lost-runtime', 'guard-death']:
        directory = root / mode
        directory.mkdir(mode=0o700)
        source = urlunsplit((url.scheme, url.netloc, '/' + database, 'connection_limit=2&pool_timeout=10', ''))
        environment = dict(os.environ, NODE_ENV='development', BACKEND_RUNTIME_ROLE='standalone',
                           RECOVERY_COORDINATION_DIR=str(directory), DATABASE_URL=source)
        child = subprocess.Popen(['sh', str(root / 'with-backend-control-ownership.sh'), 'node',
                                  str(root / 'runtime-native-owner.worker.cjs'), mode],
                                 env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        holders.append(child)
        line = child.stdout.readline()
        require(line, 'WORKER_DID_NOT_START')
        ready = json.loads(line)
        require(ready['event'] == 'ready' and ready['namespace'].startswith('sabalan-rt-'))
        file = directory / 'deployment-runtime-native.json'
        active_raw = file.read_bytes()
        active = json.loads(active_raw)
        require(active['phase'] == 'ACTIVE' and active['guardian']['pid'] == child.pid
                and active['namespace'] == ready['namespace'] and len(ready['namespace']) == 59)
        # PostgreSQL's name_data length is 64, application_name permits 63 BYTES.
        # The actual query above must prove byte-exact identity, not truncation.
        namespace = ready['namespace']
        if mode == 'native-descendant':
            wait_for(lambda: sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace
                + "' AND state='active' AND query LIKE 'DO $$%'") == '1')
            require(child.poll() is None and not available(directory) and file.read_bytes() == active_raw,
                    'DESCENDANT_DRAIN_RELEASED_EARLY')
        if mode in ['lost-runtime', 'guard-death']:
            wait_for(lambda: sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace
                + "' AND state='active' AND query LIKE 'DO $$%'") == '1')
            pid_fd = os.pidfd_open(ready['pid'])
            try:
                signal.pidfd_send_signal(pid_fd, signal.SIGKILL)
            finally:
                os.close(pid_fd)
            time.sleep(0.1)
            require(child.poll() is None and not available(directory) and file.read_bytes() == active_raw,
                    'CONTROL_LOCK_RELEASED_BEFORE_SQL_COMPLETION')
            require(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace + "'") == '1')
            if mode == 'guard-death':
                # Deliberate diagnostic whole-owner death. Durable ACTIVE must
                # refuse replacement even after the kernel lock is released.
                owner_fd = os.pidfd_open(child.pid)
                try:
                    signal.pidfd_send_signal(owner_fd, signal.SIGKILL)
                finally:
                    os.close(owner_fd)
                require(child.wait(timeout=5) == -signal.SIGKILL)
                replacement = subprocess.run(['sh', str(root / 'with-backend-control-ownership.sh'),
                    'node', str(root / 'runtime-native-owner.worker.cjs'), 'normal'], env=environment,
                    capture_output=True, timeout=5)
                require(replacement.returncode == 75 and not replacement.stdout
                        and file.read_bytes() == active_raw and available(directory))
                control = subprocess.run(['sh', str(root / 'with-backend-control-ownership.sh'),
                    'node', '-e', "console.log('UNSAFE_CONTROL_STARTED')"],
                    env=dict(environment, BACKEND_RUNTIME_ROLE='control'), capture_output=True, timeout=5)
                require(control.returncode == 75 and not control.stdout and file.read_bytes() == active_raw,
                        'CONTROL_BYPASSED_ORPHAN_RUNTIME')
                streamed = subprocess.run(['sh', str(root / 'streamed-closure.fixture.sh')],
                    env=dict(environment, OPERATIONS_ROOT=str(root)), capture_output=True, timeout=5)
                require(streamed.returncode == 75 and not streamed.stdout and file.read_bytes() == active_raw,
                        'RELEASE_STREAMED_CHECK_BYPASSED_ORPHAN_RUNTIME')
                closure_probe = subprocess.run(['node', '-e',
                    "const {assertNativeRuntimeControlBoundary}=require(process.argv[1]);"
                    "try{assertNativeRuntimeControlBoundary();process.exitCode=1;}"
                    "catch(e){if(e.message!=='RUNTIME_NATIVE_AUTHORITY_UNPROVEN')throw e;console.log('REFUSED');}",
                    str(root / 'services/runtimeNativeAuthority.js')],
                    env=dict(environment, BACKEND_RUNTIME_ROLE='control'), capture_output=True, timeout=5)
                require(closure_probe.returncode == 0 and closure_probe.stdout.strip() == b'REFUSED'
                        and file.read_bytes() == active_raw, 'TYPESCRIPT_CONTROL_BYPASSED_ORPHAN_RUNTIME')
                wait_for(lambda: sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace + "'") == '0')
                reports.append(dict(mode=mode, held=True, replacementRefused=True,
                                    activeSha256=hashlib.sha256(active_raw).hexdigest()))
                continue
        expected = 125 if mode == 'lost-runtime' else 0
        require(child.wait(timeout=12) == expected, 'GUARDIAN_EXIT_STATUS_INCORRECT')
        state = json.loads(file.read_bytes())
        require(state['phase'] == 'QUIESCENT' and state['nativeReaped'] is True
                and state['databaseQuiet'] is True and available(directory))
        require(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace + "'") == '0')
        reports.append(dict(mode=mode, nativeStatus=state['nativeStatus'], nativeReaped=True, databaseQuiet=True))
        if mode == 'normal':
            previous_raw = file.read_bytes()
            replacement = subprocess.run(['sh', str(root / 'with-backend-control-ownership.sh'), 'node',
                str(root / 'runtime-native-owner.worker.cjs'), 'normal'], env=environment,
                capture_output=True, timeout=12)
            require(replacement.returncode == 0)
            successor = json.loads(file.read_bytes())
            previous_sha = hashlib.sha256(previous_raw).hexdigest()
            require(successor['phase'] == 'QUIESCENT' and successor['namespace'] != namespace
                    and successor['previousSha256'] == previous_sha
                    and (directory / 'deployment-runtime-history' / (previous_sha + '.json')).read_bytes() == previous_raw)
            reports[-1]['successorFreshNamespace'] = True
            reports[-1]['previousClosureArchived'] = True
            streamed = subprocess.run(['sh', str(root / 'streamed-closure.fixture.sh')],
                env=dict(environment, OPERATIONS_ROOT=str(root)), capture_output=True, timeout=5)
            require(streamed.returncode == 0)
            reports[-1]['releaseStreamedClosure'] = True
    rows = json.loads(sql("SELECT json_agg(json_build_object('id',id,'amount',amount::text,'quantity',quantity::text) ORDER BY id) FROM native_owner_probe", database))
    require([row['id'] for row in rows] == ['descendant', 'guard-death', 'lost-runtime'])
    require(all(row['amount'] == '123456789.12345678' and row['quantity'] == '0.00000001' for row in rows))
    require(sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + database + "'") == '0')
    sql('DROP DATABASE "' + database + '"')  # NO FORCE; all tagged work proved closed.
    proven = True
    print(json.dumps(dict(format='sabalan-runtime-native-acceptance/v1', cases=reports, rows=rows,
                          droppedDatabase=database, retainedHeldRoot=str(root / 'guard-death'))))
finally:
    if not proven:
        # Failed acceptance retains its database, ACTIVE state, native owners
        # and evidence. Never kill or delete unknown work as test cleanup.
        print('NATIVE_OWNER_ACCEPTANCE_HELD ' + str(root), file=sys.stderr)
