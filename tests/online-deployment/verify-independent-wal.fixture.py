#!/usr/bin/env python3
"""Independent RSA verification of encrypted diagnostic WAL, not a full restore."""
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
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def require(value, code):
    if not value:
        raise RuntimeError(code)


def private_read(file, maximum):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
                and not before.st_mode & 0o077 and 0 < before.st_size <= maximum, 'PRIVATE_FILE_REQUIRED')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(maximum + 1)
        after, named = os.fstat(fd), os.lstat(file)
        require(len(data) == before.st_size and
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                and (named.st_dev, named.st_ino) == (before.st_dev, before.st_ino), 'FILE_CHANGED')
        return data
    finally:
        os.close(fd)


def main():
    require(os.getuid() == 0 and len(sys.argv) == 3, 'PRIVATE_ROOT_ARGUMENTS_REQUIRED')
    root, expected = Path(sys.argv[1]), sys.argv[2]
    require(root.parent == Path('/root/sabalan-recovery-private/native-qa')
            and re.fullmatch(r'wal-stream-[a-f0-9]{32}', root.name)
            and root.resolve(strict=True) == root, 'PRIVATE_OPERATION_REQUIRED')
    directory = root.stat()
    require(stat.S_ISDIR(directory.st_mode) and directory.st_uid == 0 and not directory.st_mode & 0o077,
            'PRIVATE_DIRECTORY_REQUIRED')
    lock = os.open(root / 'verify.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    storage_lock = os.open('/run/lock/sabalan-backup-storage.lock', os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(storage_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    sealed_bytes = private_read(root / 'seal-state.json', 65536)
    require(re.fullmatch(r'[a-f0-9]{64}', expected) and hashlib.sha256(sealed_bytes).hexdigest() == expected,
            'SEALED_RECEIPT_CHANGED')
    sealed = json.loads(sealed_bytes)
    require(sealed['format'] == 'sabalan-wal-seal/v1' and sealed['phase'] == 'SEALED'
            and sealed['namespace'] == 'sabalan-wal-' + root.name.removeprefix('wal-stream-'),
            'SEALED_IDENTITY_INVALID')
    key_bytes = private_read(Path('/root/sabalan-recovery-private/remote-recovery-private.pem'), 65536)
    key = serialization.load_pem_private_key(key_bytes, password=None)
    public_der = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    public_sha = hashlib.sha256(public_der).hexdigest()
    require(public_sha == sealed['independentPublicKeySha256'] ==
            '455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af', 'INDEPENDENT_AUTHORITY_CHANGED')
    require(2 <= len(sealed['objects']) <= 9, 'BOUNDED_OBJECTS_REQUIRED')
    result_file = root / 'independent-verification.json'
    active = dict(phase='ACTIVE', sealSha256=expected, independentPublicKeySha256=public_sha)
    with result_file.open('x') as stream:
        os.chmod(result_file, 0o600)
        json.dump(active, stream); stream.flush(); os.fsync(stream.fileno())
    directory_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    os.fsync(directory_fd)
    proofs, original_capture, recovered = [], None, {}
    for item in sealed['objects']:
        name = item['name']
        require(name == 'capture.sabrec' or re.fullmatch(r'[0-9A-F]{24}\.sabrec', name), 'OBJECT_NAME_INVALID')
        require(name not in recovered and 0 < item['rawBytes'] <= 16 * 1024 ** 2, 'OBJECT_IDENTITY_INVALID')
        encoded = private_read(root / name, item['rawBytes'] + 65536)
        require(len(encoded) == item['encryptedBytes'] and hashlib.sha256(encoded).hexdigest() == item['encryptedSha256'],
                'REMOTE_ENCRYPTED_BYTES_CHANGED')
        require(encoded[:8] == b'SABREC01', 'ENVELOPE_MAGIC_INVALID')
        length = struct.unpack('>I', encoded[8:12])[0]
        require(0 < length <= 16384 and len(encoded) > 12 + length + 16, 'ENVELOPE_LENGTH_INVALID')
        aad = encoded[12:12 + length]; header = json.loads(aad)
        require(header['format'] == 'sabalan-recovery' and header['version'] == 2 and
                header['cipher'] == 'aes-256-gcm' and header['keyWrapping'] == 'multi-recipient-v1', 'ENVELOPE_FORMAT_INVALID')
        recipients = header['recipients']
        require(len(recipients) == 2 and {row['keyId'] for row in recipients} ==
                {'local-rollback', 'independent-recovery'}, 'BOTH_AUTHORITIES_REQUIRED')
        remote = next(row for row in recipients if row['keyId'] == 'independent-recovery')
        require(remote['algorithm'] == 'rsa-oaep-sha256', 'RSA_AUTHORITY_REQUIRED')
        data_key = key.decrypt(base64.b64decode(remote['wrappedKey'], validate=True),
                               padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
        require(len(data_key) == 32, 'ENVELOPE_KEY_INVALID')
        iv = base64.b64decode(header['iv'], validate=True); require(len(iv) == 12, 'ENVELOPE_IV_INVALID')
        body = encoded[12 + length:]
        plaintext = AESGCM(data_key).decrypt(iv, body, aad)
        require(len(plaintext) == item['rawBytes'] and hashlib.sha256(plaintext).hexdigest() == item['rawSha256'],
                'INDEPENDENT_DECRYPT_MISMATCH')
        damaged = bytearray(body); damaged[len(damaged) // 2] ^= 1
        rejected = False
        try:
            AESGCM(data_key).decrypt(iv, bytes(damaged), aad)
        except InvalidTag:
            rejected = True
        require(rejected, 'DAMAGED_ENVELOPE_ACCEPTED')
        if name == 'capture.sabrec':
            original_capture = json.loads(plaintext)
        recovered[name] = dict(sha256=hashlib.sha256(plaintext).hexdigest(), bytes=len(plaintext))
        proofs.append(dict(name=name, encryptedSha256=item['encryptedSha256'], rawSha256=item['rawSha256'],
                           bytes=len(plaintext), independentRsaDecryption=True, authenticatedCorruptionRejected=True))
    require(original_capture and original_capture['phase'] == 'COMPLETE' and
            original_capture['nativeReaped'] is True and original_capture['databaseQuiet'] is True and
            original_capture['nativeStatus'] == 0 and original_capture['namespace'] == sealed['namespace'] and
            original_capture['source'] == sealed['source'] and
            all(original_capture[key] == sealed['range'][key] for key in ['startLsn', 'endLsn']) and
            recovered['capture.sabrec']['sha256'] == sealed['captureSha256'], 'RECOVERED_CAPTURE_CHANGED')
    require(set(recovered) == {'capture.sabrec', *[row['name'] + '.sabrec' for row in original_capture['segments']]},
            'RECOVERED_OBJECT_SET_CHANGED')
    for row in original_capture['segments']:
        require(recovered[row['name'] + '.sabrec'] == dict(sha256=row['sha256'], bytes=row['bytes']), 'RECOVERED_SEGMENT_CHANGED')
    result = dict(active, phase='VERIFIED', namespace=sealed['namespace'], objects=proofs,
                  plaintextPersisted=False, productionRecoveryPoint=False)
    temporary = root / 'independent-complete.json'
    with temporary.open('x') as stream:
        os.chmod(temporary, 0o600); json.dump(result, stream, sort_keys=True); stream.flush(); os.fsync(stream.fileno())
    os.replace(temporary, result_file); os.fsync(directory_fd)
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('INDEPENDENT_WAL_VERIFICATION_FAILED', file=sys.stderr)
        sys.exit(1)
