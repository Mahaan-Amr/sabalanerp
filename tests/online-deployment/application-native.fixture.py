"""Real canonical application under the existing native online HTTP guardian.

Two private incarnations of the same captured source, not immutable A/B release
admission. Unknown actors/databases are retained; no timeout authorizes teardown.
"""
import datetime
import base64
import fcntl
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import select
import stat
import subprocess
import sys
import time
from urllib.parse import urlsplit, urlunsplit, unquote, quote

os.umask(0o077)
root = Path(sys.argv[1])
assert re.fullmatch(r'/app/online-runtime-acceptance/application-native-[a-f0-9]{32}', str(root))
assert root.resolve(strict=True) == root
mode = sys.argv[2]
source = urlsplit(os.environ['DATABASE_URL'])
assert source.hostname == 'postgres' and source.path == '/sabalanerp'
pg = dict(PGHOST='postgres', PGPORT=str(source.port or 5432), PGUSER=unquote(source.username),
          PGPASSWORD=unquote(source.password), PGDATABASE='postgres', PGAPPNAME='application-native-observer',
          PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=1000', PGTZ='UTC')
environment = dict(os.environ, **pg)


def check(value, code):
    if not value:
        raise RuntimeError(code)


def wait_failed_original_child(child, deadline_seconds=30):
    """A diagnostic deadline stays failed while THIS Popen observes real exit."""
    try:
        child.wait(timeout=deadline_seconds)
        return False
    except subprocess.TimeoutExpired:
        try:
            write(root / ('failure-original-child-wait-' + str(child.pid) + '.json'), encoded(dict(
                originalPass=False, originalPopenPid=child.pid, originalPopenObjectRetained=True,
                deadlineExceeded=True, deadlineAuthorizesClosure=False, signalSent=False)))
        except BaseException:
            print('APPLICATION_NATIVE_ORIGINAL_CHILD_WAIT_DEADLINE', file=sys.stderr)
        while True:
            try:
                child.wait()
                return True
            except BaseException:
                # Retain the same actual handle through interrupted observers.
                continue


def observe_original_resources(stage, original_actors):
    """Diagnostic only: original handles identify roots; observations grant no closure."""
    parents, rows = {}, {}
    processes = [file for file in Path('/proc').iterdir() if file.name.isdigit()]
    check(len(processes) <= 8192, 'APPLICATION_NATIVE_RESOURCE_PROCESS_BOUND')
    for process in processes:
        try:
            fields = (process / 'stat').read_text().rsplit(') ', 1)[1].split()
            parents[int(process.name)] = int(fields[1])
            rows[int(process.name)] = fields
        except FileNotFoundError:
            continue
    families = []
    for grant, original in original_actors:
        owned = {original.pid}
        for _ in range(64):
            descendants = {pid for pid, parent in parents.items() if parent in owned}
            if descendants <= owned:
                break
            owned.update(descendants)
        observed = []
        for pid in sorted(owned):
            process = Path('/proc') / str(pid)
            try:
                status = {line.split(':', 1)[0]: line.split(':', 1)[1].strip()
                          for line in (process / 'status').read_text().splitlines() if ':' in line}
                fields = (process / 'stat').read_text().rsplit(') ', 1)[1].split()
                if pid in rows and fields[19] != rows[pid][19]:
                    observed.append(dict(pid=pid, observation='PID_INCARNATION_CHANGED'))
                    continue
                memory = {}
                try:
                    memory = {line.split(':', 1)[0]: line.split(':', 1)[1].strip()
                              for line in (process / 'smaps_rollup').read_text().splitlines() if ':' in line}
                except ProcessLookupError:
                    check(fields[0] == 'Z', 'APPLICATION_NATIVE_RESOURCE_ROLLUP_UNPROVEN')
                observed.append(dict(pid=pid, parentPid=int(fields[1]), startTicks=fields[19],
                    name=status['Name'], state=status['State'], rss=status.get('VmRSS'), pss=memory.get('Pss'),
                    threads=status['Threads'], wchan=(process / 'wchan').read_text().strip()))
            except FileNotFoundError:
                observed.append(dict(pid=pid, observation='PROCESS_DISAPPEARED_NOT_CLOSURE'))
        families.append(dict(originalPopenPid=original.pid, runtimeId=grant['scope']['runtimeId'], processes=observed))
    names = ['memory.current', 'memory.max', 'memory.events', 'pids.current', 'pids.max', 'cpu.stat', 'cpu.max']
    counters = {name: (Path('/sys/fs/cgroup') / name).read_text() for name in names if (Path('/sys/fs/cgroup') / name).exists()}
    write(root / ('resources-' + stage + '.json'), encoded(dict(format='sabalan-original-actor-resource-observation/v1',
        stage=stage, observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        diagnosticOnly=True, grantsClosureAuthority=False, cgroup=counters, originalFamilies=families)))


def sql(query, database='postgres'):
    result = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query],
                            env=dict(environment, PGDATABASE=database), stdin=subprocess.DEVNULL, capture_output=True)
    check(result.returncode == 0, 'APPLICATION_NATIVE_SQL_FAILED')
    return result.stdout.decode().strip()


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def write(file, data, permissions=0o400):
    descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, permissions)
    try:
        os.fchmod(descriptor, permissions)
        with os.fdopen(os.dup(descriptor), 'wb') as output:
            output.write(data)
            output.flush()
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    parent = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def provision_private_qualification_public_key(authority, configuration):
    """Public half only; never rotate a different fixed trust key in place."""
    der = base64.b64decode(configuration['originalHostEnrollment']['publicKey'], validate=True)
    check(len(der) == 44 and der[:12] == bytes.fromhex('302a300506032b6570032100'),
          'APPLICATION_PRIVATE_QUALIFICATION_KEY_NOT_ED25519')
    encoded_key = base64.b64encode(der).decode('ascii')
    pem = ('-----BEGIN PUBLIC KEY-----\n' + encoded_key + '\n-----END PUBLIC KEY-----\n').encode('ascii')
    destination = authority / 'qualification-controller-public-key.pem'
    if destination.exists() or destination.is_symlink():
        value = destination.lstat()
        check(stat.S_ISREG(value.st_mode) and value.st_nlink == 1 and value.st_uid == 0
              and value.st_mode & 0o777 == 0o444 and destination.read_bytes() == pem,
              'APPLICATION_PRIVATE_QUALIFICATION_EXISTING_KEY_DIFFERENT_OR_UNSAFE')
    else:
        write(destination, pem, 0o444)


def lock(file):
    write(file, b'', 0o600)
    value = file.stat()
    return dict(file=str(file), device=str(value.st_dev), inode=str(value.st_ino), ownerUid=value.st_uid)


def history(database):
    raw = sql('SELECT coalesce(json_agg(t ORDER BY migration_name,id),\'[]\'::json)::text FROM public._prisma_migrations t', database)
    return dict(rows=len(json.loads(raw)), sha256=hashlib.sha256(raw.encode()).hexdigest())


def issue_runtime(template, name, purpose='http'):
    runtime_id = secrets.token_hex(32)
    coordination = Path(template['coordinationDirectory'])
    native, boundary = coordination / 'online/native' / runtime_id, coordination / 'online/work' / runtime_id
    native.mkdir(mode=0o700); boundary.mkdir(mode=0o700)
    lock(native / 'deployment-runtime-control.lock')
    scope = dict(template, runtimeId=runtime_id, nonce=secrets.token_hex(32), nativeDirectory=str(native),
                 boundaryDirectory=str(boundary), purpose=purpose, role='serving' if purpose == 'http' else 'control',
                 worker=None if purpose == 'http' else template['worker'])
    namespace = 'sabalan-rt-' + hashlib.sha256(runtime_id.encode()).hexdigest()[:48]
    write(boundary / 'scope.json', encoded(dict(format='sabalan-runtime-namespace/v1', scope=dict(
          runtimeId=runtime_id, image=scope['image'], registrySha256=scope['manifestSha256'], generation=1,
          gate={key: scope['gate'][key] for key in ['device', 'inode', 'ownerUid']}, postgresApplicationName=namespace))), 0o600)
    raw = encoded(scope)
    write(Path('/app/runtime-authority') / (runtime_id + '.json'), raw)
    return dict(name=name, scope=scope, file='/run/sabalan-online/' + runtime_id + '.json', sha256=hashlib.sha256(raw).hexdigest())


