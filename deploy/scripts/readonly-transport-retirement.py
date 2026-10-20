"""Original-owner diagnostic read-only Socket transport retirement.

No production release admission, operation completion, build expiry or image GC.
The controller must start and retain its own native Popen objects. A replacement
controller cannot enroll an existing PID or load an earlier certificate.
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import select
import shlex
import time
import stat
import subprocess
import sys
from urllib.parse import unquote, urlsplit


def require(value):
    if not value:
        raise RuntimeError('READONLY_TRANSPORT_ORIGINAL_OWNER_UNPROVEN')


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode('ascii')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def birth(pid):
    fields = Path('/proc/' + str(pid) + '/stat').read_text().rsplit(') ', 1)[1].split()
    require(fields[0] != 'Z')
    return dict(pid=pid, startTicks=fields[19], bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                pidNamespace=os.readlink('/proc/' + str(pid) + '/ns/pid'))


def read(file, mode=0o600, maximum=16384):
    file = Path(file)
    require(file.resolve(strict=True) == file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_uid == os.getuid()
                and before.st_mode & 0o777 == mode and 0 < before.st_size <= maximum)
        raw = os.read(fd, maximum + 1)
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
                                  value.st_ctime_ns, value.st_mode, value.st_uid, value.st_nlink)
        require(len(raw) == before.st_size and identity(before) == identity(os.fstat(fd)) == identity(file.lstat()))
        value = json.loads(raw)
        require(encode(value) == raw)
        return value, raw
    finally:
        os.close(fd)


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Reviewed diagnostic call graph, not a declaration supplied by the caller.
# A source change requires a new review and an explicit tuple update. The
# trusted esbuild onLoad collector binds these exact bytes to the native scope's
# immutable application bundle. Production images have no authority here.
APPROVED_PROTOCOL_SOURCES = {
    'backend/src/application.ts': '84d2282e3161e40f0464ffd59ee689d09153b734633b90a1da0bdb27f798850f',
    'backend/src/services/realtimeDeliveryLifecycle.ts': 'c3470316b7c87df5a48e2c8f597ba4801e0b26f46754def3c83d5859b128d933',
    'backend/src/services/identitySessionService.ts': '744e9dcd6b944057f8cdf0514b38d55b1d5e96ea709d67919a084ffc8e8a34ec',
    'backend/src/services/onlineRuntimeWork.ts': 'c78d2af67a70c21d3ad76890c43e75e2785b7203eaeb990f1c0e0bf0c8b05350',
    'tests/online-deployment/application-native.worker.ts': '50dcb1882130fa934a3f5724d8b9eb9e5be8f5274ea79ecd7e16fa0479d11340',
    'tests/online-deployment/native-private-network.fixture.mjs': 'f46d4755c4554acea09e74803e54c80934edc90a2c27a3b405754f4394b5c4ca',
    'tests/online-deployment/browser-support-restore-native.fixture.ts': '1580384c2cd253df112e8ef07d10a8a8ef938ee3834b6c7c6840017b050aa91d',
    'tests/online-deployment/realtime-http-native.fixture.ts': 'c1128916bdcd29bf68493fc1fd98af71fc33ec35e207f442a10513e01aec7f9b',
    'tests/online-deployment/security-upload-native.fixture.ts': '23a758bbd0f9e651d219c69494b2678b921aaa86edb4b979d3f2fb72eb0bef37',
    'tests/online-deployment/support-staged-http-native.fixture.ts': '7605d709c1c9002c077c2496b9f59dedfd13a35837b8e00a5fbbfba55a35198f',
    'tests/online-deployment/support-staged-http-client.fixture.ts': '2b7bf596dcb5f58a4b733e6704b5ae0d4a682390896f1354182b5968568fbf11',
    'tests/online-deployment/application-native-environment.fixture.ts': 'c9e6502d5db4032757bd407cb0d4409ed051c14cf429ea7d7861c71c7ae96a1b',
}


ORIGINAL_APPLICATION_BOOTSTRAP = "process.umask(0o077);process.chdir(process.env.APPLICATION_NATIVE_CWD);require(process.argv[1]);"


def assert_reviewed_application_entry(directory, command, environment):
    directory = Path(directory)
    require(command == ['/usr/bin/python3', '-I', '-B', str(directory / 'online-runtime-owner.py'),
        '/usr/local/bin/node', '-e', ORIGINAL_APPLICATION_BOOTSTRAP, str(directory / 'application-worker.cjs'), 'application-http'])
    require(environment.get('NODE_PATH') == '/app/node_modules'
            and environment.get('NODE_ENV') == 'test'
            and environment.get('APPLICATION_NATIVE_CWD') == str(directory / 'app')
            and environment.get('APPLICATION_ACCEPTANCE_VERSION_ROOT') == str(directory / 'versions')
            and environment.get('APPLICATION_ACCEPTANCE_PHASE') in ['seed', 'reuse'])
    require(not any(environment.get(key) for key in ['NODE_PRELOAD', 'LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH',
        'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'PYTHONPATH', 'PYTHONSTARTUP', 'PYTHONINSPECT']))
    options = shlex.split(environment.get('NODE_OPTIONS', ''))
    require(all(re.fullmatch(r'--max-old-space-size=(?:[6-9][0-9]|[1-9][0-9]{2,3})', option) for option in options))
    executable = Path('/usr/local/bin/node')
    require(executable.resolve(strict=True) == executable and executable.is_file())
    metadata = executable.stat()
    require(metadata.st_uid == os.getuid() and not metadata.st_mode & 0o022)
    return (metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns)


class OriginalReadonlyTransportController:
    """A live controller capability. There is deliberately no from-record API."""
    def __init__(self, helper_directory):
        require(sys.platform == 'linux')
        self._directory = Path(helper_directory)
        require(self._directory.is_absolute() and self._directory.resolve(strict=True) == self._directory)
        self._parent = birth(os.getpid())
        self._protocol, self._protocol_raw = read(self._directory / 'readonly-socket-protocol.json', mode=0o400)
        require(set(self._protocol) == {'format', 'bundleSha256', 'sources', 'productionAdmission'}
                and self._protocol['format'] == 'sabalan-reviewed-diagnostic-readonly-socket-protocol/v1'
                and self._protocol['sources'] == APPROVED_PROTOCOL_SOURCES
                and self._protocol['productionAdmission'] is False
                and self._protocol['bundleSha256'] == digest((self._directory / 'application-worker.cjs').read_bytes()))
        self._sources = {name: digest((self._directory / name).read_bytes()) for name in
                         ['readonly-transport-retirement.py', 'online-runtime-owner.py', 'backend-runtime-owner.py',
                          'online-runtime-scope.py', 'online-backend-boundary.py', 'online-capture-admission.py',
                          'readonly-socket-protocol.json', 'application-worker.cjs', 'application-routing.mjs']}
        self._owners = []
        self._edge = None
        self._writer = None
        self._reader = None
        self._enrollment = None
        self._publication = None
        self._issued = False

    def _owned(self):
        require(birth(os.getpid()) == self._parent and all(digest((self._directory / name).read_bytes()) == sha
                for name, sha in self._sources.items()))
        if self._publication:
            file, descriptor, expected = self._publication
            named, inherited = file.lstat(), os.fstat(descriptor)
            require(file.resolve(strict=True) == file and stat.S_ISREG(named.st_mode)
                    and named.st_uid == os.getuid() and named.st_nlink == 1 and named.st_size == 0
                    and named.st_mode & 0o777 == 0o600
                    and (named.st_dev, named.st_ino) == (inherited.st_dev, inherited.st_ino) == expected
                    and re.search(r'FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+\S+:' + str(named.st_ino) + r'\s+0\s+EOF',
                                  Path('/proc/self/fdinfo/' + str(descriptor)).read_text()))

    def spawn_backend(self, command, *, env, stdout, stderr):
        self._owned()
        require(self._enrollment is None)
        executable_identity = assert_reviewed_application_entry(self._directory, command, env)
        scope_api = load('readonly_transport_scope_' + secrets.token_hex(8), self._directory / 'online-runtime-scope.py')
        loaded = scope_api.load_scope(env)
        require(loaded and loaded['scope']['format'] == 'sabalan-online-runtime-scope/v2'
                and loaded['scope']['purpose'] == 'http' and loaded['scope']['role'] == 'serving')
        scope = loaded['scope']
        require(scope['manifestSha256'] == self._protocol['bundleSha256'])
        require(all(value['loaded']['scope']['runtimeId'] != scope['runtimeId'] for value in self._owners)
                and not (Path(scope['nativeDirectory']) / 'deployment-runtime-native.json').exists())
        child = subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr)
        self._owners.append(dict(child=child, loaded=loaded, environment=dict(env), command=command,
                                 originalBirth=birth(child.pid), active=None, activeRaw=None, executableIdentity=executable_identity))
        return child

    def observe_active(self, child):
        """Called after normal readiness, while THIS original Popen is alive."""
        self._owned()
        selected = [value for value in self._owners if value['child'] is child]
        require(len(selected) == 1 and child.poll() is None)
        value = selected[0]
        require(assert_reviewed_application_entry(self._directory, value['command'], value['environment']) == value['executableIdentity'])
        native, raw = read(Path(value['loaded']['scope']['nativeDirectory']) / 'deployment-runtime-native.json')
        require(native['phase'] == 'ACTIVE' and native['onlineScope'] == value['loaded']
                and native['guardian'] == birth(child.pid) == value['originalBirth']
                and native['commandSha256'] == digest(encode(value['command'][4:]))
                and native['namespace'] == 'sabalan-rt-' + digest(value['loaded']['scope']['runtimeId'].encode())[:48]
                and native['initialDatabase']['name'] == value['loaded']['scope']['database']['name']
                and native['clusterIdentifier'] == value['loaded']['scope']['database']['systemIdentifier'])
        inherited = os.stat('/proc/' + str(child.pid) + '/fd/9')
        require(str(inherited.st_dev) == native['lock']['device'] and str(inherited.st_ino) == native['lock']['inode']
                and re.search(r'FLOCK\s+ADVISORY\s+WRITE', Path('/proc/' + str(child.pid) + '/fdinfo/9').read_text()))
        require(value['activeRaw'] is None or value['activeRaw'] == raw)
        value['active'], value['activeRaw'] = native, raw
        return digest(raw)

    def spawn_edge(self, command, *, env, stdout, stderr, instance_id, publication_lock_file,
                   publication_descriptor=20, retirement_directory, remote_browser=None):
        """Enroll the sole reader BEFORE launch; retain the sole writer here."""
        import fcntl
        self._owned()
        require(command == ['/usr/local/bin/node', str(self._directory / 'application-routing.mjs'), str(self._directory)])
        require(not any(env.get(key) for key in ['NODE_PRELOAD', 'LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH',
            'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH']))
        require(env.get('NODE_PATH') in [None, '', '/app/node_modules']
                and all(re.fullmatch(r'--max-old-space-size=(?:[6-9][0-9]|[1-9][0-9]{2,3})', option)
                    for option in shlex.split(env.get('NODE_OPTIONS', ''))))
        require(self._edge is None and self._owners and all(value['activeRaw'] for value in self._owners)
                and re.fullmatch(r'[a-f0-9]{64}', instance_id) and publication_descriptor == 20)
        lock = Path(publication_lock_file)
        identity = os.fstat(publication_descriptor)
        self._publication = (lock, publication_descriptor, (identity.st_dev, identity.st_ino))
        self._owned()
        destination = Path(retirement_directory)
        require(destination.resolve(strict=True) == destination and destination.is_dir()
                and destination.stat().st_uid == os.getuid() and destination.stat().st_mode & 0o777 == 0o700
                and not list(destination.iterdir()))
        reader, writer = os.pipe2(os.O_CLOEXEC)
        try:
            self._reader = fcntl.fcntl(reader, fcntl.F_DUPFD_CLOEXEC, 30)
            self._writer = fcntl.fcntl(writer, fcntl.F_DUPFD_CLOEXEC, 30)
        finally:
            os.close(reader)
            os.close(writer)
        fcntl.fcntl(self._reader, fcntl.F_SETFL, fcntl.fcntl(self._reader, fcntl.F_GETFL) | os.O_NONBLOCK)
        pipe = os.fstat(self._reader)
        browser_enrollment = None
        browser_reader = None
        if remote_browser is not None:
            # The private host receipt was verified by this original parent's
            # argv-enrolled channel, never loaded from a JSON receipt file.
            import sys
            channel_module = sys.modules.get('original_host_channel')
            require(channel_module is not None and isinstance(remote_browser, channel_module.HostReceipt)
                    and remote_browser.command == 'CHROME_READY')
            browser_raw = encode(dict(envelope=remote_browser.envelope, publicKey=remote_browser.public_key))
            require(len(browser_raw) <= 4096)
            read_end, write_end = os.pipe2(os.O_CLOEXEC)
            try:
                browser_reader = fcntl.fcntl(read_end, fcntl.F_DUPFD_CLOEXEC, 34)
                self._browser_writer = fcntl.fcntl(write_end, fcntl.F_DUPFD_CLOEXEC, 34)
            finally:
                os.close(read_end); os.close(write_end)
            browser_stat = os.fstat(browser_reader)
            browser_enrollment = dict(device=str(browser_stat.st_dev), inode=str(browser_stat.st_ino),
                readerDescriptor=browser_reader, writerDescriptor=self._browser_writer,
                sha256=digest(browser_raw), publicKeySha256=digest(base64.b64decode(remote_browser.public_key)))
            require(os.write(self._browser_writer, browser_raw) == len(browser_raw))
        self._enrollment = dict(format='sabalan-original-readonly-transport-channel/v1', enrollmentId=secrets.token_hex(32),
            instanceId=instance_id, controller=self._parent, helperDirectory=str(self._directory), sources=self._sources,
            pipe=dict(device=str(pipe.st_dev), inode=str(pipe.st_ino), readerDescriptor=self._reader, writerDescriptor=self._writer),
            publicationLock=dict(file=str(lock), descriptor=20, device=str(identity.st_dev), inode=str(identity.st_ino), ownerUid=os.getuid()),
            retirementDirectory=str(destination), owners=[dict(runtimeId=value['loaded']['scope']['runtimeId'],
                scopeSha256=value['loaded']['sha256'], image=value['loaded']['scope']['image'],
                manifestSha256=value['loaded']['scope']['manifestSha256'], activeClaimSha256=digest(value['activeRaw']),
                guardian=value['active']['guardian'], namespace=value['active']['namespace'],
                database=dict(systemIdentifier=value['active']['clusterIdentifier'], name=value['active']['initialDatabase']['name'],
                              oid=value['active']['initialDatabase']['oid'])) for value in self._owners],
            remoteBrowser=browser_enrollment, productionAdmission=False, buildOrImageGcEligible=False)
        # One bounded enrollment frame fits an empty Linux pipe. No child yet.
        frame = encode(self._enrollment)
        require(len(frame) <= 4096)
        require(os.write(self._writer, frame) == len(frame))
        child_env = dict(env, SABALAN_READONLY_RETIREMENT_FD=str(self._reader))
        self._edge = subprocess.Popen(command, env=child_env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                      pass_fds=(self._reader, publication_descriptor) + ((browser_reader,) if browser_reader is not None else ()))
        os.close(self._reader)
        self._reader = None
        if browser_reader is not None:
            os.close(browser_reader)
        return self._edge

    def abort_capture(self, proof, ready_raw):
        self._owned()
        module = sys.modules.get('application_native_coherent_join')
        require(module is not None and isinstance(proof, module.OriginalCaptureFailureProof)
                and self._edge is not None and self._edge.poll() is None and not self._issued)
        facts = module.read_original_capture_failure_proof(proof)
        require(facts['root'] == str(self._directory) and facts['originalPass'] is False)
        ready = json.loads(ready_raw)
        require(ready['originalEdgePid'] == self._edge.pid and ready['enrollmentId'] == self._enrollment['enrollmentId'])
        raw = encode(dict(format='sabalan-original-browser-capture-abort/v1', decision='CAPTURE_ABORT',
            enrollmentId=self._enrollment['enrollmentId'], operation=self._directory.name,
            readySha256=digest(ready_raw), captureFailure=facts, productionAdmission=False))
        require(len(raw) <= 4096 and os.write(self._writer, raw) == len(raw))

    def reconcile(self, pending_evidence, socket_instance_id):
        """No adopted child, no supplied native record, no timeout conclusion."""
        self._owned()
        require(self._edge is not None and self._edge.poll() is None and not self._issued
                and isinstance(pending_evidence, list) and 0 < len(pending_evidence) <= 1024
                and isinstance(socket_instance_id, str) and re.fullmatch(r'[a-f0-9]{64}', socket_instance_id))
        evidence = json.loads(encode(pending_evidence))
        ids = set()
        for entry in evidence:
            require(set(entry) == {'intent', 'intentSha256'} and re.fullmatch(r'[a-f0-9]{64}', entry['intentSha256']))
            intent = entry['intent']
            require(intent['instanceId'] == self._enrollment['instanceId'] and intent['method'] in ['GET', 'POST']
                    and re.fullmatch(r'[a-f0-9]{32}', intent['id']) and intent['id'] not in ids
                    and any(intent['image'] == owner['image'] and intent['manifestSha256'] == owner['manifestSha256']
                            for owner in self._enrollment['owners']))
            ids.add(intent['id'])
        closures = []
        for owner in self._owners:
            child = owner['child']
            require(child.poll() == 0 and child.returncode == 0)
            scope = owner['loaded']['scope']
            native, native_raw = read(Path(scope['nativeDirectory']) / 'deployment-runtime-native.json')
            require(native['phase'] == 'QUIESCENT' and native['nativeReaped'] is True and native['databaseQuiet'] is True
                    and native['nativeStatus'] == 0 and native['stoppedBySignal'] is False
                    and native['activeClaimSha256'] == digest(owner['activeRaw']))
            active = {key: value for key, value in native.items() if key not in
                      ['activeClaimSha256', 'nativeReaped', 'databaseQuiet', 'nativeStatus', 'stoppedBySignal']}
            active['phase'] = 'ACTIVE'
            require(encode(active) == owner['activeRaw'] and native['guardian'] == owner['originalBirth'])
            try:
                require(birth(child.pid) != owner['originalBirth'])
            except FileNotFoundError:
                pass
            boundary = load('readonly_work_boundary_' + secrets.token_hex(8), self._directory / 'online-backend-boundary.py')
            declaration, declaration_raw = read(Path(scope['boundaryDirectory']) / 'scope.json')
            stable = boundary.inspect_work_claim(Path(scope['boundaryDirectory']), scope['runtimeId'], owner['loaded']['sha256'],
                                                 native, digest(owner['activeRaw']), declaration_raw)
            require(declaration['scope']['image'] == scope['image']
                    and declaration['scope']['registrySha256'] == scope['manifestSha256'])
            scope_api = load('readonly_fresh_grant_' + secrets.token_hex(8), self._directory / 'online-runtime-scope.py')
            require(scope_api.load_scope(owner['environment']) == owner['loaded']
                    and not boundary.private_locked(Path(scope['nativeDirectory']) / 'deployment-runtime-control.lock', native['lock']))
            source = urlsplit(owner['environment']['DATABASE_URL'])
            namespace = native['namespace']
            query = "SELECT json_build_object('system',c.system_identifier::text,'visible',r.rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE'),'oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace + "'),'prepared',(SELECT count(*) FROM pg_prepared_xacts)) FROM pg_control_system() c CROSS JOIN pg_roles r WHERE r.rolname=current_user"
            environment = {key: value for key, value in owner['environment'].items() if not key.startswith('PG')}
            environment.update(PGHOST=source.hostname, PGPORT=str(source.port or 5432), PGUSER=unquote(source.username),
                PGPASSWORD=unquote(source.password), PGDATABASE=scope['database']['name'], PGAPPNAME='readonly-transport-retirement-proof',
                PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=5000 -c lock_timeout=250 -c default_transaction_read_only=on -c search_path=pg_catalog')
            outcome = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], env=environment,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            require(outcome.returncode == 0 and 0 < len(outcome.stdout) <= 16384)
            observed = json.loads(outcome.stdout)
            require(observed == dict(system=native['clusterIdentifier'], visible=True, oid=native['initialDatabase']['oid'], sessions=0, prepared=0))
            require(read(Path(scope['nativeDirectory']) / 'deployment-runtime-native.json')[1] == native_raw
                    and all(boundary.read(file, mode)[1] == raw for file, raw, mode in stable))
            closures.append(dict(runtimeId=scope['runtimeId'], scopeSha256=owner['loaded']['sha256'],
                activeClaimSha256=digest(owner['activeRaw']), nativeClosureSha256=digest(native_raw), guardian=owner['originalBirth'],
                originalPopenStatus=0, database=observed, namespace=namespace))
        self._owned()
        certificate = dict(format='sabalan-readonly-transport-reconciled/v1', decision='READONLY_TRANSPORT_RECONCILED',
            enrollmentId=self._enrollment['enrollmentId'], instanceId=self._enrollment['instanceId'], socketInstanceId=socket_instance_id, pendingEvidence=evidence,
            originalNativeClosures=closures, productionAdmission=False, buildOrImageGcEligible=False,
            originalOperationOutcome='UNKNOWN', mutationReconciled=False)
        raw = encode(certificate)
        require(len(raw) <= 8 * 1024 * 1024)
        self._issued = True  # From first attempted frame write, any uncertainty is held.
        offset = 0
        os.set_blocking(self._writer, False)
        deadline = time.monotonic() + 5
        while offset < len(raw):
            self._owned()
            require(self._edge.poll() is None and time.monotonic() < deadline)
            if not select.select([], [self._writer], [], min(0.1, max(0, deadline - time.monotonic())))[1]:
                continue
            try:
                count = os.write(self._writer, raw[offset:])
            except BlockingIOError:
                continue
            require(count > 0)
            offset += count
        self._issued = True
        return certificate
