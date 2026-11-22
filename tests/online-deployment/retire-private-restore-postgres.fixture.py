"""Retire the completed DR trial's exact disposable PostgreSQL working copy.

No recovery archive, image, key, forensic tool or foreign service is removed.
This one-use operator fixture is not generalized storage GC or release admission.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import stat

QA = Path('/root/sabalan-recovery-private/native-qa')
PRIVATE = QA.parent
ROOT = Path('/srv/sabalanerp-drill/20261014-independent')
OPERATION = 'retire-private-restore-postgres-20261017'
PG = '1330c530d388bafae86368805e1e6af5118da892f00724bc5d361b694ff0ebb6'
STARTED = '2026-10-15T10:45:34.664746783Z'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    guard_file = QA / 'retire-private-restore-workspace-20261017.fixture.py'
    guard = load('workspace_retirement', guard_file)
    assert guard.sha(guard_file) == 'a607550c21bf13f8d0e11c6f97ce29686a625d93f362e2949c0d16d78f5baf57'
    for directory in [QA, PRIVATE, ROOT]:
        guard.assert_plain(directory)
    guard.isolate_mount_namespace()
    owner = load('owned_drill', QA / 'physical-restore-r4.fixture.py')
    owner.STATUS = QA / (OPERATION + '-status.json')
    assert not owner.STATUS.exists(), 'OPERATION_ALREADY_STARTED'
    assert guard.sha(QA / 'native-process-owner') == '2c04343fd5befe7e4085811e73b4e441ac5a67c1b11614b5f8540c54efa933b2'
    descriptor = os.open(PRIVATE / 'drill-ownership.lock', os.O_RDWR | os.O_NOFOLLOW)
    if descriptor != 9:
        os.dup2(descriptor, 9)
        os.close(descriptor)
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    storage = open('/run/lock/sabalan-backup-storage.lock', 'a')
    fcntl.flock(storage, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for number in [signal.SIGINT, signal.SIGTERM, signal.SIGHUP]:
        signal.signal(number, owner.defer_cancellation)
    owner.state('VERIFYING_RETAINED_RECOVERY_BYTES')
    foreign = owner.foreign()
    assert len(foreign) == 11, 'FOREIGN_BASELINE_CHANGED'
    pg = owner.inspect(PG)
    owner.verify_pg(pg, ROOT / 'postgres')
    assert pg['HostConfig']['PidMode'] != 'host' and not pg['HostConfig']['Privileged']
    assert pg['State']['StartedAt'] == STARTED and pg['State']['Health']['Status'] == 'healthy'
    restore = json.loads((ROOT / 'evidence/inquiry-r24-full-proof.json').read_text())
    status = json.loads((ROOT / 'evidence/inquiry-r24-status.json').read_text())
    assert restore['status'] == 'HEALTHY' and status['phase'] == 'COMPLETED'
    assert restore['nativeInquiryStartup'] and restore['drill']['stagedPostgresRestore'] and restore['drill']['stagedSqliteIntegrity']
    previous = json.loads((QA / 'retire-private-restore-workspace-20261017-proof.json').read_text())
    assert previous['runningPostgresRetained'] == PG and len(previous['retainedPoints']) == 2
    retained = []
    for point in previous['retainedPoints']:
        archive = Path(point['path'])
        assert archive.parent.parent == Path('/srv/sabalanerp-recovery/checkpoints')
        assert archive.name == 'deploy-' + archive.parent.name + '.sabrec'
        assert archive.resolve(strict=True) == archive and stat.S_ISREG(archive.lstat().st_mode)
        metadata = Path(str(archive) + '.json')
        current = json.loads(metadata.read_text())
        assert current['restoreVerified'] and current['remoteVerified'] and current['lastDrill']['status'] == 'HEALTHY'
        assert current.get('active') is False and current.get('drillHold') is None and current.get('incidentHold') is None
        assert current.get('incidentOpen') in [None, False]
        assert current['checksum'] == point['sha256'] and guard.sha(archive) == point['sha256']
        retained.append({'path': str(archive), 'sha256': point['sha256'], 'metadataSha256': guard.sha(metadata)})
    image = Path(previous['retainedImageArchive'])
    encrypted = Path(previous['retainedEncryptedPhysicalComponent'])
    assert guard.sha(image) == 'ed56c3575e4d9641e8119613e2273b397850fbb9ae4636f33b6eca5e3549d862'
    assert guard.sha(encrypted) == '466824218145462e32b7aa4f574fb0937e2060edb3c3aaecc60d75cf25ef2acd'
    target = ROOT / 'postgres'
    guard.assert_plain(target, 70)
    guard.assert_no_nested_mounts(target)
    before = shutil.disk_usage(PRIVATE).free
    owner.atomic(QA / (OPERATION + '-proof.json'), {'phase': 'EXACT_WORKING_POSTGRES_RETIREMENT', 'container': {'id': PG, 'image': pg['Image'], 'startedAt': STARTED},
        'retainedPoints': retained, 'retainedImageArchive': str(image), 'retainedEncryptedPhysicalComponent': str(encrypted), 'target': str(target), 'foreignBaseline': foreign})
    owner.state('STOP_INTENT', container=PG)
    # Docker waits for this private server's actual graceful exit. There is no
    # kill deadline; the native owner retains the operation if closure is unknown.
    owner.mutate_host(['docker', 'stop', '--timeout=-1', PG], 120, OPERATION + '-stop')
    terminal = owner.inspect(PG)
    assert terminal['State']['StartedAt'] == STARTED
    assert terminal['State']['Status'] == 'exited' and terminal['State']['ExitCode'] == 0
    assert not terminal['State']['Running'] and terminal['State']['Pid'] == 0 and not terminal['State']['OOMKilled']
    owner.state('STOP_COMPLETE', container=PG)
    owner.mutate_host(['docker', 'rm', PG], 60, OPERATION + '-remove')
    all_ids = owner.output(['docker', 'ps', '-aq']).decode().split()
    remaining = json.loads(owner.output(['docker', 'inspect', *all_ids]))
    for container in remaining:
        for mount in container['Mounts']:
            source = Path(mount['Source'])
            assert target != source and target not in source.parents and source not in target.parents, 'WORKSPACE_STILL_REFERENCED'
    guard.assert_plain(target, 70)
    guard.assert_no_nested_mounts(target)
    files = 0
    logical_bytes = 0
    for file in target.rglob('*'):
        value = file.lstat()
        assert stat.S_ISDIR(value.st_mode) or stat.S_ISREG(value.st_mode), 'UNEXPECTED_WORKING_ENTRY'
        if stat.S_ISREG(value.st_mode):
            assert value.st_nlink == 1, 'SHARED_WORKING_INODE'
            files += 1
            logical_bytes += value.st_size
    for point in retained:
        assert guard.sha(Path(point['path'] + '.json')) == point['metadataSha256'], 'POINT_AUTHORITY_CHANGED'
    assert owner.foreign() == foreign, 'FOREIGN_BASELINE_CHANGED_DURING_RETIREMENT'
    owner.state('DELETE_INTENT', path=str(target), files=files, logicalBytes=logical_bytes)
    shutil.rmtree(target)
    parent = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)
    assert owner.foreign() == foreign, 'FOREIGN_BASELINE_CHANGED_DURING_CLEANUP'
    result = {'phase': 'COMPLETE', 'removedContainer': PG, 'removedWorkingPostgres': str(target), 'files': files, 'logicalBytes': logical_bytes,
        'availableBeforeBytes': before, 'availableAfterBytes': shutil.disk_usage(PRIVATE).free, 'healthyCheckpointsRetained': 2,
        'imageArchiveRetained': True, 'encryptedPhysicalComponentRetained': True, 'foreignStableServicesUnchanged': True}
    owner.state(**result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
