"""Original-host read-only preparation observer; data alone grants no authority."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from urllib.parse import urlsplit, unquote

assert not sys.flags.optimize
os.umask(0o077)
request = json.load(sys.stdin)
root = Path(request['root'])
assert re.fullmatch(r'/app/online-runtime-acceptance/application-native-[a-f0-9]{32}', str(root))
assert root.resolve(strict=True) == root
owned_probes = []
sha = lambda value: hashlib.sha256(value).hexdigest()


def private(file, maximum=8 * 1024**2, mode=0o400):
    assert file.resolve(strict=True) == file
    descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.getuid()
        assert before.st_mode & 0o777 == mode and 0 < before.st_size <= maximum
        with os.fdopen(os.dup(descriptor), 'rb') as stream:
            raw = stream.read(maximum + 1)
        after = os.fstat(descriptor)
        for item in [after, file.lstat()]:
            assert all(getattr(item, key) == getattr(before, key) for key in
                       ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'])
        assert len(raw) == before.st_size
        return raw
    finally:
        os.close(descriptor)


def inventory(directory):
    assert directory.resolve(strict=True) == directory
    entries = []
    for current, folders, files in os.walk(directory, followlinks=False):
        for folder in folders:
            assert not (Path(current) / folder).is_symlink()
        for name in files:
            file = Path(current) / name
            descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                before = os.fstat(descriptor)
                assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                digest = hashlib.sha256()
                with os.fdopen(os.dup(descriptor), 'rb') as stream:
                    while chunk := stream.read(262144):
                        digest.update(chunk)
                for observed in [os.fstat(descriptor), file.lstat()]:
                    assert all(getattr(observed, key) == getattr(before, key) for key in
                               ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'])
                entries.append(dict(bytes=before.st_size, path=file.relative_to(directory).as_posix(), sha256=digest.hexdigest()))
                assert len(entries) <= 32768
            finally:
                os.close(descriptor)
    entries.sort(key=lambda item: item['path'])
    assert entries
    return sha(json.dumps(entries, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode('utf8'))


try:
    index = json.loads(private(root / 'index.json'))
    config = json.loads(private(root / 'config.json'))
    pair = index['privateQualification']
    app = Path(pair['qualificationRoot'])
    assert app == Path(pair['httpGrant']['scope']['coordinationDirectory']) / 'private-qualifications' / pair['qualificationId'] / 'restored-app'
    assert app.resolve(strict=True) == app and app.is_dir() and app.stat().st_mode & 0o777 == 0o700
    for grant in [pair['httpGrant'], pair['jobsGrant']]:
        assert not (Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json').exists()
        assert not (Path(grant['scope']['boundaryDirectory']) / 'claim.json').exists()
    runtime = config['privateQualificationRuntime']
    assert runtime['entryPath'] == '/app/dist/onlinePrivateQualification.js'
    assert sha(Path(runtime['entryPath']).read_bytes()) == runtime['entrySha256']
    assert inventory(Path('/app/dist')) == runtime['distTreeSha256'] == pair['runtimeBundleSha256']
    assert inventory(Path('/app/node_modules/@prisma/client')) == runtime['clientInventorySha256']
    assert runtime['schemaSha256'] == index['schemaSha256']
    manifest_raw = private(root / 'restored-file-baseline.json')
    manifest = json.loads(manifest_raw)
    completed = json.loads(private(root / 'restored-file-baseline.json.completed.json'))
    assert completed['manifestSha256'] == sha(manifest_raw)
    captured_raw = private(Path(manifest['capturedManifest']['path']))
    assert completed['capturedManifestSha256'] == manifest['capturedManifest']['sha256'] == sha(captured_raw)
    assert completed['captureId'] == manifest['captureId']
    assert len(manifest['sources']) == len(completed['proofs']) == 9
    roots = []
    for source in manifest['sources']:
        live, store = Path(source['liveRoot']), Path(source['storeRoot'])
        assert live.is_relative_to(app) and store.is_relative_to(app)
        assert live.resolve(strict=True) == live and store.resolve(strict=True) == store
        a, b = live.stat(), store.stat()
        assert stat.S_ISDIR(a.st_mode) and stat.S_ISDIR(b.st_mode)
        assert a.st_uid == b.st_uid == os.getuid() and not (a.st_mode | b.st_mode) & 0o077
        baseline = private(store / ('legacy-adoption-' + manifest['captureId'] + '.json'), 16384)
        selected = [p for p in completed['proofs'] if p['name'] == source['name']]
        assert len(selected) == 1 and selected[0]['sha256'] == sha(baseline)
        proof = json.loads(baseline)
        assert proof['publicOnlineAdmission'] is False and proof['source']['path'] == str(live)
        assert proof['source']['device'] == str(a.st_dev) and proof['source']['inode'] == str(a.st_ino)
        roots.append(dict(live=str(live), store=str(store), liveDevice=str(a.st_dev), liveInode=str(a.st_ino),
                          storeDevice=str(b.st_dev), storeInode=str(b.st_ino), baselineSha256=sha(baseline)))
    ephemeral = [app / 'storage' / name for name in ['bi-reports', 'reports', 'sales-reports']]
    for directory in ephemeral:
        assert directory.resolve(strict=True) == directory and directory.is_dir() and directory.stat().st_mode & 0o777 == 0o700
    source = urlsplit(os.environ['DATABASE_URL'])
    assert source.hostname == 'postgres' and source.path == '/sabalanerp'
    database = dict(name=index['restoredDatabase'], oid=str(index['restoredOid']),
                    systemIdentifier=pair['httpGrant']['scope']['database']['systemIdentifier'])
    env = dict(os.environ, PGHOST='postgres', PGPORT=str(source.port or 5432), PGUSER=unquote(source.username),
               PGPASSWORD=unquote(source.password), PGDATABASE=database['name'], PGAPPNAME='private-qualification-original-observer',
               PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=1000')
    sql = "SELECT json_build_object('name',current_database(),'oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'visible',(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member') FROM pg_roles WHERE rolname=current_user),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()))"
    probe = subprocess.Popen(['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', 'BEGIN READ ONLY; ' + sql + '; COMMIT;'],
                             env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    owned_probes.append(probe)
    stdout, stderr = probe.communicate()
    assert probe.returncode == 0 and len(stdout) <= 65536 and len(stderr) <= 65536
    rows = [json.loads(line) for line in stdout.splitlines() if line.startswith(b'{')]
    assert len(rows) == 1
    observed = rows[0]
    assert {key: observed[key] for key in database} == database
    assert observed['visible'] is True and observed['sessions'] == observed['prepared'] == 0
    assert re.fullmatch(r'qa_application_native_[a-f0-9]{32}', index['database'])
    source_query = "SELECT json_build_object('visible',(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member') FROM pg_roles WHERE rolname=current_user),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE datname='" + index['database'] + "'),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database='" + index['database'] + "'),'databaseOid',(SELECT oid::text FROM pg_database WHERE datname='" + index['database'] + "'))"
    source_probe = subprocess.Popen(['psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-c','BEGIN READ ONLY; '+source_query+'; COMMIT;'],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    owned_probes.append(source_probe); source_output, source_error = source_probe.communicate()
    assert source_probe.returncode == 0 and len(source_output) <= 65536 and len(source_error) <= 65536
    source_rows = [json.loads(line) for line in source_output.splitlines() if line.startswith(b'{')]
    assert len(source_rows) == 1
    source_sql = source_rows[0]
    assert source_sql == dict(visible=True,sessions=0,prepared=0,databaseOid=str(index['oid']))
    source_native = {}
    for grant in index['grants']:
        if grant['scope']['purpose'] != 'http': continue
        native_bytes = private(Path(grant['scope']['nativeDirectory'])/'deployment-runtime-native.json', mode=0o600)
        work_bytes = private(Path(grant['scope']['boundaryDirectory'])/'state.json', mode=0o600)
        claim = json.loads(private(Path(grant['scope']['boundaryDirectory'])/'claim.json', mode=0o600))
        source_native[grant['scope']['runtimeId']] = dict(nativeRawBase64=__import__('base64').b64encode(native_bytes).decode(),
            workRawBase64=__import__('base64').b64encode(work_bytes).decode(),claimNative=claim['native'])
    print(json.dumps(dict(format='sabalan-original-private-qualification-observation/v1', database=database,
        sql={key: observed[key] for key in ['visible', 'sessions', 'prepared']}, qualificationRoot=str(app), runtime=runtime,
        baselineCompletion=completed, restoreManifestSha256=sha(manifest_raw), restoreManifestRawBase64=__import__('base64').b64encode(manifest_raw).decode(),
        capturedManifestSha256=sha(captured_raw), roots=roots, ephemeralRoots=list(map(str, ephemeral)),
        httpIngress=dict(bindHost=config['roleTopology']['main']['host'], port=33179),
        sourceSql=source_sql, sourceNative=source_native,
        originalSqlProbe=dict(pid=probe.pid, returncode=probe.returncode, reaped=True))))
finally:
    # An interrupted read-only observer still owns/reaps its same actual probes.
    for probe in owned_probes:
        while probe.poll() is None:
            try:
                probe.communicate()
            except BaseException:
                continue
