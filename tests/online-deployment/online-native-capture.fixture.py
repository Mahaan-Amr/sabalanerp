"""Actual scoped database freeze and inherited native descriptors."""
import importlib.util
import json
import os
from pathlib import Path
import re
import hashlib
import secrets
import select
import sqlite3
import subprocess

root = Path(__file__).parent
spec = importlib.util.spec_from_file_location('native_freeze', root / 'recovery-database-freeze.py')
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
source_url = os.environ['DATABASE_URL']
namespace = os.environ['BACKEND_NATIVE_POSTGRES_APPLICATION_NAME']
assert api.native_capture_namespace(source_url, 10) == namespace
claim = json.loads(Path(os.environ['BACKEND_NATIVE_AUTHORITY_FILE']).read_bytes())
backend_boundary = None
component_evidence = None
if claim.get('onlineScope', {}).get('scope', {}).get('format') == 'sabalan-online-runtime-scope/v2':
    spec = importlib.util.spec_from_file_location('backend_boundary', root / 'online-backend-boundary.py')
    fleet = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fleet)
    backend_boundary = fleet.inspect_registered_backend_boundary(source_url)


def owned():
    assert api.native_capture_namespace(source_url, 10) == namespace


with open(os.devnull, 'wb') as diagnostic:
    boundary = api.DatabaseFreeze(source_url, 10, owned, diagnostic.fileno())
    try:
        observed = boundary.acquire(claim['clusterIdentifier'], claim['initialDatabase']['name'])
        assert observed['namespace'] == namespace and observed['relations'] == 1
        # Prove the actual psql child retained each same open description,
        # rather than relying on pass_fds metadata or client process death.
        for descriptor, access in [(9, 'WRITE'), (10, 'WRITE'), (11, 'READ'), (12, 'WRITE')]:
            expected = os.fstat(descriptor)
            actual = os.stat('/proc/' + str(boundary.process.pid) + '/fd/' + str(descriptor))
            assert (expected.st_dev, expected.st_ino) == (actual.st_dev, actual.st_ino)
            details = Path('/proc/' + str(boundary.process.pid) + '/fdinfo/' + str(descriptor)).read_text()
            assert re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+' + access + r'\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                             + str(expected.st_ino) + r'\s+0\s+EOF\s*$', details, re.M)
        boundary.assert_frozen()
    finally:
        assert boundary.close() == 0

