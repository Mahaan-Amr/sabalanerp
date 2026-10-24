"""Original candidate-role diagnostic owner. Signed host commands only.

This process creates and retains every original Popen. Captured JSON on disk is
input/evidence, never replacement ownership or a host phase authorization.
Unknown work stays with this original controller; no timeout, signal or PID
adoption manufactures closure. This is not production deployment admission.
"""
import base64
import ctypes
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import shlex
import threading
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request
from urllib.parse import urlsplit, urlunsplit, unquote, parse_qsl

MIB = 1024 * 1024
CHANNEL_SHA256 = '2c38aaea17260b33b21c1d5ccc0d3110bc551df7d7b12f6d2549478dbc9fcc5e'
CAPACITY = {'migration': 384 * MIB, 'chrome': 256 * MIB,
            'restored-baseline': 128 * MIB, 'restored-inquiry': 192 * MIB, 'restored-http': 256 * MIB, 'private-http2': 256 * MIB, 'private-jobs': 384 * MIB, 'full-catalog': 384 * MIB, 'private-browser-verify':128*MIB,'private-chrome':256*MIB,'private-domain': 128 * MIB,'private-domain-baseline':128*MIB,'private-domain-verify':128*MIB}
COMMANDS = {'RUN_MIGRATION', 'START_CHROME', 'RUN_RESTORED_BASELINE', 'RUN_RESTORED_INQUIRY',
            'START_RESTORED_HTTP', 'FINISH_RESTORED_HTTP', 'WAIT_CHROME_CLOSED', 'CLOSE', 'CLOSE_CLOSED',
            'START_PRIVATE_JOBS', 'PREPARE_PRIVATE_JOBS', 'FINISH_PRIVATE_JOBS', 'RUN_FULL_CATALOG',
            'START_PRIVATE_HTTP2', 'PREPARE_PRIVATE_HTTP2', 'FINISH_PRIVATE_HTTP2','VERIFY_PRIVATE_BROWSER_TICKETS','START_PRIVATE_CHROME','WAIT_PRIVATE_CHROME_CLOSED','RUN_PRIVATE_DOMAIN_CASES','RUN_PRIVATE_DOMAIN_BASELINE','VERIFY_PRIVATE_DOMAIN_RESTORE'}
_CAPACITY_REFUSAL_AUTHORITY = object()
CAPACITY.update({'legacy-private-chrome': 256 * MIB, 'legacy-private-browser-verify': 128 * MIB})
COMMANDS.update({'START_PRIVATE_LEGACY_CHROME', 'WAIT_PRIVATE_LEGACY_CHROME_CLOSED', 'VERIFY_PRIVATE_LEGACY_BROWSER_TICKETS'})
CAPACITY['pristine-performance']=256*MIB
COMMANDS.add('RUN_PRISTINE_PERFORMANCE')
CAPACITY['online-point-inquiry']=192*MIB
COMMANDS.update({'START_ONLINE_POINT_INQUIRY','FINISH_ONLINE_POINT_INQUIRY'})


class _OriginalCapacityRefusal(Exception):
    def __init__(self, authority, kind, observed, required):
        if authority is not _CAPACITY_REFUSAL_AUTHORITY:
            raise RuntimeError('CANDIDATE_CAPACITY_REFUSAL_AUTHORITY_UNPROVEN')
        self.kind, self.observed, self.required = kind, observed, required
        super().__init__('CANDIDATE_CAPACITY_REFUSED_' + kind)


def check(value, code):
    if not value:
        raise RuntimeError(code)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def private_read(file, maximum=1024 * 1024):
    file = Path(file)
    check(file.is_absolute() and file.resolve(strict=True) == file, 'CANDIDATE_INPUT_PATH_UNPROVEN')
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        check(os.path.isfile(file) and before.st_nlink == 1 and before.st_uid == os.getuid()
              and not before.st_mode & 0o077 and 0 < before.st_size <= maximum, 'CANDIDATE_INPUT_IDENTITY_UNPROVEN')
        raw = bytearray()
        while len(raw) < before.st_size:
            chunk = os.read(fd, min(262144, before.st_size - len(raw)))
            check(chunk, 'CANDIDATE_INPUT_TRUNCATED'); raw.extend(chunk)
        check(not os.read(fd, 1), 'CANDIDATE_INPUT_GREW')
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
                                  value.st_ctime_ns, value.st_uid, value.st_mode, value.st_nlink)
        check(identity(before) == identity(os.fstat(fd)) == identity(os.lstat(file)), 'CANDIDATE_INPUT_CHANGED')
        return bytes(raw)
    finally:
        os.close(fd)


def write(file, raw, mode=0o400):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode)
        offset = 0
        while offset < len(raw):
            count = os.write(fd, raw[offset:]); check(count > 0, 'CANDIDATE_WRITE_FAILED'); offset += count
        os.fsync(fd)
    finally:
        os.close(fd)
    parent = os.open(Path(file).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)


def birth(pid):
    fields = Path('/proc/' + str(pid) + '/stat').read_text().rsplit(') ', 1)[1].split()
    check(fields[0] != 'Z', 'CANDIDATE_ORIGINAL_CHILD_ALREADY_ZOMBIE')
    return dict(pid=pid, startTicks=fields[19], bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                pidNamespace=os.readlink('/proc/' + str(pid) + '/ns/pid'))


EXPECTED_CANDIDATE_MEMORY_BYTES=1536*MIB

def configure_qa_memory_profile(configuration,receipt_raw):
    global EXPECTED_CANDIDATE_MEMORY_BYTES
    profile=configuration.get('qaMemoryProfile')
    if profile is None:
        EXPECTED_CANDIDATE_MEMORY_BYTES=1536*MIB;return
    check(isinstance(profile,dict)and set(profile)=={'format','candidateBytes','candidateSwapBytes','replacementReceiptSha256','receiptFile'}and profile['format']=='sabalan-explicit-local-qa-memory-profile/v1'and profile['receiptFile']=='qa-memory-replacement-receipt.json','CANDIDATE_QA_PROFILE_INVALID')
    check(profile['candidateBytes']==profile['candidateSwapBytes']==2048*MIB and digest(receipt_raw)==profile['replacementReceiptSha256']==configuration['roleQualification']['sha256'],'CANDIDATE_QA_PROFILE_RECEIPT_CHANGED')
    receipt=json.loads(receipt_raw);transition=receipt.get('candidateQaMemoryTransition');recovery=receipt.get('candidateQaMemoryRecovery');preserved=receipt.get('candidateQaMemoryProfile')or recovery;check((transition is None)!=(preserved is None),'CANDIDATE_QA_PROFILE_AMBIGUOUS');t=transition if transition is not None else preserved;old_candidate=(1536 if transition is not None else 2048)*MIB
    check(receipt['pass']is True and receipt['phase']=='COMPLETE'and receipt['productionAdmission']is False and receipt['up']['code']==0 and receipt['up']['signal']is None and receipt['originalChildren']==dict(allOriginalChildrenClosed=True,interrupted=False),'CANDIDATE_QA_PROFILE_REPLACEMENT_UNPROVEN')
    check(t['format']==('sabalan-explicit-local-qa-candidate-memory-transition/v3'if transition is not None else 'sabalan-recovered-local-qa-candidate-memory-profile/v1'if recovery is not None else 'sabalan-preserved-local-qa-candidate-memory-profile/v1')and receipt['originalLimitsUnchanged']==(transition is None)and t['before']=={'backend-candidate':old_candidate,'backend-retained':768*MIB}and t['after']=={'backend-candidate':2048*MIB,'backend-retained':768*MIB}and t['nativeActorFloorBytes']==384*MIB and t['cacheCreditUsed']is False,'CANDIDATE_QA_PROFILE_TRANSITION_CHANGED')
    check(t['runtimeLimitsBefore']['backend-candidate']['MemorySwap']==old_candidate and t['runtimeLimitsAfter']['backend-candidate']['MemorySwap']==2048*MIB and receipt['actual']['backend-candidate']['memoryBytes']==receipt['actual']['backend-candidate']['memorySwapBytes']==2048*MIB,'CANDIDATE_QA_PROFILE_SWAP_CHANGED')
    for name in ['beforeUp','afterUp']:check(t[name]['platform']=='win32'and type(t[name]['availableBytes'])is int and t[name]['availableBytes']>=2048*MIB,'CANDIDATE_QA_PROFILE_HOST_FLOOR')
    for service in ['backend-candidate','backend-retained']:
        before=t['runtimeLimitsBefore'][service];after=t['runtimeLimitsAfter'][service]
        check({k:v for k,v in before.items()if k!='MemorySwap'}=={k:v for k,v in after.items()if k!='MemorySwap'},'CANDIDATE_QA_PROFILE_UNRELATED_LIMIT_CHANGED')
        if service=='backend-retained':check(before==after and after['MemorySwap']==1536*MIB and receipt['actual'][service]['memoryBytes']==768*MIB and receipt['actual'][service]['memorySwapBytes']==1536*MIB,'CANDIDATE_QA_PROFILE_RETAINED_CHANGED')
        old=receipt['previous'][service];check(re.fullmatch('[a-f0-9]{64}',old['id'])and old['id']!=receipt['actual'][service]['id']and receipt['reobservedBaseline']['identities'][service]==old and receipt['reobservedBaseline']['previousIdentities'][service]==old,'CANDIDATE_QA_PROFILE_PREDECESSOR_CHANGED')
    check(set(t['predecessor'])=={'file','sha256'}and re.fullmatch('[a-f0-9]{64}',t['predecessor']['sha256'])and receipt['inputs'][t['predecessor']['file']]==t['predecessor']['sha256'],'CANDIDATE_QA_PROFILE_PREDECESSOR_PIN')
    if recovery is not None:check(t['originalTransitionQualified']is False and t['failedReportRemainsFailed']is True and t['negativeOwnerObservationNotAdoption']is True and t['failed']['sha256']=='1cccc94373dd98846b5aa8082fa9d76d3edc7a2a3e14e467e8e3e57677dc568d'and t['predecessor']['sha256']=='5c6ffedf131d47d280651f55130ffa25f5798cbbe462ae185f66c577b56229fd'and receipt['inputs'][t['failed']['file']]==t['failed']['sha256'],'CANDIDATE_QA_RECOVERY_ANCHOR_CHANGED')
    if preserved is not None and recovery is None:check(set(t['transition'])=={'file','sha256'}and re.fullmatch('[a-f0-9]{64}',t['transition']['sha256'])and receipt['inputs'][t['transition']['file']]==t['transition']['sha256'],'CANDIDATE_QA_PROFILE_TRANSITION_PIN')
    EXPECTED_CANDIDATE_MEMORY_BYTES=2048*MIB


def resource():
    root = Path('/sys/fs/cgroup')
    maximum = (root / 'memory.max').read_text().strip()
    check(maximum.isdecimal() and int(maximum) == EXPECTED_CANDIDATE_MEMORY_BYTES, 'CANDIDATE_ENFORCED_MEMORY_CAP_CHANGED')
    current = int((root / 'memory.current').read_text())
    events = {key: int(value) for key, value in (line.split() for line in (root / 'memory.events').read_text().splitlines())}
    return dict(memoryMaximum=int(maximum), memoryCurrent=current, memoryAvailable=int(maximum) - current,
                events=events, observedMonotonic=time.monotonic())


def no_oom(before, after):
    return all(after['events'].get(key, 0) == before['events'].get(key, 0) for key in ['oom', 'oom_kill', 'oom_group_kill'])


def assert_loading_environment(environment):
    check(not any(environment.get(key) for key in ['NODE_PRELOAD', 'LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH',
          'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONINSPECT']), 'CANDIDATE_LOADING_ENVIRONMENT_REFUSED')
    check(environment.get('NODE_PATH') in [None, '', '/app/node_modules']
          and all(re.fullmatch(r'--max-old-space-size=(?:[6-9][0-9]|[1-9][0-9]{2,3})', option)
                  for option in shlex.split(environment.get('NODE_OPTIONS', ''))), 'CANDIDATE_LOADING_ENVIRONMENT_REFUSED')


