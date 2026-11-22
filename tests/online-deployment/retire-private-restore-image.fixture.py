"""Retire one unreferenced DR working image with verified retrievable bytes.

No containers, archives, keys, volumes or foreign images are removed. This is
one-use diagnostic retirement, not general image GC or release admission.
"""
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
OPERATION = 'retire-private-restore-image-20261017'
IMAGE = 'sha256:15283455b75304c90f51bf16b42c272a25fb52807945dc24830ec88e63cd896d'


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def main():
    guard_file = QA / 'retire-private-restore-workspace-20261017.fixture.py'
    guard = load('image_retirement_guard', guard_file)
    assert guard.sha(guard_file) == 'a607550c21bf13f8d0e11c6f97ce29686a625d93f362e2949c0d16d78f5baf57'
    for directory in [QA, PRIVATE]:
        guard.assert_plain(directory)
    owner = load('image_retirement_owner', QA / 'physical-restore-r4.fixture.py')
    owner.STATUS = QA / (OPERATION + '-status.json')
    assert not owner.STATUS.exists(), 'OPERATION_ALREADY_STARTED'
    assert guard.sha(QA / 'native-process-owner') == '2c04343fd5befe7e4085811e73b4e441ac5a67c1b11614b5f8540c54efa933b2'
    fd = os.open(PRIVATE / 'drill-ownership.lock', os.O_RDWR | os.O_NOFOLLOW)
    if fd != 9:
        os.dup2(fd, 9); os.close(fd)
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    storage = open('/run/lock/sabalan-backup-storage.lock', 'a')
    fcntl.flock(storage, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for number in [signal.SIGINT, signal.SIGTERM, signal.SIGHUP]:
        signal.signal(number, owner.defer_cancellation)
    owner.state('VERIFYING_RETRIEVABLE_IMAGE_AND_CHECKPOINTS')
    foreign = owner.foreign()
    assert len(foreign) >= 11, 'FOREIGN_BASELINE_UNEXPECTED'
    retired = json.loads((QA / 'retire-private-restore-postgres-20261017-status.json').read_text())
    proof = json.loads((QA / 'retire-private-restore-postgres-20261017-proof.json').read_text())
    assert retired['phase'] == 'COMPLETE' and retired['removedContainer'] == '1330c530d388bafae86368805e1e6af5118da892f00724bc5d361b694ff0ebb6'
    assert proof['container']['image'] == IMAGE
    retained = []
    for point in proof['retainedPoints']:
        file = Path(point['path'])
        assert file.parent.parent == Path('/srv/sabalanerp-recovery/checkpoints')
        assert file.resolve(strict=True) == file and stat.S_ISREG(file.lstat().st_mode)
        metadata = Path(str(file) + '.json'); current = json.loads(metadata.read_text())
        assert current['restoreVerified'] and current['remoteVerified'] and current['lastDrill']['status'] == 'HEALTHY'
        assert current.get('active') is False and current.get('drillHold') is None and current.get('incidentHold') is None
        assert current.get('incidentOpen') in [None, False]
        assert current['checksum'] == point['sha256'] and guard.sha(file) == point['sha256']
        retained.append(dict(path=str(file), sha256=point['sha256'], metadataSha256=guard.sha(metadata)))
    assert len(retained) == 2
    archive = Path(proof['retainedImageArchive'])
    assert archive == Path('/srv/sabalanerp-recovery/checkpoints/images/6db61fe859b1274c0ba8b0253fd5f6c7bc96f6e3f46b3f868fde4fe44289e89f.docker.tar.gz')
    assert archive.resolve(strict=True) == archive and stat.S_ISREG(archive.lstat().st_mode)
    before_archive = archive.stat()
    assert guard.sha(archive) == 'ed56c3575e4d9641e8119613e2273b397850fbb9ae4636f33b6eca5e3549d862'
    [image] = json.loads(owner.output(['docker', 'image', 'inspect', IMAGE]))
    assert image['Id'] == IMAGE and not image.get('RepoTags') and not image.get('RepoDigests')
    seen, config, manifest = set(), None, None
    # Bounded streaming read-back only; never extract/import the large archive.
    with tarfile.open(archive, 'r|gz') as source:
        for member in source:
            assert len(seen) < 50000 and member.name not in seen, 'IMAGE_ARCHIVE_ENTRIES_UNPROVEN'
            seen.add(member.name)
            if member.name == 'manifest.json' or member.name in [IMAGE[7:] + '.json', 'blobs/sha256/' + IMAGE[7:]]:
                assert member.isfile() and 0 < member.size <= 8 * 1024 ** 2
                with source.extractfile(member) as stream:
                    data = stream.read(8 * 1024 ** 2 + 1)
                assert len(data) == member.size
                if member.name == 'manifest.json':
                    manifest = json.loads(data)
                else:
                    assert hashlib.sha256(data).hexdigest() == IMAGE[7:]
                    config = json.loads(data)
    assert config and manifest and config['rootfs']['diff_ids'] == image['RootFS']['Layers']
    roots = [entry for entry in manifest if entry['Config'] in [IMAGE[7:] + '.json', 'blobs/sha256/' + IMAGE[7:]]]
    assert len(roots) == 1 and len(roots[0]['Layers']) == len(image['RootFS']['Layers'])
    assert all(name in seen for name in roots[0]['Layers'])
    after_archive = archive.stat()
    assert (before_archive.st_dev, before_archive.st_ino, before_archive.st_size, before_archive.st_mtime_ns, before_archive.st_ctime_ns) == \
        (after_archive.st_dev, after_archive.st_ino, after_archive.st_size, after_archive.st_mtime_ns, after_archive.st_ctime_ns)
    encrypted = Path(proof['retainedEncryptedPhysicalComponent'])
    assert guard.sha(encrypted) == '466824218145462e32b7aa4f574fb0937e2060edb3c3aaecc60d75cf25ef2acd'
    ids = owner.output(['docker', 'ps', '-aq']).decode().split()
    containers = json.loads(owner.output(['docker', 'inspect', *ids]))
    assert all(container['Image'] != IMAGE for container in containers), 'IMAGE_STILL_REFERENCED'
    for point in retained:
        assert guard.sha(Path(point['path'] + '.json')) == point['metadataSha256']
    assert owner.foreign() == foreign, 'FOREIGN_BASELINE_CHANGED'
    before = shutil.disk_usage(PRIVATE).free
    owner.atomic(QA / (OPERATION + '-proof.json'), dict(phase='EXACT_UNREFERENCED_IMAGE_RETIREMENT', image=IMAGE,
        imageBytes=image['Size'], archive=str(archive), archiveSha256='ed56c3575e4d9641e8119613e2273b397850fbb9ae4636f33b6eca5e3549d862',
        archiveRoot=roots[0], retainedPoints=retained, foreignBaseline=foreign,
        retainedCreatedForensicContainer='0d42316060a78bc10368492ab6d66746a729b0d419dafbe646c33fcbd397e8ee'))
    owner.state('IMAGE_DELETE_INTENT', image=IMAGE)
    owner.mutate_host(['docker', 'image', 'rm', IMAGE], 60, OPERATION + '-remove')
    remaining = owner.output(['docker', 'image', 'ls', '--no-trunc', '--quiet']).decode().split()
    assert IMAGE not in remaining and owner.foreign() == foreign
    result = dict(phase='COMPLETE', removedImage=IMAGE, imageBytes=image['Size'], availableBeforeBytes=before,
        availableAfterBytes=shutil.disk_usage(PRIVATE).free, verifiedArchiveRootRetained=True,
        healthyCheckpointsRetained=2, encryptedPhysicalComponentRetained=True, foreignStableServicesUnchanged=True)
    owner.state(**result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
