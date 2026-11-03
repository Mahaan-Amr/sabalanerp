"""Content-crypto admission for the exact third observed backend restart.

No release authority: retains the complete historical admission chain, then
requires the new independent read-only observation and a fresh native baseline.
Only the two observed restart fields may differ. Cause remains unproven.
"""
import copy
import hashlib
import json
import pathlib
import runpy

Q = pathlib.Path('D:/sabalanerp-online-qa')
OLD = Q / 'C30-observed-second-backend-restart-current-admission-source-r2-20261025/admission.py'
OLD_SHA = '8c7dc32fd6ad614f2931865141ee46f63c83c19506176730de7383ccdc38003b'
OBSERVATION = {'file': str(Q / 'ticket412-current-readonly-e120fb065e4b4184a2b4e5985fde522d/observation.json'),
               'sha256': '965cdff3d790316b4e9c70f653de95700e0c3b218a7abc7af6fb0e733cb138ba'}
CONTRACT = Q / 'C29-installed45cab-healthy-baseline-source-r2-exact-bytes-20261024/baseline-contract.py'
CONTRACT_SHA = '30e4eb939f9cf7f528d4ba09504bbc1e0462ed3be11520467af571479d8f44c1'


def checked(file, digest):
    raw = pathlib.Path(file).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == digest
    return raw


def load(file, digest):
    scope = {'__name__': 'fixed_source_a_admission_dependency', '__file__': str(file)}
    exec(compile(checked(file, digest), str(file), 'exec'), scope)
    return scope


def transition(previous, current):
    expected = copy.deepcopy(previous)
    rows = [r for r in expected if r['service'] == 'backend']
    assert len(rows) == 1
    row = rows[0]
    assert row['id'] == '0d7dc99fcd9874316427f4f7e23d720e44662b6e6ee27dcd8b84ab80ed503345'
    assert row['restartCount'] == 2 and row['startedAt'] == '2026-10-25T06:45:49.635767039Z'
    row.update(restartCount=3, startedAt='2026-10-25T09:42:10.51237867Z')
    assert current == expected, 'ONLY_EXACT_OBSERVED_THIRD_RESTART_ALLOWED'
    return expected


def observed():
    old = load(OLD, OLD_SHA)
    base, _, custody = old['observed_transition']()
    value = custody.read(OBSERVATION)
    native = value['result']
    original = value['original']
    assert original['code'] == 0 and original['signal'] is None
    assert original['stdoutEof'] is True and original['stderrEof'] is True
    assert original['stderrBytes'] == 0 and original['observationFaults'] == []
    assert original['observationFaultCounts'] == {} and original['observationFaultTotal'] == 0
    assert original['localInterrupted'] is False and original['cancellations'] == []
    assert original['installedSshHeldAcrossSameOriginal'] is True
    assert custody.read(original['stdout']) == native
    custody.pin(value['source']['file'], value['source']['sha256'])
    saved = custody.read({'file': str(pathlib.Path(OBSERVATION['file']).parent / 'stageSource.original-closed.json'),
                          'sha256': hashlib.sha256((pathlib.Path(OBSERVATION['file']).parent / 'stageSource.original-closed.json').read_bytes()).hexdigest()})
    compared = copy.deepcopy(original)
    compared.pop('installedSshHeldAcrossSameOriginal')
    assert saved == compared
    assert native['format'] == 'sabalan-source-a-third-restart-readonly/v1'
    assert native['allOriginalChildrenClosed'] is True and native['productionAdmission'] is False
    assert native['restartCauseProven'] is False
    assert all(native[k] is True for k in ['protectedFilesUnchanged', 'cronUnchanged', 'sourceCheckoutUnchanged', 'backendStateVerified'])
    for child in native['children']:
        assert child['code'] == 0 and child['pipesClosed'] is True and child['observationFault'] is None
    assert native['expectedServiceConfigurationSha256'] == old['sha'](old['canonical'](base['expectedServiceConfiguration']))
    transition(base['expectedEight'], native['currentEight'])
    return base, native, custody


def current_spec(reference, c=None):
    base, observation, owned = observed()
    c = c or owned
    envelope = c.read(reference)
    fresh = load(CONTRACT, CONTRACT_SHA)['validate_original_baseline'](envelope, c.read(envelope['original']))
    transition(base['expectedEight'], fresh['expectedEight'])
    assert fresh['expectedEight'] == observation['currentEight']
    assert fresh['protectedBefore'] == fresh['protectedAfter'] == base['protectedFiles']
    receipt = {**reference, 'original': envelope['original']}
    spec = copy.deepcopy(base)
    spec.update(expectedEight=fresh['expectedEight'], freshRuntimeBaseline=fresh, freshRuntimeBaselineReceipt=receipt)
    spec['observedPostCheckpointReconciliationTransition']['currentBaselineReceipt'] = receipt
    spec['observedThirdBackendRestartTransition'] = {
        'observation': OBSERVATION, 'causeKnown': False, 'productionAdmission': False,
        'liveFullConfigurationGuardRequired': True,
    }
    return spec


def validate_spec(spec):
    ref = spec['freshRuntimeBaselineReceipt']
    assert spec == current_spec({'file': ref['file'], 'sha256': ref['sha256']})
    return spec


validate_completed_source_install = validate_spec
