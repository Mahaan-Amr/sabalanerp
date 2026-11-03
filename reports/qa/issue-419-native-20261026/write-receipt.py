"""Publish an honest preparation checkpoint; never a qualification capability."""
import collections
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess

directory = Path(__file__).resolve().parent
repository = directory.parents[2]
output = directory / 'RECEIPT.json'
assert not output.exists()
sha = lambda raw: hashlib.sha256(raw).hexdigest()

def reference(file):
    raw = file.read_bytes()
    return {'file': str(file), 'bytes': len(raw), 'sha256': sha(raw)}

def diagnostics(file):
    return collections.Counter((Path(match[0]).name, match[1]) for match in re.findall(
        r'([^\r\n]+?)\(\d+,\d+\): (error TS\d+: [^\r\n]+)', file.read_text(encoding='utf-8')))

current = diagnostics(directory / 'carrier-checkjs-r2.txt')
baseline = diagnostics(directory / 'carrier-checkjs-baseline.txt')
# Compiler prefixes differ by checkout; compare the final module and exact diagnostic text.
current = collections.Counter({(key[0].replace('\\', '/').split('/')[-1], key[1]): value for key, value in current.items()})
baseline = collections.Counter({(key[0].replace('\\', '/').split('/')[-1], key[1]): value for key, value in baseline.items()})
assert current == baseline and sum(current.values()) == 69
original = Path('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp')
patch = subprocess.check_output(['git', '-C', str(original), 'diff', '--cached', '--binary'])
assert sha(patch) == '0ba0dd832216df0f2c79a9512f758ead080775591e101d7520e16c135de960a4'
pyc = original / 'deploy/scripts/__pycache__/private-image-filesystem-capacity.cpython-314.pyc'
assert sha(pyc.read_bytes()) == '12e9035aa9ea495505a0a64552910a40b7acf344833a139ec9f80a10c7b4cff9'
stash = subprocess.check_output(['git', '-C', str(original), 'rev-parse', 'refs/stash'], text=True).strip()
assert stash == 'cd76a5619acefc35b8003ba6f7e5f0590486a361'
reports = []
for file in directory.glob('*.json'):
    value = json.loads(file.read_bytes())
    if 'lease' in value:
        assert value['lease']['closed'] and value['lease']['acknowledgement'] == 'LEASE_CLOSED'
        assert value['originalChildren']['allOriginalChildrenClosed']
        assert not value['originalChildren']['interrupted']
        reports.append(reference(file))

result = {
    'format': 'sabalan-419-preparation-checkpoint/v1',
    'state': 'PREPARATION_ONLY_NATIVE_ACCEPTANCE_NOT_EARNED',
    'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'baseEvidenceCommit': '7d117ffa42c8c93c38c7291b90af9659761106e0',
    'applicationSourceCommit': 'c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14',
    'runtimeAccepted': False, 'productionAdmission': False,
    'issue419Accepted': False, 'issue411Accepted': False,
    'masterStarted': False, 'FULLExecuted': False, 'bootstrap420Started': False,
    'compilerRepeated': False, 'materializerRepeated': False, 'imageBuilt': False,
    'hostPackRebuilt': False, 'successfulCryptoRepeated': False, 'composeUp': False,
    'push': False,
    'tests': {'reportingLinux': {'passed': 33, 'failed': 0, 'skipped': 0},
              'carrierRegressionWindows': {'passed': 17, 'failed': 0, 'skipped': 4},
              'probePython': {'passed': 8, 'failed': 0},
              'requestedStopPython': {'passed': 2, 'failed': 0},
              'checkJs': {'pass': False, 'diagnostics': 69,
                          'baselineDiagnostics': 69, 'exactDiagnosticMultisetUnchanged': True},
              'completeRepositorySuite': 'NOT_RUN_PENDING_NATIVE_ACCEPTANCE'},
    'preservation': {'stagedPatchSha256': sha(patch), 'trackedPycSha256': sha(pyc.read_bytes()),
                     'stash': stash, 'negativeParentsPreserved': True},
    'boundedOriginalReports': reports,
    'source': [reference(repository / name) for name in [
        'deploy/scripts/local-inquiry-carrier.mjs',
        'tests/online-deployment/local-inquiry-carrier.test.mjs']],
    'evidence': {file.name: reference(file) for file in directory.iterdir() if file.is_file()},
}
with output.open('x', encoding='utf-8') as stream:
    json.dump(result, stream, indent=2)
    stream.write('\n')
print(json.dumps({'file': str(output), 'sha256': sha(output.read_bytes()),
                  'boundedOriginalReports': len(reports), 'acceptanceEarned': False}))