def executed_writer_coverage(observations, migration, private_pair):
    """Describe only returned workflow receipts; never turn startup into coverage."""
    exercised=[]
    def observe(name, value, condition):
        if condition:
            exercised.append(dict(workflow=name,receiptSha256=hashlib.sha256(encoded(value)).hexdigest()))
    for observation in observations:
        observe('hr-hiring-upload-and-initial-erasure',observation.get('erased'),observation.get('applicationAcceptance',{}).get('uploadedThenErased') is True)
        for key,name,format_name in [
            ('contractPrint','contract-print-route','sabalan-native-contract-print/v1'),
            ('supportStagedHttp','support-staged-http','sabalan-native-support-staged-http/v1')]:
            value=observation.get(key) or {};observe(name,value,value.get('format')==format_name)
        for key,name in [('accountingArtifact','official-accounting-xlsx'),('sharedImage','shared-image-upload'),('securityUpload','security-shift-log-upload')]:
            value=observation.get(key) or {};observe(name,value,isinstance(value.get('sha256'),str) and bool(re.fullmatch(r'[a-f0-9]{64}',value['sha256'])))
    for key,name,format_name in [('performanceExport','personnel-performance-export','sabalan-native-performance-export/v1'),('dispatch','dispatch-artifact-render-and-storage','sabalan-native-dispatch-artifact/v1')]:
        value=migration.get(key) or {};observe(name,value,value.get('format')==format_name)
    cleanup=migration.get('performanceCleanup') or {};observe('performance-retention-seven-cases',cleanup,len(cleanup.get('cases',[]))==7)
    bridge=private_pair.get('bridge') or {};observe('hr-personnel-http-command-and-realtime',bridge,
        bool(bridge.get('ids',{}).get('personnelId')) and private_pair.get('bridgeAfterDrain',{}).get('passResult') is True)
    domain=private_pair.get('installedDomainWriters',{}).get('result',{}).get('qualification',{})
    for key,name in [('financial','installed-financial-http-idempotency'),('personnel','installed-personnel-erasure'),('dispatch','installed-current-profile-dispatch'),('accountingPdf','installed-accounting-contract-pdf')]:
        value=domain.get(key);observe(name,value,isinstance(value,dict) and bool(value))
    unique={row['workflow']:row for row in exercised}
    return dict(retainedRootsEnrolled=9,exercised=sorted(unique),workflowReceipts=[unique[key] for key in sorted(unique)],
        startupOnly=[] if domain.get('accountingPdf') else ['accounting-contract-pdf'],
        remaining=['full-dispatch-issuance-and-authority','complete-writer-inventory'])


