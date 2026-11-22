"""Native-owned independent-host qualification; SPEC is prepended by the runner.

No public listener, image startup script, provider credentials or external
network is admitted. Any uncertain native/daemon outcome retains ownership and
the durable active marker. This is actual historical module acceptance only.
"""
import base64
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import resource
import shutil
import stat
import subprocess
import sys
import tarfile
import time

os.umask(0o077)
if sys.flags.optimize:
    raise RuntimeError('PYTHON_ASSERTIONS_REQUIRED')
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
for name in ['DOCKER_CONTEXT', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']:
    os.environ.pop(name, None)
DOCKER = ['docker', '--host', 'unix:///var/run/docker.sock']
private = Path('/root/sabalan-recovery-private')
qa = private / 'native-qa'
operation = SPEC['operation']
assert operation.startswith('actual-image-customer-') and len(operation) == len('actual-image-customer-') + 32
assert all(character in '0123456789abcdef' for character in operation[-32:])
root = qa / operation
active = qa / 'actual-image-customer-active.json'
mutated = closed = False
RESERVE = 1024**3
MIB = 1024**2
# This drill runs SQL-only historical modules, not Chromium or production
# startup. Account for BOTH enforced cgroup maxima, control processes and an
# independent host reserve before admitting either owned container.
MEMORY_BUDGET = {'postgresBytes': 384 * MIB, 'backendBytes': 256 * MIB,
                 'controllerBytes': 128 * MIB, 'hostReserveBytes': 512 * MIB}
PG = 'sha256:15283455b75304c90f51bf16b42c272a25fb52807945dc24830ec88e63cd896d'
BACKEND = 'sha256:13c89b392eb1903f55c1160f4f5f72a85d0ec57cd39476edff7928453516dde6'
OWNER_SHA = 'c2b096894f7bdf920881c668deca48b1b7afedc4267956ed31e1743ed3687d83'
BASE_SHA = 'c4b485ccc756ea48e08a72ea9c8dbdfd00aa9d1a892c63b0788985f699957c09'


def require(value, code):
    if not value:
        raise RuntimeError(code)


def sync(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write(path, data, mode=0o400):
    with path.open('xb') as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    sync(path.parent)


def save(path, value):
    write(path, json.dumps(value, indent=2).encode())


def regular(path):
    value = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISREG(value.st_mode) and value.st_nlink == 1
            and value.st_uid == 0 and not value.st_mode & 0o022, 'UNSAFE_PRIVATE_FILE')
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns


def digest(path):
    before = regular(path)
    result = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024**2):
            result.update(chunk)
    require(regular(path) == before, 'SOURCE_CHANGED')
    return result.hexdigest()


def docker(*args):
    return subprocess.check_output([*DOCKER, *args], text=True, stderr=subprocess.STDOUT)


def inspect(identifier):
    rows = json.loads(docker('inspect', identifier))
    require(len(rows) == 1 and rows[0]['Id'] == identifier, 'DAEMON_IDENTITY_CHANGED')
    return rows[0]


def foreign():
    identifiers = docker('ps', '-q').split()
    rows = json.loads(docker('inspect', *identifiers)) if identifiers else []
    return sorted([{'id': row['Id'], 'image': row['Image'], 'startedAt': row['State']['StartedAt']}
                   for row in rows if (row['Config'].get('Labels') or {}).get('com.docker.compose.project') != 'sabalanerp-backup-drill'], key=lambda row: row['id'])


