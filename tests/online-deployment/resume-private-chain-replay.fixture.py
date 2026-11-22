"""Resume the same isolated native restore after a proved file-mode failure.

No application/production admission. Failed-stage data, native verification,
actual controller/container identities and immutable WAL remain evidenced.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import shutil
import signal
import stat
import subprocess
import time
import traceback

ROOT = Path('/root/sabalan-recovery-private/native-qa/physical-chain-6808d4086c7fe0d25c3198aa647e7180')
QA = ROOT.parent
OPERATION = '6808d4086c7fe0d25c3198aa647e7180'
OLD_PG = '6288e24f5a2c8a451d767dc9e79f0d15048d5eff14b609799fa56219e306c0dc'
IMAGE = 'sha256:9b4593c6de443299b46098151fc1ec154c882339b77a56334c7ce612c8a7be6a'
CONTROLLER_SHA = 'f2bfac11fd10f3ba80d1e933922ca548377a300b702ac9eaf96bba8ce0b78153'
OWNER_PID = 858036
OWNER_START = '119094454'
BOOT = 'ee1b3aa2-d239-4849-b926-200549c77829'
owner = None
mutated = False
closed = False


def sha(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        while data := stream.read(262144): result.update(data)
    return result.hexdigest()


def load_module(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


def main():
    global owner, mutated, closed
    assert os.getuid() == 0 and ROOT.resolve(strict=True) == ROOT
    assert ROOT.stat().st_uid == 0 and not ROOT.stat().st_mode & 0o077
    old_source = ROOT / 'replay-physical-chain-v3.fixture.py'
    assert old_source.resolve(strict=True) == old_source and old_source.stat().st_mode & 0o777 == 0o400
    assert sha(old_source) == CONTROLLER_SHA
    original = load_module('private_original_chain_v3', old_source)
    assert sha(ROOT / 'postgres-image.tar') == original.IMAGE_ARCHIVE_SHA
    config, platform_manifest = original.immutable_image(ROOT / 'postgres-image.tar')
    prepared = json.loads((ROOT / 'independent-state.json').read_text())
    assert prepared['phase'] == 'PREPARED_PRIVATE' and prepared['productionRecoveryPoint'] is False
    assert prepared['operation'] == OPERATION and prepared['sealSha256'] == '2b5ad249a2b005974365b50eb063154ad95872d78acb5c563e14e0c71e274831'
    source = prepared['source']; assert source['committedLsn'] == 'C/62000120'
    held = json.loads((ROOT / 'native-replay-state-v3.json').read_text())
    birth = dict(pid=OWNER_PID, bootId=BOOT, pidNamespace='pid:[4026531836]', startTicks=OWNER_START)
    assert held['phase'] == 'OWNERSHIP_HELD_UNPROVEN' and held['ownerBirth'] == birth
    assert Path('/proc/sys/kernel/random/boot_id').read_text().strip() == BOOT
    owner = load_module('private_chain_resume_host_owner', QA / 'physical-restore-r4.fixture.py')
    owner.STATUS = ROOT / 'native-replay-state-v4.json'; assert not owner.STATUS.exists()
    initial_state = owner.state
    current_birth = dict(pid=os.getpid(), bootId=BOOT, pidNamespace=os.readlink('/proc/self/ns/pid'),
                         startTicks=Path('/proc/self/stat').read_text().rsplit(') ', 1)[1].split()[19])
    owner.state = lambda phase, **details: initial_state(phase, ownerBirth=current_birth, **details)
    assert sha(QA / 'native-process-owner') == '2c04343fd5befe7e4085811e73b4e441ac5a67c1b11614b5f8540c54efa933b2'
    foreign = owner.foreign(); prefix = 'chain-' + OPERATION + '-v3-'
    names = ['pg-start', 'verify-create', 'verify-start']
    assert sorted(p.name for p in QA.glob(prefix + '*-outcome.json')) == [prefix + name + '-outcome.json' for name in names]
    for name in names:
        token = prefix + name; outcome = json.loads((QA / (token + '-outcome.json')).read_text())
        receipt = '\nSABALAN_NATIVE_REAPED ' + token + ' 0\n'
        assert outcome['exitStatus'] == 0 and outcome['expectedReceipt'] == receipt and outcome['receiptTail'].endswith(receipt)
        assert sha(QA / (token + '.log')) == outcome['logSha256']
    [pg] = json.loads(owner.output(['docker', 'inspect', OLD_PG]))
    assert pg['Id'] == OLD_PG and pg['Image'] == IMAGE and pg['Config']['Labels']['sabalan.drill.operation'] == OPERATION
    assert pg['HostConfig']['NetworkMode'] == 'none' and pg['HostConfig']['ReadonlyRootfs'] and not pg['HostConfig']['PortBindings']
    state = pg['State']
    assert state['Status'] == 'exited' and not state['Running'] and state['Pid'] == 0 and state['ExitCode'] == 1
    assert not state['OOMKilled'] and not state['Dead'] and not pg['ExecIDs'] and not pg['NetworkSettings']['SandboxKey']
    pg_log = owner.output(['docker', 'logs', OLD_PG], stderr=subprocess.STDOUT).decode()
    assert 'could not open file "pg_wal/RECOVERYXLOG": Permission denied' in pg_log
    assert pg_log.rstrip().endswith('LOG:  database system is shut down')
    verifier_name = 'physical-chain-' + OPERATION + '-verify-v3'
    [verifier] = json.loads(owner.output(['docker', 'inspect', verifier_name]))
    assert verifier['Image'] == IMAGE and verifier['State']['Status'] == 'exited' and verifier['State']['Pid'] == 0
    assert verifier['State']['ExitCode'] == 0 and not verifier['ExecIDs'] and all(not row['RW'] for row in verifier['Mounts'])
    verify_log = owner.output(['docker', 'logs', verifier['Id']], stderr=subprocess.STDOUT).decode()
    assert 'backup successfully verified' in verify_log and '\nSABALAN_NATIVE_REAPED ' + prefix + 'native-verify 0\n' in verify_log
    assert set(owner.output(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'label=sabalan.drill.operation=' + OPERATION]).decode().split()) == {OLD_PG, verifier['Id']}
    [image] = json.loads(owner.output(['docker', 'image', 'inspect', IMAGE])); assert image['RootFS']['Layers'] == config['rootfs']['diff_ids']
    definition = json.loads((ROOT / 'compose-native-replay.json').read_text()); service = definition['services']['postgres']
    assert service['image'] == IMAGE and service['entrypoint'] == ['/usr/local/bin/postgres'] and service['command'] == pg['Config']['Cmd']
    assert service['command'].count('restore_command=cp /wal/%f %p') == 1
    assert 'recovery_target_lsn=' + source['committedLsn'] in service['command']
    assert 'archive_cleanup_command=' in service['command'] and 'recovery_end_command=' in service['command']
    data = ROOT / 'data'; wal = ROOT / 'recovered/wal'
    assert data.resolve(strict=True) == data and data.stat().st_uid == 70 and not data.stat().st_mode & 0o077
    assert (data / 'recovery.signal').is_file() and (data / 'backup_label').is_file() and not (data / 'postmaster.pid').exists()
    recovery = data / 'pg_wal/RECOVERYXLOG'; named = recovery.lstat()
    assert recovery.resolve(strict=True) == recovery and stat.S_ISREG(named.st_mode) and named.st_nlink == 1
    assert named.st_uid == 70 and named.st_mode & 0o777 == 0o400 and named.st_size == 16777216
    recovery_sha = sha(recovery)
    segment = [row for row in source['segments'] if row['name'] == '000000010000000C00000061']; assert len(segment) == 1
    assert recovery_sha == segment[0]['sha256'] == sha(wal / segment[0]['name'])
    pidfd = os.pidfd_open(OWNER_PID)
    try:
        proc = Path('/proc') / str(OWNER_PID)
        assert (proc / 'stat').read_text().rsplit(') ', 1)[1].split()[19] == OWNER_START
        assert os.readlink(proc / 'ns/pid') == birth['pidNamespace'] and str(old_source).encode() in (proc / 'cmdline').read_bytes().split(b'\0')
        assert not (proc / 'task' / str(OWNER_PID) / 'children').read_text().strip()
        lock_stat, inherited = (QA.parent / 'drill-ownership.lock').stat(), (proc / 'fd/9').stat()
        assert (lock_stat.st_dev, lock_stat.st_ino) == (inherited.st_dev, inherited.st_ino)
        assert 'FLOCK  ADVISORY  WRITE ' + str(OWNER_PID) + ' ' in (proc / 'fdinfo/9').read_text()
        closure = dict(phase='FAILED_PRIVATE_POSTGRES_NATURALLY_QUIESCENT', controllerBirth=birth, controllerSha256=CONTROLLER_SHA,
          postgres=OLD_PG, postgresExitStatus=1, nativeToolsReaped=True, nativeChildrenEmpty=True,
          nativeBaseVerificationPassed=True, productionRecoveryPoint=False)
        owner.atomic(ROOT / 'v3-private-failure-closure-proof.json', closure)
        owner.atomic(ROOT / 'v3-failed-postgres-private-inspection.json', pg)
        signal.pidfd_send_signal(pidfd, signal.SIGKILL)
        poll = select.poll(); poll.register(pidfd, select.POLLIN); assert poll.poll(10000)
    finally: os.close(pidfd)
    lock = os.open(QA.parent / 'drill-ownership.lock', os.O_RDWR | os.O_NOFOLLOW)
    if lock != 9: os.dup2(lock, 9); os.close(lock)
    assert (os.fstat(9).st_dev, os.fstat(9).st_ino) == (lock_stat.st_dev, lock_stat.st_ino)
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    storage = os.open('/run/lock/sabalan-backup-storage.lock', os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(storage, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]: signal.signal(number, owner.defer_cancellation)
    assert sha(recovery) == recovery_sha and (recovery.lstat().st_dev, recovery.lstat().st_ino) == (named.st_dev, named.st_ino)
    owner.state('PRIVATE_WAL_RESTORE_MODE_CORRECTION_INTENT', closure=closure)
    mutated = True
    fd = os.open(recovery, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    # A 0400 owner cannot open read-write; change only this exact, verified
    # derived WAL copy's mode before PostgreSQL retries it. Original WAL is RO.
    try:
        actual = os.fstat(fd); assert (actual.st_dev, actual.st_ino) == (named.st_dev, named.st_ino) and actual.st_nlink == 1
        os.fchmod(fd, 0o600); os.fsync(fd)
    finally: os.close(fd)
    directory = os.open(recovery.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(directory)
    finally: os.close(directory)
    assert recovery.stat().st_mode & 0o777 == 0o600 and sha(recovery) == recovery_sha
    service['command'] = ['restore_command=cp /wal/%f %p && chmod 600 %p' if value == 'restore_command=cp /wal/%f %p' else value
                          for value in service['command']]
    compose = ROOT / 'compose-native-replay-v4.json'; owner.atomic(compose, definition)
    owner.mutate_host(['docker', 'rm', OLD_PG], 60, 'chain-' + OPERATION + '-v4-retire-failed-pg')
    assert shutil.disk_usage(ROOT).free >= 1024 ** 3
    owner.mutate_host(['docker', 'compose', '-p', 'sabalanerp-backup-drill', '-f', str(compose), 'up', '--no-build',
                       '--pull', 'never', '--no-deps', '-d', 'postgres'], 180, 'chain-' + OPERATION + '-v4-pg-start')
    [running] = json.loads(owner.output(['docker', 'inspect', 'sabalanerp-backup-drill-postgres-1']))
    pg_id = running['Id']; assert running['Image'] == IMAGE and running['Config']['Cmd'] == service['command']
    assert running['HostConfig']['NetworkMode'] == 'none' and not running['HostConfig']['PortBindings'] and running['HostConfig']['ReadonlyRootfs']
    expected = {'/var/lib/postgresql/data': (str(data), True), '/wal': (str(wal), False), '/restore.conf': (str(ROOT / 'restore.conf'), False)}
    binds = [row for row in running['Mounts'] if row['Type'] == 'bind']
    assert len(binds) == 3 and all(expected.get(row['Destination']) == (row['Source'], row['RW']) for row in binds)
    assert all(row['Type'] == 'bind' or row['Type'] == 'tmpfs' and row['Destination'] in ['/tmp', '/var/run/postgresql'] for row in running['Mounts'])
    query = "SELECT json_build_object('inRecovery',pg_is_in_recovery(),'systemIdentifier',(pg_control_system()).system_identifier::text," \
      "'archiveCleanupCommand',current_setting('archive_cleanup_command'),'recoveryEndCommand',current_setting('recovery_end_command')," \
      "'amount',amount::text,'quantity',quantity::text,'id',id) FROM recovery_chain_probe WHERE id='retained'"
    deadline = time.monotonic() + 300; recovered = None
    while time.monotonic() < deadline:
        [current] = json.loads(owner.output(['docker', 'inspect', pg_id])); assert current['State']['Running'] and not current['State']['OOMKilled']
        result = subprocess.run(['docker', 'exec', pg_id, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres',
                                 '-d', source['databaseName'], '-c', query], capture_output=True, timeout=10)
        if result.returncode == 0:
            candidate = json.loads(result.stdout)
            if candidate['inRecovery'] is False: recovered = candidate; break
        assert shutil.disk_usage(ROOT).free >= 512 * 1024 ** 2; time.sleep(1)
    assert recovered is not None and recovered['systemIdentifier'] == source['source']['systemIdentifier']
    assert recovered['archiveCleanupCommand'] == recovered['recoveryEndCommand'] == ''
    assert {key: recovered[key] for key in ['id', 'amount', 'quantity']} == source['expected']
    markers = ['forbidden-archive-cleanup-marker', 'forbidden-recovery-end-marker']
    assert all(not (data / name).exists() for name in markers)
    owner.state('PRIVATE_POSTGRES_REPLAY_VERIFIED', recovered=recovered)
    owner.mutate_host(['docker', 'stop', '--time', '-1', pg_id], 1800, 'chain-' + OPERATION + '-v4-pg-stop')
    [stopped] = json.loads(owner.output(['docker', 'inspect', pg_id]))
    assert stopped['State']['Status'] == 'exited' and stopped['State']['Pid'] == 0 and stopped['State']['ExitCode'] == 0 and not stopped['ExecIDs']
    assert all(not (data / name).exists() for name in markers); closed = True
    assert owner.foreign() == foreign and not owner.cancellation_requested
    proof = dict(status='PRIVATE_BASE_WAL_REPLAY_VERIFIED', operation=OPERATION, sourceProofSha256=prepared['sourceProofSha256'],
      sealSha256=prepared['sealSha256'], source=source['source'], baseRange=source['baseRange'], targetLsn=source['committedLsn'],
      recovered=recovered, nativeVerifyContainer=verifier['Id'], stoppedReplayContainer=pg_id, nativePostgresStoppedNaturally=True,
      image=IMAGE, sourceImageIndex=original.SOURCE_IMAGE, selectedPlatformManifest=platform_manifest,
      imageArchiveSha256=original.IMAGE_ARCHIVE_SHA, inheritedRecoveryHookMarkersNeverExecuted=True,
      restoredWalModeCorrectionExercised=True, foreignServicesUnchanged=True, foreignCount=len(foreign),
      applicationCoherenceRequired=True, productionRecoveryPoint=False)
    owner.atomic(ROOT / 'native-replay-proof.json', proof); owner.state('COMPLETE', proof=proof); print(json.dumps(proof))


if __name__ == '__main__':
    try: main()
    except BaseException:
        if mutated and not closed:
            try: owner.atomic(ROOT / 'native-replay-failure-v4.json', dict(traceback=traceback.format_exc())); owner.state('OWNERSHIP_HELD_UNPROVEN')
            except BaseException: pass
            while True: time.sleep(1)
        raise
