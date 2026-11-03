"""Append actual failed-compiler custody to a new immutable, inert plan."""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]
OUTPUT = pathlib.Path(json.loads((ROOT/'.scratch/final-package-location.json').read_bytes())['directory'])


def ref(file):
    raw = file.read_bytes()
    return dict(file=str(file), bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())


plan = json.loads((OUTPUT/'install-plan.json').read_bytes())
location = json.loads((ROOT/'.scratch/final-compiled-location.json').read_bytes())
file = pathlib.Path(location['receipt'])
compiled = json.loads(file.read_bytes())
assert compiled['pass'] is False and compiled['originalChildren']['allOriginalChildrenClosed'] is True
plan['backendCompilation'] = dict(receipt=ref(file), commands=[dict(originalPid=x['originalPid'], code=x['code'], signal=x['signal']) for x in compiled['commands']],
                                  originalChildren=compiled['originalChildren'], sourceInputs=len(compiled['sources']),
                                  diagnosticLines=sum('error TS' in line for x in compiled['commands'] for line in x['stdout'].splitlines()),
                                  partialOutputsRetained=True, materializationPerformed=False, imageBuilt=False)
plan['backendCompilation']['pass'] = False
plan['pending'].append(dict(code='CURRENT_BACKEND_COMPILE_FAILED', receipt=ref(file), reason='No compiler, material or image PASS can be inferred from emitted partial outputs.'))
plan['supersedesPlan'] = ref(OUTPUT/'install-plan.json')
plan['packagingProducers'] = json.loads((OUTPUT/'producer-lineage.json').read_bytes())
target = OUTPUT/'install-plan-final.json'
raw = (json.dumps(plan, sort_keys=True, separators=(',', ':'), ensure_ascii=False)+'\n').encode()
with target.open('xb') as stream:
    stream.write(raw)
print(json.dumps(ref(target)))
