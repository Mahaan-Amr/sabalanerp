"""Bind the legacy stop to the protected database boundary and disclose effects.

The known legacy image exits zero while external-effecting workers can still be
running. Its exit is a process observation, never a provider-completion receipt.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import signal
import ssl
import stat
import subprocess
import sys
import threading
import time

LEGACY_IMAGE = 'sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3'
# This immutable legacy image predates source attestation. Its recorded labels
# are both literally unattested; neither is evidence of a Git commit.
LEGACY_SOURCE_LABEL = 'unattested'
LEGACY_COMMAND = ['sh', '-c', 'node dist/scripts/recovery-database-preflight.js && node dist/index.js']
NATIVE_COMMAND = ['sh', 'scripts/with-backend-control-ownership.sh', 'sh', 'scripts/start-backend.sh']
FORMAT = 'sabalan-legacy-backend-signal/v2'
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

    pumps = [threading.Thread(target=drain, args=(stream, key), daemon=True)
             for stream, key in [(child.stdout, 'stdout'), (child.stderr, 'stderr')]]
    for pump in pumps:
        pump.start()
    if stdin is not None:
        try:
            child.stdin.write(stdin)
            child.stdin.close()
        except BrokenPipeError:
            row['pumpFailed'] = True
    try:
        row['code'] = child.wait(timeout=max(0.001, (limit - time.monotonic_ns()) / 1e9))
        row['closed'] = True
    except subprocess.TimeoutExpired:
        overdue()
        # Only the read-only Docker observer is stopped here. The container and
        # the original deployment owner remain untouched and fail closed.
        child.terminate()
        try:
            row['code'] = child.wait(timeout=5)
            row['closed'] = True
        except subprocess.TimeoutExpired:
            child.kill()
            row['code'] = child.wait(timeout=5)
            row['closed'] = True
    for pump in pumps:
        pump.join(timeout=5)
    if any(pump.is_alive() for pump in pumps):
        row['pumpFailed'] = True
    else:
        child.stdout.close()
        child.stderr.close()
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
    return int(started) + 900_000_000_000


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
                and labels.get('io.sabalan.performance.source-commit') == LEGACY_SOURCE_LABEL
                and labels.get('io.sabalan.performance.source-hash') == LEGACY_SOURCE_LABEL,
                'LEGACY_SIGNAL_UNKNOWN_IMMUTABLE_IMAGE')
        # Owner acceptance covers SMS only. A newly enabled tax broker would
        # introduce a financial provider effect outside that decision.
        tax_endpoint = [row.split('=', 1)[1] for row in value['Config'].get('Env', [])
                        if row.startswith('TAXPAYER_DELIVERY_BROKER_ENDPOINT=')]
        require(not tax_endpoint or tax_endpoint == [''], 'LEGACY_TAX_BROKER_EFFECT_UNACCEPTED')
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


def legacy_effect_receipt(snapshot):
    container = snapshot['container']
    if container['kind'] == 'NATIVE_WRAPPER_NOT_REQUIRED':
        return None
    require(container['kind'] == 'KNOWN_LEGACY_SHELL' and container['image'] == LEGACY_IMAGE,
            'LEGACY_EFFECT_UNKNOWN_IMAGE')
    # This is the owner's first-update acceptance, not a completion claim. The
    # measured handler joins neither dispatch SMS nor notification delivery.
    return dict(image=container['image'], containerId=container['containerId'],
                startedAt=container['startedAt'], nodeStartTicks=snapshot['node']['startTicks'],
                ownerAcceptedPossibleDuplicateOrUnknownSms=True,
                externalEffectsCompleted=False, exactlyOnceSmsProven=False,
                additionalNotificationUncertainty='Web Push delivery may be unknown or duplicated',
                taxpayerBrokerEndpointVerifiedAbsentAtPreflight=True)


def require_effect_receipt(plan):
    require(plan.get('legacyExternalEffectRisk') == legacy_effect_receipt(plan['snapshot']),
            'LEGACY_EFFECT_RECEIPT_REQUIRED')


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

    def daemon_identity(self):
        pidfile = Path('/run/docker.pid')
        require(pidfile.resolve(strict=True) == pidfile)
        fd = os.open(pidfile, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
                    and not before.st_mode & 0o022 and 0 < before.st_size <= 32)
            raw = os.read(fd, 33)
            after = os.fstat(fd)
            named = pidfile.lstat()
            fields = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
                                    value.st_ctime_ns, value.st_uid, value.st_mode, value.st_nlink)
            require(fields(before) == fields(after) == fields(named))
        finally:
            os.close(fd)
        require(re.fullmatch(rb'[1-9][0-9]{1,9}\n?', raw), 'LEGACY_SIGNAL_DOCKER_PIDFILE_INVALID')
        pid = int(raw)
        process = proc_identity(pid)
        require(process['exe'] == '/usr/bin/dockerd' and process['pid'] == pid,
                'LEGACY_SIGNAL_DOCKER_DAEMON_CHANGED')
        version = self.docker(['version', '--format', '{{.Server.Version}}']).decode().strip()
        root = self.docker(['info', '--format', '{{.DockerRootDir}}']).decode().strip()
        require(version == '29.2.1' and root == '/var/lib/docker', 'LEGACY_SIGNAL_DOCKER_VERSION_UNREVIEWED')
        return dict(pid=pid, startTicks=process['startTicks'], bootId=self.boot,
                    serverVersion=version, dockerRoot=root)

    def persisted_manual_stop(self, snapshot):
        container = snapshot['container']
        identifier = container['containerId']
        require(re.fullmatch('[a-f0-9]{64}', identifier))
        state, sha = private(Path('/var/lib/docker/containers') / identifier / 'config.v2.json', 0o600, 16 * 1024**2)
        require(state['ID'] == identifier and state['Image'] == container['image']
                and state['Created'] == container['created']
                and state['State']['StartedAt'] == container['startedAt']
                and state['State']['Running'] is True
                and state['State']['Pid'] == container['initHostPid']
                and isinstance(state['RestartCount'], int) and state['RestartCount'] >= 0,
                'LEGACY_SIGNAL_DOCKER_CHECKPOINT_IDENTITY_CHANGED')
        require(type(state.get('HasBeenManuallyStopped')) is bool,
                'LEGACY_SIGNAL_DOCKER_CHECKPOINT_FLAG_MISSING')
        return dict(manuallyStopped=state['HasBeenManuallyStopped'], sha256=sha,
                    restartCount=state['RestartCount'])

    def persisted_stopped(self, snapshot, barrier):
        container = snapshot['container']
        identifier = container['containerId']
        state, sha = private(Path('/var/lib/docker/containers') / identifier / 'config.v2.json', 0o600, 16 * 1024**2)
        require(state['ID'] == identifier and state['Image'] == container['image']
                and state['Created'] == container['created']
                and state['State']['StartedAt'] == container['startedAt']
                and state['State']['Running'] is False and state['State']['Pid'] == 0
                and state['State']['ExitCode'] == 0 and state['State']['OOMKilled'] is False
                and state['HasBeenManuallyStopped'] is True
                and state['RestartCount'] == barrier['restartCount'],
                'LEGACY_SIGNAL_DOCKER_STOPPED_CHECKPOINT_UNPROVEN')
        return dict(manuallyStopped=True, sha256=sha, restartCount=state['RestartCount'])

    def manual_stop_observation(self, snapshot):
        container = snapshot['container']
        identifier = container['containerId']
        state, sha = private(Path('/var/lib/docker/containers') / identifier / 'config.v2.json',
                             0o600, 16 * 1024**2)
        require(state['ID'] == identifier and state['Image'] == container['image']
                and state['Created'] == container['created'],
                'LEGACY_SIGNAL_DOCKER_PARTIAL_BARRIER_IDENTITY_CHANGED')
        return dict(sha256=sha, manuallyStopped=state.get('HasBeenManuallyStopped'),
                    restartCount=state.get('RestartCount'), running=state['State'].get('Running'),
                    pid=state['State'].get('Pid'), startedAt=state['State'].get('StartedAt'))

    def manual_stop_barrier(self, plan, mark_cont_attempt):
        snapshot = plan['snapshot']
        before_daemon = self.daemon_identity()
        require(before_daemon == plan['manualStopPreflight']['dockerDaemon'],
                'LEGACY_SIGNAL_DOCKER_DAEMON_CHANGED')
        before = self.persisted_manual_stop(snapshot)
        require(before == plan['manualStopPreflight']['checkpoint'],
                'LEGACY_SIGNAL_DOCKER_CHECKPOINT_CHANGED')
        require(before['manuallyStopped'] is False, 'LEGACY_SIGNAL_DOCKER_ALREADY_MANUALLY_STOPPED')
        identifier = snapshot['container']['containerId']
        mark_cont_attempt()
        result = self.docker(['kill', '--signal=SIGCONT', identifier])
        require(result.strip() == identifier.encode(), 'LEGACY_SIGNAL_DOCKER_CONT_UNPROVEN')
        after_daemon = self.daemon_identity()
        require(after_daemon == before_daemon, 'LEGACY_SIGNAL_DOCKER_DAEMON_CHANGED')
        after = self.persisted_manual_stop(snapshot)
        require(after['manuallyStopped'] is True, 'LEGACY_SIGNAL_MANUAL_STOP_NOT_PERSISTED')
        require(after['restartCount'] == before['restartCount'], 'LEGACY_SIGNAL_DOCKER_RESTARTED_DURING_BARRIER')
        require(self.snapshot(snapshot['container']['image']) == snapshot,
                'LEGACY_SIGNAL_ORIGINAL_RUNTIME_CHANGED_DURING_BARRIER')
        return dict(format='sabalan-legacy-manual-stop-barrier/v1', dockerDaemon=after_daemon,
                    beforeSha256=before['sha256'], afterSha256=after['sha256'],
                    restartCount=after['restartCount'], manualStopPersisted=True,
                    barrierSignal='SIGCONT')

    def confirm_manual_stop_at_signal(self, plan, barrier):
        daemon = self.daemon_identity()
        require(daemon == barrier['dockerDaemon'],
                'LEGACY_SIGNAL_DOCKER_DAEMON_CHANGED')
        checkpoint = self.persisted_manual_stop(plan['snapshot'])
        require(checkpoint['manuallyStopped'] is True
                and checkpoint['restartCount'] == barrier['restartCount'],
                'LEGACY_SIGNAL_MANUAL_STOP_LOST_BEFORE_TERM')
        return dict(checkpoint, dockerDaemon=daemon)

    def assert_current_stopped(self, plan, result):
        snapshot = plan['snapshot']
        barrier = result['manualStopBarrier']
        require(self.daemon_identity() == barrier['dockerDaemon'],
                'LEGACY_SIGNAL_DOCKER_DAEMON_CHANGED')
        current = self.inspect(snapshot['container']['containerId'])
        verify_exited(current, snapshot['container'], b'0')
        require(current['RestartCount'] == barrier['restartCount'],
                'LEGACY_SIGNAL_DOCKER_RESTARTED_AFTER_SIGNAL')
        self.persisted_stopped(snapshot, barrier)
        require(not Path('/proc', str(snapshot['node']['pid'])).exists(),
                'LEGACY_SIGNAL_OLD_NODE_STILL_PRESENT')

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

    def protected_boundary(self, plan, session_file, phases=('TRAFFIC_BLOCKED',)):
        session, _ = private(session_file, 0o600)
        for field in ['deploymentId', 'releaseId']:
            require(session[field] == plan[field] == os.environ.get('DEPLOYMENT_' + ('ID' if field == 'deploymentId' else 'RELEASE_ID')))
        phase = session['phase']
        require(phase == os.environ.get('DEPLOYMENT_PHASE') and phase in phases
                and phase in ('TRAFFIC_BLOCKED', 'SERVICES_DRAINED', 'REMOTE_CHECKPOINT_VERIFIED'))
        token = session['leaseToken']
        require(re.fullmatch('[A-Za-z0-9_-]{8,128}', token))
        value = self.inspect(plan['snapshot']['container']['containerId'])
        mounts = [m for m in value['Mounts'] if m['Destination'] == '/app/recovery-coordination' and m['RW']]
        require(len(mounts) == 1)
        marker, _ = private(Path(mounts[0]['Source']) / 'deployment-maintenance.json', 0o600)
        require(marker['deploymentId'] == session['deploymentId'] and marker['releaseId'] == session['releaseId'])
        sql = ("SELECT json_build_object('owned',EXISTS(SELECT 1 FROM deployment_operations WHERE id='"
               + session['deploymentId'] + "' AND \"releaseId\"='" + session['releaseId'] + "' AND \"leaseToken\"='"
               + token + "' AND \"activeKey\"='production' AND phase='" + phase
               + "' AND \"leaseExpiresAt\">clock_timestamp()+interval '30 seconds'))::text;\n").encode()
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


def forward_original(host, plan, plan_sha, intent_file, result_file, session_file):
    report = dict(format=FORMAT, passResult=False, signalDelivered=False, deploymentId=plan['deploymentId'],
                  releaseId=plan['releaseId'], planSha256=plan_sha, applicationNativeClosureInferred=False,
                  legacyExternalEffectRisk=plan.get('legacyExternalEffectRisk'), dockerContAttempted=False)
    fd = None
    try:
        host.protected_boundary(plan, session_file)
        snapshot = host.snapshot(plan['snapshot']['container']['image'])
        require(snapshot == plan['snapshot'], 'LEGACY_SIGNAL_PREFLIGHT_IDENTITY_CHANGED')
        require_effect_receipt(plan)
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
                                   planSha256=plan_sha, target=snapshot, signal='SIGTERM', originalHostPid=os.getpid(),
                                   dockerContAttemptPlanned=True,
                                   legacyExternalEffectRisk=plan['legacyExternalEffectRisk']))
            host.protected_boundary(plan, session_file)
            require(proc_identity(snapshot['node']['pid']) == snapshot['node'] and not interrupted)
            require(time.monotonic_ns() + 30_000_000_000 < capture_deadline_ns(), 'LEGACY_SIGNAL_INSUFFICIENT_CAPTURE_BUDGET')
            report['manualStopBarrier'] = host.manual_stop_barrier(
                plan, lambda: report.update(dockerContAttempted=True))
            host.protected_boundary(plan, session_file)
            require(host.snapshot(snapshot['container']['image']) == snapshot)
            require(proc_identity(snapshot['node']['pid']) == snapshot['node'] and not interrupted)
            report['signalPointCheckpoint'] = host.confirm_manual_stop_at_signal(
                plan, report['manualStopBarrier'])
            require(not interrupted)
            report['signalAttempted'] = True
            signal.pidfd_send_signal(fd, signal.SIGTERM, None, 0)
            report['signalDelivered'] = True
            wait_output = host.docker(['wait', snapshot['container']['containerId']])
            actual = host.inspect(snapshot['container']['containerId'])
            verify_exited(actual, snapshot['container'], wait_output)
            require(actual['RestartCount'] == report['manualStopBarrier']['restartCount'],
                    'LEGACY_SIGNAL_DOCKER_RESTARTED_AFTER_SIGNAL')
            require(host.daemon_identity() == report['manualStopBarrier']['dockerDaemon'],
                    'LEGACY_SIGNAL_DOCKER_DAEMON_CHANGED')
            report['stoppedCheckpoint'] = host.persisted_stopped(snapshot, report['manualStopBarrier'])
            require(not Path('/proc', str(snapshot['node']['pid'])).exists(),
                    'LEGACY_SIGNAL_OLD_NODE_STILL_PRESENT')
            require(not interrupted)
            report.update(passResult=True, action='NORMAL_SIGTERM', legacyContainerExitedCleanly=True,
                          stoppedContainer=snapshot['container'], exitObservation=dict(
                              Id=actual['Id'], Image=actual['Image'], Created=actual['Created'], RestartCount=actual['RestartCount'], State={key: actual['State'].get(key)
                                  for key in ['StartedAt', 'Pid', 'Running', 'OOMKilled', 'ExitCode', 'Error']}))
        require(time.monotonic_ns() < capture_deadline_ns(), 'LEGACY_SIGNAL_CAPTURE_BUDGET_EXCEEDED_HELD')
        return report
    except BaseException as error:
        report['passResult'] = False
        report['error'] = str(error)[:160]
        if report.get('signalDelivered') and not report['passResult']:
            try:
                current = host.inspect(plan['snapshot']['container']['containerId'])
                state = current['State']
                report['postSignalContainer'] = dict(Id=current['Id'], Image=current['Image'],
                    Created=current['Created'], RestartCount=current.get('RestartCount'),
                    State={key: state.get(key) for key in ['StartedAt', 'FinishedAt', 'Pid',
                        'Running', 'OOMKilled', 'ExitCode', 'Error']})
                report['restartObserved'] = (current['Id'] == plan['snapshot']['container']['containerId']
                    and current['Created'] == plan['snapshot']['container']['created']
                    and state['StartedAt'] != plan['snapshot']['container']['startedAt'])
            except BaseException:
                report['postSignalInspectionFailed'] = True
        raise
    finally:
        if fd is not None:
            os.close(fd)
        if report['dockerContAttempted'] and not report['passResult']:
            report['partialBarrierAudit'] = {}
            for field, method in [('dockerDaemon', 'daemon_identity'),
                                  ('persistedContainer', 'manual_stop_observation')]:
                try:
                    observer = getattr(host, method)
                    report['partialBarrierAudit'][field] = (observer() if field == 'dockerDaemon'
                                                             else observer(plan['snapshot']))
                except BaseException as error:
                    report['partialBarrierAudit'][field + 'Error'] = str(error)[:160]
        report['originalChildren'] = original_child_facts()
        report['interrupted'] = interrupted
        if interrupted:
            report['passResult'] = False
        save(result_file, report)


def main():
    global deadline_file
    require(len(sys.argv) in [6, 7])
    mode, base, environment, argument, plan_name = sys.argv[1:6]
    require(mode in ['--preflight', '--forward', '--assert-resolved', '--assert-current-stopped',
                     '--assert-unleased-drain-allowed'])
    host = OriginalHost(base, environment)
    plan_file = Path(plan_name)
    deployment = os.environ.get('DEPLOYMENT_ID', '')
    release = os.environ.get('DEPLOYMENT_RELEASE_ID', '')
    require(re.fullmatch('[A-Za-z0-9_-]{8,128}', deployment) and re.fullmatch('[A-Za-z0-9_-]{8,128}', release))
    require(plan_file == host.root / '.deploy-state' / ('legacy-backend-drain-' + deployment + '.json'))
    intent = plan_file.with_suffix('.signal-intent.json')
    result_file = plan_file.with_suffix('.signal-result.json')
    deadline_file = plan_file.with_suffix('.observer-deadline.json')
    if mode == '--assert-unleased-drain-allowed':
        require(len(sys.argv) == 6)
        plan, _ = private(plan_file, 0o400)
        require(plan['format'] == FORMAT and plan['deploymentId'] == deployment
                and plan['releaseId'] == release and plan['snapshot']['container']['image'] == argument
                and plan['snapshot']['container']['kind'] == 'NATIVE_WRAPPER_NOT_REQUIRED',
                'LEGACY_SIGNAL_LEASE_REQUIRED_BEFORE_DRAIN')
        require_effect_receipt(plan)
        require(host.snapshot(argument) == plan['snapshot'],
                'LEGACY_SIGNAL_UNLEASED_RUNTIME_CHANGED')
        return
    if mode in ['--assert-resolved', '--assert-current-stopped']:
        require(len(sys.argv) == (7 if mode == '--assert-current-stopped' else 6))
        if intent.exists():
            plan, plan_sha = private(plan_file, 0o400)
            require_effect_receipt(plan)
            intent_value, _ = private(intent, 0o400)
            result, _ = private(result_file, 0o400)
            require(intent_value['planSha256'] == result['planSha256'] == plan_sha and result['passResult'] is True
                    and result.get('legacyContainerExitedCleanly') is True and result['interrupted'] is False
                    and result['manualStopBarrier']['manualStopPersisted'] is True
                    and result['manualStopBarrier']['dockerDaemon'] == plan['manualStopPreflight']['dockerDaemon']
                    and intent_value['dockerContAttemptPlanned'] is True
                    and result['dockerContAttempted'] is True
                    and result['signalPointCheckpoint']['manuallyStopped'] is True
                    and result['signalPointCheckpoint']['dockerDaemon'] == result['manualStopBarrier']['dockerDaemon']
                    and result['signalPointCheckpoint']['restartCount'] == result['manualStopBarrier']['restartCount']
                    and result['stoppedCheckpoint']['manuallyStopped'] is True
                    and result['stoppedCheckpoint']['restartCount'] == result['manualStopBarrier']['restartCount']
                    == result['exitObservation']['RestartCount']
                    and intent_value['deploymentId'] == result['deploymentId'] == plan['deploymentId'] == deployment
                    and intent_value['releaseId'] == result['releaseId'] == plan['releaseId'] == release
                    and intent_value['legacyExternalEffectRisk'] == result['legacyExternalEffectRisk'] == plan['legacyExternalEffectRisk']
                    and len(result['originalChildren']) > 0
                    and all(row['closed'] and row['code'] == 0 and not row['overflow'] and not row['pumpFailed'] and not row['deadlineExceeded'] and not row['deadlineAuditFailed'] for row in result['originalChildren']))
            # A later canonical Compose promotion can replace the stopped old
            # container. This is only an unresolved-attempt hold; historical
            # exit evidence never certifies the current runtime's closure.
            verify_exited(result['exitObservation'], plan['snapshot']['container'], b'0')
            if mode == '--assert-current-stopped':
                require(plan['snapshot']['container']['kind'] == 'KNOWN_LEGACY_SHELL')
                host.protected_boundary(plan, sys.argv[6],
                                        ('TRAFFIC_BLOCKED', 'SERVICES_DRAINED', 'REMOTE_CHECKPOINT_VERIFIED'))
                host.assert_current_stopped(plan, result)
        else:
            plan, _ = private(plan_file, 0o400)
            require(plan['format'] == FORMAT and plan['deploymentId'] == deployment
                    and plan['releaseId'] == release and plan['snapshot']['container']['image'] == argument
                    and plan['snapshot']['container']['kind'] == 'NATIVE_WRAPPER_NOT_REQUIRED',
                    'LEGACY_SIGNAL_CURRENT_STOP_UNPROVEN')
            require_effect_receipt(plan)
        return
    if mode == '--preflight':
        require(len(sys.argv) == 6 and re.fullmatch('sha256:[a-f0-9]{64}', argument))
        snapshot = host.snapshot(argument)
        manual_stop_preflight = None
        if snapshot['container']['kind'] == 'KNOWN_LEGACY_SHELL':
            daemon = host.daemon_identity()
            checkpoint = host.persisted_manual_stop(snapshot)
            require(checkpoint['manuallyStopped'] is False,
                    'LEGACY_SIGNAL_DOCKER_ALREADY_MANUALLY_STOPPED')
            manual_stop_preflight = dict(dockerDaemon=daemon, checkpoint=checkpoint)
        if snapshot['node']:
            require(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'LEGACY_SIGNAL_PIDFD_UNAVAILABLE')
            fd = os.pidfd_open(snapshot['node']['pid'], 0)
            try:
                require(proc_identity(snapshot['node']['pid']) == snapshot['node'])
            finally:
                os.close(fd)
        save(plan_file, dict(format=FORMAT, deploymentId=deployment, releaseId=release, snapshot=snapshot,
                             signalDelivered=False, productionMutation=False, originalChildren=original_child_facts(),
                             legacyExternalEffectRisk=legacy_effect_receipt(snapshot),
                             manualStopPreflight=manual_stop_preflight))
    else:
        require(len(sys.argv) == 7)
        plan, plan_sha = private(plan_file, 0o400)
        require(plan['format'] == FORMAT and plan['deploymentId'] == deployment and plan['releaseId'] == release
                and plan['signalDelivered'] is False and plan['productionMutation'] is False
                and argument == plan['snapshot']['container']['image'])
        require_effect_receipt(plan)
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
