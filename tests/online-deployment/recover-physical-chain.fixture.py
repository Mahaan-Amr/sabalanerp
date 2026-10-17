"""Independent bounded decryption/extraction. No PostgreSQL startup or admission."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import tarfile
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def check(value, code):
    if not value: raise RuntimeError(code)


def sync(file):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)


def read(file, maximum):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        a = os.fstat(fd)
        check(stat.S_ISREG(a.st_mode) and a.st_uid == 0 and a.st_nlink == 1 and not a.st_mode & 0o077
              and 0 < a.st_size <= maximum, 'PRIVATE_INPUT_REQUIRED')
        with os.fdopen(os.dup(fd), 'rb') as stream: data = stream.read(maximum + 1)
        b, named = os.fstat(fd), os.lstat(file)
        check(len(data) == a.st_size and
              (a.st_dev, a.st_ino, a.st_size, a.st_mtime_ns, a.st_ctime_ns) ==
              (b.st_dev, b.st_ino, b.st_size, b.st_mtime_ns, b.st_ctime_ns)
              and (named.st_dev, named.st_ino) == (a.st_dev, a.st_ino), 'PRIVATE_INPUT_CHANGED')
        os.fsync(fd); return data
    finally: os.close(fd)


def capacity(root, required):
    value = os.statvfs(root)
    check(value.f_bavail * value.f_frsize >= required, 'PRIVATE_RECOVERY_CAPACITY_REQUIRED')


def write_all(fd, data):
    offset = 0
    while offset < len(data):
        count = os.write(fd, data[offset:]); check(count > 0, 'PRIVATE_WRITE_INCOMPLETE'); offset += count


def lsn(value):
    check(isinstance(value, str) and re.fullmatch(r'(0|[1-9A-F][0-9A-F]{0,7})/(0|[1-9A-F][0-9A-F]{0,7})', value), 'LSN_INVALID')
    high, low = value.split('/'); return int(high, 16) * 2 ** 32 + int(low, 16)


def main():
    check(os.getuid() == 0 and len(sys.argv) == 4, 'PRIVATE_ROOT_ARGUMENTS_REQUIRED')
    root = Path(sys.argv[1]); expected_seal, expected_proof = sys.argv[2:]
    check(root.parent == Path('/root/sabalan-recovery-private/native-qa') and root.resolve(strict=True) == root
          and re.fullmatch(r'physical-chain-[a-f0-9]{32}', root.name), 'PRIVATE_OPERATION_REQUIRED')
    observed = root.stat(); check(observed.st_uid == 0 and stat.S_ISDIR(observed.st_mode) and not observed.st_mode & 0o077, 'PRIVATE_ROOT_REQUIRED')
    locks = []
    for file in [Path('/root/sabalan-recovery-private/drill-ownership.lock'), Path('/run/lock/sabalan-backup-storage.lock')]:
        fd = os.open(file, os.O_RDWR | os.O_NOFOLLOW); fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB); locks.append(fd)
    seal_bytes = read(root / 'seal-state.json', 65536)
    check(re.fullmatch(r'[a-f0-9]{64}', expected_seal) and hashlib.sha256(seal_bytes).hexdigest() == expected_seal
          and re.fullmatch(r'[a-f0-9]{64}', expected_proof), 'SOURCE_IDENTITY_INVALID')
    seal = json.loads(seal_bytes)
    check(seal['format'] == 'sabalan-private-physical-chain/v1' and seal['phase'] == 'SEALED'
          and seal['operation'] == root.name.removeprefix('physical-chain-')
          and seal['sourceProofSha256'] == expected_proof and seal['localKeyIsTestAuthority'] is True, 'SEALED_COMPONENT_INVALID')
    key = serialization.load_pem_private_key(read(Path('/root/sabalan-recovery-private/remote-recovery-private.pem'), 65536), password=None)
    public = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    public_sha = hashlib.sha256(public).hexdigest()
    check(public_sha == seal['independentPublicKeySha256'] == '455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af', 'INDEPENDENT_AUTHORITY_CHANGED')
    check(len(seal['files']) == 11, 'EXPECTED_COMPONENT_SET_REQUIRED')
    total = sum(item['bytes'] for item in seal['files'])
    check(0 < total <= 3 * 1024 ** 3, 'BOUNDED_COMPONENT_REQUIRED')
    capacity(root, total + 1024 ** 3)
    state_file = root / 'independent-state.json'
    with state_file.open('x') as stream:
        os.chmod(state_file, 0o600); json.dump(dict(phase='ACTIVE', sealSha256=expected_seal), stream); stream.flush(); os.fsync(stream.fileno())
    sync(root); sync(root.parent)
    recovered = root / 'recovered'; recovered.mkdir(mode=0o700); (recovered / 'wal').mkdir(mode=0o700)
    names, chunks_seen, sequence, recovered_bytes = set(), set(), 0, 0
    proofs = []
    for item in seal['files']:
        name = item['name']
        check(name in ['source-proof.json', 'backup_manifest', 'base.tar.gz'] or re.fullmatch(r'wal/[0-9A-F]{24}', name), 'COMPONENT_NAME_INVALID')
        check(name not in names and isinstance(item['bytes'], int) and 0 < item['bytes'] <= 3 * 1024 ** 3
              and re.fullmatch(r'[a-f0-9]{64}', item['sha256']), 'COMPONENT_IDENTITY_INVALID')
        names.add(name); check(1 <= len(item['chunks']) <= 192, 'BOUNDED_CHUNKS_REQUIRED')
        destination = recovered / name
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        count, digest = 0, hashlib.sha256()
        try:
            for chunk in item['chunks']:
                check(chunk['name'] == 'chunk-' + str(sequence).zfill(6) + '.sabrec' and chunk['name'] not in chunks_seen,
                      'CHUNK_ORDER_CHANGED')
                sequence += 1; chunks_seen.add(chunk['name'])
                check(isinstance(chunk['rawBytes'], int) and 0 < chunk['rawBytes'] <= 16 * 1024 ** 2, 'CHUNK_BOUND_REQUIRED')
                encoded = read(root / chunk['name'], chunk['rawBytes'] + 65536)
                check(len(encoded) == chunk['encryptedBytes'] and hashlib.sha256(encoded).hexdigest() == chunk['encryptedSha256']
                      and encoded[:8] == b'SABREC01', 'ENCRYPTED_CHUNK_CHANGED')
                length = struct.unpack('>I', encoded[8:12])[0]
                check(0 < length <= 16384 and len(encoded) > 12 + length + 16, 'ENVELOPE_LENGTH_INVALID')
                aad = encoded[12:12 + length]; header = json.loads(aad)
                check(header['format'] == 'sabalan-recovery' and header['version'] == 2 and header['cipher'] == 'aes-256-gcm'
                      and header['keyWrapping'] == 'multi-recipient-v1' and len(header['recipients']) == 2
                      and {row['keyId'] for row in header['recipients']} == {'local-rollback', 'independent-recovery'}, 'ENVELOPE_INVALID')
                recipient = next(row for row in header['recipients'] if row['keyId'] == 'independent-recovery')
                check(recipient['algorithm'] == 'rsa-oaep-sha256', 'RSA_RECIPIENT_REQUIRED')
                data_key = key.decrypt(base64.b64decode(recipient['wrappedKey'], validate=True),
                                      padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
                check(len(data_key) == 32, 'DATA_KEY_INVALID')
                iv = base64.b64decode(header['iv'], validate=True); check(len(iv) == 12, 'IV_INVALID')
                body = encoded[12 + length:]; plaintext = AESGCM(data_key).decrypt(iv, body, aad)
                check(len(plaintext) == chunk['rawBytes'] and hashlib.sha256(plaintext).hexdigest() == chunk['rawSha256'], 'INDEPENDENT_CHUNK_MISMATCH')
                damaged = bytearray(body); damaged[len(damaged) // 2] ^= 1; refused = False
                try: AESGCM(data_key).decrypt(iv, bytes(damaged), aad)
                except InvalidTag: refused = True
                check(refused, 'AUTHENTICATED_CORRUPTION_NOT_REJECTED')
                count += len(plaintext); recovered_bytes += len(plaintext)
                check(count <= item['bytes'] and recovered_bytes <= total, 'COMPONENT_LENGTH_CHANGED')
                capacity(root, total - recovered_bytes + 1024 ** 3)
                write_all(fd, plaintext); digest.update(plaintext)
            check(count == item['bytes'] and digest.hexdigest() == item['sha256'], 'REASSEMBLED_COMPONENT_CHANGED')
            os.fsync(fd)
        finally: os.close(fd)
        proofs.append(dict(name=name, bytes=count, sha256=item['sha256'], chunks=len(item['chunks']), independentRsaVerified=True, tamperRejected=True))
    check(recovered_bytes == total, 'COMPONENT_TOTAL_CHANGED')
    source_bytes = read(recovered / 'source-proof.json', 65536); source = json.loads(source_bytes)
    check(hashlib.sha256(source_bytes).hexdigest() == expected_proof and source['operation'] == seal['operation']
          and source['nativeBaseStreamChainPassed'] is True and source['temporaryDatabaseDroppedWithoutForce'] is True, 'RECOVERED_SOURCE_CHANGED')
    check(names == {'source-proof.json', 'backup_manifest', 'base.tar.gz', *['wal/' + row['name'] for row in source['segments']]}, 'RECOVERED_FILE_SET_CHANGED')
    by_name = {row['name']: row for row in seal['files']}
    check(by_name['base.tar.gz']['sha256'] == source['archiveSha256'] and by_name['base.tar.gz']['bytes'] == source['archiveBytes']
          and by_name['backup_manifest']['sha256'] == source['manifestSha256'], 'RECOVERED_BASE_CHANGED')
    for row in source['segments']:
        check(by_name['wal/' + row['name']]['sha256'] == row['sha256'] and by_name['wal/' + row['name']]['bytes'] == row['bytes'], 'RECOVERED_WAL_CHANGED')
    check(lsn(source['range']['startLsn']) <= lsn(source['baseRange']['Start-LSN']) < lsn(source['baseRange']['End-LSN'])
          < lsn(source['committedLsn']) < lsn(source['range']['endLsn']), 'RECOVERED_WAL_COVERAGE_INVALID')
    archive = recovered / 'base.tar.gz'; seen = set(); headers = {}; expanded = 0
    maximum = int(source['source']['clusterBytes']) * 5 // 4 + 256 * 1024 ** 2
    with tarfile.open(archive, 'r|gz') as package:
        for item in package:
            name = item.name.removeprefix('./').rstrip('/')
            check(name and not name.startswith('/') and '\\' not in name and not any(part in ['', '.', '..'] for part in name.split('/'))
                  and name not in seen and len(seen) < 250000 and (item.isfile() or item.isdir()), 'PRIVATE_BASE_ARCHIVE_UNSAFE')
            seen.add(name); headers[name] = (item.size, item.isfile()); expanded += item.size; check(expanded <= maximum, 'PRIVATE_BASE_ARCHIVE_TOO_LARGE')
    check({'PG_VERSION', 'global/pg_control', 'backup_label'}.issubset(seen), 'NATIVE_BASE_ENTRIES_REQUIRED')
    capacity(root, expanded + 1024 ** 3)
    data = root / 'data'; data.mkdir(mode=0o700)
    extracted = 0; directories = {data}; second_seen = set()
    with tarfile.open(archive, 'r|gz') as package:
        for item in package:
            name = item.name.removeprefix('./').rstrip('/')
            check(name in headers and name not in second_seen and headers[name] == (item.size, item.isfile()), 'PRIVATE_BASE_ARCHIVE_CHANGED')
            second_seen.add(name)
            target = data / name
            current = data
            for part in name.split('/')[:-1]:
                current = current / part
                if not current.exists(): current.mkdir(mode=0o700)
                check(current.is_dir() and not current.is_symlink(), 'PRIVATE_EXTRACTION_PARENT_CHANGED'); directories.add(current)
            if item.isdir():
                if not target.exists(): target.mkdir(mode=0o700)
                check(target.is_dir() and not target.is_symlink(), 'PRIVATE_EXTRACTION_TYPE_CHANGED'); directories.add(target); continue
            check(item.isfile(), 'PRIVATE_EXTRACTION_TYPE_CHANGED')
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            try:
                count = 0
                with package.extractfile(item) as payload:
                    while content := payload.read(262144):
                        count += len(content); extracted += len(content)
                        check(count <= item.size and extracted <= expanded, 'PRIVATE_EXTRACTION_LENGTH_CHANGED')
                        capacity(root, expanded - extracted + 1024 ** 3); write_all(fd, content)
                check(count == item.size, 'PRIVATE_EXTRACTION_INCOMPLETE'); os.fchown(fd, 70, 70); os.fsync(fd)
            finally: os.close(fd)
    check(second_seen == seen and extracted == expanded and (data / 'PG_VERSION').read_bytes() == b'15\n', 'PRIVATE_EXTRACTION_CHANGED')
    expected_manifest = read(recovered / 'backup_manifest', 32 * 1024 ** 2)
    if (data / 'backup_manifest').exists():
        check((data / 'backup_manifest').read_bytes() == expected_manifest, 'NATIVE_MANIFEST_CHANGED')
    else:
        fd = os.open(data / 'backup_manifest', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try: write_all(fd, expected_manifest); os.fchown(fd, 70, 70); os.fsync(fd)
        finally: os.close(fd)
    for directory in sorted(directories, key=lambda item: len(item.parts), reverse=True):
        os.chown(directory, 70, 70); sync(directory)
    # WAL is mounted read-only directly into the isolated verifier/replay image.
    for file in (recovered / 'wal').iterdir(): os.chown(file, 70, 70); os.chmod(file, 0o400); sync(file)
    os.chown(recovered / 'wal', 70, 70); sync(recovered / 'wal'); sync(recovered); sync(root)
    check(read(root / 'seal-state.json', 65536) == seal_bytes, 'SEALED_COMPONENT_CHANGED')
    result = dict(phase='PREPARED_PRIVATE', operation=seal['operation'], sealSha256=expected_seal,
                  sourceProofSha256=expected_proof, recoveredFiles=proofs, expandedBytes=expanded,
                  source=source, pgData=str(data), wal=str(recovered / 'wal'),
                  nativeVerifyAndReplayRequired=True, productionRecoveryPoint=False)
    temporary = root / 'independent-prepared.json'
    with temporary.open('x') as stream:
        os.chmod(temporary, 0o600); json.dump(result, stream); stream.flush(); os.fsync(stream.fileno())
    os.replace(temporary, state_file); sync(root); print(json.dumps(result), flush=True)


if __name__ == '__main__':
    try: main()
    except Exception:
        print('PRIVATE_INDEPENDENT_RECOVERY_FAILED', file=sys.stderr); sys.exit(1)
