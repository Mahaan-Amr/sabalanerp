"""Observe every registered backend under real scoped capture ownership.

This does NOT certify images, host registration, Inquiry, privacy, recovery or a
release. The host controller must verify those and freeze scope issuance under
the worker lock. No orphan work is settled and no native registration is erased.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from datetime import datetime
from urllib.parse import unquote, urlsplit


def require(value):
    if not value:
        raise RuntimeError('ONLINE_BACKEND_BOUNDARY_UNPROVEN')


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode('ascii')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def exact(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def private_directory(file):
    value = file.lstat()
    require(file.resolve(strict=True) == file and stat.S_ISDIR(value.st_mode)
            and value.st_uid == os.getuid() and not value.st_mode & 0o077)
    return (value.st_dev, value.st_ino)


def entries(directory, maximum):
    result = []
    with os.scandir(directory) as items:
        for item in items:
            result.append(item.name)
            require(len(result) <= maximum)
    return sorted(result)


def read(file, mode=0o600):
    require(file.resolve(strict=True) == file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
                and before.st_mode & 0o777 == mode and 0 < before.st_size <= 16384)
        raw = os.read(fd, 16385)
        after, named = os.fstat(fd), file.lstat()
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
                                  value.st_ctime_ns, value.st_mode, value.st_uid, value.st_nlink)
        require(len(raw) == before.st_size and identity(before) == identity(after) == identity(named))
        value = json.loads(raw)
        require(encode(value) == raw)
        return value, raw
    finally:
        os.close(fd)


def private_locked(file, expected):
    require(file.resolve(strict=True) == file)
    fd = os.open(file, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        value, named = os.fstat(fd), file.lstat()
        require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid() and value.st_nlink == 1
                and value.st_mode & 0o777 == 0o600 and value.st_size == 0
                and (value.st_dev, value.st_ino) == (named.st_dev, named.st_ino)
                and str(value.st_dev) == expected['device'] and str(value.st_ino) == expected['inode'])
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return True
        return False
    finally:
        os.close(fd)


def inspect_work_claim(work_directory, runtime_id, grant_sha, native, native_active_sha, declaration_raw):
    """Read-only identity/completion check; grants no capture authority itself."""
    admission_api = load('fleet_work_birth', 'online-capture-admission.py')
    require(entries(work_directory, 3) == ['claim.json', 'scope.json', 'state.json'])
    claim, claim_raw = read(work_directory / 'claim.json')
    state, state_raw = read(work_directory / 'state.json')
    require(exact(claim, ['format', 'scopeSha256', 'birth', 'native'])
            and claim['format'] == 'sabalan-runtime-claim/v2' and claim['scopeSha256'] == digest(declaration_raw)
            and claim['native'] == dict(scopeSha256=grant_sha, claimSha256=native_active_sha)
            and admission_api.valid_capture(dict(runtimeId=runtime_id, scopeSha256=grant_sha, guardian=claim['birth']))
            and claim['birth']['bootId'] == native['guardian']['bootId']
            and claim['birth']['pidNamespace'] == native['guardian']['pidNamespace']
            and claim['birth']['pid'] != native['guardian']['pid'])
    require(exact(state, ['format', 'claimSha256', 'epoch', 'phase', 'previousStateSha256', 'updatedAt'])
            and state['format'] == 'sabalan-runtime-boundary/v1' and state['claimSha256'] == digest(claim_raw)
            and state['phase'] == 'QUIESCENT' and type(state['epoch']) is int and 0 <= state['epoch'] < 2**53
            and (state['previousStateSha256'] is None if state['epoch'] == 0
                 else isinstance(state['previousStateSha256'], str) and re.fullmatch(r'[a-f0-9]{64}', state['previousStateSha256']))
            and isinstance(state['updatedAt'], str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', state['updatedAt']))
    datetime.strptime(state['updatedAt'], '%Y-%m-%dT%H:%M:%S.%fZ')
    return [(work_directory / 'claim.json', claim_raw, 0o600), (work_directory / 'state.json', state_raw, 0o600)]


def inspect_registered_backend_boundary(source_url):
    freeze = load('fleet_capture_freeze', 'recovery-database-freeze.py')
    scope_api = load('fleet_scope_input', 'online-runtime-scope.py')
    admission_api = load('fleet_capture_admission', 'online-capture-admission.py')
    owner = load('fleet_native_owner', 'backend-runtime-owner.py')
    namespace = freeze.native_capture_namespace(source_url, 10)
    loaded = scope_api.load_scope(os.environ)
    require(namespace is not None and loaded is not None
            and loaded['scope']['format'] == 'sabalan-online-runtime-scope/v2'
            and loaded['scope']['purpose'] == 'capture')
    scope = loaded['scope']
    coordination = Path(scope['coordinationDirectory'])
    native_root, work_root = coordination / 'online/native', coordination / 'online/work'
    roots = {file: private_directory(file) for file in [coordination / 'online', native_root, work_root]}
    require(set(entries(coordination / 'online', 3)) == {'native', 'work', 'admission'})
    native_names, work_names = entries(native_root, 128), entries(work_root, 128)
    require(native_names == work_names and 1 <= len(native_names) <= 128
            and all(re.fullmatch(r'[a-f0-9]{64}', value) for value in native_names))
    actual_native, actual_raw = read(Path(scope['nativeDirectory']) / 'deployment-runtime-native.json')
    require(digest(actual_raw) == os.environ['BACKEND_NATIVE_CLAIM_SHA256'])
    admission = admission_api.CaptureAdmission(loaded)
    descriptors = dict(private=9, gate=10, interlock=11, worker=12)

    inventories = {}

    def owned():
        require(freeze.native_capture_namespace(source_url, 10) == namespace)
        admission.assert_owner(descriptors, True)
        state, _raw = admission.state()
        require(state['phase'] == 'CLOSING' and state['capture'] == dict(runtimeId=scope['runtimeId'],
                scopeSha256=loaded['sha256'], guardian=actual_native['guardian']))
        require(all(private_directory(file) == identity for file, identity in roots.items())
                and entries(native_root, 128) == native_names and entries(work_root, 128) == work_names
                and all(entries(file, 3) == names for file, names in inventories.items()))

    owned()
    observations, stable, lock_expectations = [], [], []
    closed_names, active_names = [], []
    for runtime_id in native_names:
        native_directory, work_directory = native_root / runtime_id, work_root / runtime_id
        for file in [native_directory, work_directory]:
            roots[file] = private_directory(file)
            inventories[file] = entries(file, 3)
        native_entries, work_entries = inventories[native_directory], inventories[work_directory]
        grant_file = Path('/run/sabalan-online') / (runtime_id + '.json')
        grant, grant_raw = read(grant_file, 0o400)
        other = scope_api.load_scope(dict(BACKEND_ONLINE_SCOPE_FILE=str(grant_file),
                    BACKEND_ONLINE_SCOPE_SHA256=digest(grant_raw), BACKEND_RUNTIME_ROLE=grant['role'],
                    RECOVERY_COORDINATION_DIR=str(coordination)))
        issued = other['scope']
        require(issued['format'] == scope['format'] and issued['runtimeId'] == runtime_id
                and all(issued[key] == scope[key] for key in ['coordinationDirectory', 'gate', 'interlock', 'database', 'admission'])
                and (issued['worker'] is None or issued['worker'] == scope['worker']))
        declaration, declaration_raw = read(work_directory / 'scope.json')
        declared = declaration.get('scope')
        require(exact(declaration, ['format', 'scope']) and declaration['format'] == 'sabalan-runtime-namespace/v1'
                and exact(declared, ['runtimeId', 'image', 'registrySha256', 'generation', 'postgresApplicationName', 'gate'])
                and declared['runtimeId'] == runtime_id and declared['image'] == issued['image']
                and declared['registrySha256'] == issued['manifestSha256']
                and type(declared['generation']) is int and declared['generation'] >= 1
                and declared['postgresApplicationName'] == 'sabalan-rt-' + digest(runtime_id.encode('ascii'))[:48]
                and declared['gate'] == {key: scope['gate'][key] for key in ['device', 'inode', 'ownerUid']})
        stable.extend([(grant_file, grant_raw, 0o400), (work_directory / 'scope.json', declaration_raw, 0o600)])
        if native_entries == ['deployment-runtime-control.lock']:
            require(work_entries == ['scope.json'])
            prepared = (native_directory / 'deployment-runtime-control.lock').lstat()
            expected = dict(device=str(prepared.st_dev), inode=str(prepared.st_ino))
            require(not private_locked(native_directory / 'deployment-runtime-control.lock', expected))
            lock_expectations.append((native_directory / 'deployment-runtime-control.lock', expected, False))
            observations.append(dict(runtimeId=runtime_id, phase='PREPARED', scopeSha256=other['sha256']))
            continue
        require(native_entries == ['deployment-runtime-control.lock', 'deployment-runtime-native.json'])
        native, native_raw = read(native_directory / 'deployment-runtime-native.json')
        require(native.get('format') == 'sabalan-runtime-native/v1' and native.get('phase') in ['ACTIVE', 'QUIESCENT']
                and native.get('role') == issued['role']
                and native.get('instanceId') == digest(runtime_id.encode('ascii'))[:48]
                and native.get('onlineScope', {}).get('scope') == issued
                and native['onlineScope'].get('sha256') == other['sha256']
                and native.get('namespace') == declared['postgresApplicationName']
                and native.get('clusterIdentifier') == scope['database']['systemIdentifier']
                and native.get('initialDatabase', {}).get('name') == scope['database']['name'])
        stable.append((native_directory / 'deployment-runtime-native.json', native_raw, 0o600))
        if runtime_id == scope['runtimeId']:
            require(native_raw == actual_raw and work_entries == ['scope.json'])
            observations.append(dict(runtimeId=runtime_id, phase='CAPTURING', nativeSha256=digest(native_raw)))
            continue
        locked = private_locked(native_directory / 'deployment-runtime-control.lock', native['lock'])
        lock_expectations.append((native_directory / 'deployment-runtime-control.lock', native['lock'], locked))
        if native['phase'] == 'ACTIVE':
            require(issued['purpose'] == 'http' and locked)
            native_active_sha = digest(native_raw)
            active_names.append(native['namespace'])
        else:
            require(not locked)
            owner.assert_closed(native_directory)
            active = dict(native)
            for key in ['activeClaimSha256', 'nativeReaped', 'databaseQuiet', 'nativeStatus', 'stoppedBySignal']:
                active.pop(key)
            active['phase'] = 'ACTIVE'
            native_active_sha = digest(encode(active))
            require(native_active_sha == native['activeClaimSha256'])
            closed_names.append(native['namespace'])
        if issued['purpose'] == 'capture':
            require(native['phase'] == 'QUIESCENT' and work_entries == ['scope.json'])
        else:
            stable.extend(inspect_work_claim(work_directory, runtime_id, other['sha256'], native, native_active_sha, declaration_raw))
        observations.append(dict(runtimeId=runtime_id, phase=native['phase'], nativeSha256=digest(native_raw),
                                 activeClaimSha256=native_active_sha))
    # Every idle pool is allowed; active/transactional SQL is not guessed done.
    # This is a fresh cluster-wide observation, including renamed databases.
    source = urlsplit(source_url)
    names = active_names + closed_names
    require(all(re.fullmatch(r'sabalan-rt-[a-f0-9]{48}', name) for name in names))
    literal_names = ','.join("'" + name + "'" for name in names) or "''"
    literal_closed = ','.join("'" + name + "'" for name in closed_names) or "''"
    query = """SELECT json_build_object('system',c.system_identifier::text,
 'visible',r.rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'),
 'database',current_database(),'prepared',(SELECT count(*) FROM pg_prepared_xacts),
 'busy',(SELECT count(*) FROM pg_stat_activity WHERE application_name IN (""" + literal_names + """)
 AND (datname IS DISTINCT FROM current_database() OR state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL)),
 'closed',(SELECT count(*) FROM pg_stat_activity WHERE application_name IN (""" + literal_closed + """)))
 FROM pg_control_system() c CROSS JOIN pg_roles r WHERE r.rolname=current_user"""
    environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    environment.update(PGHOST=source.hostname, PGPORT=str(source.port or 5432), PGDATABASE=scope['database']['name'],
                       PGUSER=unquote(source.username), PGPASSWORD=unquote(source.password), PGAPPNAME=namespace,
                       PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=5000 -c lock_timeout=250 -c default_transaction_read_only=on -c search_path=pg_catalog')
    owned()
    result = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', query],
                            env=environment, pass_fds=(9, 10, 11, 12), stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    require(result.returncode == 0 and 0 < len(result.stdout) <= 16384)
    sql = json.loads(result.stdout)
    require(sql == dict(system=scope['database']['systemIdentifier'], database=scope['database']['name'],
                        visible=True, prepared=0, busy=0, closed=0))
    owned()
    require(all(read(file, mode)[1] == raw for file, raw, mode in stable))
    require(all(private_locked(file, expected) == locked for file, expected, locked in lock_expectations))
    return dict(format='sabalan-registered-backend-boundary/v1', captureScopeSha256=loaded['sha256'],
                gate=scope['gate'], runtimes=observations, database=sql,
                hostImageAdmission=False, inquiryBoundary=False, productionRecoveryPoint=False)
