"""Real PostgreSQL/file/SQLite overlap and restore in the existing local stack.

This is a private logical-capture rehearsal, not production admission or proof
of the continuous physical/WAL/erasure/application compatibility program.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import time
from urllib.parse import urlsplit, urlunsplit


root = Path(sys.argv[1])
assert str(root).startswith('/app/online-runtime-acceptance/coherent-capture-')
assert root.resolve(strict=True) == root
config = json.loads((root / 'config.json').read_text())
database_name = config['databaseName']
assert re.fullmatch(r'sabalanerp_concurrency_[a-f0-9]{16}', database_name)
assert config['systemIdentifier'] == '7667464637415309346'
source_url = urlsplit(os.environ['DATABASE_URL'])
assert source_url.hostname == 'postgres' and source_url.path in ('/sabalanerp', '/' + database_name)
selected_url = urlunsplit(source_url._replace(path='/' + database_name))


def imported(name, filename):
    spec = importlib.util.spec_from_file_location(name, root / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


files = imported('file_generations', 'recovery-file-generations.py')
postgres = imported('database_freeze', 'recovery-database-freeze.py')
environment = postgres.postgres_environment(selected_url, 'sabalan-freeze-' + secrets.token_hex(24))


def sql(statement, selected=database_name):
    result = subprocess.run(['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement],
                            env=dict(environment, PGDATABASE=selected), capture_output=True)
    if result.returncode != 0:
        raise RuntimeError('COHERENT_FIXTURE_SQL_FAILED')
    return result.stdout.decode().strip()


def source(directory, name):
    value = directory.stat()
    return {'name': name, 'path': str(directory), 'device': str(value.st_dev), 'inode': str(value.st_ino)}


def wait_for(run, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = run()
        if value:
            return value
        time.sleep(0.01)
    raise AssertionError('NATIVE_CAPTURE_BARRIER_NOT_OBSERVED')


if len(sys.argv) == 3 and sys.argv[2] == 'capture-fault-worker':
    gate = os.fstat(10)
    store = files.FileGenerations(str(root / 'capture-fault/store'), 10, gate.st_dev, gate.st_ino)
    diagnostic = os.open(root / 'capture-fault/native.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    boundary = postgres.DatabaseFreeze(os.environ['DATABASE_URL'], 10, store.assert_gate, diagnostic)
    boundary.acquire(config['systemIdentifier'], database_name)
    print(json.dumps({'workerPid': os.getpid(), 'nativeClientPid': boundary.process.pid,
                      'namespace': boundary.namespace}), flush=True)
    boundary.command('DO $$ BEGIN PERFORM pg_sleep(2); END $$;')
    boundary.close(commit=True)
    raise AssertionError('Fault worker was not interrupted')


gate = os.open(root / 'deployment-write-admission.lock', os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
fcntl.flock(gate, fcntl.LOCK_EX)
gate_stat = os.fstat(gate)
store_root, live, sqlite_root = root / 'store', root / 'uploads', root / 'sqlite-live'
for directory in (store_root, live, sqlite_root):
    directory.mkdir(mode=0o700)
store = files.FileGenerations(str(store_root), gate, gate_stat.st_dev, gate_stat.st_ino)
diagnostic = os.open(root / 'native-postgres.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
sql('''CREATE TABLE public.recovery_capture_probe (
id text PRIMARY KEY, amount numeric(24,8) NOT NULL, quantity numeric(24,8) NOT NULL, storage_key text NOT NULL);
CREATE FUNCTION public.recovery_lost_commit() RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.recovery_capture_probe VALUES ('lost-ack',123456789.12345678,0.00000001,'original.pdf');
 PERFORM pg_sleep(2); RETURN 1;
END $$;''')
(live / 'original.pdf').write_bytes(b'ORIGINAL-ATTACHMENT-123456789.12345678')
import sqlite3
sqlite_file = sqlite_root / 'inquiry.db'
with sqlite3.connect(sqlite_file) as connection:
    connection.execute('CREATE TABLE inquiry_capture_probe(id TEXT PRIMARY KEY, amount TEXT NOT NULL)')
    connection.execute("INSERT INTO inquiry_capture_probe VALUES ('same-instant','123456789.12345678')")
    connection.commit()
os.chmod(sqlite_file, 0o600)

# Real lost client, still executing server-side SQL: locking cannot treat the
# reaped client as transaction completion. No server PID is killed or cancelled.
orphan_environment = dict(environment, PGAPPNAME='coherent-orphan-' + secrets.token_hex(16))
orphan = subprocess.Popen(['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
                           'SELECT public.recovery_lost_commit();'], env=orphan_environment,
                          stdout=subprocess.PIPE, stderr=diagnostic)
wait_for(lambda: sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"
                     + orphan_environment['PGAPPNAME'] + "' AND wait_event='PgSleep'") == '1')
orphan.send_signal(signal.SIGKILL)
orphan.communicate()
assert orphan.returncode == -signal.SIGKILL
first_freeze = postgres.DatabaseFreeze(selected_url, gate, store.assert_gate, diagnostic)
try:
    first_freeze.acquire(config['systemIdentifier'], database_name)
except RuntimeError as error:
    assert str(error) == 'RECOVERY_DATABASE_NATIVE_COMMAND_FAILED'
else:
    raise AssertionError('Server transaction survived its client but did not block capture')
first_freeze.close()
wait_for(lambda: sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"
                     + orphan_environment['PGAPPNAME'] + "'") == '0')
assert sql("SELECT amount::text||'/'||quantity::text FROM public.recovery_capture_probe WHERE id='lost-ack'") == '123456789.12345678/0.00000001'

boundary_started = time.monotonic()
work, native_control = root / 'captured-component', root / 'native-control'
work.mkdir(mode=0o700)
native_control.mkdir(mode=0o700)
capture_scope = {'format': 'sabalan-coherent-capture-scope/v1', 'captureId': secrets.token_hex(32),
                 'handshake': secrets.token_hex(32), 'systemIdentifier': config['systemIdentifier'],
                 'databaseName': database_name, 'storeRoot': str(store_root),
                 'sources': [source(live, 'uploads')], 'logicalDump': True,
                 'inquiry': {'path': str(sqlite_file), 'device': str(sqlite_file.stat().st_dev), 'inode': str(sqlite_file.stat().st_ino)}}
scope_file = work / 'scope.json'
scope_file.write_text(json.dumps(capture_scope))
os.chmod(scope_file, 0o400)
control = os.open(native_control / 'deployment-runtime-control.lock', os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
fcntl.flock(control, fcntl.LOCK_EX)
files.sync_ancestry(str(work))
files.sync_ancestry(str(native_control))
native_environment = dict(os.environ, DATABASE_URL=selected_url, BACKEND_RUNTIME_ROLE='control',
                          RECOVERY_COORDINATION_DIR=str(native_control), BACKEND_CONTROL_LOCK_FD='9',
                          BACKEND_CONTROL_LOCK_FILE=str(native_control / 'deployment-runtime-control.lock'),
                          BACKEND_CAPTURE_GATE_FD='10', BACKEND_CAPTURE_GATE_FILE=str(root / 'deployment-write-admission.lock'),
                          BACKEND_CAPTURE_GATE_DEVICE=str(gate_stat.st_dev), BACKEND_CAPTURE_GATE_INODE=str(gate_stat.st_ino))
launcher = '''import os,sys
gate,control=int(sys.argv[1]),int(sys.argv[2])
first,second=os.dup(gate),os.dup(control)
os.dup2(first,10);os.dup2(second,9)
for descriptor in {gate,control,first,second} - {9,10}:os.close(descriptor)
os.execv(sys.executable,[sys.executable,sys.argv[3],sys.executable,sys.argv[4],sys.argv[5]])
'''
guardian = subprocess.Popen([sys.executable, '-c', launcher, str(gate), str(control),
                             str(root / 'backend-runtime-owner.py'), str(root / 'capture-coherent-components.py'), str(scope_file)],
                            env=native_environment, pass_fds=(gate, control), stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=diagnostic, bufsize=0)
os.close(control)
import select
assert select.select([guardian.stdout], [], [], 15)[0], 'No native capture readiness'
ready = json.loads(guardian.stdout.readline())
assert ready['phase'] == 'FROZEN' and ready['handshake'] == capture_scope['handshake']
assert ready['relations'] > 200
assert sql("SELECT count(*) FROM public.recovery_capture_probe") == '1', 'Reads must continue under SHARE locks'

# A real SQL update waits without being cancelled/replayed. The file/SQLite
# writer independently waits on a distinct shared open-description lock.
queued_environment = dict(environment, PGAPPNAME='coherent-queued-' + secrets.token_hex(16),
                          PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=0 -c search_path=pg_catalog')
queued = subprocess.Popen(['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
                          "UPDATE public.recovery_capture_probe SET amount=77.00000001 WHERE id='lost-ack'"],
                         env=queued_environment, stdout=subprocess.PIPE, stderr=diagnostic)
wait_for(lambda: sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"
                     + queued_environment['PGAPPNAME'] + "' AND wait_event_type='Lock'") == '1')
writer_source = '''import fcntl,os,sqlite3,sys
from pathlib import Path
root=Path(sys.argv[1]); gate=os.open(root/'deployment-write-admission.lock',os.O_RDONLY)
fcntl.flock(gate,fcntl.LOCK_SH)
temporary=root/'uploads/new.tmp'
with temporary.open('xb') as file:
 file.write(b'NEW-ATTACHMENT-77.00000001'); file.flush(); os.fsync(file.fileno())
os.replace(temporary,root/'uploads/original.pdf')
with sqlite3.connect(root/'sqlite-live/inquiry.db') as db:
 db.execute("UPDATE inquiry_capture_probe SET amount='77.00000001'"); db.commit()
os.close(gate)
'''
writer = subprocess.Popen([sys.executable, '-c', writer_source, str(root)], stdout=subprocess.PIPE, stderr=diagnostic)
time.sleep(0.05)
assert writer.poll() is None and (live / 'original.pdf').read_bytes().startswith(b'ORIGINAL-')
output, _ = guardian.communicate(input=(json.dumps({'phase': 'BEGIN_CAPTURE', 'handshake': capture_scope['handshake']}) + '\n').encode())
assert guardian.returncode == 0, 'Native capture owner failed; preserve its journals'
captured = json.loads((work / 'captured.json').read_bytes())
assert captured['phase'] == 'CAPTURED_AWAITING_NATIVE_CLOSURE'
native_record = json.loads((native_control / 'deployment-runtime-native.json').read_bytes())
assert native_record['phase'] == 'QUIESCENT' and native_record['nativeReaped'] and native_record['databaseQuiet']
assert native_record['nativeStatus'] == 0
active = {key: value for key, value in native_record.items()
          if key not in ('nativeReaped', 'databaseQuiet', 'nativeStatus', 'stoppedBySignal', 'activeClaimSha256')}
active['phase'] = 'ACTIVE'
assert hashlib.sha256((json.dumps(active, sort_keys=True, separators=(',', ':')) + '\n').encode()).hexdigest() == captured['nativeClaimSha256']
assert native_record['captureGate'] == {'file': str(root / 'deployment-write-admission.lock'),
                                      'device': str(gate_stat.st_dev), 'inode': str(gate_stat.st_ino), 'descriptor': 10}
assert sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + native_record['namespace'] + "'", 'postgres') == '0'
control = os.open(native_control / 'deployment-runtime-control.lock', os.O_RDONLY)
fcntl.flock(control, fcntl.LOCK_EX | fcntl.LOCK_NB)
os.close(control)
generation = {'sha256': captured['fileGenerationSha256']}
point, identity, dump = captured['restorePoint'], captured['database'], work / 'main.dump'
assert writer.poll() is None
fcntl.flock(gate, fcntl.LOCK_UN)
boundary_ms = round((time.monotonic() - boundary_started) * 1000)
assert boundary_ms < 600000
queued.communicate()
writer.communicate()
assert queued.returncode == 0 and writer.returncode == 0
assert sql("SELECT amount::text FROM public.recovery_capture_probe WHERE id='lost-ack'") == '77.00000001'
assert (live / 'original.pdf').read_bytes() == b'NEW-ATTACHMENT-77.00000001'
with sqlite3.connect(sqlite_file) as connection:
    assert connection.execute('SELECT amount FROM inquiry_capture_probe').fetchone()[0] == '77.00000001'

# Restore into another isolated database in the SAME existing PostgreSQL
# service and a new private file root. Never replace the live fixture database.
restore_started = time.monotonic()
restored_database = 'sabalanerp_concurrency_' + secrets.token_hex(8)
sql('CREATE DATABASE "' + restored_database + '"', 'postgres')
restore = subprocess.run(['pg_restore', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname=' + restored_database, str(dump)],
                         env=environment, capture_output=True)
assert restore.returncode == 0, 'Native logical restore failed'
assert sql("SELECT amount::text||'/'||quantity::text||'/'||storage_key FROM public.recovery_capture_probe WHERE id='lost-ack'", restored_database) == '123456789.12345678/0.00000001/original.pdf'
assert sql('SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL', restored_database) == '427'
fcntl.flock(gate, fcntl.LOCK_EX)
file_restore = store.restore(generation['sha256'], str(root / 'restored-files'))
assert (root / 'restored-files/uploads/original.pdf').read_bytes() == b'ORIGINAL-ATTACHMENT-123456789.12345678'
with sqlite3.connect('file:' + str(root / 'restored-files/inquiry/inquiry.db') + '?mode=ro', uri=True) as connection:
    assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert connection.execute('SELECT amount FROM inquiry_capture_probe').fetchone()[0] == '123456789.12345678'
assert sql("SELECT count(*) FROM pg_stat_activity WHERE datname='" + restored_database + "'") == '0'
sql('DROP DATABASE "' + restored_database + '"', 'postgres')

# Prove the inherited capture gate survives BOTH native worker and psql death
# while their actual PostgreSQL transaction still runs. The real guardian owns
# the only remaining open description and observes SQL before retiring it.
fault = root / 'capture-fault'
for directory in (fault, fault / 'store', fault / 'control'):
    directory.mkdir(mode=0o700)
fault_gate = os.open(fault / 'deployment-write-admission.lock', os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
fcntl.flock(fault_gate, fcntl.LOCK_EX)
fault_gate_stat = os.fstat(fault_gate)
fault_control = os.open(fault / 'control/deployment-runtime-control.lock', os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
fcntl.flock(fault_control, fcntl.LOCK_EX)
fault_environment = dict(native_environment, RECOVERY_COORDINATION_DIR=str(fault / 'control'),
                          BACKEND_CONTROL_LOCK_FILE=str(fault / 'control/deployment-runtime-control.lock'),
                          BACKEND_CAPTURE_GATE_FILE=str(fault / 'deployment-write-admission.lock'),
                          BACKEND_CAPTURE_GATE_DEVICE=str(fault_gate_stat.st_dev), BACKEND_CAPTURE_GATE_INODE=str(fault_gate_stat.st_ino))
fault_launcher = launcher.replace('sys.argv[5]])', "sys.argv[5],'capture-fault-worker'])")
fault_owner = subprocess.Popen([sys.executable, '-c', fault_launcher, str(fault_gate), str(fault_control),
                                str(root / 'backend-runtime-owner.py'), str(root / 'fixture.py'), str(root)],
                               env=fault_environment, pass_fds=(fault_gate, fault_control),
                               stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=diagnostic, bufsize=0)
os.close(fault_gate)
os.close(fault_control)
assert select.select([fault_owner.stdout], [], [], 15)[0]
fault_ready = json.loads(fault_owner.stdout.readline())
fault_record = json.loads((fault / 'control/deployment-runtime-native.json').read_bytes())
assert fault_ready['namespace'] == fault_record['namespace']
assert fault_record['guardian']['pid'] == fault_owner.pid
worker_pidfd = os.pidfd_open(fault_ready['workerPid'])
client_pidfd = os.pidfd_open(fault_ready['nativeClientPid'])
with open('/proc/' + str(fault_ready['workerPid']) + '/stat') as actual_worker:
    assert int(actual_worker.read().rsplit(') ', 1)[1].split()[1]) == fault_owner.pid
with open('/proc/' + str(fault_ready['nativeClientPid']) + '/stat') as actual_client:
    assert int(actual_client.read().rsplit(') ', 1)[1].split()[1]) == fault_ready['workerPid']
wait_for(lambda: sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='"
                     + fault_record['namespace'] + "' AND wait_event='PgSleep'", 'postgres') == '1')
signal.pidfd_send_signal(worker_pidfd, signal.SIGKILL)
signal.pidfd_send_signal(client_pidfd, signal.SIGKILL)
independent_gate = os.open(fault / 'deployment-write-admission.lock', os.O_RDONLY)
try:
    fcntl.flock(independent_gate, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    pass
else:
    raise AssertionError('Capture gate released before actual SQL completion')
assert json.loads((fault / 'control/deployment-runtime-native.json').read_bytes())['phase'] == 'ACTIVE'
fault_owner.communicate()
assert fault_owner.returncode == 125
os.close(worker_pidfd)
os.close(client_pidfd)
fault_closed = json.loads((fault / 'control/deployment-runtime-native.json').read_bytes())
assert fault_closed['phase'] == 'QUIESCENT' and fault_closed['nativeStatus'] == -signal.SIGKILL
assert fault_closed['nativeReaped'] and fault_closed['databaseQuiet']
assert sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + fault_record['namespace'] + "'", 'postgres') == '0'
fcntl.flock(independent_gate, fcntl.LOCK_EX | fcntl.LOCK_NB)
os.close(independent_gate)
assert sql("SELECT count(*) FROM pg_stat_activity WHERE datname='" + database_name + "'", 'postgres') == '0'
os.close(diagnostic)
fcntl.flock(gate, fcntl.LOCK_UN)
os.close(gate)
report = {'format': 'sabalan-coherent-logical-capture-native/v1', 'pass': True,
          'sourceDatabaseName': database_name, 'systemIdentifier': config['systemIdentifier'],
          'migrationCount': 427, 'lockedRelations': identity['relations'], 'restorePoint': point,
          'fileGenerationSha256': generation['sha256'], 'files': file_restore,
          'databaseDumpSha256': hashlib.sha256(dump.read_bytes()).hexdigest(),
          'lostClientCommitted': {'amount': '123456789.12345678', 'quantity': '0.00000001'},
          'queuedUpdateCommittedExactlyOnce': '77.00000001', 'restoredAmount': '123456789.12345678',
          'nativeReadersContinued': True, 'nativeSqlAndFileWritersBlockedUntilRelease': True,
          'nativeCompletionProven': True, 'restoredTemporaryDatabaseDroppedWithoutForce': True,
          'captureBoundaryMs': boundary_ms, 'nativeRestoreMs': round((time.monotonic() - restore_started) * 1000),
          'nativeCaptureGuardianClosed': True, 'nativeCaptureGateDescriptor': 10,
          'nativeCaptureClaimSha256': captured['nativeClaimSha256'],
          'captureGateRetainedAfterWorkerAndClientDeathUntilSqlCompletion': True,
          'workingRoot': str(root), 'productionRecoveryPoint': False}
with (root / 'native-proof.json').open('x') as proof:
    os.chmod(root / 'native-proof.json', 0o400)
    json.dump(report, proof, sort_keys=True)
    proof.flush()
    os.fsync(proof.fileno())
files.sync_directory(str(root))
print(json.dumps(report))