if mode == 'prepare':
    config = json.loads((root / 'config.json').read_bytes())
    private_runtime = config['privateQualificationRuntime']
    check(private_runtime['entryPath'] == '/app/dist/onlinePrivateQualification.js'
          and all(re.fullmatch(r'[a-f0-9]{64}', private_runtime[key]) for key in
                  ['entrySha256', 'distTreeSha256', 'schemaSha256', 'clientInventorySha256']),
          'APPLICATION_PRIVATE_QUALIFICATION_IMAGE_RECEIPT_REQUIRED')
    catalog = config['catalog']
    check(re.fullmatch(r'[a-f0-9]{32}', catalog['operation'])
          and re.fullmatch(r'[a-f0-9]{64}', catalog['sourceManifestSha256']),
          'APPLICATION_NATIVE_CURRENT_CATALOG_RECEIPT_REQUIRED')
    prisma_spec = importlib.util.spec_from_file_location('application_private_native_prisma', root / 'application-native-prisma.fixture.py')
    prisma_module = importlib.util.module_from_spec(prisma_spec); prisma_spec.loader.exec_module(prisma_module)
    shared_client_before = prisma_module.inventory(Path('/app/node_modules/@prisma/client'), check)
    generated_prisma = prisma_module.reuse_qualified(root, write, encoded, check)
    check(shared_client_before['sha256'] == config['privateQualificationRuntimes']['candidate']['clientInventorySha256'], 'APPLICATION_NATIVE_INSTALLED_CANDIDATE_CLIENT_UNPROVEN')
    check(generated_prisma['capsule']['sha256'] == config['privateQualificationRuntimes']['candidate']['clientInventorySha256'], 'APPLICATION_NATIVE_QUALIFIED_CANDIDATE_CLIENT_UNPROVEN')
    check(config['privateQualificationRuntimes']['candidate']['schemaSha256'] == generated_prisma['schemaSha256'],
          'APPLICATION_PRIVATE_QUALIFICATION_SCHEMA_NOT_CURRENT')
    provision_private_qualification_public_key(Path('/app/runtime-authority'), config)
    database = 'qa_application_native_' + secrets.token_hex(16)
    sql('CREATE DATABASE "' + database + '"')
    oid = sql("SELECT oid FROM pg_database WHERE datname='" + database + "'")
    private_environment = dict(environment, DATABASE_URL=urlunsplit(source._replace(path='/' + database, query='connection_limit=2&pool_timeout=10')))
    prisma_module.migrate(root, database, private_environment, write, encoded, check)
    source_inventory = json.loads((root / 'prisma-source-inventory.json').read_bytes())
    actual_rows = json.loads(sql("SELECT json_agg(json_build_object('name',migration_name,'checksum',checksum,'complete',finished_at IS NOT NULL AND rolled_back_at IS NULL) ORDER BY migration_name)::text FROM _prisma_migrations", database))
    check(actual_rows == [dict(name=row['name'], checksum=row['sha256'], complete=True) for row in source_inventory['migrations']], 'APPLICATION_NATIVE_BASELINE_HISTORY_NOT_EXACT')
    original_history = history(database)
    check(prisma_module.inventory(Path('/app/node_modules/@prisma/client'), check) == shared_client_before, 'APPLICATION_NATIVE_SHARED_CLIENT_CHANGED')
    sql('CREATE TABLE application_online_migration_probe (id integer PRIMARY KEY, amount numeric(24,8) NOT NULL)', database)
    sql('INSERT INTO application_online_migration_probe SELECT i,10.25 FROM generate_series(1,100) AS i', database)
    present = sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='hr_deletion_file_cleanups' AND column_name='versionedFileState' AND data_type='jsonb'", database)
    expansion = (root / 'hr-file-expansion.sql').read_bytes()
    check(present == '1', 'APPLICATION_NATIVE_REQUIRED_COLUMN_NOT_MIGRATED')
    check(history(database) == original_history, 'APPLICATION_NATIVE_HISTORY_CHANGED')
    coordination = root / 'coordination'
    coordination.mkdir(mode=0o700)
    write(coordination / 'state.json', encoded(dict(mode='NORMAL', updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'))), 0o600)
    gate = lock(coordination / 'deployment-write-admission.lock')
    interlock = lock(coordination / 'deployment-runtime-control.lock')
    worker = lock(coordination / 'deployment-online-worker.lock')
    (coordination / 'diagnostic-finish').mkdir(mode=0o700)
    for name in ['online', 'online/native', 'online/work']:
        (coordination / name).mkdir(mode=0o700)
    (root / 'app').mkdir(mode=0o700)
    (root / 'versions').mkdir(mode=0o700)
    (root / 'routing-publications').mkdir(mode=0o700)
    for journal_name in ['routing-journal', 'routing-journal-ui', 'routing-journal-socket']:
        (root / journal_name).mkdir(mode=0o700)
    lock(root / 'routing-publication.lock')
    system = sql('SELECT system_identifier FROM pg_control_system()')
    config = json.loads((root / 'config.json').read_bytes())
    admission_root = coordination / 'online/admission'
    admission_root.mkdir(mode=0o700)
    (admission_root / 'staging').mkdir(mode=0o700)
    definition = encoded(dict(format='sabalan-online-admission-scope/v1', gate=gate, interlock=interlock,
                              worker=worker, database=dict(systemIdentifier=system, name=database)))
    write(admission_root / 'scope.json', definition)
    write(admission_root / '00000000.json', encoded(dict(format='sabalan-online-capture-admission/v1', generation=0,
          phase='OPEN', previousSha256=None, capture=None, closureSha256=None)))
    admission = dict(directory=str(admission_root), scopeSha256=hashlib.sha256(definition).hexdigest())
    grants = []
    for name, purpose in [('application-a', 'http'), ('application-b', 'http'), ('capture', 'capture'), ('migration', 'jobs')]:
        runtime_id = secrets.token_hex(32)
        native, boundary = coordination / 'online/native' / runtime_id, coordination / 'online/work' / runtime_id
        native.mkdir(mode=0o700)
        boundary.mkdir(mode=0o700)
        lock(native / 'deployment-runtime-control.lock')
        scope = dict(format='sabalan-online-runtime-scope/v2', runtimeId=runtime_id,
                     releaseId='private-canonical-application', manifestSha256=config['bundleSha256'],
                     sourceCommit=config['privateQualificationSourceCommits']['candidate' if purpose=='jobs' else 'main'],
                     image=config['roleTopology']['candidate' if purpose=='jobs' else 'main']['image'], nonce=secrets.token_hex(32),
                     purpose=purpose, role='serving' if purpose == 'http' else 'control', coordinationDirectory=str(coordination), nativeDirectory=str(native),
                     boundaryDirectory=str(boundary), gate=gate, interlock=interlock, worker=None if purpose == 'http' else worker, admission=admission,
                     database=dict(systemIdentifier=system, name=database))
        namespace = 'sabalan-rt-' + hashlib.sha256(runtime_id.encode()).hexdigest()[:48]
        provision = dict(format='sabalan-runtime-namespace/v1', scope=dict(runtimeId=runtime_id, image=scope['image'],
                         registrySha256=scope['manifestSha256'], generation=1,
                         gate={key: gate[key] for key in ['device', 'inode', 'ownerUid']}, postgresApplicationName=namespace))
        write(boundary / 'scope.json', encoded(provision), 0o600)
        raw = encoded(scope)
        write(Path('/app/runtime-authority') / (runtime_id + '.json'), raw)
        grants.append(dict(name=name, scope=scope, file='/run/sabalan-online/' + runtime_id + '.json', sha256=hashlib.sha256(raw).hexdigest()))
    restored_database = 'qa_application_restored_' + secrets.token_hex(16)
    sql('CREATE DATABASE "' + restored_database + '"')
    restored_oid = sql("SELECT oid FROM pg_database WHERE datname='" + restored_database + "'")
    restored_coordination = root / 'restored-coordination'
    restored_coordination.mkdir(mode=0o700)
    write(restored_coordination / 'state.json', encoded(dict(mode='NORMAL', updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'))), 0o600)
    (restored_coordination / 'diagnostic-finish').mkdir(mode=0o700)
    for name in ['online', 'online/native', 'online/work']:
        (restored_coordination / name).mkdir(mode=0o700)
    restored_gate = lock(restored_coordination / 'deployment-write-admission.lock')
    restored_interlock = lock(restored_coordination / 'deployment-runtime-control.lock')
    restored_worker = lock(restored_coordination / 'deployment-online-worker.lock')
    restored_admission = restored_coordination / 'online/admission'
    restored_admission.mkdir(mode=0o700); (restored_admission / 'staging').mkdir(mode=0o700)
    restored_definition = encoded(dict(format='sabalan-online-admission-scope/v1', gate=restored_gate,
        interlock=restored_interlock, worker=restored_worker, database=dict(systemIdentifier=system, name=restored_database)))
    write(restored_admission / 'scope.json', restored_definition)
    write(restored_admission / '00000000.json', encoded(dict(format='sabalan-online-capture-admission/v1', generation=0,
          phase='OPEN', previousSha256=None, capture=None, closureSha256=None)))
    restored_template = dict(grants[0]['scope'], image=config['roleTopology']['candidate']['image'],
        sourceCommit=config['privateQualificationSourceCommits']['candidate'], coordinationDirectory=str(restored_coordination), gate=restored_gate,
        interlock=restored_interlock, worker=restored_worker, database=dict(systemIdentifier=system, name=restored_database),
        admission=dict(directory=str(restored_admission), scopeSha256=hashlib.sha256(restored_definition).hexdigest()))
    restored_grant = issue_runtime(restored_template, 'restored-application')
    restored_baseline = issue_runtime(restored_template, 'restored-file-baseline', 'jobs')
    qualification_id = secrets.token_hex(32)
    qualification_root = restored_coordination / 'private-qualifications' / qualification_id / 'restored-app'
    private_runtimes = config['privateQualificationRuntimes']
    pristine_template = dict(grants[0]['scope'], manifestSha256=private_runtimes['candidate']['distTreeSha256'],
        image=config['roleTopology']['candidate']['image'],sourceCommit=config['privateQualificationSourceCommits']['candidate'])
    pristine_grant = issue_runtime(pristine_template,'pristine-installed-performance')
    private_template = dict(restored_template, manifestSha256=private_runtimes['main']['distTreeSha256'],
        image=config['roleTopology']['main']['image'],sourceCommit=config['privateQualificationSourceCommits']['main'])
    private_next_template = dict(restored_template, manifestSha256=private_runtimes['candidate']['distTreeSha256'],
        image=config['roleTopology']['candidate']['image'],sourceCommit=config['privateQualificationSourceCommits']['candidate'])
    private_http_grants=[issue_runtime(private_template,'private-qualification-http'),issue_runtime(private_next_template,'private-qualification-http-next')]
    private_pair = dict(format='sabalan-native-private-qualification-pair/v1', qualificationId=qualification_id,
        qualificationRoot=str(qualification_root), runtimeBundleSha256=private_runtime['distTreeSha256'],
        runtimeBundles={role:value['distTreeSha256'] for role,value in private_runtimes.items()},
        httpGrant=private_http_grants[0],httpGrants=private_http_grants,
        oldJobsGrant=issue_runtime(private_template,'private-qualification-old-jobs','jobs'),
        jobsGrant=issue_runtime(private_next_template, 'private-qualification-jobs', 'jobs'))
    private_pair['onlinePointCaptureGrant']=issue_runtime(private_next_template,'private-online-physical-point','capture')
    online_point_inquiry_grant=issue_runtime(private_next_template,'online-point-inquiry')
    domain_database='qa_application_native_'+secrets.token_hex(16)
    sql('CREATE DATABASE "'+domain_database+'"')
    domain_oid=sql("SELECT oid FROM pg_database WHERE datname='"+domain_database+"'")
    domain_coordination=root/'installed-domain-restored-coordination';domain_coordination.mkdir(mode=0o700)
    write(domain_coordination/'state.json',encoded(dict(mode='NORMAL',updatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'))),0o600)
    for name in ['diagnostic-finish','online','online/native','online/work']:(domain_coordination/name).mkdir(mode=0o700)
    domain_gate=lock(domain_coordination/'deployment-write-admission.lock')
    domain_interlock=lock(domain_coordination/'deployment-runtime-control.lock')
    domain_worker=lock(domain_coordination/'deployment-online-worker.lock')
    domain_admission=domain_coordination/'online/admission';domain_admission.mkdir(mode=0o700);(domain_admission/'staging').mkdir(mode=0o700)
    domain_definition=encoded(dict(format='sabalan-online-admission-scope/v1',gate=domain_gate,interlock=domain_interlock,worker=domain_worker,database=dict(systemIdentifier=system,name=domain_database)))
    write(domain_admission/'scope.json',domain_definition)
    write(domain_admission/'00000000.json',encoded(dict(format='sabalan-online-capture-admission/v1',generation=0,phase='OPEN',previousSha256=None,capture=None,closureSha256=None)))
    domain_template=dict(private_next_template,manifestSha256=config['bundleSha256'],coordinationDirectory=str(domain_coordination),gate=domain_gate,interlock=domain_interlock,worker=domain_worker,
        database=dict(systemIdentifier=system,name=domain_database),admission=dict(directory=str(domain_admission),scopeSha256=hashlib.sha256(domain_definition).hexdigest()))
    domain_root=root/'installed-domain-restored-app'
    private_pair['domainRestore']=dict(database=domain_database,databaseOid=domain_oid,root=str(domain_root),
        captureGrant=issue_runtime(private_template,'installed-domain-capture','capture'),baselineGrant=issue_runtime(domain_template,'installed-domain-restored-baseline','jobs'))
    inquiry_grants = dict(source=issue_runtime(grants[0]['scope'], 'source-inquiry'),
                          restored=issue_runtime(restored_template, 'restored-inquiry'))
    authority_fd = os.open('/app/runtime-authority', os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(authority_fd); os.close(authority_fd)
    write(root / 'index.json', encoded(dict(database=database, oid=oid, grants=grants,
          restoredDatabase=restored_database, restoredOid=restored_oid, restoredGrant=restored_grant,
          privateQualification=private_pair, pristinePerformanceGrant=pristine_grant,onlinePointInquiryGrant=online_point_inquiry_grant,
          catalog=catalog,
          restoredBaselineGrant=restored_baseline, inquiryGrants=inquiry_grants,
          history=original_history, schemaSha256=generated_prisma['schemaSha256'],
          nativePrisma=generated_prisma, sharedClientInventory=shared_client_before,
          baselineKind='captured-repository-native-migrations',
          diagnosticExpansionApplied=present == '0', diagnosticExpansionSha256=hashlib.sha256(expansion).hexdigest())))
    print(json.dumps(dict(prepared=True, database=database)))
    sys.exit(0)

if mode == 'prepare-cache':
    spec = importlib.util.spec_from_file_location('application_prepared_declaration_cache', root / 'application-native-prisma.fixture.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    print(json.dumps(module.hint_prepared_declarations(root, check)))
    sys.exit(0)

if mode == 'exercise-writers':
    index = json.loads((root / 'index.json').read_bytes()); database = index['database']
    selected = os.environ.get('APPLICATION_NATIVE_WRITER_CASE')
    check(selected in ['digest-support', 'performance-rollback', 'performance-all', 'all-writers'], 'APPLICATION_NATIVE_WRITER_CASE_INVALID')
    grant = next(value for value in index['grants'] if value['scope']['purpose'] == 'jobs')
    scope = grant['scope']; cwd = root / 'app'
    writer_environment = dict(os.environ, DATABASE_URL=urlunsplit(source._replace(path='/' + database, query='connection_limit=2&pool_timeout=10')),
        NODE_ENV='test', BACKEND_RUNTIME_ROLE='control', RECOVERY_COORDINATION_DIR=scope['coordinationDirectory'],
        BACKEND_ONLINE_SCOPE_FILE=grant['file'], BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'],
        APPLICATION_NATIVE_CWD=str(cwd), NODE_PATH='/app/node_modules')
    bootstrap = "process.umask(0o077);process.chdir(process.env.APPLICATION_NATIVE_CWD);require(process.argv[1]);"
    with (root / 'writers.stdout').open('xb') as output, (root / 'writers.stderr').open('xb') as errors:
        child = subprocess.Popen(['python3', '-I', '-B', str(root / 'online-runtime-owner.py'), 'node', '-e', bootstrap,
            str(root / 'application-writers.cjs')], env=writer_environment, stdin=subprocess.DEVNULL, stdout=output, stderr=errors)
    # A deadline never kills native work or authorizes unknown replacement.
    child.wait(timeout=240)
    native_raw = (Path(scope['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes(); native = json.loads(native_raw)
    state = json.loads((Path(scope['boundaryDirectory']) / 'state.json').read_bytes())
    claim = json.loads((Path(scope['boundaryDirectory']) / 'claim.json').read_bytes())
    check(native['guardian']['pid'] == child.pid and native['phase'] == state['phase'] == 'QUIESCENT'
          and native['nativeReaped'] and native['databaseQuiet'] and not native['stoppedBySignal'], 'APPLICATION_NATIVE_WRITER_CLOSURE_UNPROVEN')
    check(claim['native'] == dict(scopeSha256=grant['sha256'], claimSha256=native['activeClaimSha256']), 'APPLICATION_NATIVE_WRITER_BINDING_CHANGED')
    stdout, stderr = (root / 'writers.stdout').read_bytes(), (root / 'writers.stderr').read_bytes()
    check(len(stdout) <= 4 * 1024**2 and len(stderr) <= 1024**2 and b'APPLICATION_NATIVE_WRITERS_CLOSED' in stdout.splitlines(),
          'APPLICATION_NATIVE_WRITER_COMPLETION_MISSING')
    record = dict(format='sabalan-native-writers-diagnostic/v1', selected=selected, passResult=child.returncode == native['nativeStatus'] == 0,
        productionAdmission=False, nativeStatus=native['nativeStatus'], nativeReaped=True, databaseQuiet=True,
        nativeSha256=hashlib.sha256(native_raw).hexdigest(), stdout=stdout.decode(), stderr=stderr.decode(),
        originalDatabaseOid=index['oid'], originalHistory=index['history'])
    write(root / 'writers-original-outcome.json', encoded(record))
    # Reuse the original strict retirement path. No routing/capture/HTTP actor
    # started; its existing checks prove every source/unused-restored database.
    extra_descriptors = []
    for extra in [index['restoredGrant'], index['restoredBaselineGrant'], *index['inquiryGrants'].values()]:
        check(not (Path(extra['scope']['nativeDirectory']) / 'deployment-runtime-native.json').exists()
              and not (Path(extra['scope']['boundaryDirectory']) / 'claim.json').exists(), 'APPLICATION_NATIVE_WRITER_EXTRA_ACTOR_STARTED')
        fd = os.open(Path(extra['scope']['nativeDirectory']) / 'deployment-runtime-control.lock', os.O_RDONLY | os.O_NOFOLLOW)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); extra_descriptors.append(fd)
    for name in ['deployment-runtime-control.lock', 'deployment-write-admission.lock', 'deployment-online-worker.lock']:
        fd = os.open(root / 'restored-coordination' / name, os.O_RDONLY | os.O_NOFOLLOW)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); extra_descriptors.append(fd)
    client_spec = importlib.util.spec_from_file_location('application_writer_private_prisma', root / 'application-native-prisma.fixture.py')
    client_module = importlib.util.module_from_spec(client_spec); client_spec.loader.exec_module(client_module)
    check(client_module.inventory(root / 'node_modules/@prisma/client', check) == index['nativePrisma']['capsule']
          and client_module.inventory(Path('/app/node_modules/@prisma/client'), check) == index['sharedClientInventory'],
          'APPLICATION_NATIVE_WRITER_CLIENT_CHANGED')
    record['qualifiedPrivateClientUnchanged'] = record['originalSharedClientUnchanged'] = True
    check(history(database) == index['history'], 'APPLICATION_NATIVE_WRITER_HISTORY_CHANGED')
    cleanup = subprocess.run(['python3', '-I', '-B', str(root / 'fixture.py'), str(root), 'retire-failed'], stdin=subprocess.DEVNULL, capture_output=True)
    for descriptor in reversed(extra_descriptors):
        os.close(descriptor)
    record['retirement'] = dict(code=cleanup.returncode, stdout=cleanup.stdout.decode(), stderr=cleanup.stderr.decode())
    write(root / 'writers-final-outcome.json', encoded(record))
    check(cleanup.returncode == 0, 'APPLICATION_NATIVE_WRITER_DATABASE_RETIREMENT_UNPROVEN')
    print(json.dumps(record)); sys.exit(0 if record['passResult'] else 1)

if mode == 'retire-failed':
    # A newly started routing controller may still own a transport outcome.
    # The old application-only cleanup cannot adjudicate that additional owner.
    check(not (root / 'routing-input.json').exists(), 'APPLICATION_NATIVE_ROUTING_CLOSURE_REQUIRES_REVIEW')
    index = json.loads((root / 'index.json').read_bytes())
    database = index['database']
    check(re.fullmatch(r'qa_application_native_[a-f0-9]{32}', database), 'APPLICATION_NATIVE_DATABASE_INVALID')
    descriptors, closures = [], []
    try:
        for file in [root / 'coordination/deployment-runtime-control.lock', root / 'coordination/deployment-write-admission.lock']:
            check(file.resolve(strict=True) == file, 'APPLICATION_NATIVE_LOCK_ALIAS')
            descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            descriptors.append(descriptor)
        for grant in index['grants']:
            scope = grant['scope']
            native_root = Path(scope['nativeDirectory'])
            check(native_root.parent == root / 'coordination/online/native'
                  and native_root.name == scope['runtimeId'], 'APPLICATION_NATIVE_SCOPE_CHANGED')
            fd = os.open(native_root / 'deployment-runtime-control.lock', os.O_RDONLY | os.O_NOFOLLOW)
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            descriptors.append(fd)
            file = native_root / 'deployment-runtime-native.json'
            if not file.exists():
                check(not (Path(scope['boundaryDirectory']) / 'claim.json').exists(), 'APPLICATION_NATIVE_UNCLAIMED_WORK_UNPROVEN')
                closures.append(dict(runtimeId=scope['runtimeId'], neverClaimed=True))
                continue
            native = json.loads(file.read_bytes())
            check(native['phase'] == 'QUIESCENT' and native['nativeReaped'] and native['databaseQuiet']
                  and not native['stoppedBySignal'], 'APPLICATION_NATIVE_ORIGINAL_CLOSURE_UNPROVEN')
            active = {key: value for key, value in native.items() if key not in
                      ['activeClaimSha256', 'nativeReaped', 'databaseQuiet', 'nativeStatus', 'stoppedBySignal']}
            active['phase'] = 'ACTIVE'
            check(hashlib.sha256(encoded(active)).hexdigest() == native['activeClaimSha256'], 'APPLICATION_NATIVE_CLAIM_CHANGED')
            state = json.loads((Path(scope['boundaryDirectory']) / 'state.json').read_bytes())
            work_claim = json.loads((Path(scope['boundaryDirectory']) / 'claim.json').read_bytes())
            check(state['phase'] == 'QUIESCENT' and work_claim['native'] == dict(scopeSha256=grant['sha256'],
                  claimSha256=native['activeClaimSha256']), 'APPLICATION_NATIVE_ORIGINAL_WORK_CLOSURE_UNPROVEN')
            check(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + native['namespace'] + "'") == '0', 'APPLICATION_NATIVE_NAMESPACE_NOT_QUIET')
            closures.append(dict(runtimeId=scope['runtimeId'], nativeStatus=native['nativeStatus'], activeClaimSha256=native['activeClaimSha256']))
        check(sql("SELECT oid FROM pg_database WHERE datname='" + database + "'") == index['oid'], 'APPLICATION_NATIVE_DATABASE_REPLACED')
        check(sql("SELECT count(*) FROM pg_stat_activity WHERE datname='" + database + "'") == '0'
              and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + database + "'") == '0', 'APPLICATION_NATIVE_DATABASE_STILL_ACTIVE')
        check(history(database) == index['history'], 'APPLICATION_NATIVE_HISTORY_CHANGED')
        if 'restoredGrant' in index:
            restored_scope = index['restoredGrant']['scope']
            check(not (Path(restored_scope['nativeDirectory']) / 'deployment-runtime-native.json').exists()
                  and not (Path(restored_scope['boundaryDirectory']) / 'claim.json').exists(), 'APPLICATION_NATIVE_RESTORE_OWNER_UNPROVEN')
            restored_database = index['restoredDatabase']
            check(sql("SELECT oid FROM pg_database WHERE datname='" + restored_database + "'") == index['restoredOid']
                  and sql("SELECT count(*) FROM pg_stat_activity WHERE datname='" + restored_database + "'") == '0'
                  and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + restored_database + "'") == '0'
                  and sql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'", restored_database) == '0',
                  'APPLICATION_NATIVE_UNUSED_RESTORE_DATABASE_NOT_EMPTY')
            sql('DROP DATABASE "' + restored_database + '"')
        sql('DROP DATABASE "' + database + '"')
        print(json.dumps(dict(format='sabalan-application-native-failed-retirement/v1', originalClosures=closures,
                              database=database, oid=index['oid'], retiredWithoutForce=True, productionAdmission=False)))
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)
    sys.exit(0)

if mode == 'issue-role-authorities':
    index = json.loads((root / 'index.json').read_bytes())
    jobs_authority = Path('/app/jobs-authority')
    check(jobs_authority.is_dir() and jobs_authority.resolve(strict=True) == jobs_authority,
          'APPLICATION_ROLE_ISSUER_MOUNT_UNPROVEN')
    os.chmod(jobs_authority, 0o700)
    provision_private_qualification_public_key(jobs_authority, json.loads((root / 'config.json').read_bytes()))
    selected = [grant for grant in index['grants'] if grant['scope']['purpose'] == 'jobs']
    selected += [index[key] for key in ['restoredBaselineGrant', 'restoredGrant']]
    selected += [index['inquiryGrants']['restored']]
    selected += [index['onlinePointInquiryGrant'],index['privateQualification']['onlinePointCaptureGrant']]
    selected += [index['privateQualification']['jobsGrant'],index['privateQualification']['httpGrants'][1],index['privateQualification']['domainRestore']['baselineGrant'],index['pristinePerformanceGrant']]
    for grant in selected:
        raw = Path(grant['file']).read_bytes()
        check(hashlib.sha256(raw).hexdigest() == grant['sha256'] and json.loads(raw) == grant['scope'],
              'APPLICATION_ROLE_GRANT_SOURCE_CHANGED')
        write(jobs_authority / (grant['scope']['runtimeId'] + '.json'), raw)
    print(json.dumps(dict(issued=True, productionAdmission=False, scopeHashes=[grant['sha256'] for grant in selected])))
    sys.exit(0)

check(mode == 'exercise', 'APPLICATION_NATIVE_MODE_INVALID')
index = json.loads((root / 'index.json').read_bytes())
config = json.loads((root / 'config.json').read_bytes())
client_spec = importlib.util.spec_from_file_location('application_native_role_client', root / 'application-native-role-client.py')
client_module = importlib.util.module_from_spec(client_spec); client_spec.loader.exec_module(client_module)
role_client = client_module.OriginalRoleClient(root, sys.argv[3], sys.argv[4], config, index, sql, check)
main_prisma_spec=importlib.util.spec_from_file_location('main_original_installed_prisma',root/'application-native-prisma.fixture.py')
main_prisma=importlib.util.module_from_spec(main_prisma_spec);main_prisma_spec.loader.exec_module(main_prisma)
main_shared_inventory=main_prisma.inventory(Path('/app/node_modules/@prisma/client'),check)
check(main_shared_inventory['sha256']==config['privateQualificationRuntimes']['main']['clientInventorySha256'],'APPLICATION_MAIN_ORIGINAL_INSTALLED_CLIENT_CHANGED')
database = index['database']
check(re.fullmatch(r'qa_application_native_[a-f0-9]{32}', database), 'APPLICATION_NATIVE_DATABASE_INVALID')
check(sql("SELECT oid FROM pg_database WHERE datname='" + database + "'") == index['oid'], 'APPLICATION_NATIVE_DATABASE_REPLACED')
actors, observations = [], []
capture_module = None
private_pair_module = None
publication_fd = None
transport_spec = importlib.util.spec_from_file_location('application_original_readonly_transport', root / 'readonly-transport-retirement-native.fixture.py')
transport_module = importlib.util.module_from_spec(transport_spec); transport_spec.loader.exec_module(transport_module)
transport = transport_module.OriginalReadonlyTransportFixture(root)
proven = False
try:
    seed_sha = None
    for ordinal, grant in enumerate([grant for grant in index['grants'] if grant['scope']['purpose'] == 'http']):
        if ordinal == 1:
            pristine = observations[0].get('pristinePerformanceProfile', {})
            check(pristine.get('format') == 'sabalan-installed-disabled-performance-profile/v1'
                  and pristine.get('httpStatus') == 403 and pristine.get('actualInstalledAuthorization') is True
                  and pristine.get('exportRowsMinted') == pristine.get('liveArtifactChanges') == 0
                  and pristine.get('releasePhaseCreated') is False
                  and pristine.get('futureEnabledExportsQualified') is False,
                  'APPLICATION_PRISTINE_PROFILE_REQUIRED_BEFORE_DIAGNOSTIC_MIGRATION')
            write(root / 'pristine-performance-source-profile.json', encoded(dict(
                format='sabalan-pristine-performance-source-observation/v1', result=pristine,
                runtimeId=observations[0]['runtimeId'], seedSha256=observations[0]['seedSha256'],
                diagnosticSourceBundle=True, immutableInstalledApplicationQualified=False,
                productionAdmission=False)))
            pristine_installed = role_client.request('RUN_PRISTINE_PERFORMANCE',
                dict(seedSha256=observations[0]['seedSha256']), 'PRISTINE_PERFORMANCE_DONE', index['pristinePerformanceGrant'])
            write(root / 'pristine-performance-installed-profile.json', encoded(pristine_installed))
            specification = importlib.util.spec_from_file_location('native_owned_application_migration', root / 'application-native-migration.fixture.py')
            migration_module = importlib.util.module_from_spec(specification)
            specification.loader.exec_module(migration_module)
            observe_original_resources('before-jobs', actors)
            try:
                jobs_grant = next(value for value in index['grants'] if value['scope']['purpose'] == 'jobs')
                remote_migration = role_client.request('RUN_MIGRATION', dict(format='sabalan-native-migration-input/v1',
                    host=observations[0]['host'], port=observations[0]['port'], seedSha256=observations[0]['seedSha256'],
                    sources=observations[0]['sources'], originalHistory=index['history']), 'MIGRATION_DONE', jobs_grant)
                migration = remote_migration['result']
                check(migration['originalHistory'] == index['history'] and migration['history'] == history(database),
                      'APPLICATION_ROLE_MIGRATION_HISTORY_CHANGED')
                write(root / 'migration-qualified.json', encoded(migration))
            finally:
                observe_original_resources('after-jobs-handle-return', actors)
        application_environment = dict(os.environ, DATABASE_URL=urlunsplit(source._replace(path='/' + database,
                         query='connection_limit=2&pool_timeout=10')), NODE_ENV='test',
             BACKEND_RUNTIME_ROLE='serving', RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'],
             BACKEND_ONLINE_SCOPE_FILE=grant['file'], BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'],
             APPLICATION_NATIVE_CWD=str(root / 'app'), APPLICATION_ACCEPTANCE_PHASE='seed' if ordinal == 0 else 'reuse',
             APPLICATION_ACCEPTANCE_VERSION_ROOT=str(root / 'versions'), NODE_PATH='/app/node_modules')
        application_environment['APPLICATION_NATIVE_BIND_HOST'] = config['roleTopology']['main']['host']
        if seed_sha:
            application_environment['APPLICATION_ACCEPTANCE_SEED_SHA256'] = seed_sha
        bootstrap = "process.umask(0o077);process.chdir(process.env.APPLICATION_NATIVE_CWD);require(process.argv[1]);"
        output_file = root / (grant['name'] + '.stdout')
        # The native application logs to an independent durable file. Losing
        # this test controller must not break Morgan's stdout pipe and crash it.
        with output_file.open('xb') as output, (root / (grant['name'] + '.stderr')).open('xb') as errors:
            child = transport.spawn_backend(['/usr/bin/python3', '-I', '-B', str(root / 'online-runtime-owner.py'),
                                      '/usr/local/bin/node', '-e', bootstrap, str(root / 'application-worker.cjs'), 'application-http'],
                                     env=application_environment, stdout=output, stderr=errors)
        actors.append((grant, child))
        deadline, diagnostic_size = time.monotonic() + 60, 0
        with output_file.open('rb') as diagnostic:
            while True:
                remaining = deadline - time.monotonic()
                check(remaining > 0, 'APPLICATION_NATIVE_READY_DEADLINE')
                offset = diagnostic.tell()
                line = diagnostic.readline(65537)
                if not line:
                    check(child.poll() is None, 'APPLICATION_NATIVE_STARTUP_FAILED')
                    time.sleep(0.02)
                    continue
                check(len(line) <= 65536, 'APPLICATION_NATIVE_STARTUP_LOG_CAPACITY')
                if not line.endswith(b'\n'):
                    diagnostic.seek(offset)
                    time.sleep(0.02)
                    continue
                os.fsync(diagnostic.fileno())
                diagnostic_size += len(line)
                check(diagnostic_size < 262144, 'APPLICATION_NATIVE_STARTUP_LOG_CAPACITY')
                try:
                    ready = json.loads(line)
                except (ValueError, UnicodeError):
                    ready = None
                if isinstance(ready, dict) and ready.get('event') == 'ready':
                    break
        claim = json.loads((Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes())
        check(claim['phase'] == 'ACTIVE' and claim['guardian']['pid'] == child.pid and ready['namespace'] == claim['namespace']
              and ready['runtimeId'] == grant['scope']['runtimeId'], 'APPLICATION_NATIVE_READY_OWNER_MISMATCH')
        check(re.fullmatch(r'[a-f0-9]{64}', ready['seedSha256']), 'APPLICATION_NATIVE_SEED_IDENTITY_INVALID')
        if seed_sha:
            check(seed_sha == ready['seedSha256'], 'APPLICATION_NATIVE_SEED_REPLACED')
        seed_sha = ready['seedSha256']
        check(isinstance(ready['port'], int) and 1024 <= ready['port'] <= 65535, 'APPLICATION_NATIVE_PORT_INVALID')
        transport.observe_active(child)
        observations.append(ready)
    check(len({entry['namespace'] for entry in observations}) == 2, 'APPLICATION_NATIVE_NAMESPACES_COLLIDED')
    seed_file = root / 'app/acceptance-seed.json'
    check(seed_file.resolve(strict=True) == seed_file, 'APPLICATION_NATIVE_SEED_ALIAS')
    seed_bytes = seed_file.read_bytes()
    check(len(seed_bytes) <= 65536 and hashlib.sha256(seed_bytes).hexdigest() == seed_sha, 'APPLICATION_NATIVE_SEED_REPLACED')
    seed = json.loads(seed_bytes)
    check(seed['database'] == database and seed['root'] == str(root / 'app')
          and re.fullmatch(r'[A-Za-z0-9_-]{43}', seed['sessionToken'])
          and isinstance(seed['customerId'], str) and 0 < len(seed['customerId']) <= 256, 'APPLICATION_NATIVE_SEED_INVALID')
    check(isinstance(seed.get('apiApplicationId'), str) and re.fullmatch(r'[a-z0-9]{20,32}', seed['apiApplicationId']), 'APPLICATION_NATIVE_API_TARGET_INVALID')
    for ready in observations:
        check(ready['host'] == config['roleTopology']['main']['host'], 'APPLICATION_ROLE_HTTP_HOST_CHANGED')
        connection = http.client.HTTPConnection(ready['host'], ready['port'], timeout=10)
        try:
            connection.request('GET', '/api/health')
            response = connection.getresponse()
            check(response.status == 200, 'APPLICATION_NATIVE_SIMULTANEOUS_HEALTH_FAILED')
            response.read()
            connection.request('GET', '/api/accounting/ledger/customer-accounts/' + quote(seed['customerId'], safe=''),
                               headers={'Cookie': 'sabalan_session=' + seed['sessionToken']})
            response = connection.getresponse()
            check(response.status == 200, 'APPLICATION_NATIVE_CURRENT_DATA_READ_FAILED')
            account = json.loads(response.read())
            check(str(account['data']['netBalanceRials']) == '123456800', 'APPLICATION_NATIVE_CURRENT_DATA_CHANGED')
        finally:
            connection.close()
    # Publication is serialized by a real inherited FLOCK, separately from the
    # native application's work/control locks. No synthetic release authority.
    config = json.loads((root / 'config.json').read_bytes())
    transport_instance = secrets.token_hex(32)
    role_client.request('START_CHROME', {}, 'CHROME_READY')
    write(root / 'routing-input.json', encoded(dict(observations=observations, seedSha256=seed_sha,
          edgeHost=config['roleTopology']['main']['host'], uiArtifacts=config['uiArtifacts'], transportInstanceId=transport_instance)))
    original_publication_fd = os.open(root / 'routing-publication.lock', os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(original_publication_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if original_publication_fd != 20:
        try:
            os.fstat(20)
        except OSError as error:
            check(error.errno == 9, 'APPLICATION_NATIVE_PUBLICATION_DESCRIPTOR_UNCERTAIN')
        else:
            raise RuntimeError('APPLICATION_NATIVE_PUBLICATION_DESCRIPTOR_OCCUPIED')
        os.dup2(original_publication_fd, 20, inheritable=False)
        os.close(original_publication_fd)
    publication_fd = 20
    with (root / 'routing.stdout').open('xb') as output, (root / 'routing.stderr').open('xb') as errors:
        routed = transport.spawn_edge(['/usr/local/bin/node', str(root / 'application-routing.mjs'), str(root)],
            env=os.environ, stdout=output, stderr=errors, instance_id=transport_instance,
            publication_lock_file=root / 'routing-publication.lock', remote_browser=role_client.chrome_receipt)
    # This ORIGINAL edge and actual Chrome+authenticated Socket remain alive
    # through coherent capture/restore. No replacement process can adopt them.
    routing = transport.wait_business_ready()
    catalog_input = dict(format='sabalan-native-full-catalog-controller/v1', operation=index['catalog']['operation'],
        mainHost=config['roleTopology']['main']['host'],
        databaseUrl=urlunsplit(source._replace(path='/' + database, query='connection_limit=2&pool_timeout=10')),
        databaseName=database, databaseOid=str(index['oid']), systemIdentifier=index['grants'][0]['scope']['database']['systemIdentifier'],
        adminUsername=sql("SELECT username FROM users WHERE id='" + seed['adminId'] + "'", database),
        adminPassword='PRIVATE NATIVE APPLICATION CONFIRMATION')
    full_catalog = role_client.request('RUN_FULL_CATALOG', catalog_input, 'FULL_CATALOG_DONE')
    check(full_catalog['result']['passResult'] is True and full_catalog['closure']['sql']['sessions'] == 0,
          'APPLICATION_NATIVE_FULL_CATALOG_NOT_CLOSED')
    transport.qualify_forged_channel_inputs()
    check(len(routing['uploads']) == 4, 'APPLICATION_NATIVE_BROWSER_STAGE_UPLOADS_INVALID')
    check(len(routing['tickets']) == 2, 'APPLICATION_NATIVE_BROWSER_STAGE_TICKETS_INVALID')
    documents = json.loads(sql("SELECT json_agg(json_build_object('id',id,'sha256',sha256,'storageName',\"storageName\",'size',size) ORDER BY id)::text FROM public.hr_hiring_documents WHERE \"applicationId\"='" + seed['apiApplicationId'] + "'", database))
    check(len(documents) == len(routing['uploads']) == 4, 'APPLICATION_NATIVE_ROUTED_SQL_COUNT_CHANGED')
    for uploaded in routing['uploads']:
        check(any(row == dict(id=uploaded['id'], sha256=uploaded['sha256'], storageName=uploaded['storageName'], size=uploaded['bytes'])
                  for row in documents), 'APPLICATION_NATIVE_ROUTED_SQL_BYTES_CHANGED')
    capture_spec = importlib.util.spec_from_file_location('application_native_coherent_join', root / 'application-native-capture.fixture.py')
    capture_module = importlib.util.module_from_spec(capture_spec)
    sys.modules[capture_spec.name] = capture_module
    capture_spec.loader.exec_module(capture_module)
    coherent = capture_module.run(root, index, observations, routing, source, environment, sql, history, write, encoded, check,
                                  role_client=role_client)
    transport.signal_capture_finished()
    final_routing_stage = transport.wait_stopped_stage()
    role_client.request('WAIT_CHROME_CLOSED', dict(actorId=role_client.actors['chrome']), 'CHROME_CLOSED',
                        actor_id=role_client.actors['chrome'])
    check(final_routing_stage['uploads'] == routing['uploads'], 'APPLICATION_NATIVE_ROUTING_STAGE_SUBSTITUTED')
    closures = []
    for grant, child in actors:
        write(Path(grant['scope']['coordinationDirectory']) / 'diagnostic-finish' / grant['scope']['runtimeId'], b'done\n')
        child.communicate(timeout=30)
        check(child.returncode == 0, 'APPLICATION_NATIVE_ORIGINAL_OWNER_NOT_CLOSED')
        output_file = root / (grant['name'] + '.stdout')
        check(output_file.stat().st_size <= 262144, 'APPLICATION_NATIVE_CLOSURE_LOG_CAPACITY')
        remaining_output = output_file.read_bytes()
        check(b'APPLICATION_NATIVE_WORK_CLOSED' in remaining_output.splitlines(), 'APPLICATION_NATIVE_APPLICATION_CLOSURE_MISSING')
        events = []
        for line in remaining_output.splitlines():
            try:
                events.append(json.loads(line))
            except (ValueError, UnicodeError):
                continue
        check(any(isinstance(event, dict) and event.get('event') == 'application-draining-guard-qualified'
                  and event.get('exactOriginalPersianMessage') is True for event in events), 'APPLICATION_NATIVE_DRAINING_GUARD_UNQUALIFIED')
        native = json.loads((Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes())
        check(native['phase'] == 'QUIESCENT' and native['nativeReaped'] and native['databaseQuiet']
              and native['nativeStatus'] == 0 and not native['stoppedBySignal'], 'APPLICATION_NATIVE_NATIVE_CLOSURE_UNPROVEN')
        active = {key: value for key, value in native.items() if key not in
                  ['activeClaimSha256', 'nativeReaped', 'databaseQuiet', 'nativeStatus', 'stoppedBySignal']}
        active['phase'] = 'ACTIVE'
        check(hashlib.sha256(encoded(active)).hexdigest() == native['activeClaimSha256'], 'APPLICATION_NATIVE_CLAIM_CHANGED')
        state = json.loads((Path(grant['scope']['boundaryDirectory']) / 'state.json').read_bytes())
        claim = json.loads((Path(grant['scope']['boundaryDirectory']) / 'claim.json').read_bytes())
        check(state['phase'] == 'QUIESCENT' and claim['native'] == dict(scopeSha256=grant['sha256'], claimSha256=native['activeClaimSha256']), 'APPLICATION_NATIVE_WORK_CLOSURE_UNPROVEN')
        native_bytes=(Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes()
        work_bytes=(Path(grant['scope']['boundaryDirectory']) / 'state.json').read_bytes()
        role_client.verify_closure(dict(closure=dict(scopeSha256=grant['sha256'],originalPopenPid=child.pid,
            originalReturncode=child.returncode,nativeRawBase64=base64.b64encode(native_bytes).decode(),
            workRawBase64=base64.b64encode(work_bytes).decode())),grant,0)
        closures.append(dict(runtimeId=grant['scope']['runtimeId'], activeClaimSha256=native['activeClaimSha256'],
            originalPopenPid=child.pid,originalReturncode=child.returncode,
            nativeRawBase64=base64.b64encode(native_bytes).decode(),workRawBase64=base64.b64encode(work_bytes).decode(),
            workClaimRawBase64=base64.b64encode((Path(grant['scope']['boundaryDirectory'])/'claim.json').read_bytes()).decode(),
            workScopeRawBase64=base64.b64encode((Path(grant['scope']['boundaryDirectory'])/'scope.json').read_bytes()).decode(),
            claimNative=claim['native'],freshSql=dict(visible=True,systemIdentifier=grant['scope']['database']['systemIdentifier'],
                databaseOid=index['oid'],namespace='sabalan-rt-'+hashlib.sha256(grant['scope']['runtimeId'].encode()).hexdigest()[:48],namespaceSessions=0,prepared=0)))
    transport_retirement = transport.reconcile_after_original_backend_closure()
    private_spec=importlib.util.spec_from_file_location('application_original_private_pair',root/'application-native-private-pair.fixture.py')
    private_pair_module=importlib.util.module_from_spec(private_spec);sys.modules[private_spec.name]=private_pair_module
    private_spec.loader.exec_module(private_pair_module)
    private_pair=private_pair_module.run(root,index,config,source,sql,history,write,encoded,check,role_client,closures,coherent)
    coherent['genuinePrivateQualificationPair']=private_pair
    coherent['originalRestoredDatabaseRetiredWithoutForce']=True
    coherent['restoredDatabaseHeldForPrivateQualification']=False
    check(coherent.get('originalRestoredDatabaseRetiredWithoutForce') is True
          and coherent.get('genuinePrivateQualificationPair', {}).get('originalPairClosed') is True,
          'APPLICATION_NATIVE_GENUINE_PRIVATE_PAIR_NOT_FINISHED')
    routed_bytes = (root / 'routing.stdout').read_bytes()
    check(len(routed_bytes) < 524288, 'APPLICATION_NATIVE_ROUTING_LOG_CAPACITY')
    final_routing = json.loads(routed_bytes)
    check(final_routing['passResult'] and final_routing['generations'] == [1, 2, 3, 4, 5]
          and final_routing['uiPending'] == final_routing['apiPending'] == 0
          and final_routing['readonlySocketUnknown'] == transport_retirement['readonlyPendingRetained']
          and final_routing['readonlySocketUnknown'] > 0, 'APPLICATION_NATIVE_ROUTING_CLOSURE_INVALID')
    check(final_routing['uploads'] == routing['uploads'], 'APPLICATION_NATIVE_ROUTING_FINAL_UPLOADS_CHANGED')
    routing = final_routing
    os.close(publication_fd); publication_fd = None
    check(sql("SELECT count(*) FROM pg_stat_activity WHERE datname='" + database + "'") == '0'
          and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + database + "'") == '0', 'APPLICATION_NATIVE_DATABASE_STILL_ACTIVE')
    check(history(database) == migration['history'], 'APPLICATION_NATIVE_HISTORY_CHANGED')
    check(sql("SELECT oid FROM pg_database WHERE datname='" + database + "'") == index['oid'], 'APPLICATION_NATIVE_DATABASE_REPLACED')
    client_spec = importlib.util.spec_from_file_location('application_final_private_prisma', root / 'application-native-prisma.fixture.py')
    client_module = importlib.util.module_from_spec(client_spec); client_spec.loader.exec_module(client_module)
    check(client_module.inventory(root / 'node_modules/@prisma/client', check) == index['nativePrisma']['capsule']
          and client_module.inventory(Path('/app/node_modules/@prisma/client'), check) == main_shared_inventory
          and json.loads((root / 'generated-prisma-proof.json').read_bytes()) == index['nativePrisma'],
          'APPLICATION_NATIVE_FINAL_PRISMA_IDENTITY_CHANGED')
    sql('DROP DATABASE "' + database + '"')
    retained_ref=config['retainedBrowserReport']
    check(retained_ref['file']=='original-retained-browser-result.json','APPLICATION_RETAINED_BROWSER_SOURCE_NOT_FIXED')
    retained_raw=(root/retained_ref['file']).read_bytes()
    check(hashlib.sha256(retained_raw).hexdigest()==retained_ref['sha256'],'APPLICATION_RETAINED_BROWSER_SOURCE_CHANGED')
    coverage_spec=importlib.util.spec_from_file_location('installed_writer_coverage',root/'installed-writer-coverage.fixture.py')
    coverage_module=importlib.util.module_from_spec(coverage_spec);coverage_spec.loader.exec_module(coverage_module)
    installed_coverage=coverage_module.derive(private_pair,json.loads(retained_raw),
        json.loads((root/'pristine-performance-installed-profile.json').read_bytes()),index['schemaSha256'])
    proven = True
    print(json.dumps(dict(format='sabalan-application-native/v1', passResult=True, productionAdmission=False,
                          observations=observations, originalNativeClosures=closures,
                          bothServingReadersObservedLaterCommit='123456800',
                          exactOriginalPersianDrainingMessageVerified=True,
                          pairedRouting=routing, originalReadonlyTransportRetirement=transport_retirement,
                          sameReleaseCoherentRestore=coherent,
                          fullCatalog=full_catalog['result'],genuinePrivateQualificationPair=private_pair,
                          originalHistory=index['history'], history=migration['history'], ownedMigration=migration,
                          diagnosticExpansionApplied=index['diagnosticExpansionApplied'],
                          diagnosticExpansionSha256=index['diagnosticExpansionSha256'], schemaSha256=index['schemaSha256'],
                          nativePrisma=index['nativePrisma'], originalSharedClientUnchanged=True, qualifiedPrivateClientUnchanged=True,
                          writerCoverage=installed_coverage['writerCoverage'],domainCases=installed_coverage['domainCases'],
                          diagnosticWriterCoverage=executed_writer_coverage(observations,migration,private_pair),
                          actualProductionInquiryLegacyQualified=installed_coverage['actualProductionInquiryLegacyQualified'],
                          originalDatabaseRetiredWithoutForce=True, workingRoot=str(root))))
finally:
    if not proven:
        failed_capture_cleanup = False
        try:
            capture_closed = capture_module is None or capture_module.original_capture_custody_closed(sql)
            proof = None
            if capture_closed and capture_module is not None:
                capture_module.close_original_inquiry_if_quiet(root, write, encoded)
                proof = capture_module.original_capture_failure_proof()
            if capture_closed and transport.edge is not None:
                if transport.edge.poll() is None and transport.business_ready_raw is not None and proof is not None:
                    transport.signal_capture_aborted(proof)
                # Preserve this exact Popen even through an observer interrupt.
                while transport.edge.poll() is None:
                    try:
                        transport.edge.wait()
                    except BaseException:
                        continue
                if role_client.chrome_receipt is not None and not getattr(role_client, 'chrome_closed', False):
                    role_client.request('WAIT_CHROME_CLOSED', dict(purpose='FAILED_CAPTURE_CLEANUP'),
                        'CHROME_CLOSED', actor_id=role_client.actors['chrome'])
                    failed_capture_cleanup = True
        except BaseException:
            # A rejected abort, unknown capture, failed child or broken channel
            # cannot authorize release of any original controller ownership.
            pass
        # Keep THIS Python controller, its actual Popen objects and FD20 while
        # any child may still own work. A host journal cannot adopt this role.
        custody_unknown = False
        try:
            custody_unknown = ((capture_module is not None and not capture_module.original_capture_custody_closed(sql))
                or (private_pair_module is not None and not private_pair_module.original_custody_closed())
                or (transport.edge is not None and transport.edge.poll() is None)
                or (role_client.chrome_receipt is not None and not getattr(role_client, 'chrome_closed', False)))
        except BaseException:
            custody_unknown = True
        if custody_unknown:
            try:
                write(root / 'failure-original-controller-held.json', encoded(dict(originalPass=False,
                    originalControllerPid=os.getpid(), originalPopenObjectsRetained=True, publicationFdRetained=publication_fd,
                    edgePid=transport.edge.pid if transport.edge is not None else None,
                    edgeReturncode=transport.edge.poll() if transport.edge is not None else None,
                    foreignOwnerNotAdopted=True, productionAdmission=False)))
            except BaseException:
                pass
            while True:
                try:
                    time.sleep(30)
                except BaseException:
                    continue
    if not proven:
        if capture_module is not None:
            try:
                capture_module.close_original_inquiry_if_quiet(root, write, encoded)
            except Exception:
                print('APPLICATION_NATIVE_INQUIRY_FAILURE_CLOSURE_UNPROVEN', file=sys.stderr)
        # These are the ORIGINAL Popen owners, never an adopted PID or expired
        # lease. A harness assertion may request their normal finish; uncertain
        # ancestry/lock/drain/SQL remains held and no database is dropped here.
        closure_attempts = []
        for grant, child in actors:
            try:
                native_file = Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json'
                native = json.loads(native_file.read_bytes())
                check(native['onlineScope']['scope'] == grant['scope'] and native['onlineScope']['sha256'] == grant['sha256']
                      and native['guardian']['pid'] == child.pid, 'APPLICATION_NATIVE_FAILURE_OWNER_CHANGED')
                if native['phase'] == 'ACTIVE' and child.poll() is None:
                    process = Path('/proc') / str(child.pid)
                    birth = (process / 'stat').read_text().rsplit(') ', 1)[1].split()
                    actual_fd = (process / 'fd/9').stat()
                    check(birth[19] == native['guardian']['startTicks'] and birth[0] != 'Z'
                          and Path('/proc/sys/kernel/random/boot_id').read_text().strip() == native['guardian']['bootId']
                          and str(actual_fd.st_dev) == native['lock']['device'] and str(actual_fd.st_ino) == native['lock']['inode']
                          and re.search(r'FLOCK\s+ADVISORY\s+WRITE', (process / 'fdinfo/9').read_text()), 'APPLICATION_NATIVE_FAILURE_LOCK_UNPROVEN')
                    marker = Path(grant['scope']['coordinationDirectory']) / 'diagnostic-finish' / grant['scope']['runtimeId']
                    if not marker.exists():
                        write(marker, b'done\n')
                failure_wait_deadline = wait_failed_original_child(child)
                native = json.loads(native_file.read_bytes())
                state = json.loads((Path(grant['scope']['boundaryDirectory']) / 'state.json').read_bytes())
                namespace_quiet = sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + native['namespace'] + "'") == '0'
                check(native['phase'] == state['phase'] == 'QUIESCENT' and native['nativeReaped'] and native['databaseQuiet']
                      and not native['stoppedBySignal'] and namespace_quiet, 'APPLICATION_NATIVE_FAILURE_FINISH_UNPROVEN')
                check(child.returncode == native['nativeStatus'] and isinstance(child.returncode, int)
                      and 0 <= child.returncode <= 255, 'APPLICATION_NATIVE_FAILURE_STATUS_UNPROVEN')
                # This is the original child handle; fresh independent SQL and
                # durable native/work/claim checks precede any negative event.
                role_client.verify_closure(dict(closure=dict(scopeSha256=grant['sha256'],
                    originalPopenPid=child.pid, originalReturncode=child.returncode,
                    nativeRawBase64=__import__('base64').b64encode(native_file.read_bytes()).decode(),
                    workRawBase64=__import__('base64').b64encode((Path(grant['scope']['boundaryDirectory']) / 'state.json').read_bytes()).decode())),
                    grant, child.returncode)
                claim_native = json.loads((Path(grant['scope']['boundaryDirectory']) / 'claim.json').read_bytes())['native']
                closure_attempts.append(dict(runtimeId=grant['scope']['runtimeId'], normalFinishRequested=True,
                    diagnosticWaitDeadlineExceeded=failure_wait_deadline,
                    nativeStatus=native['nativeStatus'], namespaceQuiet=True, workPhase=state['phase'],
                    claimNative=claim_native, freshSql=dict(visible=True,
                        systemIdentifier=grant['scope']['database']['systemIdentifier'], databaseOid=index['oid'],
                        namespaceSessions=0, prepared=0),
                    originalPopenPid=child.pid, originalReturncode=child.returncode,
                    nativeRawBase64=__import__('base64').b64encode(native_file.read_bytes()).decode(),
                    workRawBase64=__import__('base64').b64encode((Path(grant['scope']['boundaryDirectory']) / 'state.json').read_bytes()).decode()))
            except Exception as failure:
                closure_attempts.append(dict(runtimeId=grant['scope']['runtimeId'], held=True, failureType=type(failure).__name__))
        try:
            write(root / 'failure-original-normal-finish.json', encoded(dict(originalPass=False, databaseNotDropped=True,
                  originalOwners=closure_attempts, otherControllersNotAdopted=True)))
        except Exception:
            print('APPLICATION_NATIVE_FAILURE_CLOSURE_RECORD_UNPROVEN', file=sys.stderr)
        if any(value.get('held') for value in closure_attempts) or any(child.poll() is None for _, child in actors):
            while True:
                try:
                    time.sleep(30)
                except BaseException:
                    continue
        early_http_failure = (len(actors) == len(closure_attempts) == 1 and not observations
            and not closure_attempts[0].get('held') and closure_attempts[0]['originalReturncode'] == 1
            and transport.edge is None and role_client.chrome_receipt is None
            and getattr(role_client, 'failed_closed', None) is None)
        awaiting_migration_closure = (len(actors) == len(observations) == len(closure_attempts) == 1
            and not closure_attempts[0].get('held') and closure_attempts[0]['originalReturncode'] == 0
            and transport.edge is None and role_client.chrome_receipt is None
            and role_client.failed_receive is not None and role_client.request_count == 2
            and (root / 'pristine-performance-installed-profile.json').is_file())
        private_pair_failed_closed = private_pair_module is not None and private_pair_module.original_failure_closed()
        if early_http_failure or awaiting_migration_closure or (getattr(role_client, 'failed_closed', None) is not None and transport.edge is None and role_client.chrome_receipt is None) or failed_capture_cleanup or private_pair_failed_closed:
            try:
                check(closure_attempts and all(not value.get('held') and value['originalReturncode'] == value['nativeStatus'] == (1 if early_http_failure else 0)
                      for value in closure_attempts), 'APPLICATION_ROLE_MAIN_FAILED_CLOSURE_UNPROVEN')
                role_client.channel.assert_observers_closed()
                role_client.channel.emit('MAIN_FAILED_CLOSED', dict(originalPass=False, productionAdmission=False,
                    failureKind='EARLY_HTTP_STARTUP_CLOSED' if early_http_failure else
                        'HTTP_CLOSED_AWAITING_ORIGINAL_CANDIDATE' if awaiting_migration_closure else
                        'PRIVATE_PAIR_FAILED_CLOSED' if private_pair_failed_closed else 'PRIOR_FAILED_PHASE_CLOSED',
                    failedReceive=role_client.failed_receive, requestCount=role_client.request_count,
                    edgeNeverCreated=transport.edge is None, owners=closure_attempts,
                    originalChromeClosed=getattr(role_client, 'chrome_closed', False),
                    edgeClosure=dict(originalPopenPid=transport.edge.pid, originalReturncode=transport.edge.returncode)
                        if transport.edge is not None else None))
            except Exception:
                print('APPLICATION_ROLE_MAIN_FAILURE_STILL_HELD', file=sys.stderr)
        print('APPLICATION_NATIVE_HELD ' + str(root), file=sys.stderr)
    if publication_fd is not None:
        os.close(publication_fd)