class CandidateOwner:
    def __init__(self, root, public_key, session):
        check(sys.platform == 'linux' and sys.flags.optimize == 0, 'CANDIDATE_CONTROLLER_PLATFORM_UNPROVEN')
        assert_loading_environment(os.environ)
        os.umask(0o077)
        self.root = Path(root)
        check(re.fullmatch(r'/app/online-runtime-acceptance/application-native-[a-f0-9]{32}', root)
              and self.root.resolve(strict=True) == self.root, 'CANDIDATE_CONTROLLER_ROOT_INVALID')
        # Original kernel subreaper custody predates every owned descendant.
        check(ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) == 0, 'CANDIDATE_SUBREAPER_UNPROVEN')
        check(digest(private_read(self.root / 'original-host-controller-channel.py')) == CHANNEL_SHA256, 'CANDIDATE_CHANNEL_SOURCE_CHANGED')
        spec = importlib.util.spec_from_file_location('candidate_original_host_channel', self.root / 'original-host-controller-channel.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        self.channel = module.OriginalHostChannel(public_key, session, 'candidate')
        configuration=json.loads(private_read(self.root/'config.json',8*MIB));profile_receipt=private_read(self.root/'qa-memory-replacement-receipt.json',16*MIB)if configuration.get('qaMemoryProfile')is not None else b'';configure_qa_memory_profile(configuration,profile_receipt)
        self.controller_id, self.original_birth = secrets.token_hex(32), birth(os.getpid())
        self.actors, self.helpers, self.probes = {}, {}, {}
        self.sticky_failures, self.completed = [], set()
        self.enrolled = False
        self.directory = self.root / 'candidate-original-controller'
        self.directory.mkdir(mode=0o700)
        self.channel.emit('HELLO', dict(role='candidate', pid=os.getpid(), controllerId=self.controller_id, root=str(self.root), birth=self.original_birth,
                                      resources=resource(), productionAdmission=False))

    def relative(self, name):
        check(isinstance(name, str) and name and not name.startswith('/') and '\\' not in name
              and all(part not in ['', '.', '..'] for part in name.split('/')), 'CANDIDATE_ARTIFACT_NAME_INVALID')
        value = self.root / name
        check(value.resolve(strict=True) == value, 'CANDIDATE_ARTIFACT_SYMLINK_REFUSED')
        return value

    def artifact(self, name):
        check(name in self.files, 'CANDIDATE_ARTIFACT_NOT_ENROLLED')
        file = self.relative(name)
        hashed = hashlib.sha256()
        with file.open('rb') as stream:
            while chunk := stream.read(262144):
                hashed.update(chunk)
        check(hashed.hexdigest() == self.files[name], 'CANDIDATE_CAPTURED_SOURCE_CHANGED')
        return file

    def enroll(self, receipt):
        check(not self.enrolled, 'CANDIDATE_ALREADY_ENROLLED')
        body = receipt.body
        self.request_id(body)
        check(set(body) == {'requestId', 'roleTopology', 'index', 'files'}, 'CANDIDATE_ENROLLMENT_FIELDS_INVALID')
        topology = body['roleTopology']; check(set(topology) == {'main', 'candidate'}, 'CANDIDATE_TOPOLOGY_INVALID')
        for role in topology.values():
            check(re.fullmatch(r'[a-f0-9]{64}', role['containerId']) and re.fullmatch(r'sha256:[a-f0-9]{64}', role['image']), 'CANDIDATE_IMAGE_UNPROVEN')
            address = ipaddress.ip_address(role['host']); check(address.version == 4 and address.is_private and not address.is_loopback, 'CANDIDATE_PRIVATE_ADDRESS_INVALID')
        check(topology['main']['host'] != topology['candidate']['host'] and topology['main']['containerId'] != topology['candidate']['containerId'], 'CANDIDATE_ROLES_NOT_DISTINCT')
        self.topology, self.index, self.files = topology, body['index'], body['files']
        check(isinstance(self.files, dict) and 1 <= len(self.files) <= 4096, 'CANDIDATE_ARTIFACT_INVENTORY_INVALID')
        for name, value in self.files.items():
            check(re.fullmatch(r'[a-f0-9]{64}', value), 'CANDIDATE_ARTIFACT_HASH_INVALID'); self.artifact(name)
        check(json.loads(private_read(self.root / 'index.json', 8 * MIB)) == self.index, 'CANDIDATE_SIGNED_INDEX_CHANGED')
        for field in ['database', 'restoredDatabase']:
            check(re.fullmatch(r'qa_[a-z_]+_[a-f0-9]{32}', self.index[field]), 'CANDIDATE_DATABASE_NAME_INVALID')
        source = urlsplit(os.environ['DATABASE_URL'])
        check(source.hostname == 'postgres' and source.path == '/sabalanerp', 'CANDIDATE_DATABASE_SOURCE_INVALID')
        self.source = source
        self.pg = dict(PGHOST='postgres', PGPORT=str(source.port or 5432), PGUSER=unquote(source.username),
                       PGPASSWORD=unquote(source.password), PGDATABASE='postgres', PGAPPNAME='candidate-native-observer',
                       PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=1000', PGTZ='UTC')
        for db, oid in [(self.index['database'], self.index['oid']), (self.index['restoredDatabase'], self.index['restoredOid'])]:
            check(self.sql("SELECT oid FROM pg_database WHERE datname='" + db + "'") == str(oid), 'CANDIDATE_DATABASE_REPLACED')
        self.enrolled = True

    @staticmethod
    def request_id(body):
        check(isinstance(body, dict) and re.fullmatch(r'[a-f0-9]{64}', body.get('requestId', '')), 'CANDIDATE_REQUEST_ID_INVALID')
        return body['requestId']

    def probe(self, label, argv, environment=None, cwd=None, maximum=MIB):
        key = label + '-' + secrets.token_hex(8)
        actor = subprocess.Popen(argv, env=environment, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        record = dict(actor=actor, originalPid=actor.pid, label=label, closed=False, outputBytes=0, errorBytes=0)
        self.probes[key] = record  # BEFORE any wait, read or possible interruption.
        output, errors = bytearray(), bytearray(); exceeded = False
        selector = selectors.DefaultSelector()
        try:
            for stream, target in [(actor.stdout, output), (actor.stderr, errors)]:
                os.set_blocking(stream.fileno(), False); selector.register(stream, selectors.EVENT_READ, target)
            while selector.get_map():
                for selected, _ in selector.select(1):
                    chunk = os.read(selected.fileobj.fileno(), 65536)
                    if not chunk:
                        selector.unregister(selected.fileobj); selected.fileobj.close(); continue
                    name = 'outputBytes' if selected.data is output else 'errorBytes'; record[name] += len(chunk)
                    if len(selected.data) + len(chunk) <= maximum: selected.data.extend(chunk)
                    else: exceeded = True  # Drain, never retain unbounded bytes or kill.
            actor.wait(); record['closed'] = True; record['originalReturncode'] = actor.returncode
            check(not exceeded, 'CANDIDATE_OBSERVER_OUTPUT_BOUND')
            return actor.returncode, bytes(output), bytes(errors)
        finally:
            selector.close()  # The registered original Popen/pipes remain owned on failure.

    def sql(self, text):
        status, output, errors = self.probe('psql', ['/usr/bin/psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', text],
                                         {**os.environ, **self.pg})
        check(status == 0, 'CANDIDATE_SQL_OBSERVATION_UNPROVEN')
        return output.decode().strip()

    def log_pumps(self, value):
        value['pumpFailures'], value['pumps'], value['logBytes'] = [], [], {}
        for name, stream, path, maximum in [('stdout', value['actor'].stdout, value['output'], 2 * MIB),
                                             ('stderr', value['actor'].stderr, value['errors'], MIB)]:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            def pump(name=name, stream=stream, descriptor=descriptor, maximum=maximum):
                total = 0
                try:
                    while chunk := stream.read1(65536):
                        previous = total; total += len(chunk); value['logBytes'][name] = total
                        accepted = chunk[:max(0, maximum - previous)]
                        offset = 0
                        while offset < len(accepted):
                            written = os.write(descriptor, accepted[offset:]); check(written > 0, 'CANDIDATE_LOG_WRITE_FAILED'); offset += written
                        if total > maximum and name not in value['pumpFailures']: value['pumpFailures'].append(name)
                    os.fsync(descriptor)
                except BaseException as error:
                    value['pumpFailures'].append(type(error).__name__)
                finally:
                    os.close(descriptor); stream.close()
            thread = threading.Thread(target=pump, name='candidate-owned-' + name)
            value['pumps'].append(thread); thread.start()

    def sql_closure(self, grant, namespace):
        db = grant['scope']['database']['name']; system = self.sql('SELECT system_identifier FROM pg_control_system()')
        check(system == grant['scope']['database']['systemIdentifier'], 'CANDIDATE_DATABASE_CLUSTER_CHANGED')
        expected_oid = self.index['oid'] if db == self.index['database'] else (self.index['restoredOid'] if db == self.index['restoredDatabase'] else self.index['privateQualification']['domainRestore']['databaseOid'])
        oid = self.sql("SELECT oid FROM pg_database WHERE datname='" + db + "'")
        check(oid == str(expected_oid), 'CANDIDATE_DATABASE_REPLACED')
        visible = self.sql("SELECT (rolsuper OR pg_has_role(current_user,'pg_read_all_stats','MEMBER'))::text FROM pg_roles WHERE rolname=current_user") == 'true'
        check(visible and re.fullmatch(r'sabalan-rt-[a-f0-9]{48}', namespace), 'CANDIDATE_SQL_VISIBILITY_UNPROVEN')
        sessions = int(self.sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace + "'"))
        prepared = int(self.sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + db + "'"))
        check(sessions == 0 and prepared == 0, 'CANDIDATE_ORIGINAL_SQL_NOT_CLOSED')
        return dict(system=system, oid=oid, visible=visible, sessions=sessions, prepared=prepared)

    def capacity(self, kind):
        observed = resource()
        if observed['memoryAvailable'] < CAPACITY[kind]:
            raise _OriginalCapacityRefusal(_CAPACITY_REFUSAL_AUTHORITY,kind,observed,CAPACITY[kind])
        disk = os.statvfs(self.directory)
        free = disk.f_bavail * disk.f_frsize
        # A diagnostic actor's two logs are bounded to 3 MiB. Keep an explicit
        # extra 64 MiB for already-owned actors/closure evidence; no cache credit.
        required_disk = 1024 * MIB if kind == 'full-catalog' else 67 * MIB
        check(free >= required_disk, 'CANDIDATE_DIAGNOSTIC_LOG_CAPACITY_REFUSED')
        return dict(observed, requiredBytes=CAPACITY[kind], diskFreeBytes=free, diskRequiredBytes=required_disk, kind=kind)

    def grant(self, kind):
        if kind == 'pristine-performance': grant=self.index['pristinePerformanceGrant']
        elif kind == 'migration':
            values = [value for value in self.index['grants'] if value['scope']['purpose'] == 'jobs']; check(len(values) == 1, 'CANDIDATE_JOBS_GRANT_AMBIGUOUS'); grant = values[0]
        elif kind == 'restored-baseline': grant = self.index['restoredBaselineGrant']
        elif kind == 'restored-http': grant = self.index['restoredGrant']
        elif kind == 'private-jobs': grant = self.index['privateQualification']['jobsGrant']
        elif kind == 'private-domain-baseline': grant=self.index['privateQualification']['domainRestore']['baselineGrant']
        elif kind == 'private-http2': grant = self.index['privateQualification']['httpGrants'][1]
        elif kind == 'online-point-inquiry': grant=self.index['onlinePointInquiryGrant']
        else: grant = self.index['inquiryGrants']['restored']
        raw = private_read(grant['file']); check(digest(raw) == grant['sha256'] and json.loads(raw) == grant['scope'], 'CANDIDATE_ISSUED_SCOPE_CHANGED')
        check(grant['scope']['image'] == self.topology['candidate']['image'], 'CANDIDATE_SCOPE_IMAGE_ROLE_MISMATCH')
        return grant

    def native_paths(self, grant):
        return Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json', Path(grant['scope']['boundaryDirectory']) / 'state.json'

    def environment(self, grant, database):
        result = dict(os.environ, NODE_ENV='test', NODE_PATH='/app/node_modules',
                      DATABASE_URL=urlunsplit(self.source._replace(path='/' + database, query='connection_limit=2&pool_timeout=10')),
                      BACKEND_RUNTIME_ROLE='control' if grant['scope']['purpose'] == 'jobs' else 'serving',
                      RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'], BACKEND_ONLINE_SCOPE_FILE=grant['file'],
                      BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'])
        result.pop('NODE_OPTIONS', None)
        return result

    def new_process(self, kind, argv, environment, request_id, grant=None, cwd=None, stdin=False, actor_id=None):
        check(kind not in self.actors, 'CANDIDATE_ORIGINAL_ACTOR_ALREADY_CREATED')
        for name, value in self.actors.items():
            if value.get('closed') or name == 'chrome': continue
            # Only the two explicitly scoped private actors may coexist. Each
            # still has its own original Popen, capacity admission and closure.
            check((({name,kind} == {'private-http2','private-jobs'}) or (kind == 'private-domain' and name in {'private-http2','private-jobs'}) or (kind in {'online-point-inquiry','private-chrome','private-browser-verify','legacy-private-chrome','legacy-private-browser-verify'} and name=='private-http2')) and value['actor'].poll() is None
                  and birth(value['actor'].pid) == value['birth'], 'CANDIDATE_NATIVE_ACTORS_OVERLAP')
        before = self.capacity(kind)
        if grant:
            native_file, _ = self.native_paths(grant)
            check(not native_file.exists() and not (Path(grant['scope']['boundaryDirectory']) / 'claim.json').exists(), 'CANDIDATE_SCOPE_ALREADY_CLAIMED')
        output_path, error_path = self.directory / (kind + '.stdout'), self.directory / (kind + '.stderr')
        actor_id = actor_id or secrets.token_hex(32)
        check(re.fullmatch(r'[a-f0-9]{64}', actor_id), 'CANDIDATE_ACTOR_ID_INVALID')
        requested_ns = str(time.monotonic_ns())
        actor = subprocess.Popen(argv, cwd=cwd, env=environment, stdin=subprocess.PIPE if stdin else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        value = dict(id=actor_id, kind=kind, actor=actor, birth=None, grant=grant,
                     output=output_path, errors=error_path, before=before, closed=False, deadlineExceeded=False,
                     admissionRequestedMonotonicNs=requested_ns)
        self.actors[kind] = value
        self.log_pumps(value)
        value['birth'] = birth(actor.pid)
        active = None
        if grant:
            end = time.monotonic() + 10
            while True:
                try:
                    raw = private_read(self.native_paths(grant)[0]); parsed = json.loads(raw)
                    if parsed.get('phase') == 'ACTIVE':
                        check(parsed['guardian'] == value['birth'] and parsed['onlineScope']['sha256'] == grant['sha256'], 'CANDIDATE_ACTIVE_ORIGINAL_OWNER_CHANGED')
                        active = raw; value['exclusiveClaimObservedMonotonicNs'] = str(time.monotonic_ns()); break
                except FileNotFoundError: pass
                check(actor.poll() is None and time.monotonic() < end, 'CANDIDATE_ACTIVE_OWNER_NOT_OBSERVED'); time.sleep(0.005)
        value['active'] = active
        self.channel.emit('ACTOR_STARTED', dict(requestId=request_id, actorId=value['id'], kind=kind,
            originalPopenPid=actor.pid, birth=value['birth'], scopeSha256=grant['sha256'] if grant else None,
            activeNativeRawBase64=base64.b64encode(active).decode() if active else None))
        return value

    def wait_original(self, value, timeout):
        started = time.monotonic()
        while True:
            try:
                value['actor'].wait(timeout=1)
                if 'controlClosedMonotonicNs' not in value: value['controlClosedMonotonicNs'] = str(time.monotonic_ns())
                break
            except subprocess.TimeoutExpired:
                if not value['deadlineExceeded'] and time.monotonic() - started >= timeout:
                    value['deadlineExceeded'] = True
                    write(self.directory / (value['kind'] + '-deadline.json'), encoded(dict(
                        actorId=value['id'], originalPopenPid=value['actor'].pid, deadlineExceeded=True,
                        originalHandleRetained=True, terminationRequested=False)), 0o600)
        if time.monotonic() - started >= timeout: value['deadlineExceeded'] = True
        for thread in value.get('pumps', []): thread.join()
        check(not value.get('pumpFailures'), 'CANDIDATE_ORIGINAL_LOG_FAILED_OR_EXCEEDED')
        return value['actor'].returncode

    def close_native(self, value, expected_status=0, observation_only=False):
        inquiry=value['kind'] in {'restored-inquiry','online-point-inquiry'}
        expected_native = 143 if inquiry else expected_status
        grant, actor = value['grant'], value['actor']; check(actor.returncode is not None, 'CANDIDATE_ORIGINAL_ACTOR_STILL_ACTIVE')
        native_raw = private_read(self.native_paths(grant)[0]); work_raw = private_read(self.native_paths(grant)[1]); native, work = json.loads(native_raw), json.loads(work_raw)
        work_claim_raw = private_read(Path(grant['scope']['boundaryDirectory']) / 'claim.json')
        work_scope_raw = private_read(Path(grant['scope']['boundaryDirectory']) / 'scope.json')
        claim, provision = json.loads(work_claim_raw), json.loads(work_scope_raw)
        check(native['guardian'] == value['birth'] and native['phase'] == work['phase'] == 'QUIESCENT'
              and native['nativeReaped'] and native['onlineScope']['sha256'] == grant['sha256']
              and type(native['nativeStatus']) is int, 'CANDIDATE_NATIVE_ORIGINAL_CLOSURE_UNPROVEN')
        status = native['nativeStatus']
        if inquiry:
            original_status = 128 if native['stoppedBySignal'] else (status if status >= 0 else 128 + abs(status))
        else:
            original_status = status if 0 <= status <= 125 else 125
        check(actor.returncode == original_status, 'CANDIDATE_NATIVE_WRAPPER_STATUS_MISMATCH')
        if inquiry: check(native.get('sqliteNativeClosed') is True, 'CANDIDATE_SQLITE_NOT_CLOSED')
        else: check(native.get('databaseQuiet') is True, 'CANDIDATE_DATABASE_NOT_QUIET')
        check(native['activeClaimSha256'] == digest(value['active']), 'CANDIDATE_NATIVE_ACTIVE_CLAIM_CHANGED')
        check(claim.get('native') == dict(scopeSha256=grant['sha256'],claimSha256=digest(value['active']))
              and provision['scope']['runtimeId'] == grant['scope']['runtimeId'], 'CANDIDATE_ORIGINAL_WORK_BINDING_CHANGED')
        namespace = native.get('namespace') or 'sabalan-rt-' + digest(grant['scope']['runtimeId'].encode('ascii'))[:48]
        sql = self.sql_closure(grant, namespace)
        after = resource()
        check(all(not thread.is_alive() for thread in value.get('pumps', [])), 'CANDIDATE_ORIGINAL_LOG_PUMPS_ACTIVE')
        value['closed'] = True
        closure = dict(originalPopenPid=actor.pid, originalReturncode=actor.returncode,
                    nativeRawBase64=base64.b64encode(native_raw).decode(), workRawBase64=base64.b64encode(work_raw).decode(),
                    workClaimRawBase64=base64.b64encode(work_claim_raw).decode(),workScopeRawBase64=base64.b64encode(work_scope_raw).decode(),
                    runtimeId=grant['scope']['runtimeId'],activeClaimSha256=digest(value['active']),claimNative=claim['native'],
                    freshSql=dict(visible=sql['visible'],systemIdentifier=sql['system'],databaseOid=str(sql['oid']),namespace=namespace,namespaceSessions=sql['sessions'],prepared=sql['prepared']),
                    scopeSha256=grant['sha256'], namespace=namespace, sql=sql, resourcesBefore=value['before'], resourcesAfter=after)
        if value['kind'] == 'private-jobs':
            interval = dict(runtimeId=grant['scope']['runtimeId'],bootId=value['birth']['bootId'],activeClaimSha256=digest(value['active']),
                **{key:value[key] for key in ['admissionRequestedMonotonicNs','exclusiveClaimObservedMonotonicNs','controlClosedMonotonicNs']})
            check(int(interval['admissionRequestedMonotonicNs']) <= int(interval['exclusiveClaimObservedMonotonicNs'])
                  <= int(interval['controlClosedMonotonicNs']), 'CANDIDATE_PRIVATE_OWNERSHIP_INTERVAL_INVALID')
            closure['ownershipInterval'] = interval
        if not observation_only:
            check(no_oom(value['before'], after), 'CANDIDATE_ACTOR_OOM_DELTA')
            check(actor.returncode == expected_status and native['nativeStatus'] == expected_native
                  and bool(native['stoppedBySignal']) == inquiry
                  and not value['deadlineExceeded'] and not value.get('pumpFailures'), 'CANDIDATE_ORIGINAL_ACTOR_FAILED')
        return closure

    def event(self, value, name, maximum=2 * MIB):
        raw = private_read(value['output'], maximum)
        matches = []
        for line in raw.splitlines():
            if value['kind'] in {'private-jobs','private-http2'}:
                if not line.startswith(b'SABALAN_PRIVATE_QUALIFICATION '): continue
                line = line[len(b'SABALAN_PRIVATE_QUALIFICATION '):]
            try: parsed = json.loads(line)
            except (ValueError, UnicodeError): continue
            if isinstance(parsed, dict) and parsed.get('event') == name: matches.append(parsed)
        check(len(matches) == 1, 'CANDIDATE_ACTOR_EVENT_UNPROVEN_' + name)
        return matches[0]

    def wait_event(self, value, name, seconds=60):
        end = time.monotonic() + seconds
        while True:
            check(not value.get('pumpFailures'), 'CANDIDATE_ORIGINAL_LOG_FAILED_OR_EXCEEDED')
            try: return self.event(value, name)
            except (FileNotFoundError, RuntimeError):
                check(value['actor'].poll() is None and time.monotonic() < end, 'CANDIDATE_ACTOR_READY_UNPROVEN_' + name)
                time.sleep(0.02)

    def qualification_root(self):
        value = self.index.get('privateQualification')
        if value is None: return self.root / 'restored-app'
        check(re.fullmatch(r'[a-f0-9]{64}', value['qualificationId']), 'CANDIDATE_QUALIFICATION_ID_INVALID')
        root = Path(value['qualificationRoot']); grant = value['jobsGrant']
        expected = Path(grant['scope']['coordinationDirectory']) / 'private-qualifications' / value['qualificationId'] / 'restored-app'
        check(root == expected and str(root).startswith(str(self.root) + '/'), 'CANDIDATE_QUALIFICATION_ROOT_UNPROVEN')
        check(root.resolve(strict=True) == root, 'CANDIDATE_QUALIFICATION_ROOT_ALIAS')
        return root

    def private_runtime(self, body, kind):
        check(kind in {'private-jobs','private-http2'}, 'CANDIDATE_PRIVATE_KIND_INVALID')
        check(set(body.get('input', {})) == set(), 'CANDIDATE_PRIVATE_START_INPUT_INVALID')
        check(self.completed >= {'migration','restored-baseline','restored-inquiry','restored-http','chrome'}, 'CANDIDATE_PRIVATE_PAIR_ORDER_INVALID')
        check(all(value.get('closed') for value in self.helpers.values()), 'CANDIDATE_PRIVATE_PRIOR_ORIGINAL_OWNER_ACTIVE')
        for name,value in self.actors.items():
            if value.get('closed'): continue
            check({name,kind} == {'private-http2','private-jobs'} and not value.get('privatePrepared')
                  and value['actor'].poll() is None and birth(value['actor'].pid) == value['birth'], 'CANDIDATE_PRIVATE_PRIOR_ORIGINAL_OWNER_ACTIVE')
        config = self.index['privateQualification']; grant = self.grant(kind); app = self.qualification_root()
        configuration = json.loads(private_read(self.artifact('config.json'),8*MIB))
        material = configuration['privateQualificationRuntimes']['candidate']
        check(material['entryPath'] == '/app/dist/onlinePrivateQualification.js'
              and material['distTreeSha256'] == config['runtimeBundles']['candidate'], 'CANDIDATE_PRIVATE_RUNTIME_MATERIAL_CHANGED')
        purpose = 'jobs' if kind == 'private-jobs' else 'http'
        check(grant['scope']['purpose'] == purpose and grant['scope']['role'] == ('control' if purpose == 'jobs' else 'serving')
              and grant['scope']['database']['name'] == self.index['restoredDatabase']
              and grant['scope']['manifestSha256'] == material['distTreeSha256']
              and grant['scope']['sourceCommit'] == configuration['privateQualificationSourceCommits']['candidate'], 'CANDIDATE_PRIVATE_RUNTIME_SCOPE_UNPROVEN')
        env = self.environment(grant, self.index['restoredDatabase'])
        env['RECOVERY_STORAGE_DIR'] = str(app / 'storage/recovery')
        # Explicit empty values prevent dotenv from reloading real provider credentials.
        # Canonical failures remain failures; sandbox/memory fake-success is forbidden.
        env.update({'NODE_ENV':'test','SMS_IR_API_KEY':'','SMS_IR_ENVIRONMENT':'production',
            'SMS_IR_API_URL':'http://127.0.0.1:1','WEB_PUSH_VAPID_PUBLIC_KEY':'',
            'WEB_PUSH_VAPID_PRIVATE_KEY':'','WEB_PUSH_VAPID_SUBJECT':'',
            'TAXPAYER_DELIVERY_BROKER_ENDPOINT':'','HR_HIRING_E2E':'false','HR_HIRING_SMS_ADAPTER':'disabled',
            'HTTP_PROXY':'','HTTPS_PROXY':'','ALL_PROXY':'','http_proxy':'','https_proxy':'','all_proxy':'',
            'NO_PROXY':'127.0.0.1,localhost','no_proxy':'127.0.0.1,localhost'})
        actor_id = secrets.token_hex(32)
        value = self.new_process(kind, ['/usr/bin/python3','-I','-B',str(self.artifact('online-runtime-owner.py')),
            '/usr/local/bin/node',str(self.artifact('online-private-qualification-worker.cjs')),
            self.channel.public_key,self.channel.session,actor_id], env, self.request_id(body), grant,
            cwd=str(app), stdin=True, actor_id=actor_id)
        result = self.wait_event(value,'READY',120); identity = result['identity']
        check(result['format'] == 'sabalan-private-qualification-worker/v1' and result['actorId'] == value['id'] and result['session'] == self.channel.session
              and result['scopeSha256'] == grant['sha256'] and identity['scopeSha256'] == grant['sha256']
              and identity['runtimeId'] == grant['scope']['runtimeId'] and identity['purpose'] == purpose
              and identity['qualificationId'] == config['qualificationId']
              and identity['httpIngress'] == (None if purpose == 'jobs' else dict(bindHost=self.topology['candidate']['host'],port=5000))
              and identity['database'] == dict(name=self.index['restoredDatabase'],oid=str(self.index['restoredOid']),systemIdentifier=grant['scope']['database']['systemIdentifier'])
              and identity['image'] == self.topology['candidate']['image']
              and identity['runtimeBundleSha256'] == material['distTreeSha256']
              and result['installedEntry'] == '/app/dist/onlinePrivateQualification.js'
              and result['installedEntrySha256'] == material['entrySha256'], 'CANDIDATE_PRIVATE_READY_IDENTITY_CHANGED')
        check(value['actor'].poll() is None and birth(value['actor'].pid) == value['birth'], 'CANDIDATE_PRIVATE_ORIGINAL_NOT_ACTIVE')
        ready_native = json.loads(private_read(self.native_paths(grant)[0]))
        check(ready_native['phase'] == 'ACTIVE' and ready_native['guardian'] == value['birth']
              and ready_native['onlineScope']['sha256'] == grant['sha256'], 'CANDIDATE_PRIVATE_NATIVE_NOT_ACTIVE')
        value['privatePrepared'] = False
        self.channel.emit('PRIVATE_JOBS_READY' if purpose == 'jobs' else 'PRIVATE_HTTP2_READY',dict(requestId=self.request_id(body),actorId=value['id'],result=result))

    def private_domain(self, body):
        check(body.get('input') == {}, 'CANDIDATE_PRIVATE_DOMAIN_INPUT_INVALID')
        for kind in ['private-http2','private-jobs']:
            actor=self.actors[kind]
            check(not actor.get('closed') and not actor.get('privatePrepared') and actor['actor'].poll() is None
                  and birth(actor['actor'].pid) == actor['birth'], 'CANDIDATE_PRIVATE_DOMAIN_RUNTIME_NOT_ACTIVE')
        grant=self.grant('private-http2');app=self.qualification_root()
        material=json.loads(private_read(Path(grant['scope']['nativeDirectory'])/'private-qualification/artifacts.json'))
        roots={row['live']:row for row in material['roots']}
        def root(name,prefix='storage'):
            live=str(app/prefix/name);row=roots[live]
            check(Path(row['live']).resolve(strict=True) == Path(live) and Path(row['store']).resolve(strict=True) == Path(row['store']), 'CANDIDATE_PRIVATE_DOMAIN_ROOT_ALIAS')
            return dict(liveRoot=live,store=row['store'])
        namespace='sabalan-rt-'+digest(('private-domain-'+self.request_id(body)).encode())[:48]
        env=self.environment(grant,self.index['restoredDatabase'])
        env={key:value for key,value in env.items() if not key.startswith('BACKEND_')}
        env.update(BACKEND_RUNTIME_ROLE='standalone',DATABASE_URL=urlunsplit(self.source._replace(path='/'+self.index['restoredDatabase'],query='connection_limit=2&pool_timeout=10&application_name='+namespace)))
        input=dict(format='sabalan-installed-domain-input/v1',qualificationRoot=str(app),
            seedSha256=digest(private_read(app/'acceptance-seed.json')),origin='http://'+self.topology['candidate']['host']+':5000/',
            scope=dict(runtimeId=grant['scope']['runtimeId'],image=grant['scope']['image'],
                database=dict(name=self.index['restoredDatabase'],oid=str(self.index['restoredOid']),systemIdentifier=grant['scope']['database']['systemIdentifier']),
                httpIngress=dict(bindHost=self.topology['candidate']['host'],port=5000),hiring=root('hr-hiring'),accounting=root('accounting-contracts'),security=root('security-shift-log','uploads'),uploads=root('images','uploads')))
        value=self.new_process('private-domain',['/usr/local/bin/node',str(self.artifact('installed-domain-writers.cjs'))],env,self.request_id(body),cwd=str(app),stdin=True)
        value['observerNamespace']=namespace
        value['actor'].stdin.write(encoded(input));value['actor'].stdin.close()
        self.wait_original(value,600)
        result,closure=self.private_domain_closed(value)
        check(value['actor'].returncode == 0 and not value['deadlineExceeded'] and no_oom(value['before'],resource()), 'CANDIDATE_PRIVATE_DOMAIN_FAILED')
        check(isinstance(result,dict) and result['format'] == 'sabalan-installed-domain-original-result/v1' and result['observerDisconnected'] is True
              and result['durableStateReadback'] is True and result['independentRestoreVerified'] is False
              and result['qualification']['runtimeId'] == grant['scope']['runtimeId']
              and result['qualification']['image'] == grant['scope']['image'], 'CANDIDATE_PRIVATE_DOMAIN_RESULT_CHANGED')
        self.completed.add('private-domain')
        self.channel.emit('PRIVATE_DOMAIN_DONE',dict(requestId=self.request_id(body),actorId=value['id'],result=result,closure=closure))

    def private_domain_closed(self,value):
        check(value['actor'].returncode is not None and value['actor'].returncode >= 0
              and all(not thread.is_alive() for thread in value.get('pumps',[])), 'CANDIDATE_PRIVATE_DOMAIN_NOT_CLOSED')
        closure=self.sql_closure(value.get('observerGrant') or self.grant('private-http2'),value['observerNamespace'])
        value['closed']=True
        raw=value['output'].read_bytes();check(len(raw)<=2*MIB,'CANDIDATE_PRIVATE_DOMAIN_OUTPUT_BOUND')
        try:result=json.loads(raw) if value['actor'].returncode == 0 else None
        except (ValueError,UnicodeError):result=None
        return result,dict(originalPopenPid=value['actor'].pid,originalReturncode=value['actor'].returncode,birth=value['birth'],
            scopeSha256=None,nativeRawBase64=None,workRawBase64=None,namespace=value['observerNamespace'],sql=closure,
            outputRawBase64=base64.b64encode(raw).decode(),resourcesBefore=value['before'],resourcesAfter=resource())

    def start_online_point_inquiry(self,body):
        check(body['input']=={} and self.completed >= {'private-jobs','legacy-private-chrome','legacy-private-browser-verify'},'CANDIDATE_POINT_INQUIRY_ORDER_INVALID')
        http=self.actors.get('private-http2');check(http and not http['closed'] and not http.get('privatePrepared')
            and http['actor'].poll() is None and birth(http['actor'].pid)==http['birth'],'CANDIDATE_POINT_HTTP_NOT_LIVE')
        check('online-point-inquiry' not in self.actors,'CANDIDATE_POINT_INQUIRY_ALREADY_STARTED')
        spec=importlib.util.spec_from_file_location('original_candidate_point_inquiry',self.artifact('application-native-inquiry.fixture.py'))
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        helper=module.InquiryActors(self.root,self.index,os.environ,write,check);self.online_point_inquiry_helper=helper
        grant=self.grant('online-point-inquiry');holder=[]
        def spawn_native(argv,env,cwd):
            value=self.new_process('online-point-inquiry',argv,env,self.request_id(body),grant,cwd=cwd)
            holder.append(value);return value['actor']
        result=helper.start_online_point(grant,spawn_native)
        check(len(holder)==1 and result['originalGuardian']==holder[0]['birth']
            and result['nativeActiveRawBase64']==base64.b64encode(holder[0]['active']).decode()
            and result['scopeSha256']==grant['sha256'],'CANDIDATE_POINT_INQUIRY_READY_CHANGED')
        self.channel.emit('ONLINE_POINT_INQUIRY_READY',dict(requestId=self.request_id(body),actorId=holder[0]['id'],result=result))

    def finish_online_point_inquiry(self,body):
        value=self.actors.get('online-point-inquiry');check(value and not value['closed'] and body['input']==dict(actorId=value['id']),
            'CANDIDATE_POINT_INQUIRY_STOP_OWNER_CHANGED')
        check(value['actor'].poll() is None and birth(value['actor'].pid)==value['birth'],'CANDIDATE_POINT_INQUIRY_ORIGINAL_NOT_LIVE')
        result=self.online_point_inquiry_helper.stop_online_point();self.wait_original(value,60)
        closure=self.close_native(value,128)
        check(result['nativeRawBase64']==closure['nativeRawBase64'] and result['workRawBase64']==closure['workRawBase64'],
            'CANDIDATE_POINT_INQUIRY_STOP_BYTES_CHANGED')
        self.completed.add('online-point-inquiry')
        self.channel.emit('ONLINE_POINT_INQUIRY_DONE',dict(requestId=self.request_id(body),actorId=value['id'],result=result,closure=closure))

    def pristine_performance(self,body):
        check(not self.completed and not self.actors,'CANDIDATE_PRISTINE_MUST_PRECEDE_MIGRATION')
        input=body['input'];check(set(input)=={'seedSha256'},'CANDIDATE_PRISTINE_INPUT_INVALID')
        app=self.root/'app';seed=private_read(app/'acceptance-seed.json',65536)
        check(digest(seed)==input['seedSha256'],'CANDIDATE_PRISTINE_SEED_CHANGED')
        grant=self.grant('pristine-performance');configuration=json.loads(private_read(self.root/'config.json'))
        material=configuration['privateQualificationRuntimes']['candidate']
        check(grant['scope']['image']==configuration['roleTopology']['candidate']['image']
            and grant['scope']['manifestSha256']==material['distTreeSha256']
            and grant['scope']['database']['name']==self.index['database'],'CANDIDATE_PRISTINE_SCOPE_CHANGED')
        env=self.environment(grant,self.index['database']);env.update(BACKEND_RUNTIME_ROLE='serving')
        data=dict(format='sabalan-installed-pristine-performance-input/v1',root=str(app),seedSha256=input['seedSha256'],
            scopeSha256=grant['sha256'],runtimeBundleSha256=material['distTreeSha256'],bindHost=configuration['roleTopology']['candidate']['host'],
            database=dict(name=self.index['database'],oid=str(self.index['oid']),systemIdentifier=grant['scope']['database']['systemIdentifier']))
        value=self.new_process('pristine-performance',['/usr/bin/python3','-I','-B',str(self.artifact('online-runtime-owner.py')),
            '/usr/local/bin/node',str(self.artifact('installed-pristine-performance.cjs'))],env,self.request_id(body),grant,cwd=str(app),stdin=True)
        value['actor'].stdin.write(encoded(data));value['actor'].stdin.close();self.wait_original(value,120)
        closure=self.close_native(value);lines=private_read(value['output'],2*MIB).splitlines()
        records=[json.loads(line[len(b'SABALAN_INSTALLED_PRISTINE '):]) for line in lines if line.startswith(b'SABALAN_INSTALLED_PRISTINE ')]
        check(len(records)==1 and records[0]['format']=='sabalan-installed-pristine-performance-result/v1'
            and records[0]['scopeSha256']==grant['sha256'] and records[0]['database']==data['database']
            and records[0]['runtimeBundleSha256']==material['distTreeSha256']
            and records[0]['observerDisconnected'] is True,'CANDIDATE_PRISTINE_RESULT_UNPROVEN')
        check(self.actors.get('pristine-performance') is value and value['closed'] is True
              and value['actor'].returncode == 0 and all(not pump.is_alive() for pump in value['pumps'])
              and closure['originalPopenPid'] == value['actor'].pid and closure['originalReturncode'] == 0
              and closure['scopeSha256'] == grant['sha256'] and not value.get('pumpFailures'),
              'CANDIDATE_PRISTINE_CACHE_ORIGINAL_CLOSURE_UNPROVEN')
        spec = importlib.util.spec_from_file_location('candidate_closed_pristine_cache', self.artifact('application-native-prisma.fixture.py'))
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        cache_hint = module.hint_prepared_declarations(self.root, check, material['distTreeSha256'])
        check(cache_hint['cacheCreditUsed'] is False, 'CANDIDATE_PRISTINE_CACHE_CREDIT_REFUSED')
        self.completed.add('pristine-performance')
        self.channel.emit('PRISTINE_PERFORMANCE_DONE',dict(requestId=self.request_id(body),actorId=value['id'],result=records[0],closure=closure,cacheHint=cache_hint))

    def private_domain_baseline(self,body):
        check(self.completed >= {'private-domain','private-http2','private-jobs'},'CANDIDATE_DOMAIN_RESTORE_ORDER_INVALID')
        definition=self.index['privateQualification']['domainRestore'];app=Path(definition['root'])
        input=body['input'];manifest=self.root/'installed-domain-coherent-component/baseline.json'
        check(set(input)=={'manifestPath','manifestSha256'} and input['manifestPath']==str(manifest)
            and digest(private_read(manifest,8*MIB))==input['manifestSha256'],'CANDIDATE_DOMAIN_BASELINE_INPUT_CHANGED')
        grant=self.grant('private-domain-baseline');env=self.environment(grant,definition['database'])
        env.update(APPLICATION_NATIVE_CWD=str(app),APPLICATION_ACCEPTANCE_VERSION_ROOT=str(app/'.versioned-files'),
            APPLICATION_RESTORED_BASELINE_MANIFEST=str(manifest),APPLICATION_RESTORED_BASELINE_SHA256=input['manifestSha256'])
        bootstrap="process.umask(0o077);process.chdir(process.env.APPLICATION_NATIVE_CWD);require(process.argv[1]);"
        value=self.new_process('private-domain-baseline',['/usr/bin/python3','-I','-B',str(self.artifact('online-runtime-owner.py')),
            '/usr/local/bin/node','-e',bootstrap,str(self.artifact('application-restored-baseline.cjs')),'restore-file-baseline'],env,self.request_id(body),grant,cwd=str(app))
        self.wait_original(value,120);closure=self.close_native(value)
        result=json.loads(private_read(str(manifest)+'.completed.json',8*MIB))
        check(result['manifestSha256']==input['manifestSha256'],'CANDIDATE_DOMAIN_BASELINE_RESULT_CHANGED')
        self.completed.add('private-domain-baseline')
        self.channel.emit('PRIVATE_DOMAIN_BASELINE_DONE',dict(requestId=self.request_id(body),actorId=value['id'],result=result,closure=closure))

    def private_domain_verify(self,body):
        check('private-domain-baseline' in self.completed,'CANDIDATE_DOMAIN_VERIFY_ORDER_INVALID')
        definition=self.index['privateQualification']['domainRestore'];app=Path(definition['root']);grant=self.grant('private-domain-baseline')
        input=body['input'];expected=self.root/'installed-domain-coherent-component/domain-expectations.json'
        check(set(input)=={'expectationsPath','expectationsSha256'} and input['expectationsPath']==str(expected)
            and digest(private_read(expected,8*MIB))==input['expectationsSha256'],'CANDIDATE_DOMAIN_VERIFY_INPUT_CHANGED')
        baseline=json.loads(private_read(self.root/'installed-domain-coherent-component/baseline.json',8*MIB))
        def root(name,prefix='storage'):
            live=str(app/prefix/name);rows=[row for row in baseline['sources'] if row['liveRoot']==live]
            check(len(rows)==1,'CANDIDATE_DOMAIN_VERIFY_ROOT_UNPROVEN');return dict(liveRoot=live,store=rows[0]['storeRoot'])
        namespace='sabalan-rt-'+digest(('domain-verify-'+self.request_id(body)).encode())[:48]
        env=self.environment(grant,definition['database']);env={key:value for key,value in env.items() if not key.startswith('BACKEND_')}
        env.update(BACKEND_RUNTIME_ROLE='standalone',DATABASE_URL=urlunsplit(self.source._replace(path='/'+definition['database'],query='connection_limit=2&pool_timeout=10&application_name='+namespace)))
        data=dict(format='sabalan-installed-domain-input/v1',mode='restore-verify',qualificationRoot=str(app),seedSha256=digest(private_read(app/'acceptance-seed.json')),
            expectationsPath=str(expected),expectationsSha256=input['expectationsSha256'],scope=dict(database=dict(name=definition['database'],oid=str(definition['databaseOid']),systemIdentifier=grant['scope']['database']['systemIdentifier']),hiring=root('hr-hiring'),accounting=root('accounting-contracts'),security=root('security-shift-log','uploads'),uploads=root('images','uploads')))
        value=self.new_process('private-domain-verify',['/usr/local/bin/node',str(self.artifact('installed-domain-writers.cjs'))],env,self.request_id(body),cwd=str(app),stdin=True)
        value.update(observerNamespace=namespace,observerGrant=grant)
        value['actor'].stdin.write(encoded(data));value['actor'].stdin.close();self.wait_original(value,120)
        result,closure=self.private_domain_closed(value)
        check(value['actor'].returncode==0 and not value['deadlineExceeded'] and no_oom(value['before'],resource())
            and isinstance(result,dict) and result['format']=='sabalan-installed-domain-original-result/v1' and result['observerDisconnected'] is True
            and result['independentRestoreVerified'] is True,'CANDIDATE_DOMAIN_RESTORED_VERIFICATION_FAILED')
        self.completed.add('private-domain-verify')
        self.channel.emit('PRIVATE_DOMAIN_RESTORE_VERIFIED',dict(requestId=self.request_id(body),actorId=value['id'],result=result,closure=closure))

    def private_browser_verify(self,body,legacy=False):
        required = {'private-jobs','private-chrome'}
        if legacy: required.update({'private-http2','private-browser-verify','legacy-private-chrome'})
        else:
            http=self.actors.get('private-http2')
            check(http and not http.get('closed') and http['actor'].poll() is None and http.get('privatePrepared') is False
                  and birth(http['actor'].pid)==http['birth'],'CANDIDATE_BROWSER_ORIGINAL_HTTP_NOT_READY')
        check(self.completed >= required,'CANDIDATE_BROWSER_TICKETS_ORDER_INVALID')
        app=self.qualification_root();grant=self.grant('private-http2');input=body['input'];expected=self.root/('installed-legacy-paired-browser.stdout' if legacy else 'installed-paired-browser.stdout')
        checksum = input.get('proofSha256') if legacy else input.get('expectationsSha256')
        check((set(input)=={'proofPath','proofSha256'} and input['proofPath']==str(expected) if legacy else set(input)=={'expectationsSha256'})
            and digest(private_read(expected,2*MIB))==checksum,'CANDIDATE_BROWSER_TICKETS_INPUT_CHANGED')
        if legacy:
            proof=json.loads(private_read(expected,2*MIB))
            check(proof.get('format')=='sabalan-installed-legacy-paired-browser/v1' and proof.get('actualProductionLegacy55Qualified') is True
                and proof.get('actualInstalledNewApi') is True and proof.get('legacyBackendStarted') is False
                and proof.get('journalsDrained') is True,'CANDIDATE_LEGACY_BROWSER_PROOF_INVALID')
        kind = 'legacy-private-browser-verify' if legacy else 'private-browser-verify'
        namespace='sabalan-rt-'+digest((kind+'-'+self.request_id(body)).encode())[:48]
        env=self.environment(grant,self.index['restoredDatabase']);env={key:value for key,value in env.items() if not key.startswith('BACKEND_')}
        env.update(BACKEND_RUNTIME_ROLE='standalone',DATABASE_URL=urlunsplit(self.source._replace(path='/'+self.index['restoredDatabase'],query='connection_limit=2&pool_timeout=10&application_name='+namespace)))
        data=dict(format='sabalan-installed-domain-input/v1',mode='legacy-browser-verify' if legacy else 'browser-verify',qualificationRoot=str(app),seedSha256=digest(private_read(app/'acceptance-seed.json')),
            expectationsPath=str(expected),expectationsSha256=checksum,scope=dict(database=dict(name=self.index['restoredDatabase'],oid=str(self.index['restoredOid']),systemIdentifier=grant['scope']['database']['systemIdentifier'])))
        value=self.new_process(kind,['/usr/local/bin/node',str(self.artifact('installed-domain-writers.cjs'))],env,self.request_id(body),cwd=str(app),stdin=True)
        value.update(observerNamespace=namespace,observerGrant=grant)
        value['actor'].stdin.write(encoded(data));value['actor'].stdin.close();self.wait_original(value,120)
        result,closure=self.private_domain_closed(value)
        check(value['actor'].returncode==0 and not value['deadlineExceeded'] and no_oom(value['before'],resource())
            and isinstance(result,dict) and result['format']=='sabalan-installed-domain-original-result/v1' and result['observerDisconnected'] is True
            and isinstance(result['browserReceipts'],list) and len(result['browserReceipts'])==2,'CANDIDATE_BROWSER_TICKETS_VERIFICATION_FAILED')
        self.completed.add(kind)
        self.channel.emit('PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED' if legacy else 'PRIVATE_BROWSER_TICKETS_VERIFIED',dict(requestId=self.request_id(body),actorId=value['id'],result=result,closure=closure))

    def private_wire(self, body, preparing, kind='private-jobs'):
        check(kind in {'private-jobs','private-http2'}, 'CANDIDATE_PRIVATE_KIND_INVALID')
        input = body.get('input'); value = self.actors[kind]
        check(isinstance(input,dict) and set(input) == {'actorId','wire'} and input['actorId'] == value['id']
              and isinstance(input['wire'],str) and 0 < len(input['wire'].encode('utf8')) <= 2048
              and '\n' not in input['wire'] and '\r' not in input['wire'], 'CANDIDATE_PRIVATE_CONTROL_INPUT_INVALID')
        check(not value['closed'] and value['actor'].poll() is None and birth(value['actor'].pid) == value['birth'], 'CANDIDATE_PRIVATE_ORIGINAL_NOT_ACTIVE')
        check(bool(value.get('privatePrepared')) is (not preparing), 'CANDIDATE_PRIVATE_CONTROL_ORDER_INVALID')
        value['actor'].stdin.write(input['wire'].encode('utf8') + b'\n'); value['actor'].stdin.flush()
        if preparing:
            result = self.wait_event(value,'PREPARED',240)
            check(result['format'] == 'sabalan-private-qualification-worker/v1' and result['session'] == self.channel.session
                  and result['actorId'] == value['id'] and result['scopeSha256'] == value['grant']['sha256'] and result['sequence'] == 1, 'CANDIDATE_PRIVATE_PREPARE_UNPROVEN')
            value['privatePrepared'] = True
            self.channel.emit('PRIVATE_JOBS_PREPARED' if kind == 'private-jobs' else 'PRIVATE_HTTP2_PREPARED',dict(requestId=self.request_id(body),actorId=value['id'],result=result))
        else:
            result = self.wait_event(value,'CLOSED',240)
            check(result['format'] == 'sabalan-private-qualification-worker/v1' and result['session'] == self.channel.session
                  and result['actorId'] == value['id'] and result['scopeSha256'] == value['grant']['sha256'] and result['sequence'] == 2, 'CANDIDATE_PRIVATE_CLOSE_UNPROVEN')
            self.wait_original(value,240); closure = self.close_native(value)
            self.completed.add(kind)
            self.channel.emit('PRIVATE_JOBS_DONE' if kind == 'private-jobs' else 'PRIVATE_HTTP2_DONE',dict(requestId=self.request_id(body),actorId=value['id'],result=result,closure=closure))

    def catalog_sources(self):
        config = self.index['catalog']; raw = private_read(self.artifact('full-catalog-source-manifest.json'),8*MIB)
        check(digest(raw) == config['sourceManifestSha256'], 'CANDIDATE_CATALOG_MANIFEST_CHANGED')
        manifest = json.loads(raw); app = self.root / 'full-catalog'
        check(manifest['format'] == 'sabalan-full-catalog-source/v1' and manifest['operation'] == config['operation']
              and re.fullmatch(r'[a-f0-9]{32}',config['operation']) and isinstance(manifest['files'],dict)
              and 1 <= len(manifest['files']) <= 50000 and app.resolve(strict=True) == app, 'CANDIDATE_CATALOG_SOURCE_UNPROVEN')
        check(private_read(app / 'source-manifest.json',8*MIB) == raw, 'CANDIDATE_CATALOG_MANIFEST_ALIAS_CHANGED')
        total = 0
        for name,expected in manifest['files'].items():
            check(isinstance(name,str) and name and not name.startswith('/') and '\\' not in name
                  and all(part not in ['', '.', '..'] for part in name.split('/')) and re.fullmatch(r'[a-f0-9]{64}',expected['sha256'])
                  and type(expected['bytes']) is int and expected['bytes'] >= 0, 'CANDIDATE_CATALOG_SOURCE_MEMBER_INVALID')
            file = app / name; before = os.lstat(file)
            check(file.resolve(strict=True) == file and file.is_file() and before.st_nlink == 1 and before.st_size == expected['bytes'], 'CANDIDATE_CATALOG_SOURCE_IDENTITY_CHANGED')
            total += before.st_size; check(total <= 1024*MIB, 'CANDIDATE_CATALOG_SOURCE_BYTE_BOUND')
            hashed = hashlib.sha256()
            with file.open('rb') as stream:
                while chunk := stream.read(262144): hashed.update(chunk)
            after = os.lstat(file)
            check(hashed.hexdigest() == expected['sha256'] and all(getattr(before,key) == getattr(after,key)
                  for key in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_uid','st_mode','st_nlink']), 'CANDIDATE_CATALOG_SOURCE_BYTES_CHANGED')
        check('run-full-catalog-controller.py' in manifest['files'], 'CANDIDATE_CATALOG_CONTROLLER_NOT_PINNED')
        return app

    def full_catalog(self, body):
        check('migration' in self.completed and 'full-catalog' not in self.actors, 'CANDIDATE_CATALOG_ORDER_INVALID')
        ingress = self.helpers.get('browser-ingress'); chrome = self.actors.get('chrome')
        check(ingress and chrome and not ingress['closed'] and not chrome['closed']
              and ingress['actor'].poll() is None and chrome['actor'].poll() is None
              and birth(ingress['actor'].pid) == ingress['birth'] and birth(chrome['actor'].pid) == chrome['birth'], 'CANDIDATE_CATALOG_ORIGINAL_INGRESS_NOT_ACTIVE')
        input = body.get('input'); fields = {'format','mainHost','operation','databaseUrl','databaseName','databaseOid','systemIdentifier','adminUsername','adminPassword'}
        check(isinstance(input,dict) and set(input) == fields and input['format'] == 'sabalan-native-full-catalog-controller/v1'
              and input['mainHost'] == self.topology['main']['host'] and input['operation'] == self.index['catalog']['operation']
              and input['databaseName'] == self.index['database'] and isinstance(input['databaseOid'],str)
              and re.fullmatch(r'[1-9][0-9]*',input['databaseOid']) and input['databaseOid'] == str(self.index['oid'])
              and isinstance(input['systemIdentifier'],str) and re.fullmatch(r'[1-9][0-9]*',input['systemIdentifier'])
              and isinstance(input['adminUsername'],str) and re.fullmatch(r'native-app-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',input['adminUsername'])
              and isinstance(input['adminPassword'],str) and 1 <= len(input['adminPassword']) <= 256, 'CANDIDATE_CATALOG_INPUT_UNPROVEN')
        target = urlsplit(input['databaseUrl'])
        query = parse_qsl(target.query,keep_blank_values=True)
        check(target.scheme in ['postgresql','postgres'] and not target.fragment
              and all(key in ['connection_limit','pool_timeout','application_name','schema'] and (key != 'schema' or value == 'public') for key,value in query)
              and target.hostname == self.source.hostname and target.port == self.source.port and target.username == self.source.username
              and target.password == self.source.password and target.path == '/' + self.index['database'], 'CANDIDATE_CATALOG_DATABASE_TARGET_CHANGED')
        self.capacity('full-catalog')  # Refuse before SQL observers or diagnostic input creation; new_process rechecks.
        check(self.sql('SELECT system_identifier FROM pg_control_system()') == input['systemIdentifier']
              and self.sql("SELECT oid FROM pg_database WHERE datname='" + input['databaseName'] + "'") == str(self.index['oid']), 'CANDIDATE_CATALOG_DATABASE_IDENTITY_CHANGED')
        app = self.catalog_sources()
        check(not (app / 'controller-result.json').exists() and not (app / 'full-catalog-input.json').exists(), 'CANDIDATE_CATALOG_MUTABLE_OUTPUT_ALREADY_EXISTS')
        self.catalog_input = input
        write(app / 'full-catalog-input.json',encoded(input),0o600)
        env = dict(os.environ); env.pop('NODE_OPTIONS',None)
        value = self.new_process('full-catalog',['/usr/bin/python3','-I','-B',str(app / 'run-full-catalog-controller.py')],env,self.request_id(body),cwd=str(app))
        self.wait_original(value,7320); after = resource()
        check(value['actor'].returncode == 0 and not value['deadlineExceeded'] and no_oom(value['before'],after), 'CANDIDATE_CATALOG_ORIGINAL_FAILED')
        result,closure = self.catalog_closed(value,True)
        self.completed.add('full-catalog')
        self.channel.emit('FULL_CATALOG_DONE',dict(requestId=self.request_id(body),actorId=value['id'],result=result,closure=closure))

    def catalog_closed(self,value,require_success):
        check(value['actor'].returncode in [0,1] and all(not thread.is_alive() for thread in value.get('pumps',[])), 'CANDIDATE_CATALOG_ORIGINAL_NOT_CLOSED')
        input=self.catalog_input;app=self.root / 'full-catalog'
        result = json.loads(private_read(app / 'controller-result.json',8*MIB)); cli=result.get('cliOriginal')
        check(isinstance(cli,dict) and set(cli) == {'pid','state','parentPid','startTicks'}
              and type(cli['pid']) is int and cli['pid'] > 0 and cli['parentPid'] == value['actor'].pid
              and isinstance(cli['startTicks'],str) and re.fullmatch(r'[1-9][0-9]*',cli['startTicks'])
              and cli['state'] in ['R','S','D','I'] and type(result.get('cliCode')) is int,
              'CANDIDATE_CATALOG_ORIGINAL_CLI_IDENTITY_UNPROVEN')
        check(result['format'] == 'sabalan-native-full-catalog-original-controller/v1' and result['operation'] == input['operation']
              and result['allObservedOriginalBrowsersClosed'] is True and result['sourceFilesUnchanged'] is True
              and result['borrowsOriginalNativeIngress'] is True and result['databaseQuietVerifiedByChild'] is False
              and result['nativeDatabase'] == {name:input[name] for name in ['databaseName','databaseOid','systemIdentifier','adminUsername']}
              and result['catalogApplicationName'] == 'qa-catalog-' + input['operation'] and result['browserLaunches']
              and all(row.get('originalCliDescendant') and row.get('identity') and (row.get('originalPidfdExitObserved') or row.get('originalExitObserved'))
                  and isinstance(row.get('exitCode'),str) and isinstance(row.get('exitSignal'),str) for row in result['browserLaunches']), 'CANDIDATE_CATALOG_CHILD_CLOSURE_UNPROVEN')
        if require_success:
            expected = self.index['catalog']['caseInventory']
            check(result.get('executedCaseInventory') == expected and result.get('completedCaseCount') == len(expected)
                  and digest(json.dumps(expected,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()) == self.index['catalog']['caseInventorySha256'], 'CANDIDATE_CATALOG_CASE_INVENTORY_CHANGED')
        self.catalog_sources()
        namespace = result['catalogApplicationName']
        system = self.sql('SELECT system_identifier FROM pg_control_system()')
        oid = self.sql("SELECT oid FROM pg_database WHERE datname='" + input['databaseName'] + "'")
        visible = self.sql("SELECT (rolsuper OR pg_has_role(current_user,'pg_read_all_stats','MEMBER'))::text FROM pg_roles WHERE rolname=current_user") == 'true'
        check(visible and system == input['systemIdentifier'] and oid == str(self.index['oid']), 'CANDIDATE_CATALOG_SQL_IDENTITY_UNPROVEN')
        sessions = int(self.sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace + "'"))
        prepared = int(self.sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + input['databaseName'] + "'"))
        check(sessions == prepared == 0, 'CANDIDATE_CATALOG_ORIGINAL_SQL_NOT_CLOSED')
        after=resource();value['closed']=True
        closure = dict(originalPopenPid=value['actor'].pid,originalReturncode=value['actor'].returncode,birth=value['birth'],nativeRawBase64=None,workRawBase64=None,scopeSha256=None,
            namespace=namespace,sql=dict(system=system,oid=oid,visible=visible,sessions=sessions,prepared=prepared),resourcesBefore=value['before'],resourcesAfter=after)
        if require_success:
            check(result['passResult'] is True and value['actor'].returncode == result['cliCode'] == 0 and not value['deadlineExceeded']
                  and no_oom(value['before'],after) and all(row['exitCode'] == '0' and row['exitSignal'] == 'null' for row in result['browserLaunches']), 'CANDIDATE_CATALOG_QUALIFICATION_FAILED')
        return result,closure

    def run_migration(self, body):
        request_id, input = self.request_id(body), body['input']; check('migration' not in self.completed, 'CANDIDATE_MIGRATION_ALREADY_RUN')
        check(input['format'] == 'sabalan-native-migration-input/v1' and input['host'] == self.topology['main']['host']
              and input['originalHistory'] == self.index['history'], 'CANDIDATE_MIGRATION_INPUT_UNPROVEN')
        write(self.root / 'candidate-migration-input.json', encoded(input))
        grant = self.grant('migration'); env = self.environment(grant, self.index['database'])
        env.update(APPLICATION_NATIVE_CWD=str(self.root / 'app'), APPLICATION_MIGRATION_INPUT=str(self.root / 'candidate-migration-input.json'))
        bootstrap = "process.umask(0o077);process.chdir(process.env.APPLICATION_NATIVE_CWD);require(process.argv[1]);"
        value = self.new_process('migration', ['/usr/bin/python3', '-I', '-B', str(self.artifact('online-runtime-owner.py')), '/usr/local/bin/node', '-e', bootstrap,
            str(self.artifact('application-migration.cjs'))], env, request_id, grant)
        self.wait_original(value, 120); closure = self.close_native(value)
        result = self.event(value, 'migration-qualified'); check(result['originalHistory'] == self.index['history'] and result['runtimeId'] == grant['scope']['runtimeId'], 'CANDIDATE_MIGRATION_RESULT_CHANGED')
        self.completed.add('migration'); self.channel.emit('MIGRATION_DONE', dict(requestId=request_id, actorId=value['id'], result=result, closure=closure))

    def baseline(self, body):
        check('migration' in self.completed and 'restored-baseline' not in self.completed, 'CANDIDATE_BASELINE_ORDER_INVALID')
        request_id, input = self.request_id(body), body['input']; manifest = Path(input['manifestPath'])
        check(manifest == self.root / 'restored-file-baseline.json' and digest(private_read(manifest, 8 * MIB)) == input['manifestSha256'], 'CANDIDATE_RESTORE_BASELINE_INPUT_CHANGED')
        grant = self.grant('restored-baseline'); env = self.environment(grant, self.index['restoredDatabase'])
        env.update(APPLICATION_NATIVE_CWD=str(self.qualification_root()), APPLICATION_ACCEPTANCE_VERSION_ROOT=str(self.qualification_root() / '.versioned-files'),
                   APPLICATION_RESTORED_BASELINE_MANIFEST=str(manifest), APPLICATION_RESTORED_BASELINE_SHA256=input['manifestSha256'])
        bootstrap = "process.umask(0o077);process.chdir(process.env.APPLICATION_NATIVE_CWD);require(process.argv[1]);"
        value = self.new_process('restored-baseline', ['/usr/bin/python3', '-I', '-B', str(self.artifact('online-runtime-owner.py')), '/usr/local/bin/node', '-e', bootstrap,
            str(self.artifact('application-restored-baseline.cjs')), 'restore-file-baseline'], env, request_id, grant)
        self.wait_original(value, 120); closure = self.close_native(value)
        result = json.loads(private_read(str(manifest) + '.completed.json', 8 * MIB))
        check(result['manifestSha256'] == input['manifestSha256'], 'CANDIDATE_RESTORED_BASELINE_RESULT_CHANGED')
        self.completed.add('restored-baseline'); self.channel.emit('RESTORED_BASELINE_DONE', dict(requestId=request_id, actorId=value['id'], result=result, closure=closure))

    def restored_http(self, body):
        check('restored-baseline' in self.completed and 'restored-inquiry' in self.completed, 'CANDIDATE_RESTORED_HTTP_ORDER_INVALID')
        request_id, input = self.request_id(body), body['input']
        check(digest(private_read(self.qualification_root() / 'restore-expectations.json', 8 * MIB)) == input['expectationsSha256'], 'CANDIDATE_RESTORE_EXPECTATIONS_CHANGED')
        check(digest(private_read(self.qualification_root() / 'acceptance-seed.json')) == input['seedSha256'], 'CANDIDATE_RESTORED_SEED_CHANGED')
        grant = self.grant('restored-http'); env = self.environment(grant, self.index['restoredDatabase'])
        env.update(APPLICATION_NATIVE_CWD=str(self.qualification_root()), APPLICATION_ACCEPTANCE_PHASE='restored',
                   APPLICATION_ACCEPTANCE_VERSION_ROOT=str(self.qualification_root() / '.versioned-files'), APPLICATION_ACCEPTANCE_ORIGINAL_DATABASE=self.index['database'],
                   APPLICATION_ACCEPTANCE_ORIGINAL_CWD=str(self.root / 'app'), APPLICATION_ACCEPTANCE_SEED_SHA256=input['seedSha256'],
                   APPLICATION_NATIVE_BIND_HOST=self.topology['candidate']['host'])
        bootstrap = "process.umask(0o077);process.chdir(process.env.APPLICATION_NATIVE_CWD);require(process.argv[1]);"
        value = self.new_process('restored-http', ['/usr/bin/python3', '-I', '-B', str(self.artifact('online-runtime-owner.py')), '/usr/local/bin/node', '-e', bootstrap,
            str(self.artifact('application-worker.cjs')), 'application-http'], env, request_id, grant)
        result = self.wait_event(value, 'ready'); check(result['runtimeId'] == grant['scope']['runtimeId'] and result['host'] == self.topology['candidate']['host'], 'CANDIDATE_RESTORED_HTTP_READY_OWNER_CHANGED')
        ready_native = json.loads(private_read(self.native_paths(grant)[0]))
        check(value['actor'].poll() is None and birth(value['actor'].pid) == value['birth']
              and ready_native['phase'] == 'ACTIVE' and ready_native['guardian'] == value['birth']
              and ready_native['onlineScope']['sha256'] == grant['sha256'], 'CANDIDATE_RESTORED_HTTP_ORIGINAL_NOT_ACTIVE')
        self.channel.emit('RESTORED_HTTP_READY', dict(requestId=request_id, actorId=value['id'], result=result))

    def finish_http(self, body):
        value = self.actors['restored-http']; check(not value['closed'], 'CANDIDATE_RESTORED_HTTP_ALREADY_CLOSED')
        check(json.loads(private_read(self.native_paths(value['grant'])[1]))['phase'] == 'QUIESCENT', 'CANDIDATE_HTTP_WORK_NOT_QUIET')
        write(Path(value['grant']['scope']['coordinationDirectory']) / 'diagnostic-finish' / value['grant']['scope']['runtimeId'], b'done\n', 0o600)
        self.wait_original(value, 30); closure = self.close_native(value)
        self.completed.add('restored-http'); self.channel.emit('RESTORED_HTTP_DONE', dict(requestId=self.request_id(body), actorId=value['id'], result={'originalHttpClosed': True}, closure=closure))

    def launch_helper(self, name, script, config):
        check(name not in self.helpers, 'CANDIDATE_HELPER_ALREADY_STARTED')
        config_path = self.directory / (name + '-config.json'); write(config_path, encoded(config), 0o600)
        output_path, error_path = self.directory / (name + '.stdout'), self.directory / (name + '.stderr')
        actor = subprocess.Popen(['/usr/local/bin/node', str(self.artifact(script)), str(config_path)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 env={'NODE_ENV': 'test', 'PATH': '/usr/local/bin:/usr/bin:/bin'})
        value = dict(id=secrets.token_hex(32), kind=name, actor=actor, birth=None, output=output_path, errors=error_path,
                     configSha256=digest(encoded(config)), closed=False, deadlineExceeded=False)
        self.helpers[name] = value; self.log_pumps(value); value['birth'] = birth(actor.pid)
        return value, self.wait_event(value, 'ready', 30)

    def start_chrome(self, body, private=False, legacy=False):
        check(not (private and legacy), 'CANDIDATE_CHROME_KIND_AMBIGUOUS')
        kind="legacy-private-chrome" if legacy else ("private-chrome" if private else "chrome")
        prefix="legacy-private-" if legacy else ("private-" if private else "")
        if legacy:
            check(body.get('input')=={},'CANDIDATE_PRIVATE_BROWSER_INPUT_INVALID')
            check(self.completed >= {'private-chrome','private-browser-verify'} and not self.actors['private-http2'].get('privatePrepared'), 'CANDIDATE_PRIVATE_BROWSER_ORDER_INVALID')
        if private:
            check(body.get('input')=={},'CANDIDATE_PRIVATE_BROWSER_INPUT_INVALID')
            check(self.completed >= {"private-domain","private-jobs"} and not self.actors["private-http2"].get("privatePrepared"), "CANDIDATE_PRIVATE_BROWSER_ORDER_INVALID")
        check('migration' in self.completed and kind not in self.actors, 'CANDIDATE_CHROME_ORDER_INVALID')
        request_id = self.request_id(body); self.capacity(kind)
        self.artifact('native-private-network.fixture.mjs')
        ingress, ingress_ready = self.launch_helper(prefix+'browser-ingress', 'application-native-browser-ingress.fixture.mjs',
            dict(format='sabalan-native-browser-loopback-ingress/v1', mainHost=self.topology['main']['host']))
        check(ingress_ready['originalIngressPid'] == ingress['actor'].pid and ingress_ready['host'] == '127.0.0.1'
              and ingress_ready['port'] == 3199 and ingress_ready['targetHost'] == self.topology['main']['host']
              and ingress_ready['targetPort'] == 3199 and ingress_ready['browserOrigin'] == 'http://localhost:3199', 'CANDIDATE_BROWSER_INGRESS_CHANGED')
        chrome_root = self.directory / kind; chrome_root.mkdir(mode=0o700)
        profile, home = chrome_root / 'profile', chrome_root / 'home'
        profile.mkdir(mode=0o700); home.mkdir(mode=0o700)
        config, cache = home / 'config', home / 'cache'; config.mkdir(mode=0o700); cache.mkdir(mode=0o700)
        executable = '/usr/bin/chromium'; check(Path(executable).is_file(), 'CANDIDATE_CHROME_EXECUTABLE_MISSING')
        env = dict(os.environ, HOME=str(home), XDG_CONFIG_HOME=str(config), XDG_CACHE_HOME=str(cache))
        for key in ['BACKEND_ONLINE_SCOPE_FILE', 'BACKEND_ONLINE_SCOPE_SHA256', 'NODE_OPTIONS', 'DATABASE_URL']:
            env.pop(key, None)
        value = self.new_process(kind, [executable, '--headless=new', '--no-sandbox', '--disable-setuid-sandbox',
            '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + str(profile), 'about:blank'], env, request_id)
        end = time.monotonic() + 30
        while True:
            try:
                raw = private_read(profile / 'DevToolsActivePort', 4096); lines = raw.decode('ascii').splitlines()
                check(len(lines) == 2 and lines[0].isdigit() and 1024 <= int(lines[0]) <= 65535, 'CANDIDATE_CHROME_PORT_UNPROVEN')
                match = re.fullmatch(r'/devtools/browser/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', lines[1])
                check(match and value['actor'].poll() is None and birth(value['actor'].pid) == value['birth'], 'CANDIDATE_CHROME_ORIGINAL_CHANGED')
                break
            except FileNotFoundError:
                check(value['actor'].poll() is None and time.monotonic() < end, 'CANDIDATE_CHROME_NOT_READY'); time.sleep(0.02)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:' + lines[0] + '/json/version', timeout=5) as response:
            version = json.loads(response.read(65537))
        endpoint = urlsplit(version['webSocketDebuggerUrl'])
        check(endpoint.scheme == 'ws' and endpoint.hostname in ['127.0.0.1', 'localhost'] and endpoint.port == int(lines[0])
              and endpoint.path == lines[1], 'CANDIDATE_CHROME_UUID_UNPROVEN')
        proxy, proxy_ready = self.launch_helper(prefix+'cdp-proxy', 'application-native-cdp-proxy.fixture.mjs',
            dict(format='sabalan-native-private-cdp-proxy/v1', bindHost=self.topology['candidate']['host'],
                 mainHost=self.topology['main']['host'], chromePort=int(lines[0]), browserId=match[1], token=secrets.token_hex(32)))
        check(proxy_ready['originalProxyPid'] == proxy['actor'].pid and proxy_ready['host'] == self.topology['candidate']['host'], 'CANDIDATE_CDP_PROXY_OWNER_CHANGED')
        ws = urlsplit(proxy_ready['browserWSEndpoint'])
        check(ws.scheme == 'ws' and ws.hostname == self.topology['candidate']['host'] and ws.port == proxy_ready['port']
              and re.fullmatch(r'/[a-f0-9]{64}' + re.escape(lines[1]), ws.path), 'CANDIDATE_CDP_PROXY_ENDPOINT_CHANGED')
        self.channel.emit('PRIVATE_LEGACY_CHROME_READY' if legacy else ('PRIVATE_CHROME_READY' if private else 'CHROME_READY'), dict(requestId=request_id, actorId=value['id'], originalChromePid=value['actor'].pid,
            birth=value['birth'], controllerId=self.controller_id, host=self.topology['candidate']['host'], profile=str(profile),
            browserWSEndpoint=proxy_ready['browserWSEndpoint'], browserOrigin='http://localhost:3199',
            ingress=dict(originalIngressPid=ingress['actor'].pid, birth=ingress['birth'], host='127.0.0.1', port=3199,
                         targetHost=self.topology['main']['host'], targetPort=3199),
            proxy=dict(originalProxyPid=proxy['actor'].pid, birth=proxy['birth'], endpoint=proxy_ready['browserWSEndpoint'], configSha256=proxy['configSha256']),
            resources=resource()))

    def close_chrome(self, body, private=False, legacy=False):
        check(not (private and legacy), 'CANDIDATE_CHROME_KIND_AMBIGUOUS')
        kind="legacy-private-chrome" if legacy else ("private-chrome" if private else "chrome")
        prefix="legacy-private-" if legacy else ("private-" if private else "")
        input = body.get('input', {})
        check(isinstance(input, dict) and input.get('purpose') in [None, 'FAILED_CAPTURE_CLEANUP'], 'CANDIDATE_CHROME_CLOSE_PURPOSE_INVALID')
        if input.get('purpose') == 'FAILED_CAPTURE_CLEANUP':
            check(not legacy and set(input) == {'purpose'} and all(value.get('closed') for name,value in self.actors.items() if name != kind),
                  'CANDIDATE_FAILED_CAPTURE_NATIVE_CLOSURE_UNPROVEN')
            self.sticky_failures.append('FAILED_CAPTURE_CLEANUP_NOT_QUALIFICATION')
        elif not legacy:
            check('restored-http' in self.completed, 'CANDIDATE_CHROME_CLOSE_ORDER_INVALID')
        value = self.actors[kind]; check(not value['closed'], 'CANDIDATE_CHROME_ALREADY_CLOSED')
        if private or legacy:check(set(input)=={'actorId'} and input['actorId']==value['id'],'CANDIDATE_PRIVATE_BROWSER_CLOSE_OWNER_CHANGED')
        # Only the actual remote Puppeteer owner sends Browser.close. No signal
        # or controller timeout can replace its original Chrome Popen outcome.
        self.wait_original(value, 60); check(value['actor'].returncode == 0 and not value['deadlineExceeded'], 'CANDIDATE_CHROME_ORIGINAL_EXIT_UNPROVEN')
        helper_closures = {}
        for name in ['cdp-proxy', 'browser-ingress']:
            helper = self.helpers[prefix+name]; check(helper['actor'].poll() is None and birth(helper['actor'].pid) == helper['birth'], 'CANDIDATE_HELPER_ORIGINAL_CHANGED')
            helper['actor'].stdin.write(b'finish\n'); helper['actor'].stdin.flush(); helper['actor'].stdin.close()
            self.wait_original(helper, 60)
            check(helper['actor'].returncode == 0 and not helper['deadlineExceeded'], 'CANDIDATE_HELPER_ORIGINAL_EXIT_UNPROVEN')
            ready = self.event(helper, 'closed'); check(ready['activeConnections'] == 0, 'CANDIDATE_HELPER_CONNECTIONS_NOT_CLOSED')
            helper['closed'] = True
            helper_closures[name] = dict(originalPopenPid=helper['actor'].pid, birth=helper['birth'], originalReturncode=0, result=ready)
        # With all original direct Popen handles already waited, remaining
        # children are owned descendants reparented to this pre-birth subreaper.
        # Reap naturally; never signal or create a replacement Popen from a PID.
        descendants = []
        while True:
            children = Path('/proc/self/task/' + str(os.getpid()) + '/children').read_text().split()
            # Preserve every unrelated original Popen; only naturally orphaned
            # Chrome descendants belong to this pre-birth subreaper wait path.
            originals={value['actor'].pid for value in [*self.actors.values(),*self.helpers.values()]}
            children=[int(pid) for pid in children if int(pid) not in originals]
            if not children:break
            progressed=False
            for child_pid in children:
                pid,status=os.waitpid(child_pid,os.WNOHANG)
                if pid:
                    progressed=True;descendants.append(dict(pid=pid,originalSubreaperReturncode=os.waitstatus_to_exitcode(status)))
            if not progressed:time.sleep(0.02)
        check(all(row['originalSubreaperReturncode'] == 0 for row in descendants), 'CANDIDATE_CHROME_DESCENDANT_FAILED')
        after = resource(); check(no_oom(value['before'], after), 'CANDIDATE_CHROME_LIFETIME_OOM_DELTA')
        value['closed'] = True; self.completed.add(kind)
        self.channel.emit('PRIVATE_LEGACY_CHROME_CLOSED' if legacy else ('PRIVATE_CHROME_CLOSED' if private else 'CHROME_CLOSED'), dict(requestId=self.request_id(body), actorId=value['id'], result=dict(helpers=helper_closures, ownedDescendants=descendants),
            closure=dict(originalPopenPid=value['actor'].pid, originalReturncode=0, birth=value['birth'], resourcesBefore=value['before'], resourcesAfter=after)))

    def restored_inquiry(self, body):
        check('restored-baseline' in self.completed and 'restored-inquiry' not in self.completed, 'CANDIDATE_RESTORED_INQUIRY_ORDER_INVALID')
        import sqlite3
        request_id, input = self.request_id(body), body['input']; original = input['sourceClosureReceipt']
        check(original['nativeStatus'] == 143 and original['nativeReaped'] and original['sqliteNativeClosed']
              and original['requestedSigterm'] and original['naturalExitZero'] is False, 'CANDIDATE_INQUIRY_SOURCE_CLOSURE_UNPROVEN')
        source_grant = self.index['inquiryGrants']['source']
        source_raw = private_read(Path(source_grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json')
        source_native = json.loads(source_raw)
        check(digest(source_raw) == original['nativeSha256'] and source_native['phase'] == 'QUIESCENT'
              and source_native['nativeReaped'] and source_native['sqliteNativeClosed'] and source_native['nativeStatus'] == 143,
              'CANDIDATE_INQUIRY_SOURCE_EVIDENCE_CHANGED')
        directory = self.root / 'inquiry'; app = directory / 'app'
        captured = Path(input['capturedSqlite']); check(str(captured).startswith(str(self.root) + '/') and captured.resolve(strict=True) == captured, 'CANDIDATE_INQUIRY_CAPTURE_PATH_INVALID')
        original_stat = os.lstat(captured); hashed = hashlib.sha256()
        with captured.open('rb') as incoming, (directory / 'restored.db').open('xb') as output:
            os.fchmod(output.fileno(), 0o600)
            while chunk := incoming.read(262144): hashed.update(chunk); output.write(chunk)
            output.flush(); os.fsync(output.fileno())
        current_stat = os.lstat(captured)
        check(hashed.hexdigest() == input['sha256'] and all(getattr(original_stat, key) == getattr(current_stat, key)
              for key in ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns']), 'CANDIDATE_INQUIRY_CAPTURE_CHANGED')
        def rows():
            with sqlite3.connect('file:' + str(directory / 'restored.db') + '?mode=ro', uri=True) as database:
                return database.execute('SELECT rowNumber,listPrice,finalPrice FROM Product ORDER BY rowNumber').fetchall()
        expected_rows = [('COHERENT-ACK-LOST', 1234567.0, 2345678.0)]; check(rows() == expected_rows, 'CANDIDATE_INQUIRY_RESTORED_ROWS_CHANGED')
        check((directory / 'client.cjs').read_bytes() == self.artifact('inquiry-client.cjs').read_bytes()
              and (directory / 'observer.cjs').read_bytes() == self.artifact('inquiry-observer.cjs').read_bytes(), 'CANDIDATE_INQUIRY_OBSERVER_CHANGED')
        custody = json.loads(private_read(self.artifact('inquiry-custody.json'), 8 * MIB))
        self.verify_inquiry_code(app, custody)
        inventory_script = self.artifact('inquiry-dependency-inventory.cjs')
        def inventory():
            status, output, errors = self.probe('inquiry-inventory', ['/usr/local/bin/node', '-e', inventory_script.read_text(), custody['dependency']['retainedDependencies']])
            check(status == 0, 'CANDIDATE_INQUIRY_DEPENDENCY_READ_FAILED')
            actual = json.loads(output); check(actual == {key: custody['dependency'][key] for key in ['entries', 'bytes', 'inventorySha256']}, 'CANDIDATE_INQUIRY_DEPENDENCY_CHANGED')
            return actual
        inventory()
        grant = self.grant('restored-inquiry')
        env = {key: value for key, value in os.environ.items() if not key.startswith(('PG', 'BACKEND_', 'INQUIRY_NATIVE_')) and key != 'DATABASE_URL'}
        secret = private_read(directory / 'session-secret', 4096)
        if 'sessionSecretSha256' in input: check(digest(secret) == input['sessionSecretSha256'], 'CANDIDATE_INQUIRY_SESSION_INPUT_CHANGED')
        env.update(DATABASE_URL='file:' + str(directory / 'restored.db') + '?connection_limit=2&pool_timeout=5', SESSION_SECRET=secret.decode(), NODE_ENV='production',
                   NEXT_TELEMETRY_DISABLED='1', BACKEND_RUNTIME_ROLE='serving', BACKEND_ONLINE_SCOPE_FILE=grant['file'], BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'],
                   RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'], INQUIRY_RUNTIME_GENERATION='1', INQUIRY_COHERENT_ROOT=str(directory),
                   NODE_OPTIONS='--require=' + str(directory / 'observer.cjs'))
        for key in ['SMS_IR_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'SENDGRID_API_KEY']: env.pop(key, None)
        value = self.new_process('restored-inquiry', ['/usr/bin/python3', '-I', '-B', str(self.artifact('online-inquiry-owner.py')), '/usr/local/bin/node',
            str(app / 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3287'], env, request_id, grant, cwd=app)
        end = time.monotonic() + 60; opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        while True:
            check(value['actor'].poll() is None, 'CANDIDATE_INQUIRY_EXITED_BEFORE_READY')
            try:
                with opener.open('http://127.0.0.1:3287/admin/login', timeout=1) as response:
                    if response.status == 200: break
            except Exception: pass
            check(time.monotonic() < end, 'CANDIDATE_INQUIRY_NOT_READY'); time.sleep(0.02)
        for mode, marker in [('restored', b'RESTORED_NEXT_READ_OK'), ('retry', b'DUPLICATE_REFUSED')]:
            status, output, errors = self.probe('inquiry-client-' + mode, ['/usr/local/bin/node', str(directory / 'client.cjs'), str(directory), mode], cwd=app)
            check(status == 0 and marker in output, 'CANDIDATE_INQUIRY_ACTUAL_CLIENT_FAILED')
        check(rows() == expected_rows, 'CANDIDATE_INQUIRY_DUPLICATE_OR_POSTCUT_ROW')
        end = time.monotonic() + 30
        while json.loads(private_read(self.native_paths(grant)[1]))['phase'] != 'QUIESCENT':
            check(time.monotonic() < end and value['actor'].poll() is None, 'CANDIDATE_INQUIRY_WORK_NOT_QUIET'); time.sleep(0.02)
        raw = private_read(self.native_paths(grant)[0]); initial = json.loads(raw)
        check(initial['phase'] == 'ACTIVE' and initial['guardian'] == value['birth'] and value['actor'].poll() is None, 'CANDIDATE_INQUIRY_ORIGINAL_STOP_OWNER_CHANGED')
        request = dict(format='sabalan-private-inquiry-requested-stop/v1', guardian=initial['guardian'], activeClaimSha256=digest(raw),
                       signal='SIGTERM', expectedNativeStatus=143, naturalExitZeroExpected=False)
        write(directory / 'candidate-restored-requested-stop.json', encoded(request), 0o600)
        value['actor'].send_signal(signal.SIGTERM); self.wait_original(value, 60)
        final_raw = private_read(self.native_paths(grant)[0]); final = json.loads(final_raw)
        spec = importlib.util.spec_from_file_location('candidate_inquiry_requested_stop', self.artifact('inquiry-requested-stop.py'))
        policy = importlib.util.module_from_spec(spec); spec.loader.exec_module(policy)
        stop_proof = policy.qualify_requested_stop(request, initial, final, value['actor'].returncode)
        closure = self.close_native(value, 128); dependencies = inventory()
        self.completed.add('restored-inquiry')
        self.channel.emit('RESTORED_INQUIRY_DONE', dict(requestId=request_id, actorId=value['id'], closure=closure,
            result=dict(stop_proof, nativeStatus=143, requestedSigterm=True, naturalExitZero=False,
                        nativeSha256=digest(final_raw), activeClaimSha256=request['activeClaimSha256'], nativeReaped=True, sqliteNativeClosed=True,
                        dependency=dependencies, requestedStop=dict(request=request, initialRawBase64=base64.b64encode(raw).decode(), finalRawBase64=base64.b64encode(final_raw).decode()))))

    def verify_inquiry_code(self, app, custody):
        archive_file = self.artifact('inquiry-code.tar.gz')
        check(self.files['inquiry-code.tar.gz'] == custody['codeArchiveSha256'], 'CANDIDATE_INQUIRY_CODE_ARCHIVE_CHANGED')
        check(os.readlink(app / 'node_modules') == custody['dependency']['retainedDependencies'], 'CANDIDATE_INQUIRY_DEPENDENCY_LINK_CHANGED')
        with tarfile.open(archive_file, 'r:gz') as archive:
            members = archive.getmembers()
            check(1 < len(members) < 20000 and sum(member.size for member in members) < 256 * MIB, 'CANDIDATE_INQUIRY_CODE_BOUNDS')
            names = set()
            for member in members:
                name = member.name
                check(name not in names and not name.startswith('/') and '..' not in name.split('/')
                      and (member.isdir() or member.isfile() or (member.issym()
                      and name == '.next/node_modules/@prisma/client-2c3a283f134fdcb6'
                      and member.linkname == '../../../node_modules/@prisma/client')), 'CANDIDATE_INQUIRY_CODE_MEMBER_UNSAFE')
                names.add(name); file = app / name
                if member.issym():
                    check(file.is_symlink() and os.readlink(file) == member.linkname, 'CANDIDATE_INQUIRY_CODE_LINK_CHANGED')
                elif member.isdir():
                    check(file.is_dir() and not file.is_symlink(), 'CANDIDATE_INQUIRY_CODE_DIRECTORY_CHANGED')
                else:
                    check(file.resolve(strict=True) == file and file.is_file() and file.stat().st_size == member.size, 'CANDIDATE_INQUIRY_CODE_FILE_CHANGED')
                    with archive.extractfile(member) as expected, file.open('rb') as actual:
                        while chunk := expected.read(262144):
                            check(actual.read(len(chunk)) == chunk, 'CANDIDATE_INQUIRY_CODE_BYTES_CHANGED')
                        check(not actual.read(1), 'CANDIDATE_INQUIRY_CODE_FILE_GREW')

    def held(self, error):
        self.sticky_failures.append(type(error).__name__ + ':' + str(error))
        try:
            self.channel.emit('HELD', dict(controllerId=self.controller_id, reason=self.sticky_failures[-1],
                originalActors=[dict(actorId=value['id'], kind=kind, originalPid=value['actor'].pid, returncode=value['actor'].poll(),
                                     originalHandleRetained=True) for kind, value in self.actors.items()], productionAdmission=False))
        except BaseException:
            # Loss of the reporting pipe cannot release original child custody.
            pass

    def failed_closed_phase(self, command, body, error):
        if command in {'RUN_PRIVATE_DOMAIN_CASES','VERIFY_PRIVATE_DOMAIN_RESTORE','VERIFY_PRIVATE_BROWSER_TICKETS','VERIFY_PRIVATE_LEGACY_BROWSER_TICKETS'}:
            kind,expected={'RUN_PRIVATE_DOMAIN_CASES':('private-domain','PRIVATE_DOMAIN_DONE'),
                'VERIFY_PRIVATE_DOMAIN_RESTORE':('private-domain-verify','PRIVATE_DOMAIN_RESTORE_VERIFIED'),
                'VERIFY_PRIVATE_BROWSER_TICKETS':('private-browser-verify','PRIVATE_BROWSER_TICKETS_VERIFIED'),
                'VERIFY_PRIVATE_LEGACY_BROWSER_TICKETS':('legacy-private-browser-verify','PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED')}[command]
            value=self.actors.get(kind)
            if not value or value['actor'].poll() is None:return False
            try:
                self.wait_original(value,600);result,closure=self.private_domain_closed(value)
            except BaseException:return False
            code=type(error).__name__+':'+str(error);self.sticky_failures.append(code)
            self.channel.emit('PHASE_FAILED',dict(requestId=self.request_id(body),actorId=value['id'],failedEvent=expected,qualificationError=code,result=dict(qualified=False,originalKnownClosed=True),closure=closure))
            return True
        if command == 'RUN_FULL_CATALOG':
            value=self.actors.get('full-catalog')
            if not value or value['actor'].poll() is None:return False
            try:
                self.wait_original(value,7320);result,closure=self.catalog_closed(value,False)
            except BaseException:return False
            code=type(error).__name__ + ':' + str(error)
            self.sticky_failures.append(code);self.completed.discard('full-catalog')
            self.channel.emit('PHASE_FAILED',dict(requestId=self.request_id(body),actorId=value['id'],failedEvent='FULL_CATALOG_DONE',
                qualificationError=code,result=dict(qualified=False,originalKnownClosed=True,childOutcome=result),closure=closure))
            return True
        phases = {'START_ONLINE_POINT_INQUIRY':('online-point-inquiry','ONLINE_POINT_INQUIRY_READY'),'FINISH_ONLINE_POINT_INQUIRY':('online-point-inquiry','ONLINE_POINT_INQUIRY_DONE'),'RUN_PRISTINE_PERFORMANCE':('pristine-performance','PRISTINE_PERFORMANCE_DONE'),'RUN_PRIVATE_DOMAIN_BASELINE':('private-domain-baseline','PRIVATE_DOMAIN_BASELINE_DONE'),'RUN_MIGRATION': ('migration', 'MIGRATION_DONE'),
                  'RUN_RESTORED_BASELINE': ('restored-baseline', 'RESTORED_BASELINE_DONE'),
                  'RUN_RESTORED_INQUIRY': ('restored-inquiry', 'RESTORED_INQUIRY_DONE'),
                  'START_RESTORED_HTTP': ('restored-http', 'RESTORED_HTTP_READY'),
                  'START_PRIVATE_JOBS': ('private-jobs','PRIVATE_JOBS_READY'),
                  'PREPARE_PRIVATE_JOBS': ('private-jobs','PRIVATE_JOBS_PREPARED'),
                  'FINISH_PRIVATE_JOBS': ('private-jobs','PRIVATE_JOBS_DONE'),
                  'START_PRIVATE_HTTP2': ('private-http2','PRIVATE_HTTP2_READY'),
                  'PREPARE_PRIVATE_HTTP2': ('private-http2','PRIVATE_HTTP2_PREPARED'),
                  'FINISH_PRIVATE_HTTP2': ('private-http2','PRIVATE_HTTP2_DONE'),
                  'FINISH_RESTORED_HTTP': ('restored-http', 'RESTORED_HTTP_DONE')}
        if command not in phases: return False
        kind, expected = phases[command]; value = self.actors.get(kind)
        if not value or value['actor'].poll() is None or not value.get('active'): return False
        # Qualification and original closure are different facts. A genuine
        # failed-but-reaped guardian may release cleanup custody, never PASS.
        try:
            self.wait_original(value,240)
            closure = self.close_native(value, observation_only=True)
        except BaseException: return False
        code = type(error).__name__ + ':' + str(error)
        self.sticky_failures.append(code); self.completed.discard(kind)
        self.channel.emit('PHASE_FAILED', dict(requestId=self.request_id(body), actorId=value['id'],
            failedEvent=expected, qualificationError=code,
            result=dict(qualified=False, originalKnownClosed=True), closure=closure))
        return True

    def refuse_before_start(self, command, body, error, registry_snapshot):
        phases = {'START_ONLINE_POINT_INQUIRY':('online-point-inquiry','ONLINE_POINT_INQUIRY_READY'),'FINISH_ONLINE_POINT_INQUIRY':('online-point-inquiry','ONLINE_POINT_INQUIRY_DONE'),'RUN_PRISTINE_PERFORMANCE':('pristine-performance','PRISTINE_PERFORMANCE_DONE'),'RUN_PRIVATE_DOMAIN_BASELINE':('private-domain-baseline','PRIVATE_DOMAIN_BASELINE_DONE'),'RUN_MIGRATION': ('migration','MIGRATION_DONE'),
                  'START_CHROME': ('chrome','CHROME_READY'),'START_PRIVATE_CHROME':('private-chrome','PRIVATE_CHROME_READY'),
                  'START_PRIVATE_LEGACY_CHROME':('legacy-private-chrome','PRIVATE_LEGACY_CHROME_READY'),
                  'VERIFY_PRIVATE_LEGACY_BROWSER_TICKETS':('legacy-private-browser-verify','PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED'),
                  'RUN_RESTORED_BASELINE': ('restored-baseline','RESTORED_BASELINE_DONE'),
                  'RUN_RESTORED_INQUIRY': ('restored-inquiry','RESTORED_INQUIRY_DONE'),
                  'START_RESTORED_HTTP': ('restored-http','RESTORED_HTTP_READY'),
                  'START_PRIVATE_JOBS': ('private-jobs','PRIVATE_JOBS_READY'),
                  'START_PRIVATE_HTTP2': ('private-http2','PRIVATE_HTTP2_READY'),
                  'RUN_FULL_CATALOG': ('full-catalog','FULL_CATALOG_DONE'),
                  'RUN_PRIVATE_DOMAIN_CASES': ('private-domain','PRIVATE_DOMAIN_DONE'),
                  'VERIFY_PRIVATE_DOMAIN_RESTORE':('private-domain-verify','PRIVATE_DOMAIN_RESTORE_VERIFIED'),
                  'RUN_PRIVATE_DOMAIN_BASELINE':('private-domain-baseline','PRIVATE_DOMAIN_BASELINE_DONE'),'VERIFY_PRIVATE_BROWSER_TICKETS':('private-browser-verify','PRIVATE_BROWSER_TICKETS_VERIFIED')}
        if type(error) is not _OriginalCapacityRefusal or command not in phases:return False
        kind,expected=phases[command]
        if error.kind!=kind or kind in self.actors:return False
        for original,current in zip(registry_snapshot[:2],[self.actors,self.helpers]):
            if original.keys()!=current.keys() or any(current[key] is not value for key,value in original.items()):return False
        prior_probes=registry_snapshot[2]
        if any(key not in self.probes or self.probes[key] is not value for key,value in prior_probes.items()):return False
        added=[value for key,value in self.probes.items() if key not in prior_probes]
        if added:
            if command!='RUN_FULL_CATALOG' or len(added)!=2:return False
            expected_queries={'SELECT system_identifier FROM pg_control_system()',
                "SELECT oid FROM pg_database WHERE datname='"+self.index['database']+"'"}
            actual_queries=set()
            for probe in added:
                actor=probe.get('actor');args=getattr(actor,'args',None)
                if (probe.get('label')!='psql' or not probe.get('closed') or probe.get('originalReturncode')!=0
                    or actor is None or probe.get('originalPid')!=actor.pid or actor.poll()!=0
                    or not actor.stdout.closed or not actor.stderr.closed
                    or not isinstance(args,list) or len(args)!=8
                    or args[:7]!=['/usr/bin/psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-c']):return False
                actual_queries.add(args[7])
            if actual_queries!=expected_queries:return False
        if any(not probe['closed'] for probe in self.probes.values()):return False
        if (error.observed['memoryMaximum']!=EXPECTED_CANDIDATE_MEMORY_BYTES or error.required!=CAPACITY[kind]
            or error.observed['memoryAvailable']>=error.required):return False
        grant=None if kind in ['chrome','private-chrome','legacy-private-chrome','legacy-private-browser-verify','full-catalog','private-domain','private-domain-verify','private-browser-verify'] else self.grant(kind)
        if grant:
            native,_=self.native_paths(grant)
            if native.exists() or (Path(grant['scope']['boundaryDirectory'])/'claim.json').exists():return False
        self.channel.assert_observers_closed()
        self.sticky_failures.append('NATIVE_ACTOR_NOT_STARTED_CAPACITY_REFUSAL')
        self.channel.emit('PHASE_REFUSED',dict(requestId=self.request_id(body),actorId=None,kind=kind,
            failedEvent=expected,decision='NATIVE_ACTOR_NOT_STARTED',noWorkStarted=True,
            scopeSha256=grant['sha256'] if grant else None,nativeFileAbsent=True,claimFileAbsent=True,
            resources=error.observed,requiredBytes=error.required))
        return True

    def run(self):
        self.enroll(self.channel.receive('ENROLL'))
        while True:
            receipt = self.channel.receive(COMMANDS); body = receipt.body; self.request_id(body)
            registry_snapshot=[dict(self.actors),dict(self.helpers),dict(self.probes)]
            try:
                check(not self.sticky_failures or receipt.command in {'CLOSE_CLOSED', 'FINISH_RESTORED_HTTP', 'WAIT_CHROME_CLOSED', 'FINISH_ONLINE_POINT_INQUIRY', 'PREPARE_PRIVATE_JOBS', 'FINISH_PRIVATE_JOBS','PREPARE_PRIVATE_HTTP2','FINISH_PRIVATE_HTTP2','WAIT_PRIVATE_CHROME_CLOSED','WAIT_PRIVATE_LEGACY_CHROME_CLOSED'}, 'CANDIDATE_FAILED_QUALIFICATION_CANNOT_CONTINUE')
                if receipt.command == 'START_ONLINE_POINT_INQUIRY': self.start_online_point_inquiry(body)
                elif receipt.command == 'FINISH_ONLINE_POINT_INQUIRY': self.finish_online_point_inquiry(body)
                elif receipt.command == 'START_PRIVATE_JOBS': self.private_runtime(body,'private-jobs')
                elif receipt.command == 'PREPARE_PRIVATE_JOBS': self.private_wire(body,True)
                elif receipt.command == 'FINISH_PRIVATE_JOBS': self.private_wire(body,False)
                elif receipt.command == 'START_PRIVATE_HTTP2': self.private_runtime(body,'private-http2')
                elif receipt.command == 'PREPARE_PRIVATE_HTTP2': self.private_wire(body,True,'private-http2')
                elif receipt.command == 'FINISH_PRIVATE_HTTP2': self.private_wire(body,False,'private-http2')
                elif receipt.command == 'VERIFY_PRIVATE_BROWSER_TICKETS': self.private_browser_verify(body)
                elif receipt.command == 'VERIFY_PRIVATE_LEGACY_BROWSER_TICKETS': self.private_browser_verify(body,True)
                elif receipt.command == 'RUN_PRIVATE_DOMAIN_BASELINE': self.private_domain_baseline(body)
                elif receipt.command == 'VERIFY_PRIVATE_DOMAIN_RESTORE': self.private_domain_verify(body)
                elif receipt.command == 'RUN_PRIVATE_DOMAIN_CASES': self.private_domain(body)
                elif receipt.command == 'RUN_FULL_CATALOG': self.full_catalog(body)
                elif receipt.command == 'RUN_PRISTINE_PERFORMANCE': self.pristine_performance(body)
                elif receipt.command == 'RUN_MIGRATION': self.run_migration(body)
                elif receipt.command == 'RUN_RESTORED_BASELINE': self.baseline(body)
                elif receipt.command == 'START_RESTORED_HTTP': self.restored_http(body)
                elif receipt.command == 'FINISH_RESTORED_HTTP': self.finish_http(body)
                elif receipt.command == 'START_PRIVATE_CHROME': self.start_chrome(body,True)
                elif receipt.command == 'WAIT_PRIVATE_CHROME_CLOSED': self.close_chrome(body,True)
                elif receipt.command == 'START_PRIVATE_LEGACY_CHROME': self.start_chrome(body,legacy=True)
                elif receipt.command == 'WAIT_PRIVATE_LEGACY_CHROME_CLOSED': self.close_chrome(body,legacy=True)
                elif receipt.command == 'START_CHROME': self.start_chrome(body)
                elif receipt.command == 'WAIT_CHROME_CLOSED': self.close_chrome(body)
                elif receipt.command == 'RUN_RESTORED_INQUIRY': self.restored_inquiry(body)
                elif receipt.command in {'CLOSE', 'CLOSE_CLOSED'}:
                    required = {'migration', 'restored-baseline', 'restored-inquiry', 'restored-http', 'chrome'}
                    if self.index.get('catalog'): required.add('full-catalog')
                    if self.index.get('privateQualification'): required.update({'private-jobs','private-http2','private-domain','private-domain-baseline','private-domain-verify','private-chrome','private-browser-verify','legacy-private-chrome','legacy-private-browser-verify'})
                    if self.index.get('onlinePointInquiryGrant'): required.add('online-point-inquiry')
                    if receipt.command == 'CLOSE':
                        check(not self.sticky_failures and self.completed >= required, 'CANDIDATE_PHASES_NOT_COMPLETE')
                    check(all(value.get('closed') for value in [*self.actors.values(), *self.helpers.values()]), 'CANDIDATE_ORIGINAL_CHILDREN_NOT_CLOSED')
                    check(all(probe['closed'] for probe in self.probes.values()), 'CANDIDATE_ORIGINAL_OBSERVERS_NOT_CLOSED')
                    self.channel.assert_observers_closed()
                    self.channel.emit('CLOSED', dict(requestId=body['requestId'], controllerId=self.controller_id,
                        birth=self.original_birth, allOriginalChildrenClosed=True,
                        qualificationSucceeded=receipt.command == 'CLOSE' and not self.sticky_failures and self.completed >= required,
                        createdActorCount=len(self.actors), observerCount=len(self.probes), productionAdmission=False)); return
            except BaseException as error:
                if (not self.refuse_before_start(receipt.command,body,error,registry_snapshot)
                  and not self.failed_closed_phase(receipt.command, body, error)): self.held(error)


def main():
    check(len(sys.argv) == 4, 'CANDIDATE_FIXED_ARGV_INVALID')
    owner = CandidateOwner(*sys.argv[1:])
    try:
        owner.run()
    except BaseException as error:
        owner.held(error)
        # EOF/signature/channel failure cannot release still-owned descendants.
        # Keep this same controller alive; no replacement PID or force cleanup.
        while True:
            try: time.sleep(30)
            except BaseException: pass


if __name__ == '__main__':
    main()
