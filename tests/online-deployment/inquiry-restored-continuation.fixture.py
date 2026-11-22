"""Exact restored-only continuation; original status-143 failure stays failed."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.request
from urllib.parse import urlsplit, unquote

os.umask(0o077)
root = Path(sys.argv[1])
assert root == Path('/app/online-runtime-acceptance/inquiry-coherent-7878c93646acd9ac37cef95e27a4029d')
prepared = json.loads((root / 'prepared.json').read_bytes())
assert hashlib.sha256((root / 'fixture.py').read_bytes()).hexdigest() == '0a7f8fcfc402fbf2b6000559991a1d90aa096fd620bc3406e0113ab139bfa08b'
original = {}
locks = []
for name in ['deployment-online-worker.lock', 'deployment-runtime-control.lock', 'deployment-write-admission.lock']:
    fd = os.open(root / 'coordination' / name, os.O_RDONLY | os.O_NOFOLLOW)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    locks.append(fd)
for name, expected_status, expected_claim in [
        ('source', 143, '562beb2cda6097c961c285e2f5f4468c6643d9ff129096838bfd845bf9f7db77'),
        ('capture', 0, 'e2a985e2c7d8c23662f17a821431257ebfd23cb197d5d3b5f805ce5c2609b797')]:
    raw = (Path(prepared[name]['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes()
    value = json.loads(raw)
    assert value['phase'] == 'QUIESCENT' and value['nativeReaped'] and value['nativeStatus'] == expected_status
    assert value['activeClaimSha256'] == expected_claim
    assert value.get('sqliteNativeClosed') if name == 'source' else value.get('databaseQuiet')
    assert not Path('/proc/' + str(value['guardian']['pid'])).exists()
    if name == 'source':
        assert value['stoppedBySignal'] and json.loads((Path(prepared[name]['boundaryDirectory']) / 'state.json').read_bytes())['phase'] == 'QUIESCENT'
    original[name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'record': value}
assert sorted(p.name for p in Path(prepared['restored']['nativeDirectory']).iterdir()) == ['deployment-runtime-control.lock']
assert sorted(p.name for p in Path(prepared['restored']['boundaryDirectory']).iterdir()) == ['scope.json']
assert json.loads((root / 'coordination/online/admission/00000002.json').read_bytes())['phase'] == 'OPEN'
ancestors, parent = {os.getpid()}, os.getppid()
while parent > 1:
    ancestors.add(parent)
    parent = int(Path('/proc/' + str(parent) + '/stat').read_text().rsplit(') ', 1)[1].split()[1])
for process in Path('/proc').iterdir():
    if not process.name.isdigit() or int(process.name) in ancestors:
        continue
    try:
        command = (process / 'cmdline').read_bytes()
        cwd = os.readlink(process / 'cwd')
    except FileNotFoundError:
        continue
    assert str(root).encode() not in command and not cwd.startswith(str(root) + '/'), 'ORIGINAL_ACTOR_REMAINS'
source_url = urlsplit(os.environ['DATABASE_URL'])
assert source_url.hostname == 'postgres'
observer = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
observer.update(PGHOST='postgres', PGPORT=str(source_url.port or 5432), PGDATABASE='postgres',
                PGUSER=unquote(source_url.username), PGPASSWORD=unquote(source_url.password), PGCONNECT_TIMEOUT='5',
                PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=5000')
native = original['capture']['record']
query = "SELECT json_build_object('system',system_identifier::text,'oid',(SELECT oid::text FROM pg_database WHERE datname='sabalanerp'),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name='" + native['namespace'] + "'),'prepared',(SELECT count(*) FROM pg_prepared_xacts)) FROM pg_control_system()"
check = subprocess.run(['psql', '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], env=observer, capture_output=True)
assert check.returncode == 0
sql = json.loads(check.stdout)
assert sql == {'system': native['clusterIdentifier'], 'oid': native['initialDatabase']['oid'], 'sessions': 0, 'prepared': 0}
cut_raw = (root / 'capture-proof.json').read_bytes()
cut = json.loads(cut_raw)
assert hashlib.sha256((root / 'restored.db').read_bytes()).hexdigest() == cut['sha256']
# Preserve an independent immutable capture inode before booting its working copy.
with (root / 'restored.db').open('rb') as source, (root / 'captured-sqlite-retained.db').open('xb') as target:
    while chunk := source.read(262144):
        target.write(chunk)
    target.flush()
    os.fsync(target.fileno())
os.chmod(root / 'captured-sqlite-retained.db', 0o400)
assert hashlib.sha256((root / 'captured-sqlite-retained.db').read_bytes()).hexdigest() == cut['sha256']
for fd in locks:
    os.close(fd)
log = os.open(root / 'restored-continuation.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
env = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'BACKEND_', 'INQUIRY_NATIVE_')) and k != 'DATABASE_URL'}
env.update(DATABASE_URL='file:' + str(root / 'restored.db') + '?connection_limit=2&pool_timeout=5',
           BACKEND_RUNTIME_ROLE='serving', BACKEND_ONLINE_SCOPE_FILE=prepared['restored']['file'],
           BACKEND_ONLINE_SCOPE_SHA256=prepared['restored']['sha256'], RECOVERY_COORDINATION_DIR=str(root / 'coordination'),
           INQUIRY_RUNTIME_GENERATION='1', INQUIRY_COHERENT_ROOT=str(root), NODE_ENV='production',
           SESSION_SECRET=prepared['sessionSecret'], NEXT_TELEMETRY_DISABLED='1')
for key in ['SMS_IR_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'SENDGRID_API_KEY']:
    env.pop(key, None)
actor = subprocess.Popen(['/usr/bin/python3', '-I', '-B', str(root / 'online-inquiry-owner.py'), '/usr/local/bin/node',
                          str(root / 'app/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3287'],
                         cwd=root / 'app', env=env, stdout=log, stderr=log)
end = time.monotonic() + 30
while True:
    try:
        with urllib.request.urlopen('http://127.0.0.1:3287/admin/login', timeout=1) as response:
            if response.status == 200:
                break
    except Exception:
        pass
    assert actor.poll() is None and time.monotonic() < end, 'RESTORED_NEXT_NOT_READY'
    time.sleep(0.01)
for mode, expected in [('restored', b'RESTORED_NEXT_READ_OK'), ('retry', b'DUPLICATE_REFUSED')]:
    client = subprocess.run(['/usr/local/bin/node', str(root / 'client.cjs'), str(root), mode], cwd=root / 'app', stdout=subprocess.PIPE, stderr=log)
    assert client.returncode == 0 and expected in client.stdout
with sqlite3.connect('file:' + str(root / 'restored.db') + '?mode=ro', uri=True) as database:
    assert database.execute('SELECT rowNumber,listPrice,finalPrice FROM Product').fetchall() == [('COHERENT-ACK-LOST', 1234567.0, 2345678.0)]
assert json.loads((Path(prepared['restored']['boundaryDirectory']) / 'state.json').read_bytes())['phase'] == 'QUIESCENT'
actor.send_signal(signal.SIGTERM)
actor.wait()
final_raw = (Path(prepared['restored']['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes()
final = json.loads(final_raw)
assert actor.returncode == 128 and final['phase'] == 'QUIESCENT' and final['nativeReaped'] and final['sqliteNativeClosed']
assert final['stoppedBySignal'] and final['nativeStatus'] == 143
os.fsync(log)
os.close(log)
assert 'Unique constraint failed on the fields: (`rowNumber`)' in (root / 'restored-continuation.log').read_text()
proof = {'format': 'sabalan-exact-inquiry-restored-continuation/v1', 'pass': True,
         'originalRunPassed': False, 'originalSourceNativeStatus': 143, 'originalCaptureNativeStatus': 0,
         'originalClosureSha256': {k: v['sha256'] for k, v in original.items()},
         'captureProofSha256': hashlib.sha256(cut_raw).hexdigest(), 'retainedCapturedSqliteSha256': cut['sha256'],
         'actualCompiledNextRestoredBoot': True, 'actualNativeHtmlLoginAndRead': True,
         'lostAcknowledgementRowPreservedExactlyOnce': True, 'actualUniqueConstraintRetryRefused': True,
         'queuedPostCaptureRowAbsent': True, 'restoredNativeStatus': final['nativeStatus'],
         'restoredNativeReapedAndSqliteClosed': True, 'restoredClosureSha256': hashlib.sha256(final_raw).hexdigest(),
         'productionAdmission': False, 'browser24HourContract': False, 'fullApplicationSinglePoint': False,
         'independentBackupRestore': False}
with (root / 'restored-continuation-proof.json').open('x') as output:
    json.dump(proof, output, sort_keys=True)
    output.flush()
    os.fsync(output.fileno())
fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
os.fsync(fd)
os.close(fd)
print(json.dumps(proof))
