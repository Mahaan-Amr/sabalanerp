"""Real compiled Next actions, actual native pause, SQLite restore and reboot."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.request

os.umask(0o077)
root = Path(sys.argv[1])
assert re.fullmatch(r'/app/online-runtime-acceptance/inquiry-coherent-[a-f0-9]{32}', str(root))
assert root.resolve(strict=True) == root
prepared = json.loads((root / 'prepared.json').read_bytes())
stop_spec = importlib.util.spec_from_file_location('requested_stop', root / 'requested-stop.py')
stop_module = importlib.util.module_from_spec(stop_spec)
stop_spec.loader.exec_module(stop_module)
app = root / 'app'
log = os.open(root / 'native.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)


def wait(predicate, name, seconds=30):
    end = time.monotonic() + seconds
    while not predicate():
        assert time.monotonic() < end, name
        time.sleep(0.01)


def record(name):
    return json.loads((Path(prepared[name]['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes())


def work(name):
    return json.loads((Path(prepared[name]['boundaryDirectory']) / 'state.json').read_bytes())


def native_environment(name):
    env = {k: v for k, v in os.environ.items() if not k.startswith(('PG', 'BACKEND_', 'INQUIRY_NATIVE_')) and k != 'DATABASE_URL'}
    env.update(DATABASE_URL='file:' + str(root / ('source.db' if name == 'source' else 'restored.db')) + '?connection_limit=2&pool_timeout=5',
               BACKEND_RUNTIME_ROLE='serving', BACKEND_ONLINE_SCOPE_FILE=prepared[name]['file'],
               BACKEND_ONLINE_SCOPE_SHA256=prepared[name]['sha256'], RECOVERY_COORDINATION_DIR=str(root / 'coordination'),
               INQUIRY_RUNTIME_GENERATION='1', INQUIRY_COHERENT_ROOT=str(root), NODE_ENV='production',
               SESSION_SECRET=prepared['sessionSecret'], NEXT_TELEMETRY_DISABLED='1',
               NODE_OPTIONS='--require=' + str(root / 'observer.cjs'))
    for key in ['SMS_IR_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'SENDGRID_API_KEY']:
        env.pop(key, None)
    return env


def start(name):
    return subprocess.Popen(['/usr/bin/python3', '-I', '-B', str(root / 'online-inquiry-owner.py'), '/usr/local/bin/node',
                             str(app / 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3287'],
                            cwd=app, env=native_environment(name), stdout=log, stderr=log)


def healthy():
    try:
        with urllib.request.urlopen('http://127.0.0.1:3287/admin/login', timeout=1) as response:
            return response.status == 200
    except Exception:
        return False


def client(mode, asynchronous=False):
    command = ['/usr/local/bin/node', str(root / 'client.cjs'), str(root), mode]
    actor = subprocess.Popen(command, cwd=app, stdout=subprocess.PIPE, stderr=log)
    if asynchronous:
        return actor
    output = actor.communicate()[0]
    assert actor.returncode == 0, 'NATIVE_HTTP_CLIENT_FAILED_' + mode
    return output.decode()


def product_rows(file):
    with sqlite3.connect('file:' + str(file) + '?mode=ro', uri=True) as database:
        return database.execute('SELECT rowNumber,listPrice,finalPrice FROM Product ORDER BY rowNumber').fetchall()


def stop(actor, name):
    assert actor.poll() is None and work(name)['phase'] == 'QUIESCENT'
    # Signal only our original native guardian, which forwards ordinary TERM
    # and continues to own both locks until every actual descendant exits.
    initial_raw = (Path(prepared[name]['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes()
    initial = json.loads(initial_raw)
    assert initial['phase'] == 'ACTIVE' and initial['guardian']['pid'] == actor.pid
    request = {'format': 'sabalan-private-inquiry-requested-stop/v1', 'guardian': initial['guardian'],
               'activeClaimSha256': hashlib.sha256(initial_raw).hexdigest(), 'signal': 'SIGTERM',
               'expectedNativeStatus': 143, 'naturalExitZeroExpected': False}
    with (root / (name + '-requested-stop.json')).open('x') as receipt:
        json.dump(request, receipt, sort_keys=True); receipt.flush(); os.fsync(receipt.fileno())
    parent = os.open(root, os.O_RDONLY | os.O_DIRECTORY); os.fsync(parent); os.close(parent)
    actor.send_signal(signal.SIGTERM)
    actor.wait()
    final = record(name)
    stop_module.qualify_requested_stop(request, initial, final, actor.returncode)
    return final


source_env = native_environment('source')
for key in list(source_env):
    if key.startswith(('BACKEND_', 'INQUIRY_NATIVE_')) or key in ['INQUIRY_RUNTIME_GENERATION', 'NODE_OPTIONS']:
        source_env.pop(key)
schema = subprocess.run(['/usr/local/bin/node', str(app / 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate',
                         '--schema', str(app / 'prisma/schema.prisma')], cwd=app, env=source_env, stdout=log, stderr=log)
assert schema.returncode == 0
os.chmod(root / 'source.db', 0o600)
seed = """const {PrismaClient}=require('./node_modules/@prisma/client'),bcrypt=require('./node_modules/bcryptjs');
const db=new PrismaClient();(async()=>{try{if(await db.admin.count()||await db.product.count())throw Error('NOT_EMPTY');
await db.admin.create({data:{id:'private-coherent-admin',email:'coherent@example.invalid',passwordHash:await bcrypt.hash('private-coherent-only',4)}});
}finally{await db.$disconnect();}})().catch(error=>{console.error(error);process.exitCode=1;});"""
seeded = subprocess.run(['/usr/local/bin/node', '-e', seed], cwd=app, env=source_env, stdout=log, stderr=log)
assert seeded.returncode == 0
source = start('source')
wait(healthy, 'SOURCE_NEXT_NOT_READY')
assert record('source')['phase'] == 'ACTIVE'
assert 'LOGIN_OK' in client('login')
assert 'QUEUED_NATIVE_FORM_PREPARED' in client('prepare-queued')
ambiguous = client('ambiguous', True)
wait(lambda: (root / 'action-delayed').exists(), 'REAL_ADMITTED_CALLBACK_NOT_REACHED')
out = ambiguous.communicate()[0]
assert ambiguous.returncode == 0 and b'ACK_LOST_NO_REPLAY' in out
assert work('source')['phase'] == 'ACTIVE'
capture_environment = dict(os.environ, BACKEND_RUNTIME_ROLE='control', RECOVERY_COORDINATION_DIR=str(root / 'coordination'),
                           BACKEND_ONLINE_SCOPE_FILE=prepared['capture']['file'], BACKEND_ONLINE_SCOPE_SHA256=prepared['capture']['sha256'])
capture = subprocess.Popen(['/usr/bin/python3', '-I', '-B', str(root / 'online-runtime-owner.py'),
                            '/usr/bin/python3', '-I', '-B', str(root / 'capture.py'), str(root)],
                           cwd=root, env=capture_environment, stdout=log, stderr=log)
admission = root / 'coordination/online/admission'
wait(lambda: (admission / '00000001.json').exists(), 'NATIVE_CLOSING_NOT_PUBLISHED')
assert json.loads((admission / '00000001.json').read_bytes())['phase'] == 'CLOSING'
queued = client('queued', True)
wait(lambda: (root / 'queued-acquire').exists(), 'QUEUED_NATIVE_ACTION_NOT_ADMITTED')
assert (root / 'queued-arrived').exists() and queued.poll() is None
release = os.open(root / 'release-action', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
os.fsync(release)
os.close(release)
capture.wait()
assert capture.returncode == 0
capture_final = record('capture')
assert capture_final['phase'] == 'QUIESCENT' and capture_final['nativeReaped'] and capture_final['databaseQuiet']
assert capture_final['nativeStatus'] == 0
assert json.loads((admission / '00000002.json').read_bytes())['phase'] == 'OPEN'
queued_out = queued.communicate()[0]
assert queued.returncode == 0 and b'QUEUED_COMMITTED' in queued_out
assert product_rows(root / 'source.db') == [('COHERENT-ACK-LOST', 1234567.0, 2345678.0), ('COHERENT-QUEUED', 1234567.0, 2345678.0)]
source_final = stop(source, 'source')
cut = json.loads((root / 'capture-proof.json').read_bytes())
assert hashlib.sha256((root / 'restored.db').read_bytes()).hexdigest() == cut['sha256']
assert product_rows(root / 'restored.db') == [('COHERENT-ACK-LOST', 1234567.0, 2345678.0)]
restored = start('restored')
wait(healthy, 'RESTORED_NEXT_NOT_READY')
assert 'RESTORED_NEXT_READ_OK' in client('restored')
assert 'DUPLICATE_REFUSED' in client('retry')
assert product_rows(root / 'restored.db') == [('COHERENT-ACK-LOST', 1234567.0, 2345678.0)]
restored_final = stop(restored, 'restored')
report = {'format': 'sabalan-inquiry-coherent-next-restore/v1', 'pass': True, 'workingRoot': str(root),
          'actualCompiledNextSourceAndRestoredBoot': True, 'actualNativeHtmlAction': True,
          'lostAcknowledgementCommittedExactlyOnce': True, 'retryRejectedWithoutDuplicate': True,
          'queuedActionAbsentFromCapturedSqlite': True, 'capturedSqlite': cut,
          'sourceNativeClosed': source_final['nativeReaped'] and source_final['sqliteNativeClosed'],
          'sourceNativeStatus': source_final['nativeStatus'], 'sourceRetiredByRequestedSigterm': True,
          'sourceNaturalExitZero': False, 'restoredNativeStatus': restored_final['nativeStatus'],
          'restoredRetiredByRequestedSigterm': True, 'restoredNaturalExitZero': False,
          'restoredNativeClosed': restored_final['nativeReaped'] and restored_final['sqliteNativeClosed'],
          'captureNativeAndDatabaseClosed': capture_final['nativeReaped'] and capture_final['databaseQuiet'],
          'productionAdmission': False, 'immutableImageAdmission': False, 'browser24HourContract': False,
          'fullApplicationSinglePoint': False, 'independentBackupRestore': False}
with (root / 'native-proof.json').open('x') as output:
    json.dump(report, output, sort_keys=True)
    output.flush()
    os.fsync(output.fileno())
os.close(log)
print(json.dumps(report))
