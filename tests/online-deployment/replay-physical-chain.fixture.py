"""Confined independent PostgreSQL base/WAL replay; never a production publisher."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import tarfile
import time

QA = Path('/root/sabalan-recovery-private/native-qa')
PRIVATE = QA.parent
IMAGE = 'sha256:3d0f7584ed7d04e27fa050d6683a74746608faf21f202be78460d679cc56461f'
IMAGE_ARCHIVE_SHA = '4ac986e0e795da2700e014af9fd094f447204dc863856df94689732e15708ac7'
STATIC_OWNER_SHA = 'c2b096894f7bdf920881c668deca48b1b7afedc4267956ed31e1743ed3687d83'
mutation_started = False
native_closure_proven = False
native_owner = None


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as source:
        while chunk := source.read(262144): digest.update(chunk)
    return digest.hexdigest()


def sync(file):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def main(root):
    global mutation_started, native_closure_proven, native_owner
    assert os.getuid() == 0 and root.parent == QA and root.resolve(strict=True) == root
    assert re.fullmatch(r'physical-chain-[a-f0-9]{32}', root.name)
    assert root.stat().st_uid == 0 and not root.stat().st_mode & 0o077
    prepared_bytes = (root / 'independent-state.json').read_bytes(); prepared = json.loads(prepared_bytes)
    assert prepared['phase'] == 'PREPARED_PRIVATE' and prepared['productionRecoveryPoint'] is False
    operation = prepared['operation']; assert root.name == 'physical-chain-' + operation
    source = prepared['source']; assert source['operation'] == operation
    data, wal = root / 'data', root / 'recovered/wal'
    assert prepared['pgData'] == str(data) and prepared['wal'] == str(wal)
    assert data.resolve(strict=True) == data and data.stat().st_uid == 70 and not data.stat().st_mode & 0o077
    assert wal.resolve(strict=True) == wal and wal.stat().st_uid == 70 and not wal.stat().st_mode & 0o077
    assert not (data / 'recovery.signal').exists() and not (data / 'standby.signal').exists()
    assert (data / 'PG_VERSION').read_bytes() == b'15\n'
    assert source['source']['systemIdentifier'] == '7667464637415309346'
    assert re.fullmatch(r'sabalanerp_concurrency_[a-f0-9]{16}', source['databaseName'])
    assert re.fullmatch(r'[0-9A-F]{1,8}/[0-9A-F]{1,8}', source['committedLsn'])
    assert source['canonicalBeforeAndAfter'][3]['image'] == IMAGE
    source_owner = QA / 'native-owner-storage-final-20261017/owner'
    assert source_owner.resolve(strict=True) == source_owner and sha(source_owner) == STATIC_OWNER_SHA
    owner_source = QA / 'physical-restore-r4.fixture.py'
    assert owner_source.resolve(strict=True) == owner_source and owner_source.stat().st_uid == 0 and not owner_source.stat().st_mode & 0o022
    spec = importlib.util.spec_from_file_location('chain_native_host_owner', owner_source)
    owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
    native_owner = owner
    owner.STATUS = root / 'native-replay-state.json'; assert not owner.STATUS.exists()
    assert sha(QA / 'native-process-owner') == '2c04343fd5befe7e4085811e73b4e441ac5a67c1b11614b5f8540c54efa933b2'
    lock = os.open(PRIVATE / 'drill-ownership.lock', os.O_RDWR | os.O_NOFOLLOW)
    if lock != 9: os.dup2(lock, 9); os.close(lock)
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    storage = os.open('/run/lock/sabalan-backup-storage.lock', os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(storage, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]: signal.signal(number, owner.defer_cancellation)
    owner.state('VERIFYING_PRIVATE_IMAGE_AND_REASSEMBLY')
    foreign = owner.foreign(); assert len(foreign) >= 11
    archive = root / 'postgres-image.tar'
    assert archive.resolve(strict=True) == archive and stat.S_ISREG(archive.lstat().st_mode) and archive.stat().st_uid == 0
    assert archive.stat().st_nlink == 1 and not archive.stat().st_mode & 0o077 and archive.stat().st_size == 115880960
    assert sha(archive) == IMAGE_ARCHIVE_SHA; sync(archive)
    seen, manifest, config = set(), None, None
    with tarfile.open(archive, 'r|') as package:
        for member in package:
            assert len(seen) < 50000 and member.name not in seen; seen.add(member.name)
            if member.name == 'manifest.json' or member.name in [IMAGE[7:] + '.json', 'blobs/sha256/' + IMAGE[7:]]:
                assert member.isfile() and 0 < member.size <= 8 * 1024 ** 2
                payload = package.extractfile(member).read(8 * 1024 ** 2 + 1); assert len(payload) == member.size
                if member.name == 'manifest.json': manifest = json.loads(payload)
                else:
                    assert hashlib.sha256(payload).hexdigest() == IMAGE[7:]; config = json.loads(payload)
    assert manifest and len(manifest) == 1 and config
    assert manifest[0]['Config'] in [IMAGE[7:] + '.json', 'blobs/sha256/' + IMAGE[7:]] and not manifest[0]['RepoTags']
    assert all(file in seen for file in manifest[0]['Layers'])
    assert shutil.disk_usage(PRIVATE).free > 1024 ** 3 + 2 * archive.stat().st_size
    if IMAGE not in owner.output(['docker', 'image', 'ls', '--no-trunc', '--quiet']).decode().split():
        owner.state('PRIVATE_IMMUTABLE_IMAGE_LOAD_INTENT')
        mutation_started = True
        owner.mutate_host(['docker', 'load', '--input', str(archive)], 180, 'chain-' + operation + '-image-load')
    [image] = json.loads(owner.output(['docker', 'image', 'inspect', IMAGE]))
    assert image['Id'] == IMAGE and image['RootFS']['Layers'] == config['rootfs']['diff_ids']
    assert owner.foreign() == foreign
    binary = root / 'native-owner-static'; assert not binary.exists()
    shutil.copyfile(source_owner, binary); os.chmod(binary, 0o555); sync(binary); assert sha(binary) == STATIC_OWNER_SHA
    runner = root / 'verify.sh'
    with runner.open('x') as file:
        os.chmod(runner, 0o444); file.write('#!/bin/sh\nset -eu\npg_verifybackup /data\nexec pg_controldata /data\n'); file.flush(); os.fsync(file.fileno())
    verifier_name = 'physical-chain-' + operation + '-verify'
    pg_name = 'sabalanerp-backup-drill-postgres-1'
    for name in [verifier_name, pg_name]:
        assert not owner.output(['docker', 'ps', '-aq', '--filter', 'name=^/' + name + '$']).decode().strip()
    owner.state('PRIVATE_NATIVE_VERIFY_CREATE_INTENT')
    mutation_started = True
    create = ['docker', 'create', '--name', verifier_name, '--label', 'com.docker.compose.project=sabalanerp-backup-drill',
              '--label', 'com.docker.compose.service=postgres-verify', '--label', 'sabalan.drill.operation=' + operation,
              '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
              '--user', '70:70', '--memory', '256m', '--cpus', '0.5', '--pids-limit', '64', '--log-driver', 'json-file',
              '--log-opt', 'max-size=2m', '--log-opt', 'max-file=2', '--entrypoint', '/native-owner']
    for file, target in [(binary, '/native-owner'), (runner, '/verify.sh'), (data, '/data')]:
        create += ['--mount', 'type=bind,src=' + str(file) + ',dst=' + target + ',readonly']
    token = 'chain-' + operation + '-native-verify'
    owner.mutate_host(create + [IMAGE, '300', token, '/bin/sh', '/verify.sh'], 60, 'chain-' + operation + '-verify-create')
    [verifier] = json.loads(owner.output(['docker', 'inspect', verifier_name])); verifier_id = verifier['Id']
    assert verifier['Image'] == IMAGE and verifier['Config']['User'] == '70:70' and verifier['HostConfig']['NetworkMode'] == 'none'
    assert verifier['HostConfig']['ReadonlyRootfs'] and all(not row['RW'] for row in verifier['Mounts'])
    owner.mutate_host(['docker', 'start', '--attach', verifier_id], 360, 'chain-' + operation + '-verify-start')
    [verified] = json.loads(owner.output(['docker', 'inspect', verifier_id]))
    assert verified['State']['Status'] == 'exited' and verified['State']['Pid'] == 0 and verified['State']['ExitCode'] == 0
    text = owner.output(['docker', 'logs', verifier_id], stderr=subprocess.STDOUT).decode()
    assert 'backup successfully verified' in text and '\nSABALAN_NATIVE_REAPED ' + token + ' 0\n' in text
    assert re.search(r'Database system identifier:\s+' + source['source']['systemIdentifier'] + r'\s', text)
    settings = {}
    for label, key in [('max_connections', 'max_connections'), ('max_worker_processes', 'max_worker_processes'),
                       ('max_wal_senders', 'max_wal_senders'), ('max_prepared_xacts', 'max_prepared_transactions'),
                       ('max_locks_per_xact', 'max_locks_per_transaction')]:
        match = re.search(r'^' + label + r' setting:\s+(\d+)\s*$', text, re.MULTILINE)
        assert match and 0 <= int(match[1]) <= 1000; settings[key] = match[1]
    assert (root / 'independent-state.json').read_bytes() == prepared_bytes and owner.foreign() == foreign
    # Regression setup only, after verifying the untouched native base. These
    # harmless inherited hooks must remain disabled by command-line precedence.
    automatic = data / 'postgresql.auto.conf'
    assert automatic.resolve(strict=True) == automatic and automatic.is_file() and automatic.stat().st_nlink == 1
    original_automatic = automatic.read_bytes(); assert len(original_automatic) <= 65536
    original_file = root / 'original-postgresql.auto.conf'
    with original_file.open('xb') as file:
        os.chmod(original_file, 0o600); file.write(original_automatic); file.flush(); os.fsync(file.fileno())
    hook_markers = ['forbidden-archive-cleanup-marker', 'forbidden-recovery-end-marker']
    assert all(not (data / name).exists() for name in hook_markers)
    fd = os.open(automatic, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
    try:
        with os.fdopen(os.dup(fd), 'ab') as file:
            file.write(b"\narchive_cleanup_command = 'touch /var/lib/postgresql/data/forbidden-archive-cleanup-marker'\n"
                       b"recovery_end_command = 'touch /var/lib/postgresql/data/forbidden-recovery-end-marker'\n")
            file.flush(); os.fsync(file.fileno())
    finally: os.close(fd)
    signal_file = data / 'recovery.signal'
    with signal_file.open('x') as file:
        os.chmod(signal_file, 0o600); os.chown(signal_file, 70, 70); file.flush(); os.fsync(file.fileno())
    sync(data)
    configuration = root / 'restore.conf'
    with configuration.open('x') as file:
        os.chmod(configuration, 0o400); os.chown(configuration, 70, 70)
        file.write("data_directory='/var/lib/postgresql/data'\nhba_file='/var/lib/postgresql/data/pg_hba.conf'\n"
                   "ident_file='/var/lib/postgresql/data/pg_ident.conf'\nunix_socket_directories='/var/run/postgresql'\nshared_buffers='64MB'\n")
        file.flush(); os.fsync(file.fileno())
    arguments = ['-D', '/var/lib/postgresql/data', '-c', 'config_file=/restore.conf']
    safe = dict(settings, listen_addresses='', shared_preload_libraries='', session_preload_libraries='', local_preload_libraries='',
                primary_conninfo='', primary_slot_name='', archive_mode='off', archive_command='', archive_library='', ssl='off',
                archive_cleanup_command='', recovery_end_command='',
                logging_collector='off', log_destination='stderr', autovacuum='off', max_logical_replication_workers='0',
                restore_command='cp /wal/%f %p', recovery_target_lsn=source['committedLsn'], recovery_target_inclusive='true',
                recovery_target_action='promote', recovery_target_timeline=str(source['range']['timeline']))
    for key, value in safe.items(): arguments += ['-c', key + '=' + value]
    compose = root / 'compose-native-replay.json'
    definition = {'services': {'postgres': {'image': IMAGE, 'container_name': pg_name, 'entrypoint': ['/usr/local/bin/postgres'],
        'command': arguments, 'user': '70:70', 'network_mode': 'none', 'read_only': True, 'restart': 'no',
        'cap_drop': ['ALL'], 'security_opt': ['no-new-privileges'], 'mem_limit': '384m', 'cpus': 1, 'pids_limit': 128, 'shm_size': '64m',
        'tmpfs': ['/var/run/postgresql:uid=70,gid=70,mode=0700,size=16m,noexec,nosuid', '/tmp:mode=1777,size=32m,noexec,nosuid'],
        'volumes': [str(data) + ':/var/lib/postgresql/data:rw', str(wal) + ':/wal:ro', str(configuration) + ':/restore.conf:ro'],
        'labels': {'sabalan.drill.operation': operation},
        'logging': {'driver': 'json-file', 'options': {'max-size': '2m', 'max-file': '2'}}}}}
    owner.atomic(compose, definition); sync(root)
    assert shutil.disk_usage(PRIVATE).free >= 1024 ** 3 and not owner.cancellation_requested
    owner.state('PRIVATE_POSTGRES_REPLAY_START_INTENT')
    owner.mutate_host(['docker', 'compose', '-p', 'sabalanerp-backup-drill', '-f', str(compose), 'up',
                       '--no-build', '--pull', 'never', '--no-deps', '-d', 'postgres'], 180, 'chain-' + operation + '-pg-start')
    [pg] = json.loads(owner.output(['docker', 'inspect', pg_name])); pg_id = pg['Id']
    assert pg['Image'] == IMAGE and pg['Config']['Labels']['sabalan.drill.operation'] == operation
    assert pg['Config']['Labels']['com.docker.compose.project'] == 'sabalanerp-backup-drill'
    assert pg['HostConfig']['NetworkMode'] == 'none' and pg['HostConfig']['ReadonlyRootfs'] and not pg['HostConfig']['PortBindings']
    binds = [row for row in pg['Mounts'] if row['Type'] == 'bind']
    expected_mounts = {'/var/lib/postgresql/data': (str(data), True), '/wal': (str(wal), False), '/restore.conf': (str(configuration), False)}
    assert len(binds) == 3 and all(expected_mounts.get(row['Destination']) == (row['Source'], row['RW']) for row in binds)
    assert all(row['Type'] == 'bind' or row['Type'] == 'tmpfs' and row['Destination'] in ['/tmp', '/var/run/postgresql'] for row in pg['Mounts'])
    deadline = time.monotonic() + 300; recovered = None
    query = "SELECT json_build_object('inRecovery',pg_is_in_recovery(),'systemIdentifier',(pg_control_system()).system_identifier::text," \
            "'archiveCleanupCommand',current_setting('archive_cleanup_command'),'recoveryEndCommand',current_setting('recovery_end_command')," \
            "'amount',amount::text,'quantity',quantity::text,'id',id) FROM recovery_chain_probe WHERE id='retained'"
    while time.monotonic() < deadline:
        [current] = json.loads(owner.output(['docker', 'inspect', pg_id])); assert current['State']['Running'] and not current['State']['OOMKilled']
        assert shutil.disk_usage(PRIVATE).free >= 512 * 1024 ** 2
        result = subprocess.run(['docker', 'exec', pg_id, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d',
                                 source['databaseName'], '-c', query], capture_output=True, timeout=10)
        if result.returncode == 0:
            candidate = json.loads(result.stdout)
            if candidate['inRecovery'] is False: recovered = candidate; break
        time.sleep(1)
    assert recovered is not None
    assert recovered['systemIdentifier'] == source['source']['systemIdentifier']
    assert recovered['archiveCleanupCommand'] == recovered['recoveryEndCommand'] == ''
    assert all(not (data / name).exists() for name in hook_markers)
    assert {key: recovered[key] for key in ['id', 'amount', 'quantity']} == source['expected']
    owner.state('PRIVATE_POSTGRES_REPLAY_VERIFIED', containerId=pg_id, recovered=recovered)
    owner.mutate_host(['docker', 'stop', '--time', '-1', pg_id], 1800, 'chain-' + operation + '-pg-stop')
    [stopped] = json.loads(owner.output(['docker', 'inspect', pg_id]))
    assert stopped['State']['Status'] == 'exited' and not stopped['State']['Running'] and stopped['State']['Pid'] == 0
    assert stopped['State']['ExitCode'] == 0 and not stopped['State']['Dead']
    assert all(not (data / name).exists() for name in hook_markers)
    native_closure_proven = True
    assert owner.foreign() == foreign
    assert not owner.cancellation_requested
    result = dict(status='PRIVATE_BASE_WAL_REPLAY_VERIFIED', operation=operation, sourceProofSha256=prepared['sourceProofSha256'],
                  sealSha256=prepared['sealSha256'], source=source['source'], baseRange=source['baseRange'],
                  targetLsn=source['committedLsn'], recovered=recovered, nativeVerifyContainer=verifier_id,
                  stoppedReplayContainer=pg_id, nativePostgresStoppedNaturally=True, image=IMAGE,
                  imageArchiveSha256=IMAGE_ARCHIVE_SHA, foreignServicesUnchanged=True, foreignCount=len(foreign),
                  inheritedRecoveryHookMarkersNeverExecuted=True,
                  applicationCoherenceRequired=True, productionRecoveryPoint=False)
    owner.atomic(root / 'native-replay-proof.json', result); owner.state('COMPLETE', proof=result); print(json.dumps(result))


if __name__ == '__main__':
    import sys
    assert len(sys.argv) == 2
    try: main(Path(sys.argv[1]))
    except BaseException:
        if mutation_started and not native_closure_proven:
            try: native_owner.state('OWNERSHIP_HELD_UNPROVEN', step='private-chain-replay')
            except BaseException: pass
            while True: time.sleep(1)
        raise
