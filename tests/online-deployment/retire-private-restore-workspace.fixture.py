"""Retire exact completed diagnostic working copies, never recovery points.

This one-use fixture runs only on the already-provisioned independent drill
host. Its native process owner and successful restore receipts are prerequisites.
It neither generalizes production GC nor admits an online deployment.
"""
import fcntl
import ctypes
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import stat
import time

QA = Path('/root/sabalan-recovery-private/native-qa')
PRIVATE = QA.parent
ROOT = Path('/srv/sabalanerp-drill/20261014-independent')
CHECKPOINTS = Path('/srv/sabalanerp-recovery/checkpoints')
OPERATION = 'retire-private-restore-workspace-20261017'


def sha(file):
    started = time.monotonic()
    value = hashlib.sha256()
    with file.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            assert time.monotonic() - started < 600, 'READBACK_DEADLINE'
            value.update(chunk)
    return value.hexdigest()


def assert_plain(path, owner_uid=0):
    assert path.resolve(strict=True) == path, 'SYMLINK_ANCESTRY'
    value = path.lstat()
    assert value.st_uid == owner_uid and not stat.S_IMODE(value.st_mode) & 0o022
    assert stat.S_ISDIR(value.st_mode) or stat.S_ISREG(value.st_mode)


def isolate_mount_namespace():
    # A foreign host mount must not appear between mountinfo validation and
    # recursive deletion. Changes below affect this controller and its children
    # only; the host/Docker daemon namespace is unchanged.
    libc = ctypes.CDLL(None, use_errno=True)
    libc.unshare.argtypes = [ctypes.c_int]
    libc.unshare.restype = ctypes.c_int
    libc.mount.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_ulong, ctypes.c_void_p]
    libc.mount.restype = ctypes.c_int
    assert libc.unshare(0x00020000) == 0, ('PRIVATE_MOUNT_NAMESPACE_REQUIRED', ctypes.get_errno())
    assert libc.mount(None, b'/', None, (1 << 14) | (1 << 18), None) == 0, ('PRIVATE_MOUNT_PROPAGATION_REQUIRED', ctypes.get_errno())


def assert_no_nested_mounts(target):
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        encoded = line.split(' ')[4]
        mount = Path(re.sub(r'\\([0-7]{3})', lambda value: chr(int(value[1], 8)), encoded))
        assert mount != target and target not in mount.parents, 'HOST_MOUNT_WITHIN_WORKSPACE'


