"""Exercise the exact rendered guards without SSH, Docker, or new source materialization."""
import copy
import json
import pathlib
import textwrap

HERE = pathlib.Path(__file__).resolve().parent
p = HERE/'prepare-current-preflight.py'
source = p.read_text()
scope = {'__file__': str(p), '__name__': 'source_only_renderer_test'}
exec(compile(source[:source.index('\nprivate_file = ')], str(p), 'exec'), scope)
module = {'__name__': 'exact_admission_test', '__file__': 'prospective-current-admission.py'}
exec(compile(scope['source'], 'prospective-current-admission.py', 'exec'), module)
q = pathlib.Path('D:/sabalanerp-online-qa')
before = json.loads((q/'source-install-healthy-baseline-20261025T202608776608Z.json').read_bytes())['result']['expectedEight']
after = json.loads((q/'source-install-healthy-baseline-20261026T061109827783Z.json').read_bytes())['result']['expectedEight']
assert module['transition'](before, after) == after
rejected = 0
for field, value in [('restartCount', 5), ('startedAt', '2026-10-26T06:04:30Z'),
                     ('id', 'f'*64), ('image', 'sha256:'+'f'*64), ('health', 'unhealthy'), ('status', 'exited')]:
    candidate = copy.deepcopy(after)
    next(row for row in candidate if row['service'] == 'backend')[field] = value
    try:
        module['transition'](before, candidate)
    except AssertionError:
        rejected += 1
    else:
        raise AssertionError('RESTART_MUTANT_ACCEPTED:'+field)
base, native, _ = module['observed']()
assert base['cronPins'] == native['cronObserved'][0]
# Execute the actual rendered renewal guard body at its data boundary.
rendered = scope['source']
start = rendered.index("    assert native['diagnosticOnly']")
end = rendered.index("    transition(base['expectedEight'], native['currentEight'])", start)
guard = 'def renewal_guard(base,native):\n'+textwrap.indent(textwrap.dedent(rendered[start:end]), '    ')
namespace = {'copy': copy}
exec(compile(guard, 'exact_rendered_renewal_guard', 'exec'), namespace)
def run(value):
    original = copy.deepcopy(base)
    original['cronPins'] = copy.deepcopy(native['cronExpected'])
    namespace['renewal_guard'](original, value)
    return original
assert run(native)['cronPins'] == native['cronObserved'][0]
for field, value in [('sha256', '0'*64), ('mode', 0o666), ('uid', 1), ('nlink', 2), ('bytes', 999)]:
    candidate = copy.deepcopy(native)
    for rows in candidate['cronObserved']:
        rows[2][field] = value
    try:
        run(candidate)
    except AssertionError:
        rejected += 1
    else:
        raise AssertionError('RENEWAL_MUTANT_ACCEPTED:'+field)
candidate = copy.deepcopy(native)
for row in candidate['cronSemanticsActual']:
    row['cloudflareCredentialSettingPresent'] = True
try:
    run(candidate)
except AssertionError:
    rejected += 1
else:
    raise AssertionError('RENEWAL_AUTHORITY_MUTANT_ACCEPTED')
print(json.dumps({'positiveRestartTransition': 1, 'positiveExactRenewalTransition': 1,
                  'rejectedMutations': rejected, 'actualClosedObservationJoin': True,
                  'diagnosticQualified': native['qualified'], 'runtimeExecuted': False}))
