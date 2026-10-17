"""Actual Linux independent file generations and interrupted native capture.

Runs only inside the existing project's private diagnostic volume. No database,
canonical service, real business file or recovery point is modified.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


root = Path(sys.argv[1])
assert str(root).startswith('/app/online-runtime-acceptance/file-generations-')
assert root.resolve(strict=True) == root
spec = importlib.util.spec_from_file_location('file_generations', root / 'recovery-file-generations.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def source(directory, name='uploads'):
    value = directory.stat()
    return {'name': name, 'path': str(directory), 'device': str(value.st_dev), 'inode': str(value.st_ino)}


def expect_error(code, run):
    try:
        run()
    except RuntimeError as error:
        assert str(error) == code, (str(error), code)
    else:
        raise AssertionError('Expected ' + code)


if len(sys.argv) == 4 and sys.argv[2] in ('capture-child', 'seal-child'):
    gate = int(sys.argv[3])
    gate_stat = os.fstat(gate)
    if sys.argv[2] == 'seal-child':
        store = module.FileGenerations(str(root / 'seal-store'), gate, gate_stat.st_dev, gate_stat.st_ino)
        original_sync = os.fsync

        def interrupted_sync(fd):
            if os.readlink('/proc/self/fd/' + str(fd)).endswith('/manifest.json'):
                os.kill(os.getpid(), signal.SIGSTOP)
            return original_sync(fd)

        os.fsync = interrupted_sync
        store.capture([source(root / 'live')], 'e' * 64)
    else:
        store = module.FileGenerations(str(root / 'crash-store'), gate, gate_stat.st_dev, gate_stat.st_ino)
        store.capture([source(root / 'crash-source')], 'c' * 64)
    raise AssertionError('Capture unexpectedly finished before interruption')

gate_path = root / 'deployment-write-admission.lock'
gate = os.open(gate_path, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
gate_stat = os.fstat(gate)
store_root, live = root / 'store', root / 'live'
store_root.mkdir(mode=0o700)
live.mkdir(mode=0o700)
expect_error('FILE_GENERATION_EXCLUSIVE_GATE_REQUIRED', lambda: module.FileGenerations(
    str(store_root), gate, gate_stat.st_dev, gate_stat.st_ino))
fcntl.flock(gate, fcntl.LOCK_SH)
expect_error('FILE_GENERATION_EXCLUSIVE_GATE_REQUIRED', lambda: module.FileGenerations(
    str(store_root), gate, gate_stat.st_dev, gate_stat.st_ino))
fcntl.flock(gate, fcntl.LOCK_EX)
store = module.FileGenerations(str(store_root), gate, gate_stat.st_dev, gate_stat.st_ino)
(live / 'invoice.pdf').write_bytes(b'ORIGINAL-PDF-123456789.12345678')
(live / 'deleted.txt').write_bytes(b'OLD-DELETED-ATTACHMENT')
first = store.capture([source(live)], '1' * 64)
assert first['manifest']['deleted'] == []
# A legacy in-place writer must not modify an already retained generation.
(live / 'invoice.pdf').write_bytes(b'NEW-PDF-0.00000001')
(live / 'deleted.txt').unlink()
(live / 'added.txt').write_bytes(b'NEW-PDF-0.00000001')
second = store.capture([source(live)], '2' * 64)
assert second['manifest']['previousSha256'] == first['sha256']
assert second['manifest']['deleted'] == [{'source': 'uploads', 'path': 'deleted.txt'}]
assert len(list((store_root / 'objects').iterdir())) == 3
restore_first, restore_second = root / 'restore-first', root / 'restore-second'
first_result = store.restore(first['sha256'], str(restore_first))
second_result = store.restore(second['sha256'], str(restore_second))
assert (restore_first / 'uploads/invoice.pdf').read_bytes() == b'ORIGINAL-PDF-123456789.12345678'
assert (restore_first / 'uploads/deleted.txt').read_bytes() == b'OLD-DELETED-ATTACHMENT'
assert (restore_second / 'uploads/invoice.pdf').read_bytes() == b'NEW-PDF-0.00000001'
assert (restore_second / 'uploads/added.txt').read_bytes() == b'NEW-PDF-0.00000001'
assert not (restore_second / 'uploads/deleted.txt').exists()
assert (restore_second / 'uploads/invoice.pdf').stat().st_ino != (live / 'invoice.pdf').stat().st_ino
try:
    store.restore(first['sha256'], str(restore_second))
except FileExistsError:
    pass
else:
    raise AssertionError('Restore merged into an existing target')

# Prove directory aliases, unfinished writes and unexpected native special files
# cannot turn into a completed generation. Each failed intent remains blocking.
refusals = []
for case in ('symlink', 'unfinished', 'fifo'):
    target_store, target_source = root / (case + '-store'), root / (case + '-source')
    target_store.mkdir(mode=0o700)
    target_source.mkdir(mode=0o700)
    if case == 'symlink':
        (target_source / 'alias').symlink_to(live)
    elif case == 'unfinished':
        (target_source / '.sabalan-file-interrupted.tmp').write_bytes(b'partial')
    else:
        os.mkfifo(target_source / 'pipe', 0o600)
    candidate = module.FileGenerations(str(target_store), gate, gate_stat.st_dev, gate_stat.st_ino)
    code = 'FILE_GENERATION_UNFINISHED_WRITER' if case == 'unfinished' else 'FILE_GENERATION_SOURCE_NOT_REGULAR'
    expect_error(code, lambda: candidate.capture([source(target_source)], 'a' * 64))
    expect_error('FILE_GENERATION_CAPTURE_UNFINISHED', lambda: candidate.capture([source(target_source)], 'b' * 64))
    refusals.append(case)

# A same-size tamper must fail native verification, even with intact metadata.
corrupt = store_root / 'objects' / hashlib.sha256(b'NEW-PDF-0.00000001').hexdigest()
os.chmod(corrupt, 0o600)
corrupt.write_bytes(b'X' * len(b'NEW-PDF-0.00000001'))
os.chmod(corrupt, 0o400)
expect_error('FILE_GENERATION_OBJECT_CHANGED', lambda: store.verify(second['sha256']))

# Oversized canonical metadata is refused before any named record is created.
metadata = root / 'metadata-boundary'
metadata.mkdir(mode=0o700)
metadata_fd = os.open(metadata, os.O_RDONLY | os.O_DIRECTORY)
try:
    expect_error('FILE_GENERATION_RECORD_TOO_LARGE', lambda: module.publish_record(
        metadata_fd, 'manifest.json', {'oversized': 'x' * (16 * 1024 * 1024)}))
    assert not (metadata / 'manifest.json').exists()
finally:
    os.close(metadata_fd)

# Actual Linux source paths can expand substantially under canonical JSON.
# Thirty-two independent native roots, with control bytes legal in filenames,
# exceed the intent reader budget while remaining below the manifest budget.
inventory_store = root / 'inventory-store'
inventory_store.mkdir(mode=0o700)
inventory_live = root / 'inventory-live'
inventory_live.mkdir(mode=0o700)
for index in range(18):
    inventory_live = inventory_live / ('\x01' * 195 + str(index))
    inventory_live.mkdir(mode=0o700)
inventory = []
for index in range(32):
    directory = inventory_live / ('source-' + str(index))
    directory.mkdir(mode=0o700)
    inventory.append(source(directory, 'uploads-' + str(index)))
inventory_owner = module.FileGenerations(str(inventory_store), gate, gate_stat.st_dev, gate_stat.st_ino)
expect_error('FILE_GENERATION_RECORD_TOO_LARGE', lambda: inventory_owner.capture(inventory, '9' * 64))
assert list((inventory_store / 'captures').iterdir()) == []

# Stop the actual publisher at the native fsync boundary: full canonical bytes
# are readable, but its manifest sync has not run. The child is then reaped.
(root / 'seal-store').mkdir(mode=0o700)
sealer = subprocess.Popen([sys.executable, __file__, str(root), 'seal-child', str(gate)],
                          pass_fds=(gate,), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
deadline = time.monotonic() + 10
while time.monotonic() < deadline and sealer.poll() is None:
    fields = Path('/proc/' + str(sealer.pid) + '/stat').read_text().rsplit(')', 1)[1].split()
    if fields[0] == 'T':
        break
    time.sleep(0.001)
else:
    raise AssertionError('Publisher did not reach the manifest fsync boundary')
sealer.send_signal(signal.SIGKILL)
_, error = sealer.communicate(timeout=5)
assert sealer.returncode == -signal.SIGKILL, error.decode()
sealed_manifest = list((root / 'seal-store/captures').glob('*/manifest.json'))
assert len(sealed_manifest) == 1
sealed_sha = hashlib.sha256(sealed_manifest[0].read_bytes()).hexdigest()
adopter = module.FileGenerations(str(root / 'seal-store'), gate, gate_stat.st_dev, gate_stat.st_ino)
original_sync = os.fsync


def denied_manifest_sync(fd):
    if os.readlink('/proc/self/fd/' + str(fd)).endswith('/manifest.json'):
        raise OSError(5, 'Diagnostic native fsync EIO')
    return original_sync(fd)


os.fsync = denied_manifest_sync
try:
    try:
        adopter.verify(sealed_sha)
    except OSError as error:
        assert error.errno == 5
    else:
        raise AssertionError('Readable cached manifest was adopted without synchronization')
finally:
    os.fsync = original_sync
assert adopter.verify(sealed_sha)['captureId'] == 'e' * 64
assert adopter.restore(sealed_sha, str(root / 'restore-adopted'))['files'] == 2

# Seed an independently encoded 10,000-record empty lineage at the public
# history boundary. Reject the next capture without breaking retained restores.
capacity_root = root / 'capacity-store'
capacity_root.mkdir(mode=0o700)
capacity_store = module.FileGenerations(str(capacity_root), gate, gate_stat.st_dev, gate_stat.st_ino)
previous = None
declared = [source(live)]
canonical = lambda value: (json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(',', ':')) + '\n').encode('ascii')
for index in range(1, 10001):
    identifier = format(index, '064x')
    directory = capacity_root / 'captures' / (str(index).zfill(12) + '-' + identifier)
    directory.mkdir(mode=0o700)
    intent = {'format': 'sabalan-file-generation-intent/v1', 'generation': index,
              'captureId': identifier, 'previousSha256': previous, 'sources': declared}
    intent_raw = canonical(intent)
    manifest = dict(intent, format='sabalan-file-generation/v1', entries=[], deleted=[],
                    intentSha256=hashlib.sha256(intent_raw).hexdigest())
    raw = canonical(manifest)
    for name, data in [('intent.json', intent_raw), ('manifest.json', raw)]:
        (directory / name).write_bytes(data)
        os.chmod(directory / name, 0o400)
    previous = hashlib.sha256(raw).hexdigest()
expect_error('FILE_GENERATION_HISTORY_CAPACITY', lambda: capacity_store.capture(declared, 'f' * 64))
assert len(list((capacity_root / 'captures').iterdir())) == 10000
assert capacity_store.restore(previous, str(root / 'restore-at-capacity'))['files'] == 0

(root / 'crash-store').mkdir(mode=0o700)
(root / 'crash-source').mkdir(mode=0o700)
with open(root / 'crash-source/large.bin', 'xb') as large:
    large.truncate(64 * 1024 * 1024)
    large.flush()
    os.fsync(large.fileno())
child = subprocess.Popen([sys.executable, __file__, str(root), 'capture-child', str(gate)],
                         pass_fds=(gate,), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
observed = None
deadline = time.monotonic() + 10
while time.monotonic() < deadline and child.poll() is None:
    entries = list((root / 'crash-store/objects').glob('.pending-*'))
    for entry in entries:
        value = entry.stat()
        if value.st_size > 0:
            observed = {'bytes': value.st_size, 'inode': str(value.st_ino), 'device': str(value.st_dev)}
            break
    if observed:
        break
    time.sleep(0.001)
assert observed, 'No actual partially written object observed'
child.send_signal(signal.SIGKILL)
_, error = child.communicate(timeout=5)
assert child.returncode == -signal.SIGKILL, error.decode()
replacement = module.FileGenerations(str(root / 'crash-store'), gate, gate_stat.st_dev, gate_stat.st_ino)
expect_error('FILE_GENERATION_CAPTURE_UNFINISHED', lambda: replacement.capture([source(live)], 'd' * 64))
assert not list((root / 'crash-store/captures').glob('*/manifest.json'))
assert (root / 'crash-source/large.bin').stat().st_size == 64 * 1024 * 1024
fcntl.flock(gate, fcntl.LOCK_UN)
expect_error('FILE_GENERATION_EXCLUSIVE_GATE_REQUIRED', lambda: replacement.verify(first['sha256']))
os.close(gate)
report = {'format': 'sabalan-file-generations-native/v1', 'pass': True,
                  'first': dict(first_result, sha256=first['sha256']),
                  'second': dict(second_result, sha256=second['sha256']),
                  'deletionLineage': second['manifest']['deleted'], 'refusedSources': refusals,
                  'sameSizeTamperRefused': True, 'interruptedNativeChild': observed,
                  'manifestSizeBoundRefusedBeforeCreation': True,
                  'oversizedNativeSourceInventoryRefusedBeforeCapture': True,
                  'cachedManifestSyncFailureRefused': True, 'interruptedManifestDurablyAdopted': True,
                  'captureCapacity': 10000, 'retainedRestoreAtCapacity': True,
                  'nativeChildSignal': 'SIGKILL', 'partialCaptureRetained': True,
                  'replacementRefused': True, 'workingRoot': str(root)}
with (root / 'native-proof.json').open('x') as proof:
    os.chmod(root / 'native-proof.json', 0o400)
    json.dump(report, proof, sort_keys=True)
    proof.flush()
    os.fsync(proof.fileno())
module.sync_directory(str(root))
print(json.dumps(report))
