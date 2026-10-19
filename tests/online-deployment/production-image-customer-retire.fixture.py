import hashlib
import importlib.util
import itertools
import json
import os
from pathlib import Path
import stat
import shutil
import subprocess
import sys

if sys.flags.optimize:
    raise RuntimeError('PYTHON_ASSERTIONS_REQUIRED')
root = Path(sys.argv[1])
assert root.parent == Path('/root/sabalan-recovery-private/native-qa')
assert root.name.startswith('actual-image-customer-') and root.resolve(strict=True) == root
assert root.stat().st_uid == 0 and not root.stat().st_mode & 0o077
closure = json.loads((root / 'daemon-closure.json').read_text())
assert closure['backendClosed'] and closure['postgresClosed'] and closure['taggedSqlCount'] == 0
assert closure['preparedTransactionCount'] == 0 and closure['containersRemovedWithoutForce']
command = json.loads((root / 'docker-command-active.json').read_text())
assert command['token'] == 'retire-derived' and command['phase'] == 'ACTIVE'
self_file = Path(__file__)
assert self_file in [root / 'retire.py', root / 'retire-with-process-references.py'] and self_file.resolve(strict=True) == self_file
assert command['arguments'] == ['python3', '-I', '-B', str(self_file), str(root)]
guard_file = root / 'mount_guard.py'
assert guard_file.resolve(strict=True) == guard_file
assert hashlib.sha256(guard_file.read_bytes()).hexdigest() == '165101a51ecc00db4b12ff65a5b2fe55f7037b4407ccdde5e799afa7bda54cd7'
spec = importlib.util.spec_from_file_location('closed_mount_guard', guard_file)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
# The controller already isolated its mount namespace before daemon work. This
# child inherits it, so host mount propagation cannot race the retirement scan.
targets = [root / 'pgdata', root / 'restore-input.tar']
docker = ['docker', '--host', 'unix:///var/run/docker.sock']
all_containers = subprocess.check_output([*docker, 'ps', '-aq'], text=True).split()
containers = json.loads(subprocess.check_output([*docker, 'inspect', *all_containers], text=True)) if all_containers else []
for container in containers:
    for mount in container.get('Mounts', []):
        if mount.get('Type') != 'bind':
            continue
        source = Path(mount['Source'])
        for target in targets:
            assert source != target and target not in source.parents and source not in target.parents, 'DERIVED_PATH_STILL_REFERENCED'
identity = closure['derivedIdentities']
count = total = 0
inventories = {}
for target in targets:
    assert target.parent == root and target.resolve(strict=True) == target
    before = target.lstat()
    assert [before.st_dev, before.st_ino] == identity[target.name]
    guard.assert_no_nested_mounts(target)
    entries = itertools.chain([target], target.rglob('*')) if target.is_dir() else [target]
    identities = set()
    for entry in entries:
        value = entry.lstat()
        assert stat.S_ISDIR(value.st_mode) or (stat.S_ISREG(value.st_mode) and value.st_nlink == 1)
        assert value.st_dev == before.st_dev and value.st_uid == 70
        identities.add((value.st_dev, value.st_ino))
        if stat.S_ISREG(value.st_mode):
            total += value.st_size
        count += 1
        assert total <= 1536 * 1024**2 and count <= 250000
    inventories[target] = identities
    if target.is_dir():
        assert not (target / 'postmaster.pid').exists()
    else:
        assert target.stat().st_size == 378808320
        checksum = hashlib.sha256()
        with target.open('rb') as stream:
            while chunk := stream.read(1024**2):
                checksum.update(chunk)
        assert checksum.hexdigest() == 'c4b485ccc756ea48e08a72ea9c8dbdfd00aa9d1a892c63b0788985f699957c09'

reference_file = root / 'closed_process_references.py'
assert reference_file.resolve(strict=True) == reference_file
assert hashlib.sha256(reference_file.read_bytes()).hexdigest() == 'a6570121bc431553a3f215ccaf73063d642921501fe8ab1b7310a8ec4175ff4a'
reference_spec = importlib.util.spec_from_file_location('closed_process_references', reference_file)
references = importlib.util.module_from_spec(reference_spec)
reference_spec.loader.exec_module(references)
censuses = []
for target in targets:
    # Check all remaining freshly inventoried objects immediately before each
    # deletion, including FDs, mmap-only, cwd and chroot references.
    censuses.append(references.assert_no_process_references(set().union(*inventories.values())))
    assert [target.lstat().st_dev, target.lstat().st_ino] == identity[target.name]
    if target.is_dir(): shutil.rmtree(target)
    else: target.unlink()
    assert not target.exists()
    del inventories[target]
descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
print(json.dumps({'exactDerivedPathsRetired': True, 'logicalBytesRetired': total, 'entriesRetired': count,
                  'processReferenceCensuses': censuses,
                  'sourceBaseAndImagesRetained': True, 'physicalPrivacyErasureCertified': False}))
