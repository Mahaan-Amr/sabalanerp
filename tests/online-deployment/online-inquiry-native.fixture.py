import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import time

root = Path(sys.argv[1])
config = json.loads((root / 'prepared.json').read_text())


def wait(predicate, name):
    deadline = time.monotonic() + 15
    while not predicate():
        assert time.monotonic() < deadline, name
        time.sleep(0.01)


def available(file, mode=fcntl.LOCK_EX):
    with open(file, 'r') as stream:
        try:
            fcntl.flock(stream, mode | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            return False


def state(name):
    return json.loads((root / 'coordination/online/native' / config[name]['runtimeId'] / 'deployment-runtime-native.json').read_text())


def execute(name):
    scope = config[name]
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('PG', 'BACKEND_', 'INQUIRY_NATIVE_')) and key != 'DATABASE_URL'}
    environment.update(BACKEND_RUNTIME_ROLE='serving', BACKEND_ONLINE_SCOPE_FILE=scope['file'],
                       BACKEND_ONLINE_SCOPE_SHA256=scope['sha256'],
                       RECOVERY_COORDINATION_DIR=str(root / 'coordination'),
                       DATABASE_URL='file:' + str(root / 'inquiry.db') + '?connection_limit=2&pool_timeout=5')
    command = ['/usr/bin/python3', '-I', '-B', str(root / 'online-inquiry-owner.py'),
               '/usr/local/bin/node', str(root / ('prisma-worker.cjs' if name == 'prisma-actions' else 'inquiry-worker.cjs')), str(root), name]
    return subprocess.Popen(command, env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


with sqlite3.connect(root / 'inquiry.db') as database:
    database.execute('CREATE TABLE native_probes(id TEXT PRIMARY KEY, amount TEXT NOT NULL, quantity TEXT NOT NULL)')
os.chmod(root / 'inquiry.db', 0o600)
spec = importlib.util.spec_from_file_location('inquiry_sqlite_input', root / 'online-inquiry-owner.py')
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)
original_url = os.environ.get('DATABASE_URL')
try:
    valid = 'file:' + str(root / 'inquiry.db') + '?connection_limit=2&pool_timeout=5'
    os.environ['DATABASE_URL'] = valid
    identity = owner.sqlite_identity()
    assert identity['file'] == str(root / 'inquiry.db')
    assert identity['databaseUrlSha256'] == hashlib.sha256(valid.encode()).hexdigest()
    for query in ['', '?connection_limit=0&pool_timeout=5', '?connection_limit=17&pool_timeout=5',
                  '?connection_limit=2&pool_timeout=121', '?connection_limit=02&pool_timeout=5',
                  '?pool_timeout=5&connection_limit=2', '?connection_limit=2&pool_timeout=5&mode=ro',
                  '?connection_limit=2&pool_timeout=5&pool_timeout=5', '?connection_limit=2&pool_timeout=5#alias']:
        os.environ['DATABASE_URL'] = 'file:' + str(root / 'inquiry.db') + query
        try:
            owner.sqlite_identity()
        except RuntimeError as error:
            assert str(error) == 'INQUIRY_NATIVE_OWNERSHIP_UNPROVEN'
        else:
            raise AssertionError('UNPROVEN_SQLITE_URL_ACCEPTED')
finally:
    if original_url is None:
        os.environ.pop('DATABASE_URL', None)
    else:
        os.environ['DATABASE_URL'] = original_url
results = {}
for name in ['normal', 'lost-node', 'prisma-actions']:
    actor = execute(name)
    wait(lambda: (root / (name + '.body-returned')).exists(), 'action-entered')
    assert actor.poll() is None and not (root / (name + '.action-completed')).exists()
    active = state(name)
    assert active['format'] == 'sabalan-inquiry-native/v2' and active['phase'] == 'ACTIVE'
    assert 'databaseQuiet' not in active and 'connection' not in active
    private = Path(active['onlineScope']['scope']['nativeDirectory']) / 'deployment-runtime-control.lock'
    assert not available(private) and not available(root / 'coordination/deployment-runtime-control.lock')
    work = root / 'coordination/online/work' / config[name]['runtimeId'] / 'state.json'
    assert json.loads(work.read_text())['phase'] == 'ACTIVE'
    assert not available(root / 'coordination/deployment-write-admission.lock')
    if name == 'lost-node':
        node = json.loads((root / (name + '.node.json')).read_text())
        fields = Path('/proc/' + str(node['pid']) + '/stat').read_text().rsplit(') ', 1)[1].split()
        assert fields[19] == node['startTicks'] and int(fields[1]) == actor.pid
        os.kill(node['pid'], signal.SIGKILL)
        wait(lambda: not Path('/proc/' + str(node['pid'])).exists(), 'node-reaped')
        assert actor.poll() is None and not available(private)
        assert state(name)['phase'] == 'ACTIVE'
        assert json.loads(work.read_text())['phase'] == 'ACTIVE'
        # No invented recovery: after Node death its shared gate may close,
        # but native descendants and durable orphan work remain unresolved.
    (root / (name + '.finish')).write_text('allow-owned-query-to-finish')
    stdout, stderr = actor.communicate(timeout=15)
    assert actor.returncode == (137 if name == 'lost-node' else 0), stderr.decode()
    closed = state(name)
    assert closed['phase'] == 'QUIESCENT' and closed['nativeReaped'] is True and closed['sqliteNativeClosed'] is True
    assert closed['activeClaimSha256'] == hashlib.sha256((json.dumps(active, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest()
    assert available(private) and available(root / 'coordination/deployment-runtime-control.lock')
    assert (root / (name + '.sql-committed')).exists()
    with sqlite3.connect('file:' + str(root / 'inquiry.db') + '?mode=ro', uri=True) as database:
        assert database.execute('SELECT amount,quantity FROM native_probes WHERE id=?', (name,)).fetchone() == ('123456789.12345678', '0.00000001')
        assert database.execute('PRAGMA integrity_check').fetchone() == ('ok',)
    assert json.loads(work.read_text())['phase'] == ('ACTIVE' if name == 'lost-node' else 'QUIESCENT')
    retry = execute(name)
    _, error = retry.communicate(timeout=10)
    assert retry.returncode == 75 and b'INQUIRY_NATIVE_OWNERSHIP_UNPROVEN' in error
    results[name] = dict(nativeStatus=actor.returncode, exactCommittedValues=True, consumedGrantRefused=True,
                         nativeClosure=True, unresolvedWorkRetained=name == 'lost-node')
    if name == 'prisma-actions':
        results[name]['actualPrisma'] = json.loads((root / (name + '.prisma-proof')).read_text())
faults = subprocess.run(['/usr/bin/python3', '-I', '-B', str(root / 'faults.fixture.py'), str(root)],
                       capture_output=True, timeout=60)
assert faults.returncode == 0, faults.stderr.decode()
fault_results = json.loads(faults.stdout)
assert all(all(value.values()) for value in fault_results.values()), fault_results
print(json.dumps(dict(format='sabalan-inquiry-native-diagnostic/v1', cases=results, refusalFaults=fault_results,
                     actualNextIntegration=False, publicAdmission=False, productionRecoveryPoint=False)))