if backend_boundary:
    # Exercise the actual composed v2 component worker, not just its table-lock
    # helper: backend census, logical dump, immutable file generation and SQLite.
    component = Path(claim['onlineScope']['scope']['coordinationDirectory']) / 'diagnostic-components' / secrets.token_hex(16)
    component.mkdir(mode=0o700, parents=True)
    for name in ['store', 'assets', 'sqlite', 'capture']:
        (component / name).mkdir(mode=0o700)
    payload = b'EXACT-FILE-123456789.12345678-0.00000001'
    file = component / 'assets' / 'original.pdf'
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        os.write(fd, payload)
        os.fsync(fd)
    finally:
        os.close(fd)
    sqlite_file = component / 'sqlite/inquiry.db'
    connection = sqlite3.connect(sqlite_file)
    try:
        connection.execute('CREATE TABLE capture_probe(id TEXT PRIMARY KEY, amount TEXT, quantity TEXT)')
        connection.execute("INSERT INTO capture_probe VALUES ('same-point','123456789.12345678','0.00000001')")
        connection.commit()
    finally:
        connection.close()
    os.chmod(sqlite_file, 0o600)
    assets = (component / 'assets').stat()
    sqlite_identity = sqlite_file.stat()
    scope = dict(format='sabalan-coherent-capture-scope/v1', captureId=secrets.token_hex(32), handshake=secrets.token_hex(32),
                 systemIdentifier=claim['clusterIdentifier'], databaseName=claim['initialDatabase']['name'],
                 storeRoot=str(component / 'store'), logicalDump=True,
                 sources=[dict(name='uploads', path=str(component / 'assets'), device=str(assets.st_dev), inode=str(assets.st_ino))],
                 inquiry=dict(path=str(sqlite_file), device=str(sqlite_identity.st_dev), inode=str(sqlite_identity.st_ino)))
    scope_file = component / 'capture/scope.json'
    fd = os.open(scope_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o400)
    try:
        raw = json.dumps(scope).encode()
        assert os.write(fd, raw) == len(raw)
        os.fsync(fd)
    finally:
        os.close(fd)
    with (component / 'component.stderr').open('xb') as diagnostic:
        child = subprocess.Popen(['/usr/bin/python3', '-I', '-B', str(root / 'capture-coherent-components.py'), str(scope_file)],
                                 env=os.environ, pass_fds=(9, 10, 11, 12), stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=diagnostic)
        assert select.select([child.stdout], [], [], 10)[0]
        frozen = json.loads(child.stdout.readline())
        assert frozen['phase'] == 'FROZEN' and frozen['handshake'] == scope['handshake'] and frozen['relations'] == 1
        output, _ = child.communicate(input=(json.dumps(dict(phase='BEGIN_CAPTURE', handshake=scope['handshake'])) + '\n').encode())
        assert child.returncode == 0, 'COHERENT_V2_CAPTURE_FAILED'
        assert json.loads(output)['phase'] == 'CAPTURED_AWAITING_NATIVE_CLOSURE'
    captured = json.loads((component / 'capture/captured.json').read_bytes())
    assert captured['format'] == 'sabalan-coherent-component/v2' and captured['productionRecoveryPoint'] is False
    proof = (component / 'capture/registered-backend-boundary.json').read_bytes()
    assert hashlib.sha256(proof).hexdigest() == captured['registeredBackendBoundarySha256']
    assert len(json.loads(proof)['runtimes']) == 7
    dump = component / 'capture/main.dump'
    assert dump.stat().st_size == captured['logicalDump']['bytes']
    assert hashlib.sha256(dump.read_bytes()).hexdigest() == captured['logicalDump']['sha256']
    listed = subprocess.run(['pg_restore', '--list', str(dump)], pass_fds=(9, 10, 11, 12), capture_output=True)
    assert listed.returncode == 0 and b'online_native_probe' in listed.stdout
    restored_database = 'sabalanerp_concurrency_' + secrets.token_hex(8)
    environment = api.postgres_environment(source_url, namespace)

    def sql(statement, database='postgres'):
        result = subprocess.run(['psql', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', statement],
                                env=dict(environment, PGDATABASE=database), pass_fds=(9, 10, 11, 12), capture_output=True)
        assert result.returncode == 0, 'COMPOSED_RESTORE_SQL_FAILED'
        return result.stdout.strip()

    sql('CREATE DATABASE "' + restored_database + '"')
    restored = subprocess.run(['pg_restore', '--no-owner', '--no-privileges', '--exit-on-error', '--dbname=' + restored_database, str(dump)],
                              env=environment, pass_fds=(9, 10, 11, 12), capture_output=True)
    assert restored.returncode == 0
    restored_values = json.loads(sql("SELECT json_build_object('rows',count(*),'queued',bool_or(id='pause-after'),"
        "'amount',max(amount)::text,'quantity',max(quantity)::text) FROM public.online_native_probe", restored_database))
    assert restored_values == dict(rows=2, queued=False, amount='123456789.12345678', quantity='0.00000001')
    assert sql("SELECT count(*) FROM pg_stat_activity WHERE datname='" + restored_database + "'") == b'0'
    assert sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + restored_database + "'") == b'0'
    sql('DROP DATABASE "' + restored_database + '"')  # No FORCE; verified exact idle temporary target.
    spec = importlib.util.spec_from_file_location('composed_files', root / 'recovery-file-generations.py')
    generations = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generations)
    gate = os.fstat(10)
    store = generations.FileGenerations(str(component / 'store'), 10, gate.st_dev, gate.st_ino)
    store.restore(captured['fileGenerationSha256'], str(component / 'restored'))
    assert (component / 'restored/uploads/original.pdf').read_bytes() == payload
    connection = sqlite3.connect('file:' + str(component / 'restored/inquiry/inquiry.db') + '?mode=ro', uri=True)
    try:
        assert connection.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        assert connection.execute('SELECT amount,quantity FROM capture_probe').fetchone() == ('123456789.12345678', '0.00000001')
    finally:
        connection.close()
    component_evidence = dict(directory=str(component), capturedSha256=hashlib.sha256((component / 'capture/captured.json').read_bytes()).hexdigest())
print(json.dumps(dict(event='online-capture-closed', descriptors=4, relations=1, namespace=namespace,
                     **(dict(registeredBackendRuntimes=len(backend_boundary['runtimes']), coherentV2ComponentVerified=True,
                             component=component_evidence) if backend_boundary else {}))))
