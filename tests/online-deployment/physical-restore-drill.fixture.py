"""Confined backup-host DR rehearsal. Never targets a production database.

The existing isolated DR PostgreSQL service is temporarily pointed at decrypted
physical bytes, verified, then returned to its untouched original private data.
No extra PostgreSQL daemon, public port, application server or foreign mutation.
"""
import datetime
import fcntl
import hashlib
import json
import os
import resource
from pathlib import Path
import subprocess
import signal
import tarfile
import time
import re
from urllib.parse import urlparse

PRIVATE = Path('/root/sabalan-recovery-private')
QA = PRIVATE / 'native-qa'
ROOT = Path('/srv/sabalanerp-drill/20261014-independent')
COMPONENT = PRIVATE / 'physical-base-components/physical-base-r2-20261015'
ATTEMPT = os.environ.get('PRIVATE_DRILL_ATTEMPT', '3')
assert re.fullmatch(r'[3-9][0-9]?', ATTEMPT)
RESTORED = ROOT / ('physical-restored-r' + ATTEMPT + '-20261015')
STATUS = QA / ('physical-restore-r' + ATTEMPT + '-status.json')
OVERLAY = ROOT / ('compose-physical-r' + ATTEMPT + '.yml')
REPLAY = PRIVATE / ('physical-replay-r' + ATTEMPT + '-20261015')
PG_IMAGE = 'sha256:15283455b75304c90f51bf16b42c272a25fb52807945dc24830ec88e63cd896d'
APP_IMAGE = 'sha256:74321462a183ee36bf341c47c63eededd40af936d1f950796f8a0aa5b159316d'
CAPTURE_CONTAINER = 'c3059c1493fa3b1a931d8166389893be60fc22374a85a3b12214fd519d4f26aa'
SOURCE_CONTAINER = os.environ.get('PRIVATE_DRILL_SOURCE_CONTAINER', CAPTURE_CONTAINER)
assert re.fullmatch(r'[a-f0-9]{64}', SOURCE_CONTAINER)
OPERATION = 'physical-restore-r' + ATTEMPT + '-20261015'
COMPOSE = ['docker', 'compose', '--env-file', str(ROOT / 'drill.env'), '-f', str(ROOT / 'compose.yml'), '-f', str(ROOT / 'compose-r24.yml')]


def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()


def atomic(file, value):
    temporary = file.with_suffix('.pending')
    with temporary.open('x') as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, file)
    descriptor = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY)
    os.fsync(descriptor)
    os.close(descriptor)


def state(phase, **details): atomic(STATUS, {'at': now(), 'phase': phase, **details})


def output(arguments, **kwargs): return subprocess.check_output(arguments, timeout=20, **kwargs)


def inspect(identity): return json.loads(output(['docker', 'inspect', identity]))[0]


def foreign():
    ids = output(['docker', 'ps', '-q']).decode().split()
    values = json.loads(output(['docker', 'inspect', *ids]))
    return {value['Id']: {'name': value['Name'], 'startedAt': value['State']['StartedAt']}
            for value in values if (value['Config'].get('Labels') or {}).get('com.docker.compose.project') == 'fintech-lab'}


def verify_pg(value, source, running=True):
    assert value['Image'] == PG_IMAGE and (value['State']['Running'] or not running)
    assert value['Config']['Labels'].get('com.docker.compose.project') == 'sabalanerp-backup-drill'
    assert value['Config']['Labels'].get('com.docker.compose.service') == 'postgres'
    assert all(not port for port in value['NetworkSettings']['Ports'].values())
    mounts = [item for item in value['Mounts'] if item['Destination'] == '/var/lib/postgresql/data']
    assert len(mounts) == 1 and mounts[0]['Source'] == str(source) and source.resolve() == source
    networks = json.loads(output(['docker', 'network', 'inspect', *value['NetworkSettings']['Networks']]))
    assert len(networks) == 1 and networks[0]['Internal']


def healthy(source):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        value = inspect('sabalanerp-backup-drill-postgres-1')
        verify_pg(value, source)
        if value['State'].get('Health', {}).get('Status') == 'healthy': return value
        time.sleep(1)
    raise RuntimeError('PRIVATE_DRILL_HEALTH_TIMEOUT')


tool_number = 0
tools = []
cancellation_requested = False


def defer_cancellation(_number, _frame):
    global cancellation_requested
    cancellation_requested = True


def hold_unproven(step):
    try: state('OWNERSHIP_HELD_UNPROVEN', step=step)
    except Exception: pass
    while True: time.sleep(1)


