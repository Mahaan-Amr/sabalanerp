"""Actual bounded history and native-lock refusal at publication capacity.

Historical closure records here are SYNTHETIC reader fixtures, not certification
of a recovered point. The scoped overlap fixture separately proves real closure.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import sys

root = Path(sys.argv[1])
assert root.parent == Path('/app/online-runtime-acceptance') and root.name.startswith('online-native-')
spec = importlib.util.spec_from_file_location('admission', root / 'online-capture-admission.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
source = json.loads((root / 'index.json').read_bytes())['grants'][0]['scope']
coordination = root / 'capacity-case'
coordination.mkdir(mode=0o700)
scope = dict(source, purpose='capture', role='control', coordinationDirectory=str(coordination))
descriptors = {}
for key, filename, access in [('gate', 'deployment-write-admission.lock', fcntl.LOCK_EX),
                              ('interlock', 'deployment-runtime-control.lock', fcntl.LOCK_SH),
                              ('worker', 'deployment-online-worker.lock', fcntl.LOCK_EX)]:
    file = coordination / filename
    fd = os.open(file, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
    fcntl.flock(fd, access | fcntl.LOCK_NB)
    value = os.fstat(fd)
    scope[key] = dict(file=str(file), device=str(value.st_dev), inode=str(value.st_ino), ownerUid=value.st_uid)
    descriptors[key] = fd
scope['nativeDirectory'] = str(coordination / 'online/native' / scope['runtimeId'])
Path(scope['nativeDirectory']).mkdir(mode=0o700, parents=True)
private = Path(scope['nativeDirectory']) / 'deployment-runtime-control.lock'
descriptors['private'] = os.open(private, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
fcntl.flock(descriptors['private'], fcntl.LOCK_EX | fcntl.LOCK_NB)
directory = coordination / 'online/admission'
directory.mkdir(mode=0o700)
(directory / 'staging').mkdir(mode=0o700)


def write(file, raw, mode=0o400):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        os.fchmod(fd, mode)
        offset = 0
        while offset < len(raw):
            written = os.write(fd, raw[offset:])
            assert written > 0
            offset += written
    finally:
        os.close(fd)


definition = module.encode(dict(format='sabalan-online-admission-scope/v1',
                                **{key: scope[key] for key in ['gate', 'interlock', 'worker', 'database']}))
write(directory / 'scope.json', definition)
scope['admission'] = dict(directory=str(directory), scopeSha256=module.digest(definition))
loaded = dict(scope=scope, sha256='a' * 64)
guardian = module.birth()
capture = dict(runtimeId=scope['runtimeId'], scopeSha256=loaded['sha256'], guardian=guardian)
native = module.encode(dict(phase='QUIESCENT', nativeReaped=True, databaseQuiet=True, nativeStatus=0,
                            stoppedBySignal=False, guardian=guardian, onlineScope=loaded))
write(Path(scope['nativeDirectory']) / 'deployment-runtime-native.json', native, 0o600)
previous = None
for generation in range(8191):
    phase = 'OPEN' if generation % 2 == 0 else 'CLOSING'
    value = dict(format='sabalan-online-capture-admission/v1', generation=generation, phase=phase,
                 previousSha256=module.digest(previous) if previous else None,
                 capture=capture if generation else None,
                 closureSha256=module.digest(native) if generation and phase == 'OPEN' else None)
    previous = module.encode(value)
    write(directory / (str(generation).zfill(8) + '.json'), previous)
barrier = module.CaptureAdmission(loaded)
barrier.assert_owner(descriptors)
state, raw = barrier.state()
assert state['phase'] == 'OPEN' and state['generation'] == 8190
try:
    barrier.begin(descriptors)
    raise AssertionError('CAPACITY_CLOSING_WAS_PUBLISHED')
except RuntimeError as error:
    assert str(error) == 'ONLINE_CAPTURE_ADMISSION_UNPROVEN'
assert not (directory / '00008191.json').exists()
assert not os.listdir(directory / 'staging')
assert (directory / '00008190.json').read_bytes() == raw
assert barrier.state()[0]['phase'] == 'OPEN'
for descriptor in descriptors.values():
    os.close(descriptor)
print(json.dumps(dict(passResult=True, verifiedHistoryEvents=8191, capacityRefusedBeforeClosing=True,
                      openBytesRetained=True, historicalClosuresAreSynthetic=True)))
