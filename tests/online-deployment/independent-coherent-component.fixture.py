"""Independent RSA/file/SQLite/native PostgreSQL diagnostic restore.

Bounded local fixture bytes, never production data admission or a healthy-point
publisher. Any native/Docker uncertainty retains both host ownership locks.
"""
import base64
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
import struct
import subprocess
import sys
import tarfile
import time
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

QA = Path('/root/sabalan-recovery-private/native-qa')
PRIVATE = QA.parent
IMAGE = 'sha256:9b4593c6de443299b46098151fc1ec154c882339b77a56334c7ce612c8a7be6a'
ARCHIVE = QA / 'physical-chain-6808d4086c7fe0d25c3198aa647e7180/postgres-image.tar'
ARCHIVE_SHA = '4ac986e0e795da2700e014af9fd094f447204dc863856df94689732e15708ac7'
OWNER = QA / 'native-owner-storage-final-20261017/owner'
OWNER_SHA = 'c2b096894f7bdf920881c668deca48b1b7afedc4267956ed31e1743ed3687d83'
mutated = False
completed = False
root = None


def check(value, code):
    if not value:
        raise RuntimeError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read(path, maximum):
    check(path.resolve(strict=True) == path, 'PRIVATE_PATH_REQUIRED')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        check(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
              and not before.st_mode & 0o077 and 0 < before.st_size <= maximum, 'PRIVATE_FILE_REQUIRED')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(maximum + 1)
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        check(len(data) == before.st_size and identity(before) == identity(os.fstat(fd))
              and identity(before) == identity(path.lstat()), 'PRIVATE_FILE_CHANGED')
        os.fsync(fd)
        return data
    finally:
        os.close(fd)


def write(path, data, mode=0o400):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        # umask(077) must not silently strip the deliberately reviewed read/
        # execute bits on NEW confined files mounted into UID70's container.
        os.fchmod(fd, mode)
        with os.fdopen(os.dup(fd), 'wb') as stream:
            stream.write(data)
            stream.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    sync(path.parent)


def public_executable(path):
    check(path.resolve(strict=True) == path, 'NATIVE_OWNER_PATH_CHANGED')
    value = path.lstat()
    check(stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_nlink == 1
          and not value.st_mode & 0o222 and value.st_size < 4 * 1024 ** 2, 'NATIVE_OWNER_UNSAFE')
    data = path.read_bytes()
    check(sha(data) == OWNER_SHA, 'NATIVE_OWNER_CHANGED')
    return data


def inherit_ownership(descriptors):
    check(len(descriptors) == 2, 'TWO_HOST_LOCKS_REQUIRED')
    expected = [(os.fstat(fd).st_dev, os.fstat(fd).st_ino) for fd in descriptors]
    check(expected[0] != expected[1], 'DISTINCT_HOST_LOCKS_REQUIRED')
    # Never allocate a temporary in either destination slot. In particular,
    # copies=[8,9] would lose the second OFD during the first dup2(8,9).
    copies = [fcntl.fcntl(fd, fcntl.F_DUPFD_CLOEXEC, 11) for fd in descriptors]
    try:
        for target, fd in zip((9, 10), copies):
            os.dup2(fd, target)
            os.set_inheritable(target, True)
        for target, identity in zip((9, 10), expected):
            actual = os.fstat(target)
            check((actual.st_dev, actual.st_ino) == identity, 'INHERITED_HOST_LOCK_CHANGED')
            details = Path('/proc/self/fdinfo/' + str(target)).read_text()
            check(re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                            + str(actual.st_ino) + r'\s+0\s+EOF\s*$', details, re.M), 'INHERITED_HOST_LOCK_UNPROVEN')
    finally:
        for fd in copies:
            os.close(fd)


def readonly(arguments):
    return subprocess.check_output(arguments, timeout=30, stderr=subprocess.STDOUT)


def foreign():
    identities = readonly(['docker', 'ps', '-q']).decode().split()
    values = json.loads(readonly(['docker', 'inspect', *identities])) if identities else []
    return {value['Id']: dict(name=value['Name'], image=value['Image'], startedAt=value['State']['StartedAt'])
            for value in values if (value['Config'].get('Labels') or {}).get('com.docker.compose.project') != 'sabalanerp-backup-drill'}


