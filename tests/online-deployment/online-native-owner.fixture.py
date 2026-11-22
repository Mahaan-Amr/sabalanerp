#!/usr/bin/env python3
"""Real online native/pool/worker overlap, existing local PG and slots only."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time
from urllib.parse import unquote, urlsplit, urlunsplit


def require(value, message='ONLINE_NATIVE_ACCEPTANCE_FAILED'):
    if not value:
        raise RuntimeError(message)


root = Path(sys.argv[1])
require(root.parent == Path('/app/online-runtime-acceptance') and root.name.startswith('online-native-'))
mode = sys.argv[2]
source = urlsplit(os.environ['DATABASE_URL'])
require(source.hostname == 'postgres' and unquote(source.path[1:]) == 'sabalanerp')
pg_env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
pg_env.update(PGHOST=source.hostname, PGPORT=str(source.port or 5432), PGUSER=unquote(source.username),
              PGPASSWORD=unquote(source.password), PGDATABASE='postgres', PGAPPNAME='online-native-acceptance-observer',
              PGOPTIONS='-c statement_timeout=5000 -c lock_timeout=250', PGCONNECT_TIMEOUT='5')


def sql(query, database='postgres'):
    value = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', query],
                           env=dict(pg_env, PGDATABASE=database), capture_output=True, timeout=10)
    require(value.returncode == 0, 'ACCEPTANCE_SQL_FAILED')
    return value.stdout.decode().strip()


def write(file, raw, mode=0o400):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode)
        offset = 0
        while offset < len(raw):
            count = os.write(fd, raw[offset:])
            require(count > 0)
            offset += count
        os.fsync(fd)
    finally:
        os.close(fd)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def work_scope(scope):
    gate = {key: scope['gate'][key] for key in ['device', 'inode', 'ownerUid']}
    return dict(format='sabalan-runtime-namespace/v1', scope=dict(runtimeId=scope['runtimeId'], image=scope['image'],
                registrySha256=scope['manifestSha256'], generation=1, gate=gate,
                postgresApplicationName='sabalan-rt-' + hashlib.sha256(scope['runtimeId'].encode('ascii')).hexdigest()[:48]))


def lock(file):
    write(file, b'', 0o600)
    value = file.stat()
    return dict(file=str(file), device=str(value.st_dev), inode=str(value.st_ino), ownerUid=value.st_uid)


if mode in ['prepare', 'prepare-admission']:
    database = 'sabalanerp_concurrency_' + secrets.token_hex(8)
    sql('CREATE DATABASE "' + database + '"')
    sql('CREATE TABLE online_native_probe (id text PRIMARY KEY, amount numeric(24,8), quantity numeric(24,8))', database)
    system = sql('SELECT system_identifier FROM pg_control_system()')
    coordination = root / 'coordination'
    coordination.mkdir(mode=0o700)
    write(coordination / 'state.json', encoded(dict(mode='NORMAL', updatedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))), 0o600)
    gate = lock(coordination / 'deployment-write-admission.lock')
    interlock = lock(coordination / 'deployment-runtime-control.lock')
    worker = lock(coordination / 'deployment-online-worker.lock')
    (coordination / 'diagnostic-finish').mkdir(mode=0o700)
    for name in ['online', 'online/native', 'online/work']:
        (coordination / name).mkdir(mode=0o700)
    admission = None
    if mode == 'prepare-admission':
        directory = coordination / 'online/admission'
        directory.mkdir(mode=0o700, parents=True)
        (directory / 'staging').mkdir(mode=0o700)
        definition = encoded(dict(format='sabalan-online-admission-scope/v1', gate=gate,
                                  interlock=interlock, worker=worker,
                                  database=dict(systemIdentifier=system, name=database)))
        write(directory / 'scope.json', definition)
        write(directory / '00000000.json', encoded(dict(format='sabalan-online-capture-admission/v1',
              generation=0, phase='OPEN', previousSha256=None, capture=None, closureSha256=None)))
        admission = dict(directory=str(directory), scopeSha256=hashlib.sha256(definition).hexdigest())
    grants = []
    shared_prefix = secrets.token_hex(24)
    for name, purpose in [('http-a', 'http'), ('http-b', 'http'), ('jobs', 'jobs'),
                          ('jobs-duplicate', 'jobs'), ('capture', 'capture'), ('lost-runtime', 'http'), ('lost-worker', 'jobs')]:
        runtime_id = shared_prefix + secrets.token_hex(8) if name in ['http-a', 'http-b'] else secrets.token_hex(32)
        native = coordination / 'online/native' / runtime_id
        boundary = coordination / 'online/work' / runtime_id
        native.mkdir(mode=0o700, parents=True)
        boundary.mkdir(mode=0o700, parents=True)
        lock(native / 'deployment-runtime-control.lock')
        (coordination / 'diagnostic-uploads' / runtime_id).mkdir(mode=0o700, parents=True)
        scope = dict(format='sabalan-online-runtime-scope/v1', runtimeId=runtime_id,
                     releaseId='native-overlap-diagnostic', manifestSha256='a' * 64, sourceCommit='b' * 40,
                     image='sha256:33cb69566bb1de4f8895e73486be364ccad1d60e978ba0a30f34c210ecf6f505',
                     nonce=secrets.token_hex(32), purpose=purpose, role='serving' if purpose == 'http' else 'control',
                     coordinationDirectory=str(coordination), nativeDirectory=str(native), boundaryDirectory=str(boundary),
                     gate=gate, interlock=interlock, worker=worker if purpose != 'http' else None,
                     database=dict(systemIdentifier=system, name=database))
        if admission:
            scope.update(format='sabalan-online-runtime-scope/v2', admission=admission)
        write(Path(scope['boundaryDirectory']) / 'scope.json', encoded(work_scope(scope)), 0o600)
        raw = encoded(scope)
        write(Path('/app/runtime-authority') / (runtime_id + '.json'), raw)
        grants.append(dict(name=name, file='/run/sabalan-online/' + runtime_id + '.json',
                           sha256=hashlib.sha256(raw).hexdigest(), scope=scope))
    unknown_coordination = root / 'null-worker-coordination'
    unknown_coordination.mkdir(mode=0o700)
    scope = json.loads(json.dumps(next(grant['scope'] for grant in grants if grant['name'] == 'jobs')))
    runtime_id = secrets.token_hex(32)
    scope.update(runtimeId=runtime_id, nonce=secrets.token_hex(32), coordinationDirectory=str(unknown_coordination),
                 nativeDirectory=str(unknown_coordination / 'online/native' / runtime_id),
                 boundaryDirectory=str(unknown_coordination / 'online/work' / runtime_id),
                 gate=lock(unknown_coordination / 'deployment-write-admission.lock'),
                 interlock=lock(unknown_coordination / 'deployment-runtime-control.lock'),
                 worker=lock(unknown_coordination / 'deployment-online-worker.lock'))
    # The existing malformed-worker negative case intentionally remains v1;
    # it must fail on the actual native fence, before any work factory binds.
    scope['format'] = 'sabalan-online-runtime-scope/v1'
    scope.pop('admission', None)
    for name in ['nativeDirectory', 'boundaryDirectory']:
        Path(scope[name]).mkdir(mode=0o700, parents=True)
    lock(Path(scope['nativeDirectory']) / 'deployment-runtime-control.lock')
    write(unknown_coordination / 'deployment-online-worker-native.json', b'null\n', 0o600)
    write(Path(scope['boundaryDirectory']) / 'scope.json', encoded(work_scope(scope)), 0o600)
    raw = encoded(scope)
    write(Path('/app/runtime-authority') / (runtime_id + '.json'), raw)
    grants.append(dict(name='null-worker', file='/run/sabalan-online/' + runtime_id + '.json',
                       sha256=hashlib.sha256(raw).hexdigest(), scope=scope))
    if admission:
        paused_coordination = root / 'interrupted-capture-coordination'
        paused_coordination.mkdir(mode=0o700)
        write(paused_coordination / 'state.json', encoded(dict(mode='NORMAL', updatedAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))), 0o600)
        (paused_coordination / 'diagnostic-finish').mkdir(mode=0o700)
        for name in ['online', 'online/native', 'online/work']:
            (paused_coordination / name).mkdir(mode=0o700)
        paused_locks = {key: lock(paused_coordination / name) for key, name in [
            ('gate', 'deployment-write-admission.lock'), ('interlock', 'deployment-runtime-control.lock'),
            ('worker', 'deployment-online-worker.lock')]}
        pause_directory = paused_coordination / 'online/admission'
        pause_directory.mkdir(mode=0o700, parents=True)
        (pause_directory / 'staging').mkdir(mode=0o700)
        definition = encoded(dict(format='sabalan-online-admission-scope/v1', **paused_locks,
                                  database=dict(systemIdentifier=system, name=database)))
        write(pause_directory / 'scope.json', definition)
        write(pause_directory / '00000000.json', encoded(dict(format='sabalan-online-capture-admission/v1',
              generation=0, phase='OPEN', previousSha256=None, capture=None, closureSha256=None)))
        for name, purpose in [('pause-http', 'http'), ('pause-jobs', 'jobs'),
                              ('pause-capture', 'capture'), ('pause-capture-retry', 'capture')]:
            scope = json.loads(json.dumps(grants[0]['scope']))
            runtime_id = secrets.token_hex(32)
            scope.update(runtimeId=runtime_id, nonce=secrets.token_hex(32), purpose=purpose,
                         role='serving' if purpose == 'http' else 'control', coordinationDirectory=str(paused_coordination),
                         nativeDirectory=str(paused_coordination / 'online/native' / runtime_id),
                         boundaryDirectory=str(paused_coordination / 'online/work' / runtime_id),
                         gate=paused_locks['gate'], interlock=paused_locks['interlock'],
                         worker=None if purpose == 'http' else paused_locks['worker'],
                         admission=dict(directory=str(pause_directory), scopeSha256=hashlib.sha256(definition).hexdigest()))
            for key in ['nativeDirectory', 'boundaryDirectory']:
                Path(scope[key]).mkdir(mode=0o700, parents=True)
            lock(Path(scope['nativeDirectory']) / 'deployment-runtime-control.lock')
            (paused_coordination / 'diagnostic-uploads' / runtime_id).mkdir(mode=0o700, parents=True)
            write(Path(scope['boundaryDirectory']) / 'scope.json', encoded(work_scope(scope)), 0o600)
            raw = encoded(scope)
            write(Path('/app/runtime-authority') / (runtime_id + '.json'), raw)
            grants.append(dict(name=name, file='/run/sabalan-online/' + runtime_id + '.json',
                               sha256=hashlib.sha256(raw).hexdigest(), scope=scope))
    write(root / 'index.json', encoded(dict(database=database, grants=grants)))
    fd = os.open('/app/runtime-authority', os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(fd)
    os.close(fd)
    print(json.dumps(dict(prepared=True, isolatedDatabase=database, grants=len(grants))))
    sys.exit(0)

require(mode in ['exercise', 'scoped-exercise'])
scoped = mode == 'scoped-exercise'
index = json.loads((root / 'index.json').read_bytes())
database = index['database']
grants = {value['name']: value for value in index['grants']}
coordination = Path(grants['http-a']['scope']['coordinationDirectory'])
processes = []
proven = False


def environment(grant):
    return dict(os.environ, DATABASE_URL=urlunsplit((source.scheme, source.netloc, '/' + database,
                'connection_limit=2&pool_timeout=10', '')), NODE_ENV='development',
                BACKEND_RUNTIME_ROLE=grant['scope']['role'], RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'],
                BACKEND_ONLINE_SCOPE_FILE=grant['file'], BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'])


def launch(name):
    grant = grants[name]
    child = subprocess.Popen(['python3', '-I', '-B', str(root / 'online-runtime-owner.py'),
                              'node', str(root / 'worker.cjs'), name], env=environment(grant),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    processes.append(child)
    return child


def ready(child):
    # Poll a private durable claim / child termination before the bounded pipe
    # read. No guessed process cleanup on failure.
    import select
    require(select.select([child.stdout], [], [], 12)[0], 'WORKER_READY_DEADLINE')
    raw = child.stdout.readline()
    if not raw:
        child.wait(timeout=5)
        diagnostic = child.stderr.read(4096)
        write(root / ('startup-diagnostic-' + str(child.pid) + '.stderr'), diagnostic or b'NO_STDERR\n', 0o600)
        require(False, 'ONLINE_SCOPED_WORK_NOT_IMPLEMENTED' if b'ONLINE_SCOPED_WORK_NOT_IMPLEMENTED' in diagnostic
                else 'CAPTURE_NAMESPACE_PROBE_REJECTED' if b'CAPTURE_NAMESPACE_PROBE_REJECTED' in diagnostic else 'WORKER_DID_NOT_START')
    value = json.loads(raw)
    require(value['event'] == 'ready')
    return value


def available(file):
    return subprocess.run(['flock', '--exclusive', '--nonblock', str(file), '/usr/bin/true'],
                          capture_output=True, timeout=5).returncode == 0


def finish(name, child):
    directory = Path(grants[name]['scope']['nativeDirectory'])
    write(Path(grants[name]['scope']['coordinationDirectory']) / 'diagnostic-finish' / grants[name]['scope']['runtimeId'], b'done\n')
    require(child.wait(timeout=15) == 0, 'NATIVE_DRAIN_FAILED')
    value = json.loads((directory / 'deployment-runtime-native.json').read_bytes())
    require(value['phase'] == 'QUIESCENT' and value['nativeReaped'] and value['databaseQuiet'])
    active = dict(value)
    for key in ['activeClaimSha256', 'nativeReaped', 'databaseQuiet', 'nativeStatus', 'stoppedBySignal']:
        active.pop(key)
    active['phase'] = 'ACTIVE'
    require(hashlib.sha256(encoded(active)).hexdigest() == value['activeClaimSha256'], 'NATIVE_CLOSURE_ACTIVE_BINDING_MISMATCH')
    if scoped and grants[name]['scope']['purpose'] != 'capture':
        state = json.loads((Path(grants[name]['scope']['boundaryDirectory']) / 'state.json').read_bytes())
        require(state['phase'] == 'QUIESCENT')
        claim = json.loads((Path(grants[name]['scope']['boundaryDirectory']) / 'claim.json').read_bytes())
        require(claim['format'] == 'sabalan-runtime-claim/v2'
                and claim['native'] == dict(scopeSha256=grants[name]['sha256'], claimSha256=value['activeClaimSha256']))



try:
    running = {name: launch(name) for name in ['http-a', 'http-b', 'jobs']}
    observations = {name: ready(child) for name, child in running.items()}
    require(len({value['namespace'] for value in observations.values()}) == 3)
    if scoped:
        import http.client
        for name in ['http-a', 'http-b']:
            client = http.client.HTTPConnection('127.0.0.1', observations[name]['port'], timeout=5)
            try:
                client.request('GET', '/read')
                response = client.getresponse()
                require(response.status == 200 and json.loads(response.read()) == dict(namespace=observations[name]['namespace']))
            finally:
                client.close()
        worker_row = json.loads(sql("SELECT json_build_object('amount',amount::text,'quantity',quantity::text) FROM online_native_probe WHERE id='worker'", database))
        require(worker_row == dict(amount='123456789.12345678', quantity='0.00000001'))

    require(not available(coordination / 'deployment-runtime-control.lock'))
    require(not available(coordination / 'deployment-online-worker.lock'))
    for name in ['jobs-duplicate', 'capture']:
        child = launch(name)
        out, err = child.communicate(timeout=8)
        require(child.returncode == 75 and not out)
        require(not (Path(grants[name]['scope']['nativeDirectory']) / 'deployment-runtime-native.json').exists())
    wrong = coordination / 'wrong-gate'
    wrong.mkdir(mode=0o700)
    wrong_gate = wrong / 'deployment-write-admission.lock'
    lock(wrong_gate)
    capture_finished = False
    component_evidence = None
    if grants['capture']['scope']['format'] == 'sabalan-online-runtime-scope/v2':
        # Actual in-flight HTTP/SQL finishes under SH10. Capture publishes its
        # native-owned durable pause before waiting for EX10. A later HTTP write
        # cannot enter its handler or DB until real capture closure reopens it.
        from concurrent.futures import ThreadPoolExecutor

        def request(name, route):
            client = http.client.HTTPConnection('127.0.0.1', observations[name]['port'], timeout=15)
            try:
                client.request('POST', route)
                response = client.getresponse()
                result = response.read().decode()
                require(response.status == 200, 'PAUSE_HTTP_REFUSED_' + str(response.status) + '_' + result[:160])
                return result
            finally:
                client.close()

        finish('jobs', running.pop('jobs'))
        with ThreadPoolExecutor(max_workers=2) as executor:
            before_pause = executor.submit(request, 'http-a', '/pause-write')
            deadline = time.monotonic() + 8
            while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + observations['http-a']['namespace']
                      + "' AND state='active' AND query LIKE 'DO $$%'") != '1':
                require(time.monotonic() < deadline, 'PAUSE_WRITE_DID_NOT_START')
                time.sleep(0.01)
            capture = launch('capture')
            pause_file = coordination / 'online/admission/00000001.json'
            deadline = time.monotonic() + 8
            while not pause_file.exists():
                require(time.monotonic() < deadline and capture.poll() is None, 'DURABLE_PAUSE_NOT_PUBLISHED')
                time.sleep(0.01)
            pause_raw = pause_file.read_bytes()
            require(json.loads(pause_raw)['phase'] == 'CLOSING')
            after_pause = executor.submit(request, 'http-b', '/pause-queued')
            capture_ready = ready(capture)
            require(capture_ready['purpose'] == 'capture')
            component_evidence = capture_ready.get('component')
            require(before_pause.result(timeout=8) == 'committed-before')
            require(not after_pause.done(), 'NEW_HTTP_WORK_BYPASSED_CAPTURE_PAUSE')
            require(sql("SELECT count(*) FROM online_native_probe WHERE id='pause-after'", database) == '0')
            require(not available(coordination / 'deployment-write-admission.lock'))
            finish('capture', capture)
            require(component_evidence is not None)
            closed_raw = (Path(grants['capture']['scope']['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes()
            component_evidence.update(nativeClosedSha256=hashlib.sha256(closed_raw).hexdigest(),
                                      nativeActiveSha256=json.loads(closed_raw)['activeClaimSha256'], productionRecoveryPoint=False)
            require(after_pause.result(timeout=8) == 'committed-after')
            opened = json.loads((coordination / 'online/admission/00000002.json').read_bytes())
            require(opened['phase'] == 'OPEN' and opened['previousSha256'] == hashlib.sha256(pause_raw).hexdigest())
            capture_finished = True
    lost = launch('lost-runtime')
    observed = ready(lost)
    namespace = observed['namespace']
    deadline = time.monotonic() + 8
    while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace
              + "' AND state='active' AND query LIKE 'DO $$%'") != '1':
        require(time.monotonic() < deadline, 'SERVER_QUERY_DID_NOT_START')
        time.sleep(0.02)
    process_fd = os.pidfd_open(observed['pid'])
    try:
        signal.pidfd_send_signal(process_fd, signal.SIGKILL)
    finally:
        os.close(process_fd)
    null_worker = launch('null-worker')
    null_out, null_err = null_worker.communicate(timeout=8)
    require(null_worker.returncode == 75 and not null_out, 'NULL_WORKER_FENCE_BYPASSED')
    require(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace + "' AND state='active'") == '1')
    require((Path(grants['null-worker']['scope']['coordinationDirectory']) / 'deployment-online-worker-native.json').read_bytes() == b'null\n')
    # Retire other runtimes while the disconnected server query remains live.
    for name, child in running.items():
        finish(name, child)
    require(lost.poll() is None and not available(coordination / 'deployment-runtime-control.lock'),
            'GLOBAL_INTERLOCK_RELEASED_BEFORE_SQL_COMPLETION')
    require(lost.wait(timeout=12) == 125)
    require(available(coordination / 'deployment-runtime-control.lock'))
    current = json.loads((Path(grants['lost-runtime']['scope']['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes())
    require(current['phase'] == 'QUIESCENT' and current['nativeStatus'] == -9
            and current['nativeReaped'] and current['databaseQuiet'])
    if scoped:
        state = json.loads((Path(grants['lost-runtime']['scope']['boundaryDirectory']) / 'state.json').read_bytes())
        require(state['phase'] == 'ACTIVE' and state['epoch'] >= 1)
        # The native guard has proved descendant/SQL completion, but it cannot
        # settle the dead application's unfinished work journal. Exercise the
        # same read-only claim validator called by the owned capture census.
        if grants['lost-runtime']['scope']['format'] == 'sabalan-online-runtime-scope/v2':
            import importlib.util
            spec = importlib.util.spec_from_file_location('orphan_work_check', root / 'online-backend-boundary.py')
            fleet = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(fleet)
            work_directory = Path(grants['lost-runtime']['scope']['boundaryDirectory'])
            try:
                fleet.inspect_work_claim(work_directory, grants['lost-runtime']['scope']['runtimeId'],
                    grants['lost-runtime']['sha256'], current, current['activeClaimSha256'], (work_directory / 'scope.json').read_bytes())
                require(False, 'ORPHAN_WORK_CLAIM_ACCEPTED')
            except RuntimeError as error:
                require(str(error) == 'ONLINE_BACKEND_BOUNDARY_UNPROVEN')
    row = json.loads(sql("SELECT json_build_object('amount',amount::text,'quantity',quantity::text) FROM online_native_probe WHERE id='lost-runtime'", database))
    require(row == dict(amount='123456789.12345678', quantity='0.00000001'))
    # Exercise the guardian directly with a genuine SH holder on the real
    # gate and EX ownership on a different private, correctly named gate.
    attack = """import fcntl,os,sys
