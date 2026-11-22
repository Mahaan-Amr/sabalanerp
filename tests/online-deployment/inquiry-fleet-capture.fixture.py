"""Actual owned fleet census; no snapshot or recovery-point publication."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import traceback
import copy

root = Path(sys.argv[1])
configuration = json.loads((root / 'fixture.json').read_text())
spec = importlib.util.spec_from_file_location('actual_fleet', root / 'online-backend-boundary.py')
fleet = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fleet)
try:
    observed = fleet.inspect_registered_backend_boundary(os.environ['DATABASE_URL'])
    inquiry = [row for row in observed['runtimes'] if row.get('engine') == 'sqlite']
    assert len(inquiry) == 1 and inquiry[0]['runtimeId'] == configuration['runtimeId']
    assert inquiry[0]['sqlite']['file'] == configuration['databaseFile']
    assert inquiry[0]['phase'] == configuration['expectedPhase']
    assert observed['inquiryBoundary'] is False and observed['productionRecoveryPoint'] is False
    api = fleet.load('inquiry_negative_checks', 'online-inquiry-boundary.py')
    native_directory = Path(configuration['coordination']) / 'online/native' / configuration['runtimeId']
    work_directory = Path(configuration['coordination']) / 'online/work' / configuration['runtimeId']
    native, raw = fleet.read(native_directory / 'deployment-runtime-native.json')
    loaded = native['onlineScope']
    admission = fleet.load('inquiry_negative_admission', 'online-capture-admission.py')
    rejected = []

    def refused(name, action):
        try:
            action()
        except (RuntimeError, FileNotFoundError, KeyError):
            rejected.append(name)
            return
        raise AssertionError('NEGATIVE_CENSUS_ACCEPTED:' + name)

    # Mutate only private in-memory copies, never real authority or records.
    for name, change in [
        ('legacy-format', lambda value: value.update(format='sabalan-inquiry-native/v1')),
        ('backend-closure-substitution', lambda value: value.update(databaseQuiet=True)),
        ('wrong-url-hash', lambda value: value['sqlite'].update(databaseUrlSha256='invalid')),
        ('wrong-file-inode', lambda value: value['sqlite'].update(inode='1')),
        ('wrong-grant', lambda value: value['onlineScope'].update(sha256='0' * 64)),
        ('wrong-lock-declaration', lambda value: value['onlineLocks'].update(worker={})),
    ]:
        changed = copy.deepcopy(native)
        change(changed)
        refused(name, lambda: api.inspect_native(changed, fleet.encode(changed), loaded,
                                                configuration['expectedPhase'] == 'ACTIVE', admission, fleet.encode))
    refused('wrong-kernel-lock-state', lambda: api.inspect_native(native, raw, loaded,
                                    configuration['expectedPhase'] != 'ACTIVE', admission, fleet.encode))
    source = dict(path=native['sqlite']['file'], device=native['sqlite']['device'], inode=native['sqlite']['inode'])
    api.assert_capture_source(observed, source)
    refused('wrong-snapshot-source', lambda: api.assert_capture_source(observed, dict(source, inode='1')))
    # An orphan ACTIVE work record must remain refused even when its native
    # guardian has actually closed. Keep this synthetic copy as evidence.
    orphan = root / 'orphan-work'
    orphan.mkdir(mode=0o700)
    for name in ['scope.json', 'claim.json', 'state.json']:
        value, original = fleet.read(work_directory / name)
        if name == 'state.json':
            value.update(phase='ACTIVE')
            original = fleet.encode(value)
        descriptor = os.open(orphan / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            assert os.write(descriptor, original) == len(original)
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    refused('orphan-active-work', lambda: fleet.inspect_work_claim(orphan, configuration['runtimeId'],
        loaded['sha256'], native, inquiry[0]['activeClaimSha256'], (orphan / 'scope.json').read_bytes()))
    result = dict(actualFleetCensus=True, boundary=observed, rejected=rejected)
except Exception as error:
    # Preserve a real failing observation but let this no-op diagnostic child
    # finish normally. No capture artifact or release is ever published here.
    result = dict(actualFleetCensus=False, failure=type(error).__name__ + ':' + str(error),
                  frames=[dict(file=Path(frame.filename).name, line=frame.lineno) for frame in traceback.extract_tb(error.__traceback__)])
with open(root / 'observed.json', 'x') as output:
    os.fchmod(output.fileno(), 0o600)
    json.dump(result, output, sort_keys=True)
    output.flush()
    os.fsync(output.fileno())
