"""Retire completed diagnostic working data, preserving its full encrypted chain."""
import base64
import ctypes
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import struct
import tempfile
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path('/root/sabalan-recovery-private/native-qa/physical-chain-6808d4086c7fe0d25c3198aa647e7180')
QA = ROOT.parent
IMAGE = 'sha256:9b4593c6de443299b46098151fc1ec154c882339b77a56334c7ce612c8a7be6a'


def sha(path):
    result = hashlib.sha256()
    with path.open('rb') as file:
        while chunk := file.read(262144): result.update(chunk)
    return result.hexdigest()


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


def main():
    assert os.getuid() == 0 and ROOT.resolve(strict=True) == ROOT
    assert ROOT.stat().st_uid == 0 and not ROOT.stat().st_mode & 0o077
    lock = os.open(QA.parent / 'drill-ownership.lock', os.O_RDWR | os.O_NOFOLLOW)
    if lock != 9: os.dup2(lock, 9); os.close(lock)
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    storage = os.open('/run/lock/sabalan-backup-storage.lock', os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(storage, fcntl.LOCK_EX | fcntl.LOCK_NB)
    mount_guard_source = QA / 'retire-private-restore-workspace-20261017.fixture.py'
    assert sha(mount_guard_source) == 'a607550c21bf13f8d0e11c6f97ce29686a625d93f362e2949c0d16d78f5baf57'
    mount_guard = load('completed_chain_mount_guard', mount_guard_source)
    namespace_before = os.readlink('/proc/self/ns/mnt')
    mount_guard.isolate_mount_namespace()
    assert os.readlink('/proc/self/ns/mnt') != namespace_before
    # Actual same-device bind regression, exclusively in this recursively
    # private namespace. No mount is propagated to the host or Docker daemon.
    scratch = Path(tempfile.mkdtemp(prefix='mount-guard-', dir=ROOT))
    source, destination = scratch / 'source', scratch / 'destination'
    source.mkdir(mode=0o700); destination.mkdir(mode=0o700)
    sentinel = source / 'retained'; sentinel.write_bytes(b'foreign-bind-sentinel')
    assert source.stat().st_dev == destination.stat().st_dev
    libc = ctypes.CDLL(None, use_errno=True)
    libc.mount.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_char_p, ctypes.c_ulong, ctypes.c_void_p]
    libc.mount.restype = ctypes.c_int
    libc.umount2.argtypes = [ctypes.c_char_p, ctypes.c_int]; libc.umount2.restype = ctypes.c_int
    assert libc.mount(os.fsencode(source), os.fsencode(destination), None, 1 << 12, None) == 0
    refused = False
    try:
        try:
            mount_guard.assert_no_nested_mounts(scratch)
            shutil.rmtree(scratch)
        except AssertionError as error:
            assert str(error) == 'HOST_MOUNT_WITHIN_WORKSPACE'; refused = True
        assert refused and sentinel.read_bytes() == (destination / 'retained').read_bytes() == b'foreign-bind-sentinel'
    finally:
        assert libc.umount2(os.fsencode(destination), 0) == 0
    mount_guard.assert_no_nested_mounts(scratch)
    sentinel.unlink(); source.rmdir(); destination.rmdir(); scratch.rmdir()
    guard_source = ROOT / 'retire-physical-chain-derived-base.fixture.py'
    assert sha(guard_source) == 'c3b558b93a77dbfe122a55f9095fec6f056616ecc01602bc3eca51e4cac56e61'
    guard = load('completed_chain_private_guard', guard_source)
    parser_source = ROOT / 'replay-physical-chain-v3.fixture.py'
    assert sha(parser_source) == 'f2bfac11fd10f3ba80d1e933922ca548377a300b702ac9eaf96bba8ce0b78153'
    parser = load('completed_chain_image_guard', parser_source)
    assert sha(ROOT / 'postgres-image.tar') == parser.IMAGE_ARCHIVE_SHA
    config, _ = parser.immutable_image(ROOT / 'postgres-image.tar')
    owner = load('completed_chain_retirement_owner', QA / 'physical-restore-r4.fixture.py')
    assert sha(QA / 'native-process-owner') == '2c04343fd5befe7e4085811e73b4e441ac5a67c1b11614b5f8540c54efa933b2'
    owner.STATUS = ROOT / 'completed-working-retirement-state.json'; assert not owner.STATUS.exists()
    for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]: signal.signal(number, owner.defer_cancellation)
    foreign = owner.foreign()
    proof_bytes = guard.read(ROOT / 'native-replay-proof.json', 65536)
    assert hashlib.sha256(proof_bytes).hexdigest() == 'dd1ce8717a1f5ebe71a6464d58f90a908921ceec402a7981b007bc52e91f4c22'
    proof = json.loads(proof_bytes)
    assert proof['status'] == 'PRIVATE_BASE_WAL_REPLAY_VERIFIED' and proof['productionRecoveryPoint'] is False
    assert proof['source']['systemIdentifier'] == '7667464637415309346' and proof['nativePostgresStoppedNaturally'] is True
    assert json.loads(guard.read(ROOT / 'native-replay-state-v4.json', 65536))['phase'] == 'COMPLETE'
    ids = [proof['nativeVerifyContainer'], proof['stoppedReplayContainer']]
    assert ids == ['0140210d91960e89270a6c304a0b8e12a5c41d81b129be30555b3d69063531b3',
                   '784e879b62181f5eb7a87f09bfbb81ac4ce46a9ca21d57bb2bec096f51d6e9a2']
    all_ids = owner.output(['docker', 'ps', '-aq']).decode().split()
    containers = json.loads(owner.output(['docker', 'inspect', *all_ids]))
    owned = [row for row in containers if row['Id'] in ids]; assert len(owned) == 2
    data = ROOT / 'data'
    mount_guard.assert_no_nested_mounts(data)
    assert [row['Id'] for row in containers if row['Image'] == IMAGE] == [row['Id'] for row in owned]
    for row in containers:
        for mount in row['Mounts']:
            source = mount.get('Source', '')
            if source and (Path(source) == data or data in Path(source).parents or Path(source) in data.parents):
                assert row['Id'] in ids and source == str(data)
    for row in owned:
        state = row['State']
        assert row['Image'] == IMAGE and row['Config']['Labels']['sabalan.drill.operation'] == proof['operation']
        assert state['Status'] == 'exited' and not state['Running'] and state['Pid'] == 0 and state['ExitCode'] == 0
        assert not state['Dead'] and not state['OOMKilled'] and not row['ExecIDs']
        owner.atomic(ROOT / ('completed-working-private-inspection-' + row['Id'] + '.json'), row)
    [image] = json.loads(owner.output(['docker', 'image', 'inspect', IMAGE]))
    assert image['Id'] == IMAGE and not image.get('RepoTags') and not image.get('RepoDigests')
    assert image['RootFS']['Layers'] == config['rootfs']['diff_ids']
    # Independently decrypt every retained original component in bounded memory
    # before discarding any derived working data or unreferenced image layers.
    seal_bytes = guard.read(ROOT / 'seal-state.json', 65536)
    assert hashlib.sha256(seal_bytes).hexdigest() == proof['sealSha256']
    seal = json.loads(seal_bytes)
    key = serialization.load_pem_private_key(guard.read(QA.parent / 'remote-recovery-private.pem', 65536), password=None)
    public = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    assert hashlib.sha256(public).hexdigest() == seal['independentPublicKeySha256'] == '455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af'
    components = []; chunks = set()
    for item in seal['files']:
        digest = hashlib.sha256(); count = 0
        for chunk in item['chunks']:
            name = chunk['name']; assert name.startswith('chunk-') and len(name) == 19 and name.endswith('.sabrec') and name not in chunks
            chunks.add(name); encoded = guard.read(ROOT / name, 16 * 1024 ** 2 + 65536)
            assert hashlib.sha256(encoded).hexdigest() == chunk['encryptedSha256'] and encoded[:8] == b'SABREC01'
            length = struct.unpack('>I', encoded[8:12])[0]; assert 0 < length <= 16384
            aad = encoded[12:12 + length]; header = json.loads(aad)
            [recipient] = [row for row in header['recipients'] if row['keyId'] == 'independent-recovery']
            assert recipient['algorithm'] == 'rsa-oaep-sha256'
            wrapped = base64.b64decode(recipient['wrappedKey'], validate=True)
            data_key = key.decrypt(wrapped, padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
            plaintext = AESGCM(data_key).decrypt(base64.b64decode(header['iv'], validate=True), encoded[12 + length:], aad)
            assert len(plaintext) == chunk['rawBytes'] and hashlib.sha256(plaintext).hexdigest() == chunk['rawSha256']
            count += len(plaintext); digest.update(plaintext)
        assert count == item['bytes'] and digest.hexdigest() == item['sha256']
        components.append(dict(name=item['name'], bytes=count, sha256=item['sha256']))
    assert len(components) == 11 and len(chunks) == 38
    assert data.resolve(strict=True) == data and data.parent == ROOT and data.name == 'data'
    initial = data.lstat(); assert stat.S_ISDIR(initial.st_mode) and initial.st_uid == 70 and not initial.st_mode & 0o077
    entries = 0; logical = 0
    for base, directories, files in os.walk(data, followlinks=False):
        for name in directories + files:
            path = Path(base) / name; value = path.lstat(); entries += 1
            assert entries <= 250000 and value.st_dev == initial.st_dev and value.st_uid == 70
            assert stat.S_ISREG(value.st_mode) or stat.S_ISDIR(value.st_mode)
            if stat.S_ISREG(value.st_mode): assert value.st_nlink == 1; logical += value.st_size
    assert logical <= 2 * int(proof['source']['clusterBytes']) + 512 * 1024 ** 2
    before = shutil.disk_usage(ROOT).free
    owner.state('COMPLETED_DIAGNOSTIC_RETIREMENT_INTENT', containers=ids, data=str(data), image=IMAGE,
                allIndependentComponentsReconstructed=components, encryptedChunksRetained=len(chunks), logicalDataBytes=logical)
    for identity in ids:
        owner.mutate_host(['docker', 'rm', identity], 60, 'chain-' + proof['operation'] + '-retire-complete-' + identity[:12])
    remaining = owner.output(['docker', 'ps', '-aq']).decode().split()
    assert not set(ids).intersection(remaining)
    others = json.loads(owner.output(['docker', 'inspect', *remaining]))
    assert all(row['Image'] != IMAGE for row in others)
    assert all(not any(mount.get('Source') and (Path(mount['Source']) == data or data in Path(mount['Source']).parents
               or Path(mount['Source']) in data.parents) for mount in row['Mounts']) for row in others)
    assert data.resolve(strict=True) == data and (data.stat().st_dev, data.stat().st_ino) == (initial.st_dev, initial.st_ino)
    mount_guard.assert_no_nested_mounts(data)
    shutil.rmtree(data); guard.sync(ROOT)
    owner.mutate_host(['docker', 'image', 'rm', IMAGE], 60, 'chain-' + proof['operation'] + '-retire-complete-image')
    assert IMAGE not in owner.output(['docker', 'image', 'ls', '--no-trunc', '--quiet']).decode().split()
    assert guard.read(ROOT / 'native-replay-proof.json', 65536) == proof_bytes
    assert guard.read(ROOT / 'seal-state.json', 65536) == seal_bytes and sha(ROOT / 'postgres-image.tar') == parser.IMAGE_ARCHIVE_SHA
    assert owner.foreign() == foreign and not owner.cancellation_requested
    result = dict(phase='COMPLETE', containersRetiredWithoutForce=ids, imageRetiredWithoutForce=IMAGE,
      derivedWorkingDataRetired=str(data), logicalDataBytes=logical, encryptedComponentsReverified=components,
      allEncryptedChunksRetained=len(chunks), exactImageArchiveRetained=True, originalFailureEvidenceRetained=True,
      readonlyWalAndManifestRetained=True, foreignServicesUnchanged=True, availableBeforeBytes=before,
      privateMountNamespace=True, sameDeviceBindMountDeletionRefused=True,
      availableAfterBytes=shutil.disk_usage(ROOT).free, productionRecoveryPoint=False)
    owner.atomic(ROOT / 'completed-working-retirement-proof.json', result); owner.state('COMPLETE', proof=result)
    print(json.dumps(result))


if __name__ == '__main__': main()
