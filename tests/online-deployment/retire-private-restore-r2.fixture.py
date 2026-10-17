"""Retire the proven never-started R2 tool container/image; preserve its evidence."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import tarfile

QA = Path('/root/sabalan-recovery-private/native-qa')
PRIVATE = QA.parent
OPERATION = 'retire-private-restore-r2-20261017'
CONTAINER = '0d42316060a78bc10368492ab6d66746a729b0d419dafbe646c33fcbd397e8ee'
IMAGE = 'sha256:74321462a183ee36bf341c47c63eededd40af936d1f950796f8a0aa5b159316d'
ERROR = 'failed to create task for container: failed to initialize logging driver: compression cannot be enabled when max file count is 1'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def main():
    guard_file = QA / 'retire-private-restore-workspace-20261017.fixture.py'
    guard = load('r2_retirement_guard', guard_file)
    assert guard.sha(guard_file) == 'a607550c21bf13f8d0e11c6f97ce29686a625d93f362e2949c0d16d78f5baf57'
    owner = load('r2_retirement_owner', QA / 'physical-restore-r4.fixture.py')
    owner.STATUS = QA / (OPERATION + '-status.json')
    assert not owner.STATUS.exists(), 'OPERATION_ALREADY_STARTED'
    assert guard.sha(QA / 'native-process-owner') == '2c04343fd5befe7e4085811e73b4e441ac5a67c1b11614b5f8540c54efa933b2'
    for directory in [QA, PRIVATE]: guard.assert_plain(directory)
    fd = os.open(PRIVATE / 'drill-ownership.lock', os.O_RDWR | os.O_NOFOLLOW)
    if fd != 9: os.dup2(fd, 9); os.close(fd)
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    storage = open('/run/lock/sabalan-backup-storage.lock', 'a')
    fcntl.flock(storage, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for number in [signal.SIGINT, signal.SIGTERM, signal.SIGHUP]: signal.signal(number, owner.defer_cancellation)
    owner.state('VERIFYING_NEVER_STARTED_FORENSICS_AND_RETRIEVABLE_IMAGE')
    foreign = owner.foreign(); assert len(foreign) >= 11

    def container():
        [row] = json.loads(owner.output(['docker', 'inspect', CONTAINER]))
        assert row['Id'] == CONTAINER and row['Image'] == IMAGE and row['Name'] == '/physical-restore-r2-20261015-business-before'
        state = row['State']
        assert state['Status'] == 'created' and not state['Running'] and state['Pid'] == 0 and state['ExitCode'] == 128
        assert state['StartedAt'] == state['FinishedAt'] == '0001-01-01T00:00:00Z' and state['Error'] == ERROR
        assert not state['Paused'] and not state['Restarting'] and not state['OOMKilled'] and not state['Dead']
        expected = {'/native-owner': str(QA / 'native-process-owner'),
                    '/app/physical-drill.cjs': str(QA / 'physical-component-drill.fixture.cjs'),
                    '/app/dist': '/srv/sabalanerp-drill/20261014-independent/code-r22-20261015/dist'}
        assert len(row['Mounts']) == len(expected)
        assert all(item['Type'] == 'bind' and item['RW'] is False and expected.get(item['Destination']) == item['Source'] for item in row['Mounts'])
        assert not row.get('ExecIDs') and not row['NetworkSettings'].get('SandboxID')
        return row

    original = container()
    # Preserve complete private inspection bytes (including configuration), not
    # just a public PASS field, before retiring the unusable Docker reference.
    owner.atomic(QA / (OPERATION + '-private-inspection.json'), original)
    r4 = json.loads((QA / 'physical-restore-r4-proof.json').read_text())
    assert r4['status'] == 'PRIVATE_PHYSICAL_RESTORE_VERIFIED' and r4['originalDataPreserved'] is True
    assert r4['foreignStableServicesUnchanged'] is True and r4['baseline'] == r4['restored'] == r4['returnedBusiness']
    archived = json.loads((QA / 'retire-private-restore-image-20261017-proof.json').read_text())
    points = []
    for point in archived['retainedPoints']:
        file = Path(point['path']); sidecar = Path(str(file) + '.json')
        assert file.parent.parent == Path('/srv/sabalanerp-recovery/checkpoints')
        assert file.resolve(strict=True) == file and stat.S_ISREG(file.lstat().st_mode)
        metadata = json.loads(sidecar.read_text())
        assert metadata['restoreVerified'] and metadata['remoteVerified'] and metadata['lastDrill']['status'] == 'HEALTHY'
        assert metadata.get('active') is False and metadata.get('drillHold') is None and metadata.get('incidentHold') is None
        assert metadata.get('incidentOpen') in [None, False]
        assert metadata['checksum'] == point['sha256'] and guard.sha(file) == point['sha256']
        points.append(dict(path=str(file), sha256=point['sha256'], metadataSha256=guard.sha(sidecar)))
    assert len(points) == 2
    archive = Path(archived['archive'])
    assert archive == Path('/srv/sabalanerp-recovery/checkpoints/images/6db61fe859b1274c0ba8b0253fd5f6c7bc96f6e3f46b3f868fde4fe44289e89f.docker.tar.gz')
    assert archive.resolve(strict=True) == archive and stat.S_ISREG(archive.lstat().st_mode)
    prior = archive.stat(); assert guard.sha(archive) == 'ed56c3575e4d9641e8119613e2273b397850fbb9ae4636f33b6eca5e3549d862'
    [image] = json.loads(owner.output(['docker', 'image', 'inspect', IMAGE]))
    assert image['Id'] == IMAGE and not image.get('RepoTags') and not image.get('RepoDigests')
    seen, manifest, config = set(), None, None
    with tarfile.open(archive, 'r|gz') as source:
        for member in source:
            assert len(seen) < 50000 and member.name not in seen
            seen.add(member.name)
            if member.name == 'manifest.json' or member.name in [IMAGE[7:] + '.json', 'blobs/sha256/' + IMAGE[7:]]:
                assert member.isfile() and 0 < member.size <= 8 * 1024 ** 2
                data = source.extractfile(member).read(8 * 1024 ** 2 + 1); assert len(data) == member.size
                if member.name == 'manifest.json': manifest = json.loads(data)
                else:
                    assert hashlib.sha256(data).hexdigest() == IMAGE[7:]; config = json.loads(data)
    assert config and manifest and config['rootfs']['diff_ids'] == image['RootFS']['Layers']
    roots = [row for row in manifest if row['Config'] in [IMAGE[7:] + '.json', 'blobs/sha256/' + IMAGE[7:]]]
    assert len(roots) == 1 and len(roots[0]['Layers']) == len(image['RootFS']['Layers']) and all(name in seen for name in roots[0]['Layers'])
    after = archive.stat()
    assert (prior.st_dev, prior.st_ino, prior.st_size, prior.st_mtime_ns, prior.st_ctime_ns) == \
        (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
    for point in points: assert guard.sha(Path(point['path'] + '.json')) == point['metadataSha256']
    ids = owner.output(['docker', 'ps', '-aq']).decode().split(); containers = json.loads(owner.output(['docker', 'inspect', *ids]))
    assert [row['Id'] for row in containers if row['Image'] == IMAGE] == [CONTAINER]
    assert container() == original and owner.foreign() == foreign
    proof = dict(container=CONTAINER, image=IMAGE, imageBytes=image['Size'], neverStarted=True, allMountsReadOnly=True,
                 privateInspection=str(QA / (OPERATION + '-private-inspection.json')), healthyPoints=points,
                 archive=str(archive), archiveRoot=roots[0],
                 archiveSha256='ed56c3575e4d9641e8119613e2273b397850fbb9ae4636f33b6eca5e3549d862', foreignBaseline=foreign)
    owner.atomic(QA / (OPERATION + '-proof.json'), proof)
    before = shutil.disk_usage(PRIVATE).free
    owner.state('EXACT_NEVER_STARTED_CONTAINER_DELETE_INTENT', container=CONTAINER)
    owner.mutate_host(['docker', 'rm', CONTAINER], 60, OPERATION + '-container-remove')
    assert CONTAINER not in owner.output(['docker', 'ps', '-aq', '--no-trunc']).decode().split()
    ids = owner.output(['docker', 'ps', '-aq']).decode().split(); containers = json.loads(owner.output(['docker', 'inspect', *ids]))
    assert all(row['Image'] != IMAGE for row in containers) and owner.foreign() == foreign
    for point in points: assert guard.sha(Path(point['path'] + '.json')) == point['metadataSha256']
    owner.state('EXACT_UNREFERENCED_IMAGE_DELETE_INTENT', image=IMAGE)
    owner.mutate_host(['docker', 'image', 'rm', IMAGE], 60, OPERATION + '-image-remove')
    assert IMAGE not in owner.output(['docker', 'image', 'ls', '--no-trunc', '--quiet']).decode().split()
    assert owner.foreign() == foreign
    result = dict(phase='COMPLETE', removedContainer=CONTAINER, removedImage=IMAGE, imageBytes=image['Size'],
                  availableBeforeBytes=before, availableAfterBytes=shutil.disk_usage(PRIVATE).free,
                  inspectionAndOriginalFailureEvidenceRetained=True, retrievableExactImageRetained=True,
                  healthyCheckpointsRetained=2, foreignStableServicesUnchanged=True)
    owner.state(**result); print(json.dumps(result))


if __name__ == '__main__': main()