def main():
    for path in [QA, PRIVATE, ROOT]:
        assert_plain(path)
    transfer_uid = pwd.getpwnam('sabalan-backup').pw_uid
    assert transfer_uid != 0
    assert_plain(CHECKPOINTS, transfer_uid)
    isolate_mount_namespace()
    spec = importlib.util.spec_from_file_location('owned_drill', QA / 'physical-restore-r4.fixture.py')
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    owner.STATUS = QA / (OPERATION + '-status.json')
    assert not owner.STATUS.exists(), 'OPERATION_ALREADY_STARTED'
    assert sha(QA / 'native-process-owner') == '2c04343fd5befe7e4085811e73b4e441ac5a67c1b11614b5f8540c54efa933b2'
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
    pg = owner.inspect('1330c530d388bafae86368805e1e6af5118da892f00724bc5d361b694ff0ebb6')
    owner.verify_pg(pg, ROOT / 'postgres')
    assert pg['State']['Health']['Status'] == 'healthy'
    restore = json.loads((ROOT / 'evidence/inquiry-r24-full-proof.json').read_text())
    status = json.loads((ROOT / 'evidence/inquiry-r24-status.json').read_text())
    assert restore['status'] == 'HEALTHY' and status['phase'] == 'COMPLETED'
    assert restore['nativeInquiryStartup'] and restore['drill']['stagedPostgresRestore']
    assert restore['drill']['stagedSqliteIntegrity'] and restore['drill']['promotedFiles'] == {'files': 1589, 'bytes': 948451839}
    retained = []
    for directory, digest in [
        ('20261014T054528Z-cce0fa8da6b3-release', '747b3ab6a43afd2d4e083806c0b169f2b303837885d9aa9b870f510c7f15f93f'),
        ('20261013T071324Z-129b1f970e1a-release', 'c5480bbedc7e82648ba6faed0d68a9b1c2e0e38abea92578ceb3e22bd9be8c5e'),
    ]:
        archive = CHECKPOINTS / directory / ('deploy-' + directory + '.sabrec')
        metadata = Path(str(archive) + '.json')
        assert_plain(archive, transfer_uid)
        point = json.loads(metadata.read_text())
        assert point['restoreVerified'] and point['remoteVerified'] and point['lastDrill']['status'] == 'HEALTHY'
        assert point.get('active') is False and point.get('drillHold') is None and point.get('incidentHold') is None
        assert point.get('incidentOpen') in [None, False], 'INCIDENT_HELD_POINT'
        assert point['checksum'] == digest and sha(archive) == digest
        retained.append({'path': str(archive), 'sha256': digest, 'metadataSha256': sha(metadata)})
    image = CHECKPOINTS / 'images/6db61fe859b1274c0ba8b0253fd5f6c7bc96f6e3f46b3f868fde4fe44289e89f.docker.tar.gz'
    assert sha(image) == 'ed56c3575e4d9641e8119613e2273b397850fbb9ae4636f33b6eca5e3549d862'
    encrypted = PRIVATE / 'physical-replay-r4-20261015/base.sabrec'
    assert sha(encrypted) == '466824218145462e32b7aa4f574fb0937e2060edb3c3aaecc60d75cf25ef2acd'
    targets = [ROOT / 'uploads', ROOT / 'storage', PRIVATE / 'physical-base-components/physical-base-r2-20261015/base.tar']
    inventories = []
    for target in targets:
        assert_plain(target)
        assert_no_nested_mounts(target)
        files = list(target.rglob('*')) if target.is_dir() else [target]
        count = 0
        size = 0
        for file in files:
            value = file.lstat()
            assert stat.S_ISDIR(value.st_mode) or stat.S_ISREG(value.st_mode), 'UNEXPECTED_WORKING_ENTRY'
            if stat.S_ISREG(value.st_mode):
                assert value.st_nlink == 1, 'SHARED_WORKING_INODE'
                count += 1
                size += value.st_size
        inventories.append({'path': str(target), 'files': count, 'bytes': size})
    assert sha(targets[2]) == '298a5bce747f4db56c11edc37b410088853fc799ebca4b083c241fc6803dfbaf'
    identities = [
        ('22b4f2e81096fd1522715317c5c672fdd9a0860eaa4422334e1ec801e62ff43c', 'inquiry-startup-r24-20261015'),
        ('6a11a371253d36ef8e5a533494b7e4cc8d6a298ff811db29be9851c5c266adbe', 'inquiry-r24-20261015'),
        ('b313119ba27d', 'inquiry-startup-r22-20261015'),
        ('b6ac6410beb1', 'inquiry-r22-20261015'),
        ('98e2672f6392fbf1231c68b1bdb10a6be5441d135f9f732a8cde32a793f942e4', 'restore-previous'),
        ('1376521f20e065cec2ff4adb026f8030ffb0e23ca6c0f3b49d57552ee32118e5', 'restore-latest'),
    ]
    terminal = []
    for identity, name in identities:
        container = owner.inspect(identity)
        assert container['Name'] == '/sabalanerp-backup-drill-' + name
        assert container['Image'] == 'sha256:74321462a183ee36bf341c47c63eededd40af936d1f950796f8a0aa5b159316d'
        assert container['Config']['Labels']['com.docker.compose.project'] == 'sabalanerp-backup-drill'
        assert container['Config']['Labels']['com.docker.compose.service'] in ['restore', 'inquiry-admission']
        assert container['State']['Status'] == 'exited' and container['State']['ExitCode'] == 0
        assert not container['State']['Running'] and container['State']['Pid'] == 0
        assert container['HostConfig']['PidMode'] != 'host' and not container['HostConfig']['Privileged']
        # The tested native adapter streams into a bounded 4 MiB evidence
        # prefix and separately verifies the descendant-reaping receipt. An
        # exactly-full prefix is ambiguous/truncated and refuses deletion.
        log_token = OPERATION + '-capture-' + name
        owner.mutate_host(['docker', 'logs', '--tail', '10000', container['Id']], 30, log_token)
        log_path = QA / (log_token + '.log')
        assert log_path.stat().st_size < 4 * 1024 * 1024, 'DIAGNOSTIC_LOG_EXCEEDS_EVIDENCE_BOUND'
        terminal.append({'id': container['Id'], 'name': name, 'state': container['State'], 'mounts': container['Mounts'], 'logSha256': sha(log_path)})
    before = shutil.disk_usage(PRIVATE).free
    owner.atomic(QA / (OPERATION + '-proof.json'), {'phase': 'EXACT_TERMINAL_WORKSPACE_RETIREMENT', 'retainedPoints': retained,
        'retainedImageArchive': str(image), 'retainedEncryptedPhysicalComponent': str(encrypted), 'targets': inventories,
        'containers': terminal, 'foreignBaseline': foreign, 'runningPostgresRetained': pg['Id']})
    for container in terminal:
        owner.mutate_host(['docker', 'rm', container['id']], 60, OPERATION + '-' + container['name'])
    all_ids = owner.output(['docker', 'ps', '-aq']).decode().split()
    remaining = json.loads(owner.output(['docker', 'inspect', *all_ids]))
    for target in targets:
        for container in remaining:
            for mount in container['Mounts']:
                source = Path(mount['Source'])
                assert target != source and target not in source.parents and source not in target.parents, 'WORKSPACE_STILL_REFERENCED'
        assert_plain(target)
        assert_no_nested_mounts(target)
        owner.state('DELETE_INTENT', path=str(target))
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        parent = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        os.fsync(parent)
        os.close(parent)
        owner.state('DELETE_COMPLETE', path=str(target))
    assert owner.foreign() == foreign, 'FOREIGN_BASELINE_CHANGED_DURING_CLEANUP'
    assert owner.inspect(pg['Id'])['State']['StartedAt'] == pg['State']['StartedAt']
    for point in retained:
        assert sha(Path(point['path'] + '.json')) == point['metadataSha256']
    result = {'phase': 'COMPLETE', 'removedContainers': len(terminal), 'availableBeforeBytes': before,
        'availableAfterBytes': shutil.disk_usage(PRIVATE).free, 'healthyCheckpointsRetained': 2,
        'imageArchiveRetained': True, 'encryptedPhysicalComponentRetained': True, 'postgresRetained': True,
        'foreignStableServicesUnchanged': True, 'diagnosticFileWorkspaceRetired': True}
    owner.state(**result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
