"""One known legacy shell's normal shutdown, inside the original deployment.

This bridge never owns/adopts application work, creates a guardian, or declares
SQL/native quiescence. Existing deployment closure and recovery gates remain.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import ssl
import socket
import select
import urllib.parse
import stat
import subprocess
import sys
import threading
import time

LEGACY_IMAGE = 'sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3'
# Both the immutable image and its current container have these literal labels.
# The serving release commit is not an attestation of this older image's source.
LEGACY_IMAGE_LABELS = {
    'io.sabalan.performance.source-commit': 'unattested',
    'io.sabalan.performance.source-hash': 'unattested',
}
LEGACY_COMMAND = ['sh', '-c', 'node dist/scripts/recovery-database-preflight.js && node dist/index.js']
NATIVE_COMMAND = ['sh', 'scripts/with-backend-control-ownership.sh', 'sh', 'scripts/start-backend.sh']
FORMAT = 'sabalan-legacy-backend-signal/v1'
children = []
interrupted = False
deadline_file = None


def require(value, code='LEGACY_SIGNAL_UNPROVEN'):
    if not value:
        raise RuntimeError(code)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def private(file, mode, maximum=4 * 1024**2):
    file = Path(file)
    require(file.is_absolute() and file.resolve(strict=True) == file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
                and stat.S_IMODE(before.st_mode) == mode and 0 < before.st_size <= maximum)
        raw = bytearray()
        while len(raw) < before.st_size:
            part = os.read(fd, min(65536, before.st_size - len(raw)))
            require(part)
            raw.extend(part)
        pin = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
                             value.st_ctime_ns, value.st_uid, value.st_mode, value.st_nlink)
        require(not os.read(fd, 1) and pin(before) == pin(os.fstat(fd)) == pin(file.lstat()))
        return json.loads(raw), digest(raw)
    finally:
        os.close(fd)


def save(file, value):
    file = Path(file)
    require(file.parent.resolve(strict=True) == file.parent)
    parent = file.parent.lstat()
    require(parent.st_uid == 0 and not parent.st_mode & 0o022)
    raw = encoded(value) + b'\n'
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    try:
        with os.fdopen(os.dup(fd), 'wb') as stream:
            stream.write(raw)
            stream.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    directory = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def observed(argv, stdin=None, role='read-only-docker'):
    limit = min(time.monotonic_ns() + 45_000_000_000, capture_deadline_ns())
    require(time.monotonic_ns() < limit, 'LEGACY_SIGNAL_DEADLINE_EXCEEDED_HELD')
    child = subprocess.Popen(argv, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, pass_fds=(9,))
    row = dict(role=role, originalPid=child.pid, closed=False, code=None, overflow=False,
               pumpFailed=False, stdout=[], stderr=[], bytes=0, deadlineExceeded=False, deadlineAuditFailed=False)
    children.append(row)
    lock = threading.Lock()

    def overdue():
        row['deadlineExceeded'] = True
        if deadline_file is not None:
            try:
                if not Path(deadline_file).exists():
                    save(deadline_file, dict(format=FORMAT, passResult=False, deadlineExceeded=True,
                         originalOwnerRetained=True, nativeCompletionUnknown=True, originalChildren=original_child_facts()))
            except BaseException:
                row['deadlineAuditFailed'] = True

    watchdog = threading.Timer(max(0, (limit - time.monotonic_ns()) / 1e9), overdue)
    watchdog.start()

    def drain(stream, key):
        try:
            while True:
                part = stream.read(65536)
                if not part:
                    break
                with lock:
                    row['bytes'] += len(part)
                    if row['bytes'] <= 8 * 1024**2:
                        row[key].append(part)
                    else:
                        row['overflow'] = True
        except BaseException:
            row['pumpFailed'] = True

    pumps = [threading.Thread(target=drain, args=(stream, key))
             for stream, key in [(child.stdout, 'stdout'), (child.stderr, 'stderr')]]
    for pump in pumps:
        pump.start()
    if stdin is not None:
        try:
            child.stdin.write(stdin)
            child.stdin.close()
        except BrokenPipeError:
            row['pumpFailed'] = True
    row['code'] = child.wait()
    row['closed'] = True
    for pump in pumps:
        pump.join()
    watchdog.cancel()
    watchdog.join()
    row['deadlineExceeded'] = row['deadlineExceeded'] or time.monotonic_ns() >= limit
    require(row['code'] == 0 and not row['overflow'] and not row['pumpFailed'] and not interrupted,
            'LEGACY_SIGNAL_OBSERVER_NOT_CLOSED')
    require(not row['deadlineExceeded'] and not row['deadlineAuditFailed'], 'LEGACY_SIGNAL_LATE_CHILD_CLOSED_HELD')
    return b''.join(row['stdout'])


def original_child_facts():
    return [{key: row[key] for key in ['role', 'originalPid', 'closed', 'code', 'overflow', 'pumpFailed', 'bytes', 'deadlineExceeded', 'deadlineAuditFailed']}
            for row in children]


def capture_deadline_ns():
    started = os.environ.get('DEPLOYMENT_CAPTURE_PAUSE_STARTED_NS')
    if started is None:
        return time.monotonic_ns() + 600_000_000_000
    require(re.fullmatch('[0-9]{1,20}', started), 'LEGACY_SIGNAL_INVALID_CAPTURE_CLOCK')
    require(int(started) <= time.monotonic_ns(), 'LEGACY_SIGNAL_INVALID_CAPTURE_CLOCK')
    return int(started) + 600_000_000_000


def proc_identity(pid):
    require(isinstance(pid, int) and pid > 1)
    root = Path('/proc') / str(pid)
    raw = (root / 'stat').read_text().rsplit(') ', 1)[1].split()
    require(raw[0] not in ['Z', 'X'])
    uid = re.search(r'^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$', (root / 'status').read_text(), re.M)
    require(uid and all(value == '0' for value in uid.groups()))
    return dict(pid=pid, ppid=int(raw[1]), startTicks=raw[19],
                pidNamespace=os.readlink(root / 'ns/pid'), exe=os.readlink(root / 'exe'),
                cwd=os.readlink(root / 'cwd'), cgroup=(root / 'cgroup').read_text(),
                argv=[part.decode('utf-8', 'strict') for part in (root / 'cmdline').read_bytes().split(b'\0') if part])


def classify_container(value, expected_image):
    require(value['Image'] == expected_image and re.fullmatch('sha256:[a-f0-9]{64}', expected_image))
    labels = value['Config'].get('Labels') or {}
    require(labels.get('com.docker.compose.project') == 'sabalanerp'
            and labels.get('com.docker.compose.service') == 'backend')
    require(value['State']['Running'] and value['State']['Pid'] > 1 and not value['State']['OOMKilled'])
    require(value['Config'].get('Entrypoint') in [None, [], ['docker-entrypoint.sh']])
    command = value['Config'].get('Cmd')
    if command == LEGACY_COMMAND:
        require(expected_image == LEGACY_IMAGE
                and all(labels.get(key) == expected for key, expected in LEGACY_IMAGE_LABELS.items()),
                'LEGACY_SIGNAL_UNKNOWN_IMMUTABLE_IMAGE')
        kind = 'KNOWN_LEGACY_SHELL'
    else:
        require(command == NATIVE_COMMAND, 'LEGACY_SIGNAL_UNKNOWN_STARTUP')
        kind = 'NATIVE_WRAPPER_NOT_REQUIRED'
    for mount in value.get('Mounts', []):
        target = mount['Destination'].rstrip('/')
        require(not any(code == target or code.startswith(target + '/') for code in
                        ['/app/dist', '/app/node_modules', '/app/scripts', '/usr/local/bin/node', '/usr/bin/dash']),
                'LEGACY_SIGNAL_CODE_MOUNT_UNPROVEN')
    require(isinstance(value['Created'], str) and value['Created'])
    return dict(kind=kind, containerId=value['Id'], image=value['Image'], created=value['Created'], startedAt=value['State']['StartedAt'],
                initHostPid=value['State']['Pid'])


def validate_process_shape(container, init, node, top, host_namespace):
    require(init['pid'] == container['initHostPid'] and init['pidNamespace'] != host_namespace
            and container['containerId'] in init['cgroup'], 'LEGACY_SIGNAL_CONTAINER_PROCESS_CHANGED')
    if container['kind'] == 'NATIVE_WRAPPER_NOT_REQUIRED':
        require(init['argv'] == ['python3', '/app/scripts/backend-runtime-owner.py', 'sh', 'scripts/start-backend.sh']
                and init['exe'].endswith('/python3.11'), 'LEGACY_SIGNAL_NATIVE_WRAPPER_UNPROVEN')
        return
    require(init['argv'] == LEGACY_COMMAND and init['exe'] == '/usr/bin/dash' and init['cwd'] == '/app')
    require(node and node['ppid'] == init['pid'] and node['pid'] != init['pid']
            and node['pidNamespace'] == init['pidNamespace'] and node['cgroup'] == init['cgroup']
            and node['argv'] == ['node', 'dist/index.js'] and node['exe'] == '/usr/local/bin/node' and node['cwd'] == '/app',
            'LEGACY_SIGNAL_NODE_SHAPE_UNPROVEN')
    require(len(top) == 2 and {row[0] for row in top} == {init['pid'], node['pid']}
            and (node['pid'], init['pid']) in top, 'LEGACY_SIGNAL_UNKNOWN_DESCENDANTS')


class OriginalHost:
    def __init__(self, base, environment):
        require(sys.platform == 'linux' and os.getuid() == 0)
        self.base, self.environment = Path(base), Path(environment).absolute()
        require(self.base.name == 'docker-compose.prod.yml' and self.base.resolve(strict=True) == self.base
                and self.environment.resolve(strict=True) == self.environment)
        self.root = self.base.parent
        self.parent = proc_identity(os.getppid())
        self.boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        self.namespace = os.readlink('/proc/self/ns/pid')
        self.lock_identity = None
        self.compose = ['docker', 'compose', '--env-file', str(self.environment), '-f', str(self.base), '-p', 'sabalanerp']
        self.assert_original()

    def assert_original(self):
        file = self.root / '.deploy-state/deployment.lock'
        require(file.resolve(strict=True) == file)
        held, named = os.fstat(9), file.lstat()
        identity = lambda value: (value.st_dev, value.st_ino, value.st_uid, value.st_gid, value.st_mode,
                                  value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        require(stat.S_ISREG(held.st_mode) and held.st_uid == 0 and held.st_nlink == 1
                and not held.st_mode & 0o022 and identity(held) == identity(named))
        if self.lock_identity is None:
            self.lock_identity = identity(held)
        require(identity(held) == self.lock_identity, 'LEGACY_SIGNAL_ORIGINAL_LOCK_CHANGED')
        require(re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                          + str(held.st_ino) + r'\s+0\s+EOF\s*$', Path('/proc/self/fdinfo/9').read_text(), re.M),
                'LEGACY_SIGNAL_INHERITED_LOCK_REQUIRED')
        require(proc_identity(os.getppid()) == self.parent
                and Path('/proc/sys/kernel/random/boot_id').read_text().strip() == self.boot,
                'LEGACY_SIGNAL_ORIGINAL_PARENT_CHANGED')

    def docker(self, args, stdin=None):
        self.assert_original()
        observed(self.compose + ['ps', '--all', '--format', 'json'])
        return observed(['docker'] + args, stdin=stdin, role='docker-' + args[0])

    def inspect(self, container):
        values = json.loads(self.docker(['inspect', container]))
        require(len(values) == 1 and values[0]['Id'] == container)
        return values[0]

    def snapshot(self, expected_image):
        ids = self.docker(['ps', '--no-trunc', '--filter', 'label=com.docker.compose.project=sabalanerp',
                           '--filter', 'label=com.docker.compose.service=backend', '--format', '{{.ID}}']).decode().split()
        require(len(ids) == 1 and re.fullmatch('[a-f0-9]{64}', ids[0]))
        value = self.inspect(ids[0])
        container = classify_container(value, expected_image)
        lines = self.docker(['top', ids[0], '-eo', 'pid,ppid']).decode().strip().splitlines()
        require(lines[0].split() == ['PID', 'PPID'])
        top = [tuple(map(int, line.split())) for line in lines[1:]]
        require(all(len(row) == 2 for row in top))
        init = proc_identity(container['initHostPid'])
        candidates = [pid for pid, parent in top if parent == init['pid']]
        node = proc_identity(candidates[0]) if container['kind'] == 'KNOWN_LEGACY_SHELL' and len(candidates) == 1 else None
        validate_process_shape(container, init, node, top, self.namespace)
        require(classify_container(self.inspect(ids[0]), expected_image) == container,
                'LEGACY_SIGNAL_CONTAINER_CHANGED_DURING_INSPECTION')
        return dict(container=container, init=init, node=node, bootId=self.boot)

    def protected_boundary(self, plan, session_file):
        session, _ = private(session_file, 0o600)
        for field in ['deploymentId', 'releaseId']:
            require(session[field] == plan[field] == os.environ.get('DEPLOYMENT_' + ('ID' if field == 'deploymentId' else 'RELEASE_ID')))
        require(session['phase'] == os.environ.get('DEPLOYMENT_PHASE') == 'TRAFFIC_BLOCKED')
        token = session['leaseToken']
        require(re.fullmatch('[A-Za-z0-9_-]{8,128}', token))
        value = self.inspect(plan['snapshot']['container']['containerId'])
        mounts = [m for m in value['Mounts'] if m['Destination'] == '/app/recovery-coordination' and m['RW']]
        require(len(mounts) == 1)
        marker, _ = private(Path(mounts[0]['Source']) / 'deployment-maintenance.json', 0o600)
        require(marker['deploymentId'] == session['deploymentId'] and marker['releaseId'] == session['releaseId'])
        sql = ("SELECT json_build_object('owned',EXISTS(SELECT 1 FROM deployment_operations WHERE id='"
               + session['deploymentId'] + "' AND \"releaseId\"='" + session['releaseId'] + "' AND \"leaseToken\"='"
               + token + "' AND \"activeKey\"='production' AND phase='TRAFFIC_BLOCKED' AND \"leaseExpiresAt\">clock_timestamp()+interval '30 seconds'))::text;\n").encode()
        result = observed(self.compose + ['exec', '-T', 'postgres', 'sh', '-c',
                          'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
                          stdin=sql, role='read-only-original-lease')
        require(json.loads(result)['owned'] is True, 'LEGACY_SIGNAL_DATABASE_LEASE_REQUIRED')
        values = {}
        for line in self.environment.read_text().splitlines():
            key, separator, value = line.partition('=')
            if separator and key in ['DOMAIN', 'INQUIRY_DOMAIN']:
                require(key not in values)
                values[key] = value
        require(set(values) == {'DOMAIN', 'INQUIRY_DOMAIN'})
        for domain in values.values():
            require(re.fullmatch('[A-Za-z0-9.-]+(?::[0-9]{1,5})?', domain))
            connection = http.client.HTTPSConnection(domain, timeout=10, context=ssl._create_unverified_context())
            try:
                connection.request('GET', '/')
                require(connection.getresponse().status == 503, 'LEGACY_SIGNAL_PUBLIC_BOUNDARY_REQUIRED')
            finally:
                connection.close()
        self.assert_original()


def verify_exited(actual, expected, wait_output):
    require(wait_output.strip() == b'0', 'LEGACY_SIGNAL_GRACEFUL_EXIT_REQUIRED')
    require(actual['Id'] == expected['containerId'] and actual['Image'] == expected['image']
            and actual['Created'] == expected['created']
            and actual['State']['StartedAt'] == expected['startedAt'] and actual['State']['Pid'] == 0
            and actual['State']['Running'] is False and actual['State']['OOMKilled'] is False
            and actual['State']['ExitCode'] == 0 and not actual['State'].get('Error'),
            'LEGACY_SIGNAL_GRACEFUL_EXIT_UNPROVEN')



# Daemon build observed by the original read-only R3: b83c47de... .
# Primary implementation pinned to moby/moby commit 6bc6209, API 1.53.
DAEMON_BUILD = {'Version': '29.2.1', 'ApiVersion': '1.53', 'MinAPIVersion': '1.44', 'GitCommit': '6bc6209'}

def api_remaining():
    remaining = (capture_deadline_ns() - time.monotonic_ns()) / 1_000_000_000
    require(remaining > 0 and not interrupted, 'LEGACY_SIGNAL_CAPTURE_BUDGET_EXCEEDED_HELD')
    return remaining

class OwnedDaemonRequest:
    def __init__(self, host, method, path, *, unbounded_stop=False, sent=None):
        # Allocation never dispatches. The original owner stores THIS object
        # before open() can expose any request bytes to the daemon.
        self.host, self.method, self.path = host, method, path
        self.unbounded_stop, self.sent = unbounded_stop, sent
        self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.response = None
        self.potentialDispatch = False
        self.underlyingComplete = False
        self.clientTerminal = False
        self.clientFault = False
    def open(self):
        self.host.assert_original()
        self.socket.settimeout(api_remaining())
        self.socket.connect('/var/run/docker.sock')
        # sendall can fail AFTER all or part of the request reached the daemon.
        self.potentialDispatch = True
        self.socket.sendall((self.method+' '+self.path+' HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nConnection: close\r\n\r\n').encode('ascii'))
        if self.sent is not None:
            self.sent.set()
        if self.unbounded_stop:
            self.socket.settimeout(None)
        self.response = http.client.HTTPResponse(self.socket)
        self.response.begin()
    def bounded_json(self, maximum):
        self.socket.settimeout(api_remaining())
        raw = self.response.read(maximum+1)
        require(len(raw) <= maximum, 'LEGACY_SIGNAL_DAEMON_RESPONSE_BOUND')
        return json.loads(raw)
    def close(self):
        require(not self.unbounded_stop or not self.potentialDispatch or self.underlyingComplete,
                'LEGACY_SIGNAL_STOP_COMPLETION_UNKNOWN_HELD')
        if self.response is not None:
            self.response.close()
        self.socket.close()

def retain_unknown_stop(request, report):
    # No retry, resolver, signal or synthetic completion exists in this branch.
    # Same original non-daemon worker retains exact request and inherited FD9.
    report['stopCompletionUnknown'] = True
    report['passResult'] = False
    try:
        if deadline_file is not None and not Path(deadline_file).exists():
            save(deadline_file, dict(format=FORMAT, passResult=False,
                 originalOwnerRetained=True, manualStopCompletionUnknown=True,
                 potentialDispatch=request.potentialDispatch,
                 clientTerminal=request.clientTerminal, clientFault=request.clientFault,
                 underlyingComplete=False, originalHostPid=os.getpid()))
    except BaseException:
        report['stopHeldAuditFault'] = True
    held = threading.Event()
    while True:
        try:
            held.wait()
        except BaseException:
            report['stopHeldObservationFault'] = True

def owned_normal_stop(host, snapshot, node_fd, plan, session_file, report):
    cid = snapshot['container']['containerId']
    require(re.fullmatch('[0-9a-f]{64}', cid))
    initial = host.inspect(cid)
    version_request = OwnedDaemonRequest(host, 'GET', '/version')
    try:
        version_request.open()
        require(version_request.response.status == 200)
        version = version_request.bounded_json(65536)
        require({k: version.get(k) for k in DAEMON_BUILD} == DAEMON_BUILD, 'LEGACY_SIGNAL_DAEMON_BUILD_UNREVIEWED')
    finally:
        version_request.close()
    wait = None
    events = None
    stop_thread = None
    stop_sent = threading.Event()
    stop = {'closed': False, 'status': None, 'fault': False, 'underlyingCompletionUnknown': False, 'underlyingComplete': False}
    observation_fault = False
    def normal_stop():
        request = OwnedDaemonRequest(host, 'POST', '/v1.53/containers/'+cid+'/stop?signal=SIGTERM&t=-1', unbounded_stop=True, sent=stop_sent)
        stop['request'] = request
        try:
            request.open()
            stop['status'] = request.response.status
            raw = request.response.read(65537)
            request.clientTerminal = True
            require(len(raw) <= 65536 and stop['status'] == 204 and not raw, 'LEGACY_SIGNAL_NORMAL_STOP_RESPONSE_UNPROVEN')
            request.underlyingComplete = True
            stop['underlyingComplete'] = True
        except BaseException:
            request.clientFault = True
            request.clientTerminal = True
            stop['fault'] = True
            if request.potentialDispatch and not request.underlyingComplete:
                stop['underlyingCompletionUnknown'] = True
                retain_unknown_stop(request, report)
        finally:
            # Unknown-dispatch branch never reaches here in runtime. Its exact
            # request stays owned even when a unit-test hold hook interrupts it.
            if not stop['underlyingCompletionUnknown']:
                request.close()
                stop['closed'] = True
    try:
        # In this exact daemon source ContainerWait is registered BEFORE these
        # HTTP headers are flushed. Events headers have no such meaning.
        wait = OwnedDaemonRequest(host, 'POST', '/v1.53/containers/'+cid+'/wait?condition=next-exit')
        wait.open()
        require(wait.response.status == 200, 'LEGACY_SIGNAL_NEXT_EXIT_REGISTRATION_UNPROVEN')
        report['nextExitRegistered'] = True
        intent_ns = time.time_ns()
        filters = json.dumps({'container': [cid], 'event': ['kill'], 'type': ['container']}, separators=(',', ':'))
        query = urllib.parse.urlencode({'since': str(intent_ns//1_000_000_000), 'filters': filters})
        events = OwnedDaemonRequest(host, 'GET', '/v1.53/events?'+query)
        events.open()
        require(events.response.status == 200)
        host.protected_boundary(plan, session_file)
        require(host.snapshot(snapshot['container']['image']) == snapshot)
        require(proc_identity(snapshot['node']['pid']) == snapshot['node'] and not select.select([node_fd], [], [], 0)[0])
        stop_thread = threading.Thread(target=normal_stop, name='original-normal-stop', daemon=False)
        stop_thread.start()
        require(stop_sent.wait(api_remaining()), 'LEGACY_SIGNAL_NORMAL_STOP_SEND_UNPROVEN')
        # Replay closes the events-header/subscription race. Only a genuinely
        # received fresh kill(SIGTERM) event can acknowledge manual stop state.
        total = 0
        while True:
            events.socket.settimeout(api_remaining())
            raw = events.response.readline(65537)
            require(raw and len(raw) <= 65536, 'LEGACY_SIGNAL_MANUAL_STOP_EVENT_MISSING')
            total += len(raw)
            require(total <= 1024*1024, 'LEGACY_SIGNAL_MANUAL_STOP_EVENT_BOUND')
            event = json.loads(raw)
            if (event.get('Type') == 'container' and event.get('Action') == 'kill'
                    and event.get('Actor', {}).get('ID') == cid
                    and event.get('Actor', {}).get('Attributes', {}).get('signal') == '15'
                    and type(event.get('timeNano')) is int and event['timeNano'] >= intent_ns):
                report['manualStopEvent'] = event
                break
        host.protected_boundary(plan, session_file)
        require(host.snapshot(snapshot['container']['image']) == snapshot, 'LEGACY_SIGNAL_ORIGINAL_INCARNATION_CHANGED')
        require(proc_identity(snapshot['node']['pid']) == snapshot['node'] and not select.select([node_fd], [], [], 0)[0])
        require(not interrupted and not stop['closed'], 'LEGACY_SIGNAL_ORIGINAL_STOP_CLOSED_BEFORE_NODE')
        report['signalAttempted'] = True
        signal.pidfd_send_signal(node_fd, signal.SIGTERM, None, 0)
        report['signalDelivered'] = True
        result = wait.bounded_json(65536)
        require(type(result.get('StatusCode')) is int and result['StatusCode'] == 0 and result.get('Error') in (None, {}), 'LEGACY_SIGNAL_GRACEFUL_EXIT_REQUIRED')
    except BaseException:
        observation_fault = True
        raise
    finally:
        # Once sent, the SAME original stop owns a daemon operation even if an
        # observation fails. Retain it through its genuine response, never retry,
        # cancel, escalate or release original FD9 on a deadline-only assertion.
        if stop_thread is not None:
            while stop_thread.is_alive():
                try:
                    stop_thread.join(0.25)
                except BaseException:
                    observation_fault = True
            report['normalStopOriginal'] = {k: v for k, v in stop.items() if k != 'request'}
        if events is not None:
            events.close()
        if wait is not None:
            wait.close()
        observation_fault = observation_fault or interrupted or time.monotonic_ns() >= capture_deadline_ns()
        report['shutdownObservationFault'] = observation_fault
    require(not observation_fault and stop['closed'] and not stop['fault'] and stop['status'] == 204)
    actual = host.inspect(cid)
    require(actual['RestartCount'] == initial['RestartCount'], 'LEGACY_SIGNAL_RESTARTED_INCARNATION')
    verify_exited(actual, snapshot['container'], b'0')
    return actual

def forward_original(host, plan, plan_sha, intent_file, result_file, session_file):
    report = dict(format=FORMAT, passResult=False, signalDelivered=False, deploymentId=plan['deploymentId'],
                  releaseId=plan['releaseId'], planSha256=plan_sha, applicationNativeClosureInferred=False)
    fd = None
    try:
        host.protected_boundary(plan, session_file)
        snapshot = host.snapshot(plan['snapshot']['container']['image'])
        require(snapshot == plan['snapshot'], 'LEGACY_SIGNAL_PREFLIGHT_IDENTITY_CHANGED')
        if snapshot['container']['kind'] == 'NATIVE_WRAPPER_NOT_REQUIRED':
            report.update(passResult=True, action='NOT_REQUIRED')
        else:
            require(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'LEGACY_SIGNAL_PIDFD_UNAVAILABLE')
            require(not Path(intent_file).exists() and not Path(result_file).exists(), 'LEGACY_SIGNAL_ORIGINAL_ATTEMPT_ALREADY_EXISTS')
            fd = os.pidfd_open(snapshot['node']['pid'], 0)
            require(proc_identity(snapshot['node']['pid']) == snapshot['node'])
            require(host.snapshot(snapshot['container']['image']) == snapshot)
            require(proc_identity(snapshot['node']['pid']) == snapshot['node'] and not interrupted)
            save(intent_file, dict(format=FORMAT, deploymentId=plan['deploymentId'], releaseId=plan['releaseId'],
                                   planSha256=plan_sha, target=snapshot, signal='SIGTERM', originalHostPid=os.getpid()))
            host.protected_boundary(plan, session_file)
            require(proc_identity(snapshot['node']['pid']) == snapshot['node'] and not interrupted)
            require(time.monotonic_ns() + 30_000_000_000 < capture_deadline_ns(), 'LEGACY_SIGNAL_INSUFFICIENT_CAPTURE_BUDGET')
            actual = owned_normal_stop(host, snapshot, fd, plan, session_file, report)
            require(not interrupted)
            report.update(passResult=True, action='NORMAL_SIGTERM', legacyContainerExitedCleanly=True,
                          stoppedContainer=snapshot['container'], exitObservation=dict(
                              Id=actual['Id'], Image=actual['Image'], Created=actual['Created'], State={key: actual['State'].get(key)
                                  for key in ['StartedAt', 'Pid', 'Running', 'OOMKilled', 'ExitCode', 'Error']}))
        require(time.monotonic_ns() < capture_deadline_ns(), 'LEGACY_SIGNAL_CAPTURE_BUDGET_EXCEEDED_HELD')
        return report
    except BaseException as error:
        report['error'] = str(error)[:160]
        raise
    finally:
        if fd is not None:
            os.close(fd)
        report['originalChildren'] = original_child_facts()
        report['interrupted'] = interrupted
        if interrupted:
            report['passResult'] = False
        save(result_file, report)


def main():
    global deadline_file
    require(len(sys.argv) in [6, 7])
    mode, base, environment, argument, plan_name = sys.argv[1:6]
    require(mode in ['--preflight', '--forward', '--assert-resolved'])
    host = OriginalHost(base, environment)
    plan_file = Path(plan_name)
    deployment = os.environ.get('DEPLOYMENT_ID', '')
    release = os.environ.get('DEPLOYMENT_RELEASE_ID', '')
    require(re.fullmatch('[A-Za-z0-9_-]{8,128}', deployment) and re.fullmatch('[A-Za-z0-9_-]{8,128}', release))
    require(plan_file == host.root / '.deploy-state' / ('legacy-backend-drain-' + deployment + '.json'))
    intent = plan_file.with_suffix('.signal-intent.json')
    result_file = plan_file.with_suffix('.signal-result.json')
    deadline_file = plan_file.with_suffix('.observer-deadline.json')
    if mode == '--assert-resolved':
        if intent.exists():
            plan, plan_sha = private(plan_file, 0o400)
            intent_value, _ = private(intent, 0o400)
            result, _ = private(result_file, 0o400)
            require(intent_value['planSha256'] == result['planSha256'] == plan_sha and result['passResult'] is True
                    and result.get('legacyContainerExitedCleanly') is True and result['interrupted'] is False
                    and intent_value['deploymentId'] == result['deploymentId'] == plan['deploymentId'] == deployment
                    and intent_value['releaseId'] == result['releaseId'] == plan['releaseId'] == release
                    and len(result['originalChildren']) > 0
                    and all(row['closed'] and row['code'] == 0 and not row['overflow'] and not row['pumpFailed'] and not row['deadlineExceeded'] and not row['deadlineAuditFailed'] for row in result['originalChildren']))
            # A later canonical Compose promotion can replace the stopped old
            # container. This is only an unresolved-attempt hold; historical
            # exit evidence never certifies the current runtime's closure.
            verify_exited(result['exitObservation'], plan['snapshot']['container'], b'0')
        return
    if mode == '--preflight':
        require(len(sys.argv) == 6 and re.fullmatch('sha256:[a-f0-9]{64}', argument))
        snapshot = host.snapshot(argument)
        if snapshot['node']:
            require(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'LEGACY_SIGNAL_PIDFD_UNAVAILABLE')
            fd = os.pidfd_open(snapshot['node']['pid'], 0)
            try:
                require(proc_identity(snapshot['node']['pid']) == snapshot['node'])
            finally:
                os.close(fd)
        save(plan_file, dict(format=FORMAT, deploymentId=deployment, releaseId=release, snapshot=snapshot,
                             signalDelivered=False, productionMutation=False, originalChildren=original_child_facts()))
    else:
        require(len(sys.argv) == 7)
        plan, plan_sha = private(plan_file, 0o400)
        require(plan['format'] == FORMAT and plan['deploymentId'] == deployment and plan['releaseId'] == release
                and plan['signalDelivered'] is False and plan['productionMutation'] is False
                and argument == plan['snapshot']['container']['image'])
        forward_original(host, plan, plan_sha, intent, result_file, sys.argv[6])
    require(not interrupted and all(not row['deadlineExceeded'] and not row['deadlineAuditFailed'] for row in children),
            'LEGACY_SIGNAL_INTERRUPTED_OR_LATE_HELD')
    print(json.dumps(dict(format=FORMAT, mode=mode, passResult=True)))


def interrupt(_number, _frame):
    global interrupted
    interrupted = True


if __name__ == '__main__':
    for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]:
        signal.signal(number, interrupt)
    try:
        main()
    except BaseException as error:
        print(json.dumps(dict(format=FORMAT, passResult=False, error=str(error)[:160])), file=sys.stderr)
        sys.exit(1)
