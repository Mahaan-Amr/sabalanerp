"""Bind canonical storage preflight to an independently observed fourth restart.
No cleanup policy, native owner, source install or image code is replaced.
"""
import hashlib
import json
import pathlib
import runpy
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = pathlib.Path(__file__).resolve().parent
Q = pathlib.Path('D:/sabalanerp-online-qa')
sha = lambda raw: hashlib.sha256(raw).hexdigest()
observation = json.loads((EVIDENCE/'RENEWAL-SEMANTICS-OBSERVATION.json').read_bytes())
raw = pathlib.Path(observation['file']).read_bytes()
assert sha(raw) == observation['sha256']
value = json.loads(raw)
assert value['result']['format'] == 'sabalan-413-current-cron-diagnostic/v1'
assert value['result']['diagnosticOnly'] is True and value['result']['qualified'] is False
assert value['result']['cronSemanticsUnchanged'] is True
assert value['result']['cronStableAcrossObservation'] is True
assert value['result']['allOriginalChildrenClosed'] is True
original = value['original']
assert original['code'] == 0 and original['signal'] is None
assert original['stdoutEof'] and original['stderrEof'] and not original['localInterrupted']
assert not original['observationFaults'] and not original['observationFaultTotal']

previous = Q/'C30-source-a-fixed-existing-gzip-stream-source-r8-third-restart-20261025/current-admission.py'
parent = previous.read_bytes()
assert sha(parent) == '0546ba63c0fdf9ac1ffc119b07cba44a4e55ea56f90fca7a2c12467c870bb70c'
source = parent.decode()
source = source.replace("assert row['restartCount'] == 2 and row['startedAt'] == '2026-10-25T06:45:49.635767039Z'",
                        "assert row['restartCount'] == 3 and row['startedAt'] == '2026-10-25T09:42:10.51237867Z'")
source = source.replace("row.update(restartCount=3, startedAt='2026-10-25T09:42:10.51237867Z')",
                        "row.update(restartCount=4, startedAt='2026-10-26T06:04:29.230523694Z')")
source = source.replace('ONLY_EXACT_OBSERVED_THIRD_RESTART_ALLOWED','ONLY_EXACT_OBSERVED_FOURTH_RESTART_ALLOWED')
source = source.replace("base, _, custody = old['observed_transition']()", """base, _, custody = old['observed_transition']()
    prior = load(pathlib.Path(%r), %r)
    prior_base, prior_native, _ = prior['observed']()
    assert prior_base == base
    base = copy.deepcopy(base)
    base['expectedEight'] = prior_native['currentEight']""" % (str(previous), sha(parent)))
# Change only the new independent observation reference. Keep all older proofs.
start = source.index('OBSERVATION = ')
end = source.index('\nCONTRACT = ', start)
source = source[:start]+'OBSERVATION = '+repr(observation)+source[end:]
source = source.replace('sabalan-source-a-third-restart-readonly/v1','sabalan-source-a-fourth-restart-readonly/v1')
source = source.replace('observedThirdBackendRestartTransition','observedFourthBackendRestartTransition')
source = source.replace('sabalan-source-a-fourth-restart-readonly/v1','sabalan-413-current-cron-diagnostic/v1')
source = source.replace("['protectedFilesUnchanged', 'cronUnchanged', 'sourceCheckoutUnchanged', 'backendStateVerified']",
                        "['protectedFilesUnchanged', 'sourceCheckoutUnchanged', 'backendStateVerified']")
marker = "    transition(base['expectedEight'], native['currentEight'])"
assert source.count(marker) == 1
source = source.replace(marker, """    assert native['diagnosticOnly'] is True and native['qualified'] is False
    assert native['cronSemanticsUnchanged'] is True and native['cronStableAcrossObservation'] is True
    assert native['cronExpected'] == base['cronPins']
    assert native['cronSemanticsExpected'] == base['cronRenewalSemantics']
    assert all(row == base['cronRenewalSemantics'] for row in native['cronSemanticsActual'])
    assert native['cronObserved'][0] == native['cronObserved'][-1]
    changed = [(a,b) for a,b in zip(base['cronPins'],native['cronObserved'][0]) if a != b]
    assert len(base['cronPins']) == len(native['cronObserved'][0]) == 3 and len(changed) == 1
    before, after = changed[0]
    assert before['path'] == after['path'] == '/var/lib/docker/volumes/sabalanerp_certbot_conf/_data/renewal/sabalanerp.com.conf'
    assert before['sha256'] == '87b430d1d2835ca5a6b0c7a16da922a5f52c5709c149a688c83c46be5fe8657b'
    assert after['sha256'] == '54814f9643c9922f03b309e2e81c06c52eed8e13012ed6bd78d0f982bb4c82a2'
    assert {key for key in before if before[key] != after[key]} == {'ctimeNs','inode','mtimeNs','sha256'}
    assert after['ctimeNs'] > before['ctimeNs'] and after['mtimeNs'] > before['mtimeNs']
    assert after['uid'] == 0 and after['nlink'] == 1 and not after['mode'] & 0o022
    base['cronPins'] = copy.deepcopy(native['cronObserved'][0])
"""+marker)
compile(source, 'exact-fourth-restart-admission', 'exec')

private_file = Q/'C30-strict-complete-actual-plan-source-r6-observed-renewal-20261025/prepare.py'
private_raw = private_file.read_bytes()
assert sha(private_raw) == '0e11fddceb398d90eced7650f59b6be92a223277c7bdd971376ccbd4f8ba28cb'
private = runpy.run_path(str(private_file), run_name='private_directory_dependency')
directory = Q/('ticket413-fourth-restart-preflight-source-'+pathlib.Path(sys.argv[1]).stem)
private['private_output'](directory)
admission = private['write'](directory/'current-admission.py', source.encode())

template_file = ROOT/'.scratch/prepare-native-source-a.py'
template = template_file.read_text()
expected = json.loads((EVIDENCE/'preflight-producer-reference.json').read_bytes())
assert sha(template_file.read_bytes()) == expected['sha256']
template = template.replace("ad=runpy.run_path(str(R8/'current-admission.py'))", 'ad=runpy.run_path('+repr(admission['file'])+')')
template = template.replace('R8.name', repr(directory.name))
template = template.replace("sha((R8/'current-admission.py').read_bytes())", repr(admission['sha256']))
template = template.replace('ROOT=pathlib.Path(__file__).resolve().parent.parent','ROOT=pathlib.Path('+repr(str(ROOT))+')')
prepared = private['write'](directory/'prepare-preflight.py',template.encode())
sys.argv = [prepared['file'],*sys.argv[1:]]
runpy.run_path(prepared['file'],run_name='__main__')