from pathlib import Path
scope=__import__('json').loads(sys.argv[1]); retained=[]
for file,target,access in [(scope['interlock']['file'],11,fcntl.LOCK_SH),(scope['worker']['file'],12,fcntl.LOCK_EX),(scope['nativeDirectory']+'/deployment-runtime-control.lock',9,fcntl.LOCK_EX),(scope['gate']['file'],13,fcntl.LOCK_SH),(sys.argv[2],10,fcntl.LOCK_EX)]:
 fd=os.open(file,os.O_RDWR|os.O_NOFOLLOW);fcntl.flock(fd,access|fcntl.LOCK_NB);copy=fcntl.fcntl(fd,fcntl.F_DUPFD_CLOEXEC,20);os.close(fd);retained.append((copy,target))
for fd,target in retained:os.dup2(fd,target,inheritable=True)
for fd,target in retained:os.close(fd)
v=os.stat(sys.argv[2]);os.environ.update(BACKEND_CONTROL_LOCK_FD='9',BACKEND_CONTROL_LOCK_FILE=scope['nativeDirectory']+'/deployment-runtime-control.lock',BACKEND_ONLINE_INTERLOCK_FD='11',BACKEND_ONLINE_WORKER_FD='12',BACKEND_CAPTURE_GATE_FD='10',BACKEND_CAPTURE_GATE_FILE=sys.argv[2],BACKEND_CAPTURE_GATE_DEVICE=str(v.st_dev),BACKEND_CAPTURE_GATE_INODE=str(v.st_ino))
os.execv('/usr/bin/python3',['/usr/bin/python3','-I','-B',sys.argv[3],'node','-e',"console.log('UNSAFE')"])
"""
    attack_result = subprocess.run(['python3', '-I', '-B', '-c', attack, json.dumps(grants['capture']['scope']),
                                    str(wrong_gate), str(root / 'backend-runtime-owner.py')],
                                   env=environment(grants['capture']), capture_output=True, timeout=8)
    require(attack_result.returncode == 75 and not attack_result.stdout, 'SUBSTITUTED_CAPTURE_GATE_ACCEPTED')
    if not capture_finished:
        capture = launch('capture')
        require(ready(capture)['purpose'] == 'capture')
        require(not available(coordination / 'deployment-write-admission.lock'))
        finish('capture', capture)
    # Kill both the worker client and its native guardian during server SQL.
    # Kernel ownership can disappear; the durable global worker ACTIVE fence
    # must still refuse another worker. No automatic reset is introduced.
    orphan = launch('lost-worker')
    orphan_ready = ready(orphan)
    orphan_namespace = orphan_ready['namespace']
    deadline = time.monotonic() + 8
    while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + orphan_namespace
              + "' AND state='active' AND query LIKE 'DO $$%'") != '1':
        require(time.monotonic() < deadline)
        time.sleep(0.02)
    for pid in [orphan_ready['pid'], orphan.pid]:
        fd = os.pidfd_open(pid)
        try:
            signal.pidfd_send_signal(fd, signal.SIGKILL)
        finally:
            os.close(fd)
    require(orphan.wait(timeout=5) == -9)
    release_deadline = time.monotonic() + 5
    while not available(coordination / 'deployment-online-worker.lock'):
        require(time.monotonic() < release_deadline, 'DEAD_WORKER_KERNEL_OWNERSHIP_STILL_PRESENT')
        time.sleep(0.01)
    require(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + orphan_namespace + "' AND state='active'") == '1', 'ORPHAN_QUERY_NOT_ACTIVE_AT_REPLACEMENT')
    replacement = launch('jobs-duplicate')
    out, err = replacement.communicate(timeout=8)
    require(replacement.returncode == 75 and not out, 'DEAD_WORKER_DURABLE_FENCE_BYPASSED')
    deadline = time.monotonic() + 10
    while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + orphan_namespace + "'") != '0':
        require(time.monotonic() < deadline)
        time.sleep(0.025)
    worker_row = json.loads(sql("SELECT json_build_object('amount',amount::text,'quantity',quantity::text) FROM online_native_probe WHERE id='lost-worker'", database))
    require(worker_row == row)
    worker_raw = (coordination / 'deployment-online-worker-native.json').read_bytes()
    require(json.loads(worker_raw)['phase'] == 'ACTIVE')
    retry = launch('http-a')
    out, err = retry.communicate(timeout=8)
    require(retry.returncode == 75 and not out, 'COMPLETED_GRANT_REUSED')
    # Global EX is now available, but persisted fleet registration still blocks
    # the legacy command. This prevents kernel-release-only orphan takeover.
    legacy_env = dict(os.environ, RECOVERY_COORDINATION_DIR=str(coordination), BACKEND_RUNTIME_ROLE='control')
    legacy = subprocess.run(['sh', str(root / 'with-backend-control-ownership.sh'),
                             'node', '-e', "console.log('UNSAFE')"], env=legacy_env, capture_output=True, timeout=8)
    require(legacy.returncode == 75 and not legacy.stdout, 'PROTECTED_FLEET_BYPASS')
    node_probe = subprocess.run(['node', '-e', "const {assertNativeRuntimeControlBoundary}=require(process.argv[1]);try{assertNativeRuntimeControlBoundary();process.exitCode=1}catch(e){if(e.message!=='RUNTIME_NATIVE_AUTHORITY_UNPROVEN')throw e;console.log('REFUSED')}",
                                str(root / 'services/runtimeNativeAuthority.js')], env=legacy_env, capture_output=True, timeout=8)
    require(node_probe.returncode == 0 and node_probe.stdout.strip() == b'REFUSED')
    interrupted_pause_refused = False
    if capture_finished:
        pause_http = launch('pause-http')
        pause_ready = ready(pause_http)
        pause_coord = Path(grants['pause-http']['scope']['coordinationDirectory'])
        pause_gate = os.open(pause_coord / 'deployment-write-admission.lock', os.O_RDONLY | os.O_NOFOLLOW)
        fcntl.flock(pause_gate, fcntl.LOCK_SH | fcntl.LOCK_NB)
        pause_capture = launch('pause-capture')
        pause_file = pause_coord / 'online/admission/00000001.json'
        deadline = time.monotonic() + 8
        while not pause_file.exists():
            require(time.monotonic() < deadline and pause_capture.poll() is None)
            time.sleep(0.01)
        pause_raw = pause_file.read_bytes()
        pause_state = json.loads(pause_raw)
        require(pause_state['phase'] == 'CLOSING' and pause_state['capture']['guardian']['pid'] == pause_capture.pid)
        require(not (Path(grants['pause-capture']['scope']['nativeDirectory']) / 'deployment-runtime-native.json').exists())
        require(not available(pause_coord / 'deployment-online-worker.lock'))
        descriptor = os.pidfd_open(pause_capture.pid)
        try:
            fields = Path('/proc/' + str(pause_capture.pid) + '/stat').read_text().rsplit(') ', 1)[1].split()
            require(fields[19] == pause_state['capture']['guardian']['startTicks'])
            signal.pidfd_send_signal(descriptor, signal.SIGKILL)
        finally:
            os.close(descriptor)
        require(pause_capture.wait(timeout=5) == -9)
        os.close(pause_gate)
        require(available(pause_coord / 'deployment-online-worker.lock'))
        for name in ['pause-jobs', 'pause-capture-retry']:
            replacement = launch(name)
            out, err = replacement.communicate(timeout=8)
            require(replacement.returncode == 75 and not out, 'DEAD_CAPTURE_PAUSE_BYPASSED')
            require(not (Path(grants[name]['scope']['nativeDirectory']) / 'deployment-runtime-native.json').exists())

        def paused_request():
            client = http.client.HTTPConnection('127.0.0.1', pause_ready['port'], timeout=8)
            try:
                client.request('GET', '/read')
                response = client.getresponse()
                response.read()
                return response.status
            finally:
                client.close()

        with ThreadPoolExecutor(max_workers=1) as executor:
            waiting = executor.submit(paused_request)
            time.sleep(0.1)
            require(not waiting.done(), 'SERVING_REOPENED_AFTER_CAPTURE_OWNER_DEATH')
            finish('pause-http', pause_http)
            require(waiting.result(timeout=8) == 503)
        require(pause_file.read_bytes() == pause_raw
                and not (pause_coord / 'online/admission/00000002.json').exists())
        interrupted_pause_refused = True
    require(sql("SELECT count(*) FROM pg_stat_activity WHERE datname='" + database + "'") == '0')
    require(sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + database + "'") == '0')
    sql('DROP DATABASE "' + database + '"')  # No force, after actual namespace/pool closure.
    proven = True
    print(json.dumps(dict(format='sabalan-online-native-acceptance/v1', passResult=True,
                          simultaneousServingPools=2, singleWorker=True, captureCannotStealWorker=True,
                          servingContinuedDuringWorkerOwnership=True, disconnectedCommit=row,
                          globalInterlockHeldUntilSqlCompletion=True, grantReuseRefused=True,
                          substitutedCaptureGateRefused=True, actualCaptureGateExclusive=True,
                          fullRuntimeIdNamespaceSeparation=True, deadWorkerDurableFenceRefused=True,
                          existingNullWorkerRefusedDuringOrphanSql=True,
                          retainedWorkerHoldSha256=hashlib.sha256(worker_raw).hexdigest(),
                          legacyFleetBypassRefused=True, scopedHttpAndWorkerWork=scoped,
                          durableCapturePauseWithQueuedHttp=capture_finished,
                          registeredBackendCensusAndComponent=component_evidence,
                          orphanWorkClaimRefused=scoped and capture_finished,
                          interruptedCapturePauseRetained=interrupted_pause_refused, droppedDatabase=database)))
finally:
    if not proven:
        print('ONLINE_NATIVE_ACCEPTANCE_HELD ' + str(root), file=sys.stderr)
