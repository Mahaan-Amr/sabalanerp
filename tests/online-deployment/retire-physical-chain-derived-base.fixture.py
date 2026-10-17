"""Retire one derived compressed scratch copy after independent reconstruction.

Keeps every original encrypted chunk, seal, manifest, WAL and extracted PGDATA.
No healthy recovery point, application/image object, container or foreign file
is deleted. The encrypted independent chain can reconstruct the exact copy.
"""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import sys
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path('/root/sabalan-recovery-private/native-qa/physical-chain-6808d4086c7fe0d25c3198aa647e7180')
SEAL_SHA = '2b5ad249a2b005974365b50eb063154ad95872d78acb5c563e14e0c71e274831'


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def read(path, maximum):
    assert path.resolve(strict=True) == path
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        assert stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
        assert not before.st_mode & 0o077 and 0 < before.st_size <= maximum
        with os.fdopen(os.dup(fd), 'rb') as file: data = file.read(maximum + 1)
        after, named = os.fstat(fd), os.lstat(path)
        assert (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == \
               (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        assert (named.st_dev, named.st_ino) == (before.st_dev, before.st_ino) and len(data) == before.st_size
        os.fsync(fd); return data
    finally: os.close(fd)


def persist(path, value):
    with path.open('x') as file:
        os.chmod(path, 0o600); json.dump(value, file); file.flush(); os.fsync(file.fileno())
    sync(path.parent)


def main():
    assert os.getuid() == 0 and ROOT.resolve(strict=True) == ROOT
    assert ROOT.stat().st_uid == 0 and not ROOT.stat().st_mode & 0o077
    locks = []
    for path in [ROOT.parent.parent / 'drill-ownership.lock', Path('/run/lock/sabalan-backup-storage.lock')]:
        fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW); fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(fd)
    prepared_bytes = read(ROOT / 'independent-state.json', 65536); prepared = json.loads(prepared_bytes)
    assert prepared['phase'] == 'PREPARED_PRIVATE' and prepared['productionRecoveryPoint'] is False
    assert prepared['sealSha256'] == SEAL_SHA
    assert json.loads(read(ROOT / 'native-replay-state.json', 65536))['phase'] == 'VERIFYING_PRIVATE_IMAGE_AND_REASSEMBLY'
    assert not (ROOT / 'native-replay-state-v2.json').exists()
    assert not (ROOT / 'data/recovery.signal').exists() and not (ROOT / 'data/postmaster.pid').exists()
    seal_bytes = read(ROOT / 'seal-state.json', 65536); assert hashlib.sha256(seal_bytes).hexdigest() == SEAL_SHA
    seal = json.loads(seal_bytes); assert seal['phase'] == 'SEALED' and seal['operation'] == prepared['operation']
    key = serialization.load_pem_private_key(read(ROOT.parent.parent / 'remote-recovery-private.pem', 65536), password=None)
    public = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    assert hashlib.sha256(public).hexdigest() == seal['independentPublicKeySha256'] == '455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af'
    base = [item for item in seal['files'] if item['name'] == 'base.tar.gz']; assert len(base) == 1
    [base] = base
    expected = [item for item in prepared['recoveredFiles'] if item['name'] == 'base.tar.gz']; assert len(expected) == 1
    assert expected[0]['sha256'] == base['sha256'] == prepared['source']['archiveSha256']
    assert expected[0]['bytes'] == base['bytes'] == prepared['source']['archiveBytes'] == 440811984
    digest = hashlib.sha256(); count = 0
    for chunk in base['chunks']:
        name = chunk['name']; assert name.startswith('chunk-') and len(name) == 19 and name.endswith('.sabrec')
        encoded = read(ROOT / name, 16 * 1024 ** 2 + 65536)
        assert encoded[:8] == b'SABREC01' and hashlib.sha256(encoded).hexdigest() == chunk['encryptedSha256']
        length = struct.unpack('>I', encoded[8:12])[0]; assert 0 < length <= 16384
        aad = encoded[12:12 + length]; header = json.loads(aad)
        recipient = [row for row in header['recipients'] if row['keyId'] == 'independent-recovery']; assert len(recipient) == 1
        assert recipient[0]['algorithm'] == 'rsa-oaep-sha256'
        data_key = key.decrypt(base64.b64decode(recipient[0]['wrappedKey'], validate=True),
                              padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
        iv = base64.b64decode(header['iv'], validate=True); assert len(iv) == 12
        body = encoded[12 + length:]; plaintext = AESGCM(data_key).decrypt(iv, body, aad)
        assert len(plaintext) == chunk['rawBytes'] and hashlib.sha256(plaintext).hexdigest() == chunk['rawSha256']
        corrupted = bytearray(body); corrupted[len(corrupted) // 2] ^= 1
        refused = False
        try: AESGCM(data_key).decrypt(iv, bytes(corrupted), aad)
        except InvalidTag: refused = True
        assert refused; digest.update(plaintext); count += len(plaintext)
    assert count == base['bytes'] and digest.hexdigest() == base['sha256']
    source = ROOT / 'recovered/base.tar.gz'; assert source.resolve(strict=True) == source
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        assert stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1 and not before.st_mode & 0o077
        assert before.st_size == count; raw = hashlib.sha256()
        with os.fdopen(os.dup(fd), 'rb') as file:
            while content := file.read(262144): raw.update(content)
        assert raw.hexdigest() == base['sha256']; os.fsync(fd)
        after, named = os.fstat(fd), os.lstat(source)
        assert (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == \
               (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
        assert (named.st_dev, named.st_ino) == (before.st_dev, before.st_ino)
        assert read(ROOT / 'independent-state.json', 65536) == prepared_bytes
        free = shutil.disk_usage(ROOT).free
        intent = dict(phase='VERIFIED_DERIVED_COPY_RETIREMENT_INTENT', path=str(source), bytes=count, sha256=base['sha256'],
                      independentRsaReconstructionVerified=True, authenticatedCorruptionRejected=True, encryptedChunksRetained=True,
                      sealSha256=SEAL_SHA, beforeAvailableBytes=free, productionRecoveryPoint=False)
        persist(ROOT / 'derived-base-retirement-intent.json', intent)
        os.unlink(source); sync(source.parent)
    finally: os.close(fd)
    assert not source.exists()
    result = dict(intent, phase='COMPLETE', afterAvailableBytes=shutil.disk_usage(ROOT).free)
    persist(ROOT / 'derived-base-retirement-proof.json', result); print(json.dumps(result))


if __name__ == '__main__': main()
