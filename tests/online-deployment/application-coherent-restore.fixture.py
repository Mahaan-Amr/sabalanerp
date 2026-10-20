"""Actual Node versions -> native coherent cut -> independent post-pause restore.

Private correctness rehearsal, not fleet authority or production pause/RPO proof.
All PostgreSQL databases belong to this fixture in the existing local service.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import select
import sqlite3
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit, urlunsplit

root = Path(sys.argv[1])
assert re.fullmatch(r'/app/online-runtime-acceptance/application-coherent-[a-f0-9]{32}', str(root))
assert root.resolve(strict=True) == root
config = json.loads((root / 'config.json').read_bytes())
database_name = config['databaseName']
assert re.fullmatch(r'sabalanerp_concurrency_[a-f0-9]{16}', database_name)
assert config['systemIdentifier'] == '7667464637415309346'
source_url = urlsplit(os.environ['DATABASE_URL'])
assert source_url.hostname == 'postgres' and source_url.path == '/sabalanerp'
selected_url = urlunsplit(source_url._replace(path='/' + database_name))


def imported(name, filename):
    spec = importlib.util.spec_from_file_location(name, root / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


files = imported('file_generations', 'recovery-file-generations.py')
postgres = imported('database_freeze', 'recovery-database-freeze.py')
reader = imported('versioned_reader', 'recovery-versioned-files.py')
environment = postgres.postgres_environment(selected_url, 'sabalan-freeze-' + secrets.token_hex(24))


def sql(statement, selected=database_name):
    result = subprocess.run(['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', statement],
                            env=dict(environment, PGDATABASE=selected), capture_output=True)
    if result.returncode != 0:
        raise RuntimeError('VERSIONED_COHERENT_SQL_FAILED')
    return result.stdout.decode().strip()


def receive(process, timeout=15):
    assert select.select([process.stdout], [], [], timeout)[0], 'ACTOR_READINESS_MISSING'
    while True:
        line = process.stdout.readline()
        assert line, 'ACTOR_CLOSED_WITHOUT_CONTROL_MESSAGE'
        if line.startswith(b'APPLICATION_CONTROL:'):
            return json.loads(line[len(b'APPLICATION_CONTROL:'):])
        if line.startswith(b'{'):
            return json.loads(line)
        os.write(diagnostic, line)


def send(process, value):
    process.stdin.write((json.dumps(value) + '\n').encode())
    process.stdin.flush()


diagnostic = os.open(root / 'native.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
gate_file = root / 'deployment-write-admission.lock'
gate = os.open(gate_file, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
gate_stat = os.fstat(gate)
for name in ('source-app', 'restored-app', 'sqlite-live', 'captured-component', 'native-control'):
    (root / name).mkdir(mode=0o700)
# Duplicate outside all reserved descriptor numbers before remapping. Both
# parent and Node retain the SAME open description; there is no reopened EX.
node_launcher = '''import fcntl,os,sys
copy=fcntl.fcntl(int(sys.argv[1]),fcntl.F_DUPFD_CLOEXEC,20)
os.dup2(copy,10);os.close(copy)
bootstrap="process.umask(0o077);process.chdir(process.env.APPLICATION_COHERENT_CWD);process.env.RECOVERY_STORAGE_DIR=process.cwd()+'/private-recovery';process.env.RECOVERY_COORDINATION_DIR=process.cwd()+'/private-recovery/coordination';process.env.SUPPORT_TICKET_STORAGE_DIR=process.cwd()+'/storage/support-tickets';require(process.argv[1]);"
os.execvp('node',['node','-e',bootstrap,sys.argv[2]])
'''
application_environment = dict(os.environ, NODE_ENV='test', NODE_PATH='/app/node_modules', ALLOW_UNSCANNED_HR_FILES='true',
                               APPLICATION_COHERENT_ROOT=str(root), APPLICATION_COHERENT_MODE='source',
                               APPLICATION_COHERENT_CWD=str(root / 'source-app'), DATABASE_URL=selected_url)
publisher = subprocess.Popen([sys.executable, '-c', node_launcher, str(gate), str(root / 'application.cjs')],
                             env=application_environment, pass_fds=(gate,), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=diagnostic, bufsize=0)
publisher_ready = receive(publisher, 60)
assert publisher_ready['phase'] == 'APPLICATION_READY'
assert publisher_ready['gate']['device'] == str(gate_stat.st_dev)
assert publisher_ready['gate']['inode'] == str(gate_stat.st_ino)
sql('''CREATE TABLE public.recovery_capture_probe (
id text PRIMARY KEY, amount numeric(24,8) NOT NULL, quantity numeric(24,8) NOT NULL, storage_key text NOT NULL);
INSERT INTO public.recovery_capture_probe VALUES ('same-instant',123456789.12345678,0.00000001,'original.pdf');''')
history = sql('SELECT md5(string_agg(row_to_json(m)::text,E\'\\n\' ORDER BY migration_name,id)) FROM public._prisma_migrations m')
migration_count = int(sql('SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL'))
source_oid = sql('SELECT oid FROM pg_database WHERE datname=current_database()')
sqlite_file = root / 'sqlite-live/inquiry.db'
with sqlite3.connect(sqlite_file) as connection:
    connection.execute('CREATE TABLE inquiry_capture_probe(id TEXT PRIMARY KEY, amount TEXT NOT NULL)')
    connection.execute("INSERT INTO inquiry_capture_probe VALUES ('same-instant','123456789.12345678')")
os.chmod(sqlite_file, 0o600)
fcntl.flock(gate, fcntl.LOCK_EX)
boundary_started = time.monotonic()
work, native_control = root / 'captured-component', root / 'native-control'
live = Path(publisher_ready['sources'][0]['path'])
capture_scope = {'format': 'sabalan-coherent-capture-scope/v2', 'captureId': secrets.token_hex(32),
                 'handshake': secrets.token_hex(32), 'systemIdentifier': config['systemIdentifier'],
                 'databaseName': database_name, 'storeRoot': None, 'logicalDump': True,
                 'sources': publisher_ready['sources'],
                 'inquiry': {'path': str(sqlite_file), 'device': str(sqlite_file.stat().st_dev),
                             'inode': str(sqlite_file.stat().st_ino)}}
scope_file = work / 'scope.json'
scope_file.write_text(json.dumps(capture_scope))
os.chmod(scope_file, 0o400)
control_file = native_control / 'deployment-runtime-control.lock'
control = os.open(control_file, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
fcntl.flock(control, fcntl.LOCK_EX)
files.sync_ancestry(str(work))
files.sync_ancestry(str(native_control))
native_environment = dict(os.environ, DATABASE_URL=selected_url, BACKEND_RUNTIME_ROLE='control',
                          RECOVERY_COORDINATION_DIR=str(native_control), BACKEND_CONTROL_LOCK_FD='9',
                          BACKEND_CONTROL_LOCK_FILE=str(control_file), BACKEND_CAPTURE_GATE_FD='10',
                          BACKEND_CAPTURE_GATE_FILE=str(gate_file),
                          BACKEND_CAPTURE_GATE_DEVICE=str(gate_stat.st_dev), BACKEND_CAPTURE_GATE_INODE=str(gate_stat.st_ino))
launcher = '''import fcntl,os,sys
first=fcntl.fcntl(int(sys.argv[1]),fcntl.F_DUPFD_CLOEXEC,20)
second=fcntl.fcntl(int(sys.argv[2]),fcntl.F_DUPFD_CLOEXEC,20)
os.dup2(first,10);os.dup2(second,9)
for descriptor in {int(sys.argv[1]),int(sys.argv[2]),first,second}-{9,10}:os.close(descriptor)
os.execv(sys.executable,[sys.executable,sys.argv[3],sys.executable,sys.argv[4],sys.argv[5]])
'''
guardian = subprocess.Popen([sys.executable, '-c', launcher, str(gate), str(control),
                             str(root / 'backend-runtime-owner.py'), str(root / 'capture-coherent-components.py'), str(scope_file)],
                            env=native_environment, pass_fds=(gate, control), stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=diagnostic, bufsize=0)
os.close(control)
ready = receive(guardian)
assert ready['phase'] == 'FROZEN' and ready['handshake'] == capture_scope['handshake']
assert ready['relations'] > 200
assert sql('SELECT count(*) FROM public.recovery_capture_probe') == '1'
send(publisher, {'command': 'seal', 'captureId': capture_scope['captureId']})
sealed = receive(publisher, 8)
assert sealed['phase'] == 'SEALED'
# An actual admitted writer waits for the same gate, without cancellation.
send(publisher, {'command': 'mutate'})
queued_env = dict(environment, PGAPPNAME='versioned-queued-' + secrets.token_hex(16),
                  PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=0 -c search_path=pg_catalog')
queued = subprocess.Popen(['psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c',
                          "UPDATE public.recovery_capture_probe SET amount=77.00000001 WHERE id='same-instant'"],
                         env=queued_env, stdout=subprocess.PIPE, stderr=diagnostic)
assert not select.select([publisher.stdout], [], [], 0.05)[0]
assert not select.select([publisher.stdout], [], [], 0)[0]
output, _ = guardian.communicate(input=(json.dumps({'phase': 'BEGIN_CAPTURE',
    'handshake': capture_scope['handshake'], 'versionedCuts': sealed['versionedCuts']}) + '\n').encode())
assert guardian.returncode == 0, 'Native capture failed; retain all evidence'
captured = json.loads((work / 'captured.json').read_bytes())
assert captured['format'] == 'sabalan-coherent-component/v3'
assert captured['phase'] == 'CAPTURED_AWAITING_NATIVE_CLOSURE'
assert captured['versionedCuts'] == sealed['versionedCuts']
native = json.loads((native_control / 'deployment-runtime-native.json').read_bytes())
assert native['phase'] == 'QUIESCENT' and native['nativeReaped'] and native['databaseQuiet'] and native['nativeStatus'] == 0
assert native['activeClaimSha256'] == captured['nativeClaimSha256']
assert native['captureGate']['device'] == str(gate_stat.st_dev) and native['captureGate']['inode'] == str(gate_stat.st_ino)
control = os.open(control_file, os.O_RDONLY)
fcntl.flock(control, fcntl.LOCK_EX | fcntl.LOCK_NB)
os.close(control)
fcntl.flock(gate, fcntl.LOCK_UN)
boundary_ms = round((time.monotonic() - boundary_started) * 1000)
post_cut = receive(publisher)
assert post_cut['phase'] == 'MUTATED'
queued.communicate()
assert queued.returncode == 0
with sqlite3.connect(sqlite_file) as connection:
    connection.execute("UPDATE inquiry_capture_probe SET amount='77.00000001'")
assert sql("SELECT amount::text FROM public.recovery_capture_probe") == '77.00000001'
assert isinstance(post_cut['storageName'], str)
send(publisher, {'command': 'stop'})
assert receive(publisher)['phase'] == 'APPLICATION_CLOSED'
publisher.communicate()
assert publisher.returncode == 0
assert json.loads((Path(publisher_ready['journalRoot']) / 'state.json').read_bytes())['phase'] == 'QUIESCENT'
# Full histories/objects are checked ONLY after native closure and EX release.
restore_started = time.monotonic()
restored_files = []
for cut, enrolled in zip(captured['versionedCuts'], publisher_ready['sources']):
    target = root / ('restored-cut-' + cut['name'])
    restored_files.append(reader.SealedVersionedFiles(cut['storeRoot'], cut['captureId'], cut['sha256']).restore(str(target)))
    relative = Path(enrolled['path']).relative_to(root / 'source-app')
    destination = root / 'restored-app' / relative
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    assert not destination.exists()
    shutil.copytree(target / 'files', destination)
assert len(restored_files) == 5
assert not any((root / 'restored-app' / Path(enrolled['path']).relative_to(root / 'source-app') / post_cut['storageName']).exists() for enrolled in publisher_ready['sources'])
snapshot = work / captured['sqliteSnapshot']['file']
assert hashlib.sha256(snapshot.read_bytes()).hexdigest() == captured['sqliteSnapshot']['sha256']
with sqlite3.connect('file:' + str(snapshot) + '?mode=ro', uri=True) as connection:
    assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert connection.execute('SELECT amount FROM inquiry_capture_probe').fetchone()[0] == '123456789.12345678'
restored_database = 'sabalanerp_concurrency_' + secrets.token_hex(8)
sql('CREATE DATABASE "' + restored_database + '"', 'postgres')
restored_oid = sql("SELECT oid FROM pg_database WHERE datname='" + restored_database + "'", 'postgres')
restore = subprocess.run(['pg_restore', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname=' + restored_database,
                          str(work / 'main.dump')], env=environment, capture_output=True)
assert restore.returncode == 0
assert sql('SELECT md5(string_agg(row_to_json(m)::text,E\'\\n\' ORDER BY migration_name,id)) FROM public._prisma_migrations m', restored_database) == history
assert sql('SELECT amount::text||\'/\'||quantity::text||\'/\'||storage_key FROM public.recovery_capture_probe', restored_database) == '123456789.12345678/0.00000001/original.pdf'
restored_url = urlunsplit(source_url._replace(path='/' + restored_database))
restored_environment = dict(application_environment, DATABASE_URL=restored_url,
                            APPLICATION_COHERENT_MODE='restored', APPLICATION_COHERENT_CWD=str(root / 'restored-app'))
restored_actor = subprocess.Popen([sys.executable, '-c', node_launcher, str(gate), str(root / 'application.cjs')],
                                  env=restored_environment, pass_fds=(gate,), stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=diagnostic, bufsize=0)
restored_ready = receive(restored_actor, 30)
assert restored_ready['phase'] == 'APPLICATION_READY' and restored_ready['source'] is False
send(restored_actor, {'command': 'stop'})
assert receive(restored_actor)['phase'] == 'APPLICATION_CLOSED'
restored_actor.communicate()
assert restored_actor.returncode == 0
assert json.loads((Path(restored_ready['journalRoot']) / 'state.json').read_bytes())['phase'] == 'QUIESCENT'
assert sql("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname='" + restored_database + "')+(SELECT count(*) FROM pg_prepared_xacts WHERE database='" + restored_database + "')", 'postgres') == '0'
assert sql("SELECT oid FROM pg_database WHERE datname='" + restored_database + "'", 'postgres') == restored_oid
sql('DROP DATABASE "' + restored_database + '"', 'postgres')
assert sql("SELECT oid FROM pg_database WHERE datname='" + database_name + "'", 'postgres') == source_oid
assert sql("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname='" + database_name + "')+(SELECT count(*) FROM pg_prepared_xacts WHERE database='" + database_name + "')", 'postgres') == '0'
os.close(gate)
os.close(diagnostic)
report = {'format': 'sabalan-application-coherent-native/v1', 'pass': True, 'workingRoot': str(root),
          'sourceDatabaseName': database_name, 'sourceDatabaseOid': source_oid, 'migrationCount': migration_count,
          'migrationHistoryMd5': history, 'nativeCompletionProven': True, 'actualNodePublisher': True, 'canonicalApplicationBootedBeforeAndAfterRestore': True,
          'restoredAuthenticatedIdentityVerified': True, 'restoredAccountingAmountRials': '123456789',
          'restoredAttachmentDownloadVerified': True, 'erasedAttachmentNotResurrected': True,
          'postCutAttachmentAbsentFromRestore': True,
          'inheritedSameGateDescription': True, 'nativeCaptureGuardianClosed': True,
          'versionedCuts': captured['versionedCuts'], 'restorePoint': captured['restorePoint'],
          'lockedRelations': ready['relations'], 'sqliteSnapshot': captured['sqliteSnapshot'],
          'restoredFiles': restored_files, 'restoredAmount': '123456789.12345678', 'restoredQuantity': '0.00000001',
          'queuedMutationCommitted': '77.00000001', 'restoreOutsideCapturePause': True,
          'restoredTemporaryDatabaseDroppedWithoutForce': True, 'captureBoundaryMs': boundary_ms,
          'nativeRestoreMs': round((time.monotonic() - restore_started) * 1000),
          'productionAdmission': False, 'fullApplicationRestore': False, 'continuousRecovery': False}
proof_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
try:
    files.publish_record(proof_fd, 'native-proof.json', report)
finally:
    os.close(proof_fd)
print(json.dumps(report))
