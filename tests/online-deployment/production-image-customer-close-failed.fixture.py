"""Exact closed-failed diagnostic reconciliation; no restart, cleanup or PASS."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import select
import signal
import stat
import subprocess
import sys
import time

if sys.flags.optimize:
    raise RuntimeError('ASSERTIONS_REQUIRED')
ORIGINAL = 'actual-image-customer-dd67e319494eb352c7fd8729eb5b3fa8'
QA = Path('/root/sabalan-recovery-private/native-qa')
ROOT = QA / ORIGINAL
ACTIVE = QA / 'actual-image-customer-active.json'
PID, START = 2309491, '133049743'
BOOT = 'ee1b3aa2-d239-4849-b926-200549c77829'
CONTROLLER = 'c4e92092dd34209d40a30d7c42fbc26c01ebf882b088b307f66de0e92104f014'
BACKEND = 'e522d2a12bd5119c373c7035858cea6fc2e0427eb08f1cd442605ebd354f632b'
POSTGRES = 'a71ae8fbc0e6a95b06436dd25478effec6236d45d86fb4bedc0dd4aee72e7e83'
DOCKER = ['docker', '--host', 'unix:///var/run/docker.sock']
LOCKS = [(Path('/root/sabalan-recovery-private/drill-ownership.lock'), (64513, 13050), 9),
         (Path('/run/lock/sabalan-backup-storage.lock'), (29, 6), 8)]

def require(condition, reason):
    if not condition:
        raise RuntimeError(reason)

def regular(path):
    value = path.lstat()
    require(path.resolve(strict=True) == path and stat.S_ISREG(value.st_mode) and value.st_nlink == 1, 'UNSAFE_FILE')
    return value

def digest(path):
    regular(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(path):
    regular(path)
    return json.loads(path.read_text())

def birth(pid):
    path = Path('/proc') / str(pid)
    try:
        return path.joinpath('stat').read_text().rsplit(') ', 1)[1].split()[19]
    except FileNotFoundError:
        return None

def save(path, value):
    data = (json.dumps(value, sort_keys=True, indent=2) + '\n').encode()
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    try:
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(data); stream.flush(); os.fsync(fd)
    finally:
        os.close(fd)
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)

def inspect(identifier):
    result = json.loads(subprocess.check_output([*DOCKER, 'inspect', identifier], text=True))
    require(len(result) == 1 and result[0]['Id'] == identifier, 'DAEMON_IDENTITY_CHANGED')
    return result[0]

def evidence():
    require(Path('/proc/sys/kernel/random/boot_id').read_text().strip() == BOOT, 'BOOT_CHANGED')
    require(digest(ROOT / 'controller.py') == CONTROLLER, 'ORIGINAL_CONTROLLER_CHANGED')
    manifest = read(ROOT / 'input-manifest.json')
    for name, item in manifest['files'].items():
        require('/' not in name and '\\' not in name and digest(ROOT / name) == item['sha256'], 'ORIGINAL_INPUT_CHANGED')
    statuses, native_hashes = {}, {}
    for start in ROOT.glob('*-native-start.json'):
        row = read(start)
        require(birth(row['pid']) != row['startTicks'], 'ORIGINAL_NATIVE_STILL_LIVE')
        token = start.name.removesuffix('-native-start.json')
        completion = read(ROOT / (token + '-native-completion.json'))
        log = ROOT / 'native-control' / (token + '.log')
        require(digest(log) == completion['outputSha256'], 'ORIGINAL_LOG_CHANGED')
        status = completion['status']
        require(log.read_bytes().endswith(('\nSABALAN_NATIVE_REAPED ' + token + ' ' + str(status) + '\n').encode()), 'ORIGINAL_REAPING_MISSING')
        statuses[token] = status
        native_hashes[token] = {'start':digest(start), 'completion':digest(ROOT / (token + '-native-completion.json')),
                                'output':completion['outputSha256']}
    require(statuses.get('run-backend') == 1 and statuses.get('sql-census') == 0 and statuses.get('stop-postgres') == 137,
            'ORIGINAL_TERMINAL_STATUSES_CHANGED')
    expected_statuses = {'stop-postgres':137, 'run-backend':1, 'baseline':0, 'sql-census':0,
                         'create-backend':0, 'create-postgres':0, 'start-postgres':0,
                         'private-infrastructure':0, 'rename-private-database':0,
                         'ready-0':2, 'ready-1':2, 'ready-2':2, 'ready-3':2, 'ready-4':1, 'ready-5':0}
    require(statuses == expected_statuses and len(list(ROOT.glob('*-native-completion.json'))) == len(statuses), 'ORIGINAL_NATIVE_SET_CHANGED')
    backend_log = (ROOT / 'native-control/run-backend.log').read_text()
    require('"actualImageCustomerClientsClosed":true' in backend_log and '\nSABALAN_NATIVE_REAPED inner-backend 1\n' in backend_log,
            'ORIGINAL_BACKEND_CLOSURE_MISSING')
    require((ROOT / 'native-control/sql-census.log').read_text().splitlines()[0] == '0:0', 'ORIGINAL_SQL_CENSUS_MISSING')
    containers = []
    for identifier, status, image, service in [
        (BACKEND, 1, 'sha256:13c89b392eb1903f55c1160f4f5f72a85d0ec57cd39476edff7928453516dde6', 'backend'),
        (POSTGRES, 0, 'sha256:15283455b75304c90f51bf16b42c272a25fb52807945dc24830ec88e63cd896d', 'postgres')]:
        row = inspect(identifier); state = row['State']
        require(row['Image'] == image and row['Config']['Labels']['sabalan.drill.operation'] == ORIGINAL
                and row['Config']['Labels']['com.docker.compose.service'] == service, 'ORIGINAL_CONTAINER_CHANGED')
        require(state['Status'] == 'exited' and state['ExitCode'] == status and state['Pid'] == 0
                and not state['OOMKilled'] and not row.get('ExecIDs'), 'ORIGINAL_DAEMON_NOT_CLOSED')
        require(read(ROOT / (service + '-container.json'))['id'] == identifier, 'ORIGINAL_CONTAINER_RECEIPT_CHANGED')
        containers.append({'id': identifier, 'status': status, 'image': image})
    logs = subprocess.run([*DOCKER, 'logs', POSTGRES], text=True, capture_output=True, check=True)
    pg_log = logs.stdout + logs.stderr
    require('received fast shutdown request' in pg_log and 'database system is shut down' in pg_log
            and '\nSABALAN_NATIVE_REAPED inner-postgres 0\n' in pg_log and not (ROOT / 'pgdata/postmaster.pid').exists(),
            'ORIGINAL_POSTGRES_SHUTDOWN_UNPROVEN')
    return {'nativeStatuses': statuses, 'nativeHashes':native_hashes, 'containers': containers, 'postgresLogSha256': hashlib.sha256(pg_log.encode()).hexdigest(),
            'pgControlSha256': digest(ROOT / 'pgdata/global/pg_control'), 'originalSqlCount': 0, 'originalPreparedCount': 0}

for name in ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']:
    os.environ.pop(name, None)
for directory in [QA, ROOT]:
    value = directory.lstat()
    require(directory.resolve(strict=True) == directory and stat.S_ISDIR(value.st_mode) and value.st_uid == 0
            and not value.st_mode & 0o022, 'PRIVATE_ROOT_CHANGED')
intent = read(ACTIVE)
require(intent['operation'] == ORIGINAL and intent['pid'] == PID and intent['startTicks'] == START
        and intent['bootId'] == BOOT and intent['controllerSha256'] == CONTROLLER and not intent['productionAdmission'], 'ORIGINAL_INTENT_CHANGED')
require(read(ROOT / 'ownership-held-unproven.json')['reason'] == 'NATIVE_DAEMON_COMMAND_FAILED', 'HOLD_REASON_CHANGED')
command = read(ROOT / 'docker-command-active.json')
require(command == {'token':'stop-postgres','arguments':[*DOCKER,'exec','--user','70:70',POSTGRES,'pg_ctl','-D',
        '/var/lib/postgresql/data','-m','fast','-w','-t','60','stop'],'phase':'ACTIVE'}, 'ORIGINAL_COMMAND_CHANGED')
require(birth(PID) == START, 'ORIGINAL_CONTROLLER_NOT_PRESENT')
require(hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal'), 'PIDFD_REQUIRED')
pidfd = os.pidfd_open(PID, 0)
require(birth(PID) == START, 'ORIGINAL_PID_REUSED')
for path, expected, descriptor in LOCKS:
    value = regular(path)
    require((value.st_dev, value.st_ino) == expected, 'ORIGINAL_LOCK_CHANGED')
    fd = Path('/proc') / str(PID) / 'fd' / str(descriptor)
    require((fd.stat().st_dev, fd.stat().st_ino) == expected, 'ORIGINAL_OWNER_LOCK_CHANGED')
    info = (Path('/proc') / str(PID) / 'fdinfo' / str(descriptor)).read_text()
    require('FLOCK' in info and 'WRITE' in info and str(PID) in info, 'ORIGINAL_FLOCK_UNPROVEN')
for thread in (Path('/proc') / str(PID) / 'task').iterdir():
    require(not (thread / 'children').read_text().strip(), 'CONTROLLER_HAS_CHILDREN')
for process in Path('/proc').iterdir():
    if not process.name.isdigit() or int(process.name) in [PID, os.getpid()]: continue
    try: cmd = (process / 'cmdline').read_bytes()
    except (FileNotFoundError, ProcessLookupError): continue
    require(str(ROOT).encode() not in cmd and ORIGINAL.encode() not in cmd, 'OPERATION_PROCESS_STILL_LIVE')
original = evidence()
if globals().get('EXECUTE_RECONCILIATION') is not True:
    print(json.dumps({'phase':'CLOSED_FAILED_RECONCILIATION_READY_READONLY','originalOperation':ORIGINAL,
                     'originalEvidence':original,'originalControllerStillHeld':True,'productionAdmission':False}))
    raise SystemExit(0)
proof = {'format':'sabalan-failed-component-closure/v1','phase':'FAILED_COMPONENT_CLOSED','originalOperation':ORIGINAL,
         'controllerPid':PID,'controllerStartTicks':START,'bootId':BOOT,'originalIntent':intent,'originalCommand':command,
         'originalEvidence':original,'backendExitCode':1,'stopClientExitCode':137,'productionAdmission':False,
         'healthyRecoveryPoint':False,'fullApplicationRestore':False,'dataAndContainersRetained':True}
save(ROOT / 'failed-component-closure-before-owner-retirement.json', proof)
# Only this exact idle orchestration process is signalled. Its original native
# descendants and both daemons have already been proved terminal independently.
descriptors = []
try:
    require(birth(PID) == START, 'ORIGINAL_CONTROLLER_CHANGED')
    signal.pidfd_send_signal(pidfd, signal.SIGTERM, None, 0)
    require(select.select([pidfd], [], [], 30)[0], 'CONTROLLER_EXIT_UNPROVEN')
    os.close(pidfd)
    for path, expected, target in LOCKS:
        descriptor = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
        value = os.fstat(descriptor)
        require((value.st_dev, value.st_ino) == expected, 'ORIGINAL_LOCK_CHANGED')
        saved = fcntl.fcntl(descriptor, fcntl.F_DUPFD_CLOEXEC, 20); os.close(descriptor)
        descriptors.append(saved)
        fcntl.flock(saved, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        fields = (Path('/proc') / str(PID) / 'stat').read_text().rsplit(') ', 1)[1].split()
        terminal = fields[19] != START or fields[0] == 'Z'
    except FileNotFoundError:
        terminal = True
    require(terminal and read(ACTIVE) == intent and read(ROOT / 'docker-command-active.json') == command, 'ORIGINAL_OWNER_CHANGED')
    require(evidence() == original, 'TERMINAL_EVIDENCE_CHANGED')
    save(ROOT / 'failed-component-closed.json', {**proof, 'controllerRetiredAfterClosure':True,'originalLocksReacquired':True})
    os.rename(ROOT / 'docker-command-active.json', ROOT / 'closed-failed-stop-postgres-command.json')
    os.rename(ACTIVE, ROOT / 'closed-failed-owner-intent.json')
    for directory in [ROOT, QA]:
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try: os.fsync(fd)
        finally: os.close(fd)
    print(json.dumps({'phase':'FAILED_COMPONENT_CLOSED','originalOperation':ORIGINAL,'backendExitCode':1,
                     'stopClientExitCode':137,'originalLocksReacquired':True,'dataAndContainersRetained':True,
                     'productionAdmission':False,'healthyRecoveryPoint':False}))
except BaseException:
    # Keep any reacquired ownership on an uncertain post-retirement outcome.
    while True: time.sleep(1)