def mutate_host(arguments, seconds, token):
    # A timed-out Compose client/plugin may still orchestrate the service.
    # The host subreaper owns that entire descendant tree. An unsuccessful or
    # missing completion receipt retains FD9; no competing return is started.
    path = QA / (token + '.log')
    with path.open('xb') as log:
        os.chmod(path, 0o600)
        process = subprocess.Popen([str(QA / 'native-process-owner'), str(seconds), token, *arguments],
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        proven = False
        try:
            tail = bytearray()
            stored = 0
            while chunk := process.stdout.read(65536):
                tail.extend(chunk)
                del tail[:-4096]
                remaining = max(0, 4 * 1024 ** 2 - stored)
                log.write(chunk[:remaining])
                stored += min(remaining, len(chunk))
            status = process.wait()
            receipt = ('\nSABALAN_NATIVE_REAPED ' + token + ' 0\n').encode()
            log.flush(); os.fsync(log.fileno())
            atomic(QA / (token + '-outcome.json'), {'exitStatus': status, 'receiptTail': tail.decode('utf8', errors='replace'),
                   'expectedReceipt': receipt.decode(), 'logSha256': hashlib.sha256(path.read_bytes()).hexdigest()})
            if status != 0 or not tail.endswith(receipt): hold_unproven(token)
            proven = True
            log.flush(); os.fsync(log.fileno())
        finally:
            if not proven: hold_unproven(token)


def tool(kind, image, arguments, mounts, network='none', database_url=None):
    global tool_number
    subprocess.run(COMPOSE + ['ps'], check=True, timeout=20)
    tool_number += 1
    name = OPERATION + '-' + kind
    assert subprocess.run(['docker', 'inspect', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20).returncode != 0
    command = ['docker', 'create', '--name', name, '--label', 'com.docker.compose.project=sabalanerp-backup-drill',
               '--label', 'com.docker.compose.service=physical-drill-tool', '--label', 'sabalan.drill.operation=' + OPERATION,
               '--network', network, '--user', '0:0', '--memory', '256m', '--cpus', '0.5', '--pids-limit', '64',
               '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
               '--log-driver', 'local', '--log-opt', 'max-size=2m', '--log-opt', 'max-file=2',
               '--tmpfs', '/tmp:rw,nosuid,size=32m', '--entrypoint', '/native-owner']
    for source, destination, readonly in [(QA / 'native-process-owner', '/native-owner', True), *mounts]:
        assert source.resolve(strict=True) == source
        command += ['--mount', 'type=bind,src=' + str(source) + ',dst=' + destination + (',readonly' if readonly else '')]
    environment = dict(os.environ)
    if database_url:
        command += ['--env', 'DATABASE_URL']
        environment['DATABASE_URL'] = database_url
    command += [image, '300', name, *arguments]
    identity = output(command, env=environment).decode().strip()
    initial = inspect(identity)
    assert initial['Image'] == image and initial['Name'] == '/' + name
    log_path = QA / (name + '.log')
    with log_path.open('x') as log:
        os.chmod(log_path, 0o600)
        # A Docker connection failure does not prove completion. Observe the
        # immutable container's terminal state before releasing host ownership.
        started = subprocess.run(['docker', 'start', '-a', identity], stdout=log, stderr=subprocess.STDOUT,
                                 preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (4 * 1024 ** 2, 4 * 1024 ** 2)))
    if started.returncode != 0:
        rejected = inspect(identity)['State']
        if (rejected['Status'] == 'created' and rejected['Pid'] == 0 and not rejected['Running']
                and rejected['StartedAt'].startswith('0001-') and rejected['FinishedAt'].startswith('0001-')
                and rejected['ExitCode'] == 128 and rejected['Error'] == 'failed to create task for container: failed to initialize logging driver: compression cannot be enabled when max file count is 1'):
            atomic(QA / (name + '-start-rejection.json'), {'phase': 'START_REJECTED_NOT_EXECUTED', 'containerId': identity, 'state': rejected})
            raise RuntimeError('PRIVATE_TOOL_LOGGING_START_REJECTED')
    while True:
        try:
            final = inspect(identity)
            if final['State']['Status'] == 'exited' and not final['State']['Running']: break
        except Exception: pass
        time.sleep(1)
    assert final['State']['Status'] == 'exited' and final['State']['ExitCode'] == 0
    text = log_path.read_text()
    assert '\nSABALAN_NATIVE_REAPED ' + name + ' 0\n' in text
    tools.append({'containerId': identity, 'kind': kind, 'image': image, 'exitCode': 0,
                  'logSha256': hashlib.sha256(log_path.read_bytes()).hexdigest()})
    lines = [line for line in text.splitlines() if line.startswith('{')]
    return json.loads(lines[-1]) if lines else {'nativeVerification': text.strip()}


def main():
    assert os.getuid() == 0 and not STATUS.exists() and not RESTORED.exists() and not OVERLAY.exists() and not REPLAY.exists()
    for number in [signal.SIGINT, signal.SIGTERM, signal.SIGHUP]: signal.signal(number, defer_cancellation)
    descriptor = os.open(PRIVATE / 'drill-ownership.lock', os.O_RDWR)
    if descriptor != 9: os.dup2(descriptor, 9); os.close(descriptor)
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    storage = open('/run/lock/sabalan-backup-storage.lock', 'a')
    fcntl.flock(storage, fcntl.LOCK_EX | fcntl.LOCK_NB)
    state('PREPARING')
    subprocess.run(COMPOSE + ['ps'], check=True, timeout=20)
    original = inspect(SOURCE_CONTAINER)
    verify_pg(original, ROOT / 'postgres')
    assert original['State']['Health']['Status'] == 'healthy'
    before_foreign = foreign()
    assert len(before_foreign) == 10
    configuration = json.loads(output(COMPOSE + ['config', '--format', 'json']))
    environment = configuration['services']['restore']['environment']
    database_url = environment['DATABASE_URL']
    parsed = urlparse(database_url)
    assert parsed.hostname == 'postgres' and parsed.path == '/sabalan_independent_drill'
    network = configuration['networks']['isolated']['name']
    assert network == 'sabalanerp-backup-drill_isolated'
    point = json.loads((COMPONENT / 'component.json').read_text())
    assert point['status'] == 'NATIVE_VERIFIED_PRIVATE_ONLY' and point['containerId'] == CAPTURE_CONTAINER
    system_identifier = output(['docker', 'exec', SOURCE_CONTAINER, 'psql', '-X', '-qAt', '-U', 'postgres',
                                '-d', 'sabalan_independent_drill', '-c', 'SELECT (pg_control_system()).system_identifier']).decode().strip()
    assert system_identifier == point['source']['systemIdentifier']
    digest = hashlib.sha256()
    with (COMPONENT / 'base.tar').open('rb') as stream:
        while chunk := stream.read(1024 * 1024): digest.update(chunk)
    assert digest.hexdigest() == point['archiveSha256']
    assert (ROOT / 'postgres').stat().st_uid == 70
    assert os.statvfs(PRIVATE).f_bavail * os.statvfs(PRIVATE).f_frsize > 4 * point['archiveBytes'] + 1024 ** 3
    fixture_mounts = [(QA / ('physical-component-drill-r' + ATTEMPT + '.fixture.cjs'), '/app/physical-drill.cjs', True),
                      (ROOT / 'code-r22-20261015/dist', '/app/dist', True)]
    state('BUSINESS_BASELINE')
    before = tool('business-before', APP_IMAGE, ['node', '/app/physical-drill.cjs', 'business'], fixture_mounts,
                  network=network, database_url=database_url)
    assert before == {'tables': 199, 'records': '16700', 'sha256': '553597e5c7fd65fbbd0369fe4ff3dcf3588f2be0e7b01d83db444190b45ff665'}
    state('ENCRYPTING_AND_AUTHENTICATING')
    REPLAY.mkdir(mode=0o700)
    encryption = tool('crypto', APP_IMAGE, ['node', '/app/physical-drill.cjs', 'crypto'], fixture_mounts + [
        (COMPONENT, '/source', True), (REPLAY, '/component', False),
        (PRIVATE / 'remote-recovery-private.pem', '/run/secrets/recovery-private.pem', True)])
    assert encryption['sourceSha256'] == point['archiveSha256'] and encryption['rsaRoundTrip'] and encryption['authenticatedCorruptionRejected']
    state('EXTRACTING')
    RESTORED.mkdir(mode=0o700)
    with tarfile.open(REPLAY / 'restored.tar', 'r:') as package:
        count = total = 0
        for item in package:
            assert os.statvfs(ROOT).f_bavail * os.statvfs(ROOT).f_frsize >= 1024 ** 3
            count += 1
            name = item.name.removeprefix('./').rstrip('/')
            assert name and not name.startswith('/') and '\\' not in name and all(part not in ['', '.', '..'] for part in name.split('/'))
            assert item.isdir() or item.isfile()
            total += item.size
            assert count <= 250000 and total <= point['archiveBytes']
            destination = RESTORED / name
            if item.isdir(): destination.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                with destination.open('xb') as out, package.extractfile(item) as source:
                    os.chmod(destination, 0o600)
                    while chunk := source.read(1024 * 1024): out.write(chunk)
                    out.flush(); os.fsync(out.fileno())
    # Verify as the root owner before assigning the private bytes to PostgreSQL.
    # The capability-dropped verifier must not need DAC permission bypasses.
    native = tool('verify', PG_IMAGE, ['pg_verifybackup', '/restore'], [(RESTORED, '/restore', True)])
    assert 'backup successfully verified' in native['nativeVerification']
    for directory, folders, files in os.walk(RESTORED, topdown=False):
        for file in files:
            target = Path(directory) / file
            os.chown(target, 70, 70)
            descriptor = os.open(target, os.O_RDONLY); os.fsync(descriptor); os.close(descriptor)
        os.chown(directory, 70, 70)
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY); os.fsync(descriptor); os.close(descriptor)
    descriptor = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY); os.fsync(descriptor); os.close(descriptor)
    overlay = {'services': {'postgres': {'volumes': [{'type': 'bind', 'source': str(RESTORED), 'target': '/var/lib/postgresql/data',
                                                   'bind': {'create_host_path': False}}]}}}
    atomic(OVERLAY, overlay)  # JSON is a valid Compose YAML document.
    physical_compose = COMPOSE + ['-f', str(OVERLAY)]
    merged = json.loads(output(physical_compose + ['config', '--format', 'json']))['services']['postgres']
    assert merged['image'] == PG_IMAGE and not merged.get('ports')
    assert [item['source'] for item in merged['volumes'] if item['target'] == '/var/lib/postgresql/data'] == [str(RESTORED)]
    assert not cancellation_requested
    switched = False
    try:
        switched = True  # Once the stop is attempted, always prove the return.
        state('STARTING_PRIVATE_PHYSICAL_RESTORE', baseline=before, encryption=encryption)
        verify_pg(inspect(SOURCE_CONTAINER), ROOT / 'postgres')
        mutate_host(['docker', 'stop', '--time', '60', SOURCE_CONTAINER], 90, OPERATION + '-stop-original')
        mutate_host(physical_compose + ['up', '-d', '--no-deps', '--pull', 'never', 'postgres'], 180, OPERATION + '-start-physical')
        physical = healthy(RESTORED)
        state('VERIFYING_RESTORED_BUSINESS', containerId=physical['Id'])
        after = tool('business-after', APP_IMAGE, ['node', '/app/physical-drill.cjs', 'business'], fixture_mounts,
                     network=network, database_url=database_url)
        assert after == before
    finally:
        if switched:
            try:
                state('RETURNING_ORIGINAL_PRIVATE_DR_CLUSTER')
                current = inspect('sabalanerp-backup-drill-postgres-1')
                sources = [item['Source'] for item in current['Mounts'] if item['Destination'] == '/var/lib/postgresql/data']
                assert len(sources) == 1 and sources[0] in [str(ROOT / 'postgres'), str(RESTORED)]
                verify_pg(current, Path(sources[0]), running=False)
                if current['State']['Running'] and sources[0] != str(ROOT / 'postgres'):
                    mutate_host(['docker', 'stop', '--time', '60', current['Id']], 90, OPERATION + '-stop-physical')
                mutate_host(COMPOSE + ['up', '-d', '--no-deps', '--pull', 'never', 'postgres'], 180, OPERATION + '-return-original')
                returned = healthy(ROOT / 'postgres')
            except BaseException:
                try: state('OWNERSHIP_HELD_PRIVATE_RETURN_UNPROVEN')
                except Exception: pass
                while True: time.sleep(1)
    returned_business = tool('business-returned', APP_IMAGE, ['node', '/app/physical-drill.cjs', 'business'], fixture_mounts,
                             network=network, database_url=database_url)
    assert returned_business == before
    assert foreign() == before_foreign
    result = {'status': 'PRIVATE_PHYSICAL_RESTORE_VERIFIED', 'completedAt': now(), 'baseline': before, 'restored': after,
              'component': point, 'encryption': encryption, 'native': native, 'tools': tools,
              'physicalContainerId': physical['Id'], 'returnedOriginalContainerId': returned['Id'],
              'originalDataPreserved': True, 'returnedBusiness': returned_business, 'foreignStableServicesUnchanged': True, 'productionRecoveryPoint': False}
    atomic(QA / ('physical-restore-r' + ATTEMPT + '-proof.json'), result)
    state('COMPLETED', proof=result)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        state('FAILED', failureClass=type(error).__name__)
        raise