def native(args, token, seconds=120, allow_failure=False):
    require(not (root / 'docker-command-active.json').exists(), 'UNRESOLVED_DAEMON_COMMAND')
    command = {'token': token, 'arguments': args, 'phase': 'ACTIVE'}
    save(root / 'docker-command-active.json', command)
    environment = dict(os.environ, SABALAN_NATIVE_STORAGE_ROOT=str(root / 'native-control'),
                       SABALAN_NATIVE_STORAGE_MAX_BYTES=str(32 * 1024**2), SABALAN_NATIVE_STORAGE_RESERVE_BYTES=str(RESERVE))
    child = subprocess.Popen([str(owner), str(seconds), token, *args], env=environment,
                             pass_fds=(9, 8), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    save(root / (token + '-native-start.json'), {'pid': child.pid, 'startTicks': Path('/proc/' + str(child.pid) + '/stat').read_text().rsplit(') ', 1)[1].split()[19]})
    output = bytearray()
    with (root / 'native-control' / (token + '.log')).open('xb') as log:
        while chunk := child.stdout.read(65536):
            require(len(output) + len(chunk) <= 4 * 1024**2, 'NATIVE_OUTPUT_BOUND')
            output.extend(chunk)
            log.write(chunk)
        status = child.wait()
        log.flush()
        os.fsync(log.fileno())
    require(output.endswith(('\nSABALAN_NATIVE_REAPED ' + token + ' ' + str(status) + '\n').encode()), 'NATIVE_CLOSURE_UNPROVEN')
    save(root / (token + '-native-completion.json'), {'status': status, 'outputSha256': hashlib.sha256(output).hexdigest()})
    require(status == 0 or allow_failure, 'NATIVE_DAEMON_COMMAND_FAILED')
    return bytes(output), status, command


def acknowledge(command):
    require(json.loads((root / 'docker-command-active.json').read_text()) == command, 'DAEMON_INTENT_CHANGED')
    os.rename(root / 'docker-command-active.json', root / (command['token'] + '-daemon-acknowledged.json'))
    sync(root)


def create(service, image, arguments, mounts):
    name = 'sabalan-customer-' + service + '-' + operation[-12:]
    args = [*DOCKER, 'create', '--name', name, '--label', 'com.docker.compose.project=sabalanerp-backup-drill',
            '--label', 'com.docker.compose.service=' + service, '--label', 'sabalan.drill.operation=' + operation,
            '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--cpus', '1', '--pids-limit', '128', '--log-opt', 'max-size=2m', '--log-opt', 'max-file=2', *arguments]
    for source, target, readonly in mounts:
        args += ['--mount', 'type=bind,src=' + str(source) + ',dst=' + target + (',readonly' if readonly else '')]
    output, _, command = native([*args, image, *(['900', 'inner-' + service, '/bin/sh', '/restore.sh'] if service == 'postgres'
                                               else ['120', 'inner-backend', 'node', '/qa-overlap.cjs'])], 'create-' + service)
    identifiers = [line for line in output.decode().splitlines() if len(line) == 64 and all(char in '0123456789abcdef' for char in line)]
    require(len(identifiers) == 1, 'CREATE_ACK_UNPROVEN')
    identifier = identifiers[0]
    row = inspect(identifier)
    expected = sorted([(str(source), target, not readonly) for source, target, readonly in mounts])
    actual = sorted([(item['Source'], item['Destination'], item['RW']) for item in row['Mounts'] if item['Type'] == 'bind'])
    require(row['Image'] == image and row['Config']['Labels']['sabalan.drill.operation'] == operation
            and row['HostConfig']['NetworkMode'] == 'none' and row['HostConfig']['ReadonlyRootfs']
            and row['HostConfig']['CapDrop'] == ['ALL'] and row['HostConfig']['SecurityOpt'] in [['no-new-privileges'], ['no-new-privileges:true']]
            and row['Config']['Entrypoint'] == ['/native-owner']
            and row['Config']['User'] == ('70:70' if service == 'postgres' else '0:0')
            and all(item['Type'] in ['bind', 'tmpfs'] for item in row['Mounts'])
            and not row['HostConfig']['PortBindings'] and actual == expected and row['State']['Status'] == 'created', 'CREATED_CONTAINER_UNPROVEN')
    memory_limit = MEMORY_BUDGET['postgresBytes' if service == 'postgres' else 'backendBytes']
    require(row['HostConfig']['Memory'] == memory_limit and row['HostConfig']['MemorySwap'] == memory_limit,
            'ENFORCED_DRILL_MEMORY_BUDGET_UNPROVEN')
    save(root / (service + '-container.json'), {'id': identifier, 'image': image, 'mounts': expected})
    acknowledge(command)
    return identifier


def execute_postgres(arguments, token, allow_failure=False):
    output, status, command = native([*DOCKER, 'exec', '--user', '70:70', pg, *arguments], token, allow_failure=allow_failure)
    require(inspect(pg)['State']['Running'], 'POSTGRES_DAEMON_NOT_RUNNING')
    acknowledge(command)
    return output.decode(), status


def observe_backend_memory_admission(identifier):
    """Charge remaining PG growth; never infer usage from its configured cap.

    This is bounded admission headroom, not an OS reservation against unrelated
    future host allocations. A missing/changed cgroup or counter fails closed.
    """
    row = inspect(identifier)
    require(row['Image'] == PG and row['State']['Running'] and row['State']['Pid'] > 1
            and row['HostConfig']['Memory'] == MEMORY_BUDGET['postgresBytes']
            and row['HostConfig']['MemorySwap'] == MEMORY_BUDGET['postgresBytes'],
            'MEMORY_OBSERVER_ORIGINAL_POSTGRES_UNPROVEN')
    pid = row['State']['Pid']
    process = Path('/proc') / str(pid)
    birth = (process / 'stat').read_text().rsplit(') ', 1)[1].split()[19]
    membership = (process / 'cgroup').read_text()
    lines = membership.splitlines()
    require(len(lines) == 1 and lines[0].startswith('0::/'), 'UNIFIED_MEMORY_CGROUP_REQUIRED')
    relative = lines[0][3:].lstrip('/')
    require(relative and all(part not in ['', '.', '..'] for part in relative.split('/'))
            and relative.split('/')[-1] in [identifier, 'docker-' + identifier + '.scope'],
            'ORIGINAL_POSTGRES_CGROUP_PATH_UNPROVEN')
    directory = Path('/sys/fs/cgroup') / relative
    require(directory.resolve(strict=True) == directory, 'MEMORY_CGROUP_ALIAS')
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        initial = os.fstat(fd)
        require(initial.st_uid == 0 and stat.S_ISDIR(initial.st_mode), 'MEMORY_CGROUP_OWNER_UNPROVEN')

        def counter_file(name):
            descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            try:
                value = os.fstat(descriptor)
                require(stat.S_ISREG(value.st_mode) and value.st_dev == initial.st_dev
                        and value.st_uid == 0 and not value.st_mode & 0o022, 'MEMORY_COUNTER_UNSAFE')
                raw = os.read(descriptor, 65537)
                require(len(raw) <= 65536 and not os.read(descriptor, 1),
                        'MEMORY_COUNTER_UNPROVEN')
                named = os.stat(name, dir_fd=fd, follow_symlinks=False)
                require((named.st_dev, named.st_ino) == (value.st_dev, value.st_ino), 'MEMORY_COUNTER_CHANGED')
                return raw
            finally:
                os.close(descriptor)

        def counter(name):
            raw = counter_file(name)
            require(raw.strip().isdigit(), 'MEMORY_NUMERIC_COUNTER_REQUIRED')
            return int(raw.strip())

        def usage():
            total = counter('memory.current')
            pairs = [line.split() for line in counter_file('memory.stat').decode('ascii').splitlines()]
            require(all(len(pair) == 2 and pair[1].isdigit() for pair in pairs)
                    and len({pair[0] for pair in pairs}) == len(pairs), 'MEMORY_STAT_UNPROVEN')
            values = {name: int(value) for name, value in pairs}
            require('anon' in values and 'shmem' in values, 'MEMORY_STAT_REQUIRED_FIELDS_MISSING')
            # memory.current includes reclaimable file cache also counted by
            # host MemAvailable. Credit only anon+shmem with swap disabled;
            # never double-credit ordinary file cache as reserved headroom.
            # https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html
            credited = values['anon'] + values['shmem']
            require(0 <= credited <= total <= MEMORY_BUDGET['postgresBytes'], 'MEMORY_STAT_CHANGED')
            return total, credited

        def available():
            values = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
            return int(values['MemAvailable'].strip().split()[0]) * 1024

        available_before = available()
        require(counter('memory.max') == MEMORY_BUDGET['postgresBytes'] and counter('memory.swap.max') == 0,
                'POSTGRES_MEMORY_LIMIT_CHANGED')
        usage_before, credited_before = usage()
        available_middle = available()
        usage_after, credited_after = usage()
        available_after = available()
        require(counter('memory.max') == MEMORY_BUDGET['postgresBytes'] and counter('memory.swap.max') == 0
                and 0 <= usage_before <= MEMORY_BUDGET['postgresBytes']
                and 0 <= usage_after <= MEMORY_BUDGET['postgresBytes'], 'POSTGRES_MEMORY_COUNTER_CHANGED')
        current = os.fstat(fd)
        named = directory.lstat()
        require((current.st_dev, current.st_ino, current.st_uid) == (initial.st_dev, initial.st_ino, initial.st_uid)
                == (named.st_dev, named.st_ino, named.st_uid)
                and (process / 'cgroup').read_text() == membership
                and (process / 'stat').read_text().rsplit(') ', 1)[1].split()[19] == birth,
                'POSTGRES_MEMORY_IDENTITY_CHANGED')
        actual = inspect(identifier)
        require(actual['Image'] == PG and actual['State']['Running'] and actual['State']['Pid'] == pid
                and actual['State']['StartedAt'] == row['State']['StartedAt']
                and actual['HostConfig']['Memory'] == MEMORY_BUDGET['postgresBytes']
                and actual['HostConfig']['MemorySwap'] == MEMORY_BUDGET['postgresBytes'],
                'POSTGRES_MEMORY_DAEMON_IDENTITY_CHANGED')
        growth = MEMORY_BUDGET['postgresBytes'] - min(credited_before, credited_after)
        required = sum(value for key, value in MEMORY_BUDGET.items() if key != 'postgresBytes') + growth
        free = min(available_before, available_middle, available_after)
        return {'originalContainerId': identifier, 'hostPid': pid, 'startTicks': birth,
                'cgroupDevice': initial.st_dev, 'cgroupInode': initial.st_ino,
                'usageBeforeBytes': usage_before, 'usageAfterBytes': usage_after,
                'creditedAnonAndShmemBeforeBytes': credited_before,
                'creditedAnonAndShmemAfterBytes': credited_after,
                'ordinaryFileCacheCredited': False,
                'remainingPostgresGrowthBytes': growth, 'requiredAvailableBytes': required,
                'observedMinimumAvailableBytes': free, 'admitted': free >= required}
    finally:
        os.close(fd)


try:
    manifest_bytes = base64.b64decode(SPEC['inputManifest']['base64'], validate=True)
    require(hashlib.sha256(manifest_bytes).hexdigest() == SPEC['inputManifest']['sha256'], 'INPUT_MANIFEST_CHANGED')
    manifest = json.loads(manifest_bytes)
    require(manifest['format'] == 'sabalan-actual-image-customer-input/v1' and manifest['productionAdmission'] is False
            and manifest['controller']['sha256'] == SPEC['controller']['sha256'], 'INPUT_MANIFEST_UNPROVEN')
    require(set(manifest['files']) == set(SPEC['files']) and all(manifest['files'][name]['sha256'] == item['sha256']
            for name, item in SPEC['files'].items()), 'EXECUTED_FILE_IDENTITY_UNPROVEN')
    preflight_bytes = base64.b64decode(SPEC['preflight']['base64'], validate=True)
    require(hashlib.sha256(preflight_bytes).hexdigest() == SPEC['preflight']['sha256'], 'PREFLIGHT_CHANGED')
    preflight = json.loads(preflight_bytes)
    checked = json.loads(preflight['stdout'])
    age = (datetime.datetime.now(datetime.timezone.utc) - datetime.datetime.fromisoformat(preflight['observedAt'])).total_seconds()
    require(preflight['sshExitCode'] == 0 and checked['exitCode'] == 0 and checked['lockHeldThroughBothHostPreflight']
            and checked['productionCommitBefore'] == checked['productionCommitAfter'] == 'a2c75f1027a069e91837ff433e1c91cdc7746798'
            and 0 <= age <= 600, 'FRESH_BOTH_HOST_PREFLIGHT_REQUIRED')
    for path, mask in [(private, 0o077), (qa, 0o022)]:
        value = path.lstat()
        require(path.resolve(strict=True) == path and stat.S_ISDIR(value.st_mode) and value.st_uid == 0
                and not value.st_mode & mask, 'UNSAFE_PRIVATE_ROOT')
    descriptors = []
    for path, expected, target in [(private / 'drill-ownership.lock', (64513, 13050), 9),
                                   (Path('/run/lock/sabalan-backup-storage.lock'), (29, 6), 8)]:
        require(regular(path)[:2] == expected, 'ORIGINAL_LOCK_CHANGED')
        descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
        require((os.fstat(descriptor).st_dev, os.fstat(descriptor).st_ino) == expected, 'LOCK_CHANGED')
        descriptors.append((fcntl.fcntl(descriptor, fcntl.F_DUPFD_CLOEXEC, 20), target))
        os.close(descriptor)
    for descriptor, target in descriptors:
        os.dup2(descriptor, target, inheritable=True)
        fcntl.flock(target, fcntl.LOCK_EX | fcntl.LOCK_NB)
    require(not root.exists() and not any(path for directory in [private, qa] for path in directory.glob('*active*.json')), 'ACTIVE_OWNER_REQUIRES_INSPECTION')
    require(not docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=sabalanerp-backup-drill').strip(), 'UNKNOWN_DRILL_CONTAINER')
    owner = qa / 'native-owner-storage-final-20261017/owner'
    require(digest(owner) == OWNER_SHA, 'NATIVE_OWNER_CHANGED')
    base = qa / 'production-base-restore-dbfc6b6eca9741469ae3076756b165a8/base.tar'
    require(regular(base)[2] == 378808320 and digest(base) == BASE_SHA, 'SOURCE_BASE_CHANGED')
    require(json.loads((base.parent / 'independent-decryption-proof.json').read_text())['independentRsaDecryptVerified'], 'INDEPENDENT_DECRYPTION_UNPROVEN')
    daemon_info = json.loads(docker('info', '--format', '{{json .}}'))
    require(str(daemon_info['CgroupVersion']) == '2', 'UNIFIED_MEMORY_CGROUP_REQUIRED')
    docker_root = Path(daemon_info['DockerRootDir'])
    require(docker_root.resolve(strict=True) == docker_root and docker_root.stat().st_dev == qa.stat().st_dev, 'DAEMON_FILESYSTEM_UNMONITORED')
    expanded = 0
    with tarfile.open(base, 'r|') as archive:
        seen = set()
        for entry in archive:
            name = entry.name.removeprefix('./').rstrip('/')
            require(name and not name.startswith('/') and '\\' not in name and all(part not in ['', '.', '..'] for part in name.split('/'))
                    and name not in seen and (entry.isfile() or entry.isdir()), 'UNSAFE_BASE_MEMBER')
            seen.add(name)
            expanded += entry.size
            require(expanded < 1024**3 and len(seen) < 250000, 'SOURCE_BASE_BOUND')
    require(shutil.disk_usage(qa).free >= RESERVE + 378808320 + expanded + 160 * 1024**2, 'DERIVED_RESTORE_CAPACITY_INSUFFICIENT')
    source_member_count = len(seen)
    memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    memory_before = int(memory['MemAvailable'].strip().split()[0]) * 1024
    require(memory_before >= sum(MEMORY_BUDGET.values()), 'RESTORE_MEMORY_INSUFFICIENT')
    for image in [PG, BACKEND]:
        require(inspect(image)['Id'] == image, 'IMMUTABLE_IMAGE_MISSING')
    before = foreign()
    root.mkdir(mode=0o700)
    sync(qa)
    intent = {'operation': operation, 'root': str(root), 'pid': os.getpid(), 'startTicks': Path('/proc/self/stat').read_text().rsplit(') ', 1)[1].split()[19],
              'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip(), 'phase': 'ACTUAL_IMAGE_PRIVATE_FINANCIAL_OVERLAP',
              'sourceBaseSha256': BASE_SHA, 'controllerSha256': SPEC['controller']['sha256'], 'productionAdmission': False}
    save(active, intent)
    mutated = True
    write(root / 'input-manifest.json', manifest_bytes)
    write(root / 'both-host-preflight.json', preflight_bytes)
    controller = base64.b64decode(SPEC['controller']['base64'], validate=True)
    require(len(controller) <= 128 * 1024 and hashlib.sha256(controller).hexdigest() == SPEC['controller']['sha256'], 'CONTROLLER_SOURCE_CHANGED')
    write(root / 'controller.py', controller, 0o444)
    require(set(SPEC['files']) == {'qa-fixture.cjs', 'qa-overlap.cjs', 'qa-financial.sql', 'qa-infrastructure.sql',
                                  'restore.sh', 'retire.py', 'closed_process_references.py', 'mount_guard.py'}, 'UNSUPPORTED_SOURCE_SET')
    total = 0
    for name, item in SPEC['files'].items():
        data = base64.b64decode(item['base64'], validate=True)
        total += len(data)
        require(total <= 16 * 1024**2 and hashlib.sha256(data).hexdigest() == item['sha256'], 'SOURCE_BYTES_CHANGED')
        write(root / name, data, 0o444)
    guard_spec = importlib.util.spec_from_file_location('closed_mount_guard', root / 'mount_guard.py')
    require(digest(root / 'mount_guard.py') == '165101a51ecc00db4b12ff65a5b2fe55f7037b4407ccdde5e799afa7bda54cd7', 'MOUNT_GUARD_CHANGED')
    guard = importlib.util.module_from_spec(guard_spec)
    guard_spec.loader.exec_module(guard)
    guard.isolate_mount_namespace()
    write(root / 'native-owner', owner.read_bytes(), 0o555)
    write(root / 'restore.conf', b'port=5432\nhot_standby=off\n', 0o444)
    write(root / 'restore.hba', b'local all all trust\n', 0o444)
    write(root / 'restore.ident', b'', 0o444)
    for name, uid, gid, mode in [('native-control', 0, 0, 0o700), ('pgdata', 70, 70, 0o700), ('pg-control', 70, 70, 0o700),
                                 ('socket', 70, 70, 0o770), ('backend-control', 0, 0, 0o700)]:
        path = root / name
        path.mkdir(mode=mode)
        os.chown(path, uid, gid)
        os.chmod(path, mode)
    copied = root / 'restore-input.tar'
    original = regular(base)
    checksum = hashlib.sha256()
    with base.open('rb') as source, copied.open('xb') as destination:
        os.fchmod(destination.fileno(), 0o400)
        os.fchown(destination.fileno(), 70, 70)
        while chunk := source.read(1024**2):
            require(shutil.disk_usage(root).free >= RESERVE + len(chunk), 'COPY_STORAGE_FLOOR')
            destination.write(chunk)
            checksum.update(chunk)
        destination.flush()
        os.fsync(destination.fileno())
    require(checksum.hexdigest() == BASE_SHA and regular(base) == original, 'BASE_COPY_CHANGED')
    derived = {name: [os.lstat(root / name).st_dev, os.lstat(root / name).st_ino] for name in ['pgdata', 'restore-input.tar']}
    save(root / 'derived-identities-before-daemon.json', derived)
    pg_mounts = [(root / 'pgdata', '/var/lib/postgresql/data', False), (root / 'pg-control', '/qa-pg-control', False),
                 (root / 'socket', '/qa-pg-socket', False),
                 (copied, '/restore-input.tar', True), *[(root / name, '/' + name, True) for name in ['native-owner', 'restore.sh', 'restore.conf', 'restore.hba', 'restore.ident', 'qa-infrastructure.sql']]]
    memory = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    require(int(memory['MemAvailable'].strip().split()[0]) * 1024 >= sum(MEMORY_BUDGET.values()),
            'RESTORE_MEMORY_CHANGED_BEFORE_CONTAINER_START')
    require(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024 <= MEMORY_BUDGET['controllerBytes'],
            'RESTORE_CONTROLLER_MEMORY_BUDGET_EXCEEDED')
    pg = create('postgres', PG, ['--user', '70:70', '--memory', str(MEMORY_BUDGET['postgresBytes']),
                '--memory-swap', str(MEMORY_BUDGET['postgresBytes']), '--shm-size', '64m',
                '--tmpfs', '/tmp:uid=70,gid=70,mode=0700,size=32m,noexec,nosuid', '--entrypoint', '/native-owner',
                # Monitor the stable control root on the SAME filesystem. A
                # recursive scan racing normal PostgreSQL rollback/unlink would
                # mistake a disappearing owned relation file for owner failure.
                # The filesystem floor still covers actual data allocation;
                # preflight includes base copy, parsed expansion and WAL margin.
                '--env', 'SABALAN_NATIVE_STORAGE_ROOT=/qa-pg-control', '--env', 'SABALAN_NATIVE_STORAGE_MAX_BYTES=16777216',
                '--env', 'SABALAN_NATIVE_STORAGE_RESERVE_BYTES=1073741824'], pg_mounts)
    _, _, command = native([*DOCKER, 'start', pg], 'start-postgres')
    require(inspect(pg)['State']['Running'], 'POSTGRES_START_ACK_UNPROVEN')
    acknowledge(command)
    for attempt in range(120):
        _, status = execute_postgres(['pg_isready', '-q', '-h', '/qa-pg-socket', '-U', 'sabalanerp', '-d', 'postgres'], 'ready-' + str(attempt), True)
        if status == 0:
            break
        require(status in [1, 2], 'READINESS_OUTCOME_UNPROVEN')
        time.sleep(1)
    else:
        raise RuntimeError('PRIVATE_POSTGRES_NOT_READY')
    database = 'qa_customer_expansion_' + operation[-32:]
    psql = ['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '/qa-pg-socket', '-U', 'sabalanerp']
    baseline, _ = execute_postgres([*psql, '-d', 'sabalanerp', '-c', "SELECT system_identifier::text||':'||current_setting('server_version_num')||':'||pg_is_in_recovery()::text FROM pg_control_system()"], 'baseline')
    require(baseline.splitlines()[0] == '7609810350852628513:150016:false', 'RESTORED_CLUSTER_UNPROVEN')
    execute_postgres([*psql, '-d', 'postgres', '-c', 'ALTER DATABASE sabalanerp RENAME TO ' + database], 'rename-private-database')
    execute_postgres([*psql, '-d', database, '-f', '/qa-infrastructure.sql'], 'private-infrastructure')
    application_name = 'actual-image-customer-' + operation[-16:]
    url = 'postgresql://sabalanerp@localhost/' + database + '?host=%2Fqa-pg-socket&connection_limit=2&pool_timeout=5&application_name=' + application_name
    backend_mounts = [(root / 'socket', '/qa-pg-socket', False), (root / 'backend-control', '/qa-native-control', False),
                      *[(root / name, '/' + name, True) for name in ['native-owner', 'qa-fixture.cjs', 'qa-overlap.cjs', 'qa-financial.sql']]]
    backend_memory_observation = observe_backend_memory_admission(pg)
    save(root / 'backend-memory-admission.json', backend_memory_observation)
    memory_before_backend = backend_memory_observation['observedMinimumAvailableBytes']
    require(backend_memory_observation['admitted'], 'BACKEND_MEMORY_INSUFFICIENT')
    # Match the actual historical runtime UID. Its graph package manifest is
    # root-owned0600; UID1000 is not a qualification of that unchanged image.
    # Networknone, readonly root, ALL capabilities dropped and no-new-privileges
    # remain required; no image permissions or production files are changed.
    backend = create('backend', BACKEND, ['--user', '0:0', '--group-add', '70',
                     '--memory', str(MEMORY_BUDGET['backendBytes']), '--memory-swap', str(MEMORY_BUDGET['backendBytes']),
                     '--tmpfs', '/tmp:uid=0,gid=0,mode=0700,size=64m,noexec,nosuid', '--entrypoint', '/native-owner',
                     '--env', 'NODE_ENV=test', '--env', 'NODE_OPTIONS=--max-old-space-size=128',
                     '--env', 'NODE_PATH=/app/node_modules:/packages/contract-product-graph/node_modules',
                     '--env', 'DATABASE_URL=' + url, '--env', 'SABALAN_PRODUCTION_IMAGE_CUSTOMER_OVERLAP=1',
                     '--env', 'SABALAN_NATIVE_STORAGE_ROOT=/qa-native-control', '--env', 'SABALAN_NATIVE_STORAGE_MAX_BYTES=16777216',
                     '--env', 'SABALAN_NATIVE_STORAGE_RESERVE_BYTES=1073741824'], backend_mounts)
    output, status, command = native([*DOCKER, 'start', '--attach', backend], 'run-backend', 180, True)
    state = inspect(backend)['State']
    require(state['Status'] == 'exited' and state['ExitCode'] == status and state['Pid'] == 0 and not state['OOMKilled'], 'BACKEND_DAEMON_CLOSURE_UNPROVEN')
    require(('\nSABALAN_NATIVE_REAPED inner-backend ' + str(status) + '\n').encode() in output
            and b'"actualImageCustomerClientsClosed":true' in output, 'BACKEND_INNER_CLOSURE_UNPROVEN')
    proofs = [json.loads(line) for line in output.decode().splitlines() if line.startswith('{"format":"sabalan-actual-image-customer-overlap/v1"')]
    require(len(proofs) == (1 if status == 0 else 0), 'ACTUAL_IMAGE_ACCEPTANCE_MISSING')
    if proofs:
        require(proofs[0]['actualImageModuleAcceptance'] and not proofs[0]['productionAdmission'], 'ACTUAL_IMAGE_ACCEPTANCE_MISSING')
    backend_status = status
    acknowledge(command)
    census, _ = execute_postgres([*psql, '-d', 'postgres', '-c', "SELECT (SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid())::text||':'||(SELECT count(*) FROM pg_prepared_xacts)::text"], 'sql-census')
    require(census.splitlines()[0] == '0:0', 'ORIGINAL_SQL_CLOSURE_UNPROVEN')
    # Ordinary PostgreSQL shutdown is requested only after actual app/SQL closure.
    output, stop_status, command = native([*DOCKER, 'exec', '--user', '70:70', pg, 'pg_ctl', '-D', '/var/lib/postgresql/data', '-m', 'fast', '-w', '-t', '60', 'stop'], 'stop-postgres', 90, True)
    # The daemon can complete clean shutdown while pg_ctl's waiting exec still
    # belongs to its cgroup. A reaped client137 is not daemon completion. Prove
    # the exact original daemon and inner owner independently before ack.
    for _ in range(100):
        state = inspect(pg)['State']
        if state['Status'] == 'exited':
            break
        time.sleep(0.1)
    row = inspect(pg)
    state = row['State']
    require(state['Status'] == 'exited' and state['ExitCode'] == 0 and state['Pid'] == 0
            and not state['OOMKilled'] and not row.get('ExecIDs'), 'POSTGRES_DAEMON_CLOSURE_UNPROVEN')
    pg_logs = docker('logs', pg)
    require('SABALAN_NATIVE_REAPED inner-postgres 0' in pg_logs and 'database system is shut down' in pg_logs,
            'POSTGRES_INNER_CLOSURE_UNPROVEN')
    require(stop_status in [0, 137], 'POSTGRES_STOP_CLIENT_OUTCOME_UNPROVEN')
    require(not (root / 'pgdata/postmaster.pid').exists(), 'POSTMASTER_REMAINS')
    acknowledge(command)
    output, _, command = native([*DOCKER, 'wait', pg], 'wait-postgres', 120)
    state = inspect(pg)['State']
    require(state['Status'] == 'exited' and state['ExitCode'] == 0 and state['Pid'] == 0 and not state['OOMKilled'], 'POSTGRES_DAEMON_CLOSURE_UNPROVEN')
    require('SABALAN_NATIVE_REAPED inner-postgres 0' in docker('logs', pg), 'POSTGRES_INNER_CLOSURE_UNPROVEN')
    acknowledge(command)
    for service, identifier in [('backend', backend), ('postgres', pg)]:
        require(inspect(identifier)['State']['Status'] == 'exited', 'CONTAINER_NOT_CLOSED')
        _, _, command = native([*DOCKER, 'rm', identifier], 'retire-' + service)
        require(identifier not in docker('ps', '-aq', '--no-trunc').split(), 'CONTAINER_RETIREMENT_UNPROVEN')
        acknowledge(command)
    save(root / 'daemon-closure.json', {'backendClosed': True, 'postgresClosed': True, 'taggedSqlCount': 0,
         'preparedTransactionCount': 0, 'containersRemovedWithoutForce': True, 'derivedIdentities': derived})
    output, _, command = native(['python3', '-I', '-B', str(root / 'retire.py'), str(root)], 'retire-derived')
    retirements = [json.loads(line) for line in output.decode().splitlines() if line.startswith('{"exactDerivedPathsRetired":')]
    require(len(retirements) == 1 and retirements[0]['exactDerivedPathsRetired'] and not (root / 'pgdata').exists()
            and not copied.exists() and digest(base) == BASE_SHA, 'DERIVED_RETIREMENT_UNPROVEN')
    for image in [PG, BACKEND]:
        require(inspect(image)['Id'] == image, 'RECOVERY_IMAGE_NOT_RETAINED')
    acknowledge(command)
    after = foreign()
    result = {'format': 'sabalan-native-actual-image-customer-overlap/v1', 'operation': operation, 'root': str(root),
              'actualImageModuleAcceptance': proofs[0] if proofs else None, 'backendExitCode': backend_status,
              'postgresStopClientExitCode': stop_status,
              'backendImage': BACKEND, 'postgresImage': PG,
              'nativeDaemonAndSqlClosureVerified': True, 'derivedRetirement': retirements[0],
              'sourceHashes': {name: item['sha256'] for name, item in SPEC['files'].items()},
              'controllerSha256': SPEC['controller']['sha256'],
              'inputManifestSha256': SPEC['inputManifest']['sha256'], 'preflightSha256': SPEC['preflight']['sha256'],
              'foreignBefore': before, 'foreignAfter': after, 'allForeignIdentitiesUnchanged': before == after,
              'memoryAdmissionBudget': MEMORY_BUDGET, 'containerMemoryAndSwapLimitsVerified': True,
              'memAvailableBeforeBytes': memory_before,
              'memAvailableBeforeBackendBytes': memory_before_backend,
              'backendMemoryObservation': backend_memory_observation,
              'sourceBaseMemberCount': source_member_count,
              'controllerObservedMaxRssBytes': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
              'hostReserveIsAdmissionHeadroomNotReservation': True,
              'fullApplicationRestore': False, 'healthyRecoveryPoint': False, 'productionAdmission': False,
              'freeBytesAfter': shutil.disk_usage(qa).free}
    save(root / 'host-actual-image-customer-proof.json', result)
    require(json.loads(active.read_text()) == intent, 'ACTIVE_OWNER_CHANGED')
    os.rename(active, root / 'closed-owner-intent.json')
    sync(root)
    sync(qa)
    closed = True
    print(json.dumps(result))
    raise SystemExit(0 if backend_status == 0 and before == after else 1)
except BaseException as error:
    if mutated and not closed:
        try:
            save(root / 'ownership-held-unproven.json', {'phase': 'OWNERSHIP_HELD_UNPROVEN', 'operation': operation,
                 'errorType': type(error).__name__, 'reason': str(error)[:4000]})
        except BaseException:
            pass
        while True:
            time.sleep(1)
    raise