def mutate(arguments, token, seconds=180):
    global mutated
    check(shutil.disk_usage(PRIVATE).free >= 1024 ** 3, 'INDEPENDENT_STORAGE_RESERVE_REQUIRED')
    write(root / (token + '-intent.json'), json.dumps(dict(arguments=arguments, phase='ACTIVE')).encode())
    mutated = True
    # Inherit BOTH ownership descriptions into the native subreaper, including
    # through controller death. A CLI exit never authorizes PostgreSQL cleanup.
    environment = dict(os.environ, SABALAN_NATIVE_STORAGE_ROOT=str(root),
                       SABALAN_NATIVE_STORAGE_MAX_BYTES=str(1024 ** 3),
                       SABALAN_NATIVE_STORAGE_RESERVE_BYTES=str(1024 ** 3))
    process = subprocess.Popen([str(OWNER), str(seconds), token, *arguments], pass_fds=(9, 10),
                               env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    output = bytearray()
    with (root / (token + '.log')).open('xb') as log:
        os.chmod(log.name, 0o600)
        while chunk := process.stdout.read(65536):
            check(len(output) + len(chunk) <= 4 * 1024 ** 2, 'NATIVE_OUTPUT_BOUND_EXCEEDED')
            output.extend(chunk)
            log.write(chunk)
        status = process.wait()
        log.flush()
        os.fsync(log.fileno())
    receipt = ('\nSABALAN_NATIVE_REAPED ' + token + ' 0\n').encode()
    check(status == 0 and output.endswith(receipt), 'NATIVE_COMMAND_UNPROVEN')
    write(root / (token + '-closed.json'), json.dumps(dict(status=status, logSha256=sha(output), nativeReaped=True)).encode())
    return bytes(output)


def main():
    global root, completed
    check(os.getuid() == 0 and len(sys.argv) == 6, 'PRIVATE_ARGUMENTS_REQUIRED')
    root = Path(sys.argv[1])
    expected_seal, expected_package, image_verifier_sha, file_restore_sha = sys.argv[2:]
    check(root.parent == QA and re.fullmatch(r'coherent-component-[a-f0-9]{32}', root.name)
          and root.resolve(strict=True) == root and root.stat().st_uid == 0
          and not root.stat().st_mode & 0o077, 'PRIVATE_OPERATION_REQUIRED')
    check(all(re.fullmatch(r'[a-f0-9]{64}', value) for value in sys.argv[2:]), 'EXPECTED_HASHES_REQUIRED')
    descriptors = []
    for path in [PRIVATE / 'drill-ownership.lock', Path('/run/lock/sabalan-backup-storage.lock')]:
        fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        descriptors.append(fd)
    inherit_ownership(descriptors)
    global_intent = QA / 'coherent-component-active.json'
    check(not global_intent.exists(), 'PRIOR_COMPONENT_OWNERSHIP_REQUIRES_AUDIT')
    check(shutil.disk_usage(PRIVATE).free >= 2 * 1024 ** 3, 'INDEPENDENT_COMPONENT_CAPACITY_REQUIRED')
    seal_bytes = read(root / 'seal-proof.json', 65536)
    package_bytes = read(root / 'package-proof.json', 65536)
    check(sha(seal_bytes) == expected_seal and sha(package_bytes) == expected_package, 'TRANSFERRED_AUTHORITY_CHANGED')
    seal, package = json.loads(seal_bytes), json.loads(package_bytes)
    check(seal['format'] == 'sabalan-private-coherent-seal/v1' and seal['phase'] == 'SEALED'
          and seal['productionRecoveryPoint'] is False and seal['localKeyIsTestAuthority'] is True
          and seal['packageProofSha256'] == expected_package
          and package['format'] == 'sabalan-private-coherent-package/v1'
          and package['productionRecoveryPoint'] is False, 'DIAGNOSTIC_SCOPE_REQUIRED')
    encoded = read(root / 'component.sabrec', 65 * 1024 ** 2)
    check(sha(encoded) == seal['encryptedSha256'] and len(encoded) == seal['encryptedBytes']
          and encoded[:8] == b'SABREC01', 'CIPHER_CHANGED')
    length = struct.unpack('>I', encoded[8:12])[0]
    check(0 < length <= 16384 and len(encoded) > 12 + length + 16, 'ENVELOPE_BOUND_INVALID')
    aad, body = encoded[12:12 + length], encoded[12 + length:]
    header = json.loads(aad)
    check(header['format'] == 'sabalan-recovery' and header['version'] == 2 and header['cipher'] == 'aes-256-gcm'
          and header['keyWrapping'] == 'multi-recipient-v1' and len(header['recipients']) == 2
          and {item['keyId'] for item in header['recipients']} == {'local-rollback', 'independent-recovery'}, 'ENVELOPE_INVALID')
    key = serialization.load_pem_private_key(read(PRIVATE / 'remote-recovery-private.pem', 65536), password=None)
    public_sha = sha(key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))
    check(public_sha == seal['independentPublicKeySha256'] == '455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af', 'INDEPENDENT_KEY_CHANGED')
    recipient = next(item for item in header['recipients'] if item['keyId'] == 'independent-recovery')
    check(recipient['algorithm'] == 'rsa-oaep-sha256', 'RSA_RECIPIENT_REQUIRED')
    data_key = key.decrypt(base64.b64decode(recipient['wrappedKey'], validate=True),
                           padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    iv = base64.b64decode(header['iv'], validate=True)
    check(len(data_key) == 32 and len(iv) == 12, 'ENVELOPE_KEY_INVALID')
    plaintext = AESGCM(data_key).decrypt(iv, body, aad)
    damaged = bytearray(body)
    damaged[-32] ^= 1
    refused = False
    try:
        AESGCM(data_key).decrypt(iv, bytes(damaged), aad)
    except InvalidTag:
        refused = True
    check(refused and len(plaintext) == seal['packageBytes'] == package['packageBytes']
          and sha(plaintext) == seal['packageSha256'] == package['packageSha256'], 'INDEPENDENT_READBACK_FAILED')
    write(root / 'component.tar', plaintext)
    check(len(package['files']) == 10 and sum(item['bytes'] for item in package['files']) < 48 * 1024 ** 2,
          'BOUNDED_DIAGNOSTIC_SET_REQUIRED')
    expected = {item['name']: item for item in package['files']}
    check(len(expected) == len(package['files']), 'DUPLICATE_COMPONENT')
    recovered = root / 'recovered'
    recovered.mkdir(mode=0o700)
    seen = set()
    with tarfile.open(root / 'component.tar', 'r:') as archive:
        for member in archive:
            name = member.name
            check(name in expected and name not in seen and member.isfile()
                  and not name.startswith('/') and '\\' not in name
                  and all(part not in ['', '.', '..'] for part in name.split('/'))
                  and member.size == expected[name]['bytes'] and 0 < member.size <= 32 * 1024 ** 2,
                  'ARCHIVE_MEMBER_UNSAFE')
            seen.add(name)
            data = archive.extractfile(member).read(member.size + 1)
            check(len(data) == member.size and sha(data) == expected[name]['sha256'], 'ARCHIVE_CONTENT_CHANGED')
            destination = recovered / name
            destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            write(destination, data)
    check(seen == set(expected), 'ARCHIVE_SET_INCOMPLETE')
    # Validate the file history and original SQLite bytes independently.
    tool = recovered / 'tools/recovery-file-generations.py'
    check(sha(read(tool, 1024 ** 2)) == expected['tools/recovery-file-generations.py']['sha256'] == file_restore_sha,
          'REVIEWED_FILE_RESTORE_TOOL_CHANGED')
    spec = importlib.util.spec_from_file_location('independent_file_generations', tool)
    files = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(files)
    gate = os.open(root / 'deployment-write-admission.lock', os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
    fcntl.flock(gate, fcntl.LOCK_EX | fcntl.LOCK_NB)
    gate_stat = os.fstat(gate)
    store = files.FileGenerations(str(recovered / 'files'), gate, gate_stat.st_dev, gate_stat.st_ino)
    restored = store.restore(package['fileGenerationSha256'], str(root / 'restored-files'))
    attachment = read(root / 'restored-files/uploads/original.pdf', 65536)
    check(attachment == b'ORIGINAL-ATTACHMENT-123456789.12345678', 'RESTORED_ATTACHMENT_CHANGED')
    import sqlite3
    with sqlite3.connect('file:' + str(root / 'restored-files/inquiry/inquiry.db') + '?mode=ro', uri=True) as sqlite:
        check(sqlite.execute('PRAGMA integrity_check').fetchone() == ('ok',)
              and sqlite.execute('SELECT amount FROM inquiry_capture_probe').fetchone() == ('123456789.12345678',), 'RESTORED_SQLITE_CHANGED')
    # Reuse the independently reviewed OCI graph verifier; hash-bind its source
    # before import. No tags, pulls or mutable-image substitution.
    verifier = root / 'image-verifier.py'
    check(sha(read(verifier, 1024 ** 2)) == image_verifier_sha, 'IMAGE_VERIFIER_CHANGED')
    spec = importlib.util.spec_from_file_location('independent_oci_graph', verifier)
    graph = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(graph)
    check(sha(read(ARCHIVE, 128 * 1024 ** 2)) == ARCHIVE_SHA, 'IMAGE_ARCHIVE_CHANGED')
    config, platform = graph.immutable_image(ARCHIVE)
    owner_bytes = public_executable(OWNER)
    original_foreign = foreign()
    # Foreign workloads can add services between rehearsals. Freeze every
    # currently running foreign identity, rather than a stale service count.
    check(len(original_foreign) >= 14, 'FOREIGN_INVENTORY_INCOMPLETE')
    write(root / 'foreign-before.json', json.dumps(original_foreign, sort_keys=True).encode())
    check(not readonly(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=sabalanerp-backup-drill']).strip(),
          'EXISTING_DRILL_CONTAINER_REQUIRES_AUDIT')
    write(global_intent, json.dumps(dict(root=str(root), phase='ACTIVE', pid=os.getpid(),
          startTicks=Path('/proc/self/stat').read_text().rsplit(') ', 1)[1].split()[19],
          bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip())).encode())
    signal.signal(signal.SIGTERM, lambda *_: None)
    signal.signal(signal.SIGINT, lambda *_: None)
    signal.signal(signal.SIGHUP, lambda *_: None)
    if IMAGE not in readonly(['docker', 'image', 'ls', '--no-trunc', '--quiet']).decode().split():
        mutate(['docker', 'load', '--input', str(ARCHIVE)], 'image-load')
    [image] = json.loads(readonly(['docker', 'image', 'inspect', IMAGE]))
    check(image['Id'] == IMAGE and image['RootFS']['Layers'] == config['rootfs']['diff_ids'], 'LOADED_IMAGE_CHANGED')
    data = root / 'pgdata'
    data.mkdir(mode=0o700)
    os.chown(data, 70, 70)
    binary = root / 'native-owner'
    write(binary, owner_bytes, 0o555)
    script = b'''#!/bin/sh
set -eu
initdb -D /var/lib/postgresql/data --username=postgres --auth-local=trust --auth-host=reject >/tmp/initdb.log
pg_ctl -D /var/lib/postgresql/data -l /tmp/postgres.log -o "-c listen_addresses='' -c shared_buffers=32MB -c max_connections=10 -c autovacuum=off -c shared_preload_libraries='' -c archive_mode=off" -w start
createdb -U postgres component_restore
pg_restore -U postgres --no-owner --no-privileges --exit-on-error --dbname=component_restore /component.dump
value=$(psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d component_restore -c "SELECT amount::text||'/'||quantity::text||'/'||storage_key FROM public.recovery_capture_probe WHERE id='lost-ack'")
[ "$value" = '123456789.12345678/0.00000001/original.pdf' ]
count=$(psql -X -qAt -v ON_ERROR_STOP=1 -U postgres -d component_restore -c 'SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL')
[ "$count" = '427' ]
printf '\\nSABALAN_COMPONENT_RESTORED %s %s\\n' "$value" "$count"
pg_ctl -D /var/lib/postgresql/data -m fast -w stop
'''
    write(root / 'restore.sh', script, 0o444)
    # The dump is an independent copy. Permit only the confined postgres UID
    # to read it, without modifying any retained object or original archive.
    dump = root / 'native-main.dump'
    write(dump, read(recovered / 'capture/main.dump', 32 * 1024 ** 2))
    os.chown(dump, 70, 70)
    name = 'sabalanerp-backup-drill-postgres-1'
    operation = root.name.removeprefix('coherent-component-')
    arguments = ['docker', 'create', '--name', name, '--label', 'com.docker.compose.project=sabalanerp-backup-drill',
                 '--label', 'com.docker.compose.service=postgres', '--label', 'sabalan.drill.operation=' + operation,
                 '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                 '--user', '70:70', '--memory', '384m', '--cpus', '1', '--pids-limit', '128', '--shm-size', '64m',
                 '--env', 'SABALAN_NATIVE_STORAGE_ROOT=/var/lib/postgresql/data',
                 '--env', 'SABALAN_NATIVE_STORAGE_MAX_BYTES=536870912',
                 '--env', 'SABALAN_NATIVE_STORAGE_RESERVE_BYTES=1073741824',
                 '--tmpfs', '/var/run/postgresql:uid=70,gid=70,mode=0700,size=16m,noexec,nosuid',
                 '--tmpfs', '/tmp:mode=1777,size=32m,noexec,nosuid', '--log-opt', 'max-size=2m', '--log-opt', 'max-file=2',
                 '--entrypoint', '/native-owner']
    for source, target, readonly_mount in [(data, '/var/lib/postgresql/data', False), (binary, '/native-owner', True),
                                           (root / 'restore.sh', '/restore.sh', True), (dump, '/component.dump', True)]:
        arguments += ['--mount', 'type=bind,src=' + str(source) + ',dst=' + target + (',readonly' if readonly_mount else '')]
    mutate(arguments + [IMAGE, '900', 'component-native-restore', '/bin/sh', '/restore.sh'], 'container-create')
    [container] = json.loads(readonly(['docker', 'inspect', name]))
    identity = container['Id']
    check(container['Image'] == IMAGE and container['Config']['User'] == '70:70'
          and container['HostConfig']['NetworkMode'] == 'none' and container['HostConfig']['ReadonlyRootfs']
          and not container['HostConfig']['PortBindings']
          and len(container['Mounts']) == 4 and all(item['Type'] == 'bind' for item in container['Mounts']), 'PRIVATE_CONTAINER_CHANGED')
    output = mutate(['docker', 'start', '--attach', identity], 'native-restore', 960)
    [finished] = json.loads(readonly(['docker', 'inspect', identity]))
    check(finished['Id'] == identity and finished['State']['Status'] == 'exited' and finished['State']['ExitCode'] == 0
          and finished['State']['Pid'] == 0 and not finished['State']['OOMKilled']
          and b'\nSABALAN_COMPONENT_RESTORED 123456789.12345678/0.00000001/original.pdf 427\n' in output
          and b'\nSABALAN_NATIVE_REAPED component-native-restore 0\n' in output
          and not (data / 'postmaster.pid').exists(), 'NATIVE_RESTORE_NOT_CLOSED')
    final_foreign = foreign()
    check(all(final_foreign.get(identity) == expected for identity, expected in original_foreign.items()),
          'FOREIGN_SERVICES_CHANGED')
    result = dict(format='sabalan-independent-coherent-diagnostic/v1', phase='COMPLETE', productionRecoveryPoint=False,
                  operation=operation, sealSha256=expected_seal, packageProofSha256=expected_package,
                  independentRsaReadbackVerified=True, tamperRejected=True, nativePostgresRestoreVerified=True,
                  migrationCount=427, restoredAmount='123456789.12345678', restoredQuantity='0.00000001',
                  attachmentSha256=sha(attachment), sqliteIntegrityVerified=True, restoredFiles=restored,
                  fileGenerationSha256=package['fileGenerationSha256'], image=IMAGE, selectedPlatformManifest=platform,
                  imageArchiveSha256=ARCHIVE_SHA, nativePostgresStoppedNaturally=True, stoppedContainer=identity,
                  foreignServicesUnchanged=original_foreign,
                  additionalForeignServicesObserved=sorted(set(final_foreign) - set(original_foreign)),
                  availableBytes=shutil.disk_usage(PRIVATE).free,
                  fullApplicationAndProductionChainAcceptanceRequired=True)
    write(root / 'independent-proof.json', json.dumps(result, sort_keys=True).encode())
    # Archive the exact active ownership record after terminal native proof;
    # never erase uncertainty merely because its kernel lock became available.
    os.rename(global_intent, root / 'closed-owner-intent.json')
    sync(root)
    sync(QA)
    completed = True
    print(json.dumps(result))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except BaseException:
        if mutated and not completed:
            # Unknown daemon/native work remains owned. No cleanup, retry,
            # competing recovery, forced stop or healthy-point publication.
            try:
                write(root / 'ownership-held-unproven.json', b'{"phase":"OWNERSHIP_HELD_UNPROVEN"}')
            except BaseException:
                pass
            while True:
                time.sleep(1)
        raise
