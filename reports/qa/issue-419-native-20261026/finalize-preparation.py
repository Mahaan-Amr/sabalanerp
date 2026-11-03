"""Retain working-byte and Git-byte identities for this preparation milestone."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

directory = Path(__file__).resolve().parent
repository = directory.parents[2]
output = directory / 'PREPARATION-CHECKPOINT.json'
assert not output.exists()
sha = lambda raw: hashlib.sha256(raw).hexdigest()
git = lambda *args: subprocess.check_output(['git', '-C', str(repository), *args])
head = git('rev-parse', 'HEAD').decode().strip()
files = git('ls-tree', '-r', '--name-only', head, '--', 'reports/qa/issue-419-native-20261026',
            'deploy/scripts/local-inquiry-carrier.mjs', 'tests/online-deployment/local-inquiry-carrier.test.mjs').decode().splitlines()
references = []
for name in files:
    working = (repository / name).read_bytes()
    canonical = git('show', head + ':' + name)
    references.append({'path': name, 'workingBytes': len(working), 'workingSha256': sha(working),
                       'canonicalGitBytes': len(canonical), 'canonicalGitSha256': sha(canonical)})
original = Path('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp')
patch = subprocess.check_output(['git', '-C', str(original), 'diff', '--cached', '--binary'])
bytecode = (original / 'deploy/scripts/__pycache__/private-image-filesystem-capacity.cpython-314.pyc').read_bytes()
stash = subprocess.check_output(['git', '-C', str(original), 'rev-parse', 'refs/stash'], text=True).strip()
assert sha(patch) == '0ba0dd832216df0f2c79a9512f758ead080775591e101d7520e16c135de960a4'
assert sha(bytecode) == '12e9035aa9ea495505a0a64552910a40b7acf344833a139ec9f80a10c7b4cff9'
assert stash == 'cd76a5619acefc35b8003ba6f7e5f0590486a361'
correction = json.loads((directory / 'REPORTING-CAPACITY-CORRECTION.json').read_bytes())
proposal = json.loads((directory / 'EXISTING-INQUIRY-CARRIER-PROPOSAL.json').read_bytes())
assert not correction['historicalDestinationCapacityAdmission'] and not correction['retroactiveAdmissionClaimed']
assert proposal['prepared'] and not proposal['executable'] and not proposal['composeUp']
value = {'format': 'sabalan-419-reviewed-preparation-checkpoint/v1',
         'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'reviewedHead': head, 'baseCommit': '7d117ffa42c8c93c38c7291b90af9659761106e0',
         'state': 'LIMITED_CARRIER_PROPOSAL_READY_EXECUTION_APPROVAL_PENDING',
         'issue419Accepted': False, 'issue411Accepted': False, 'runtimeAccepted': False,
         'productionAdmission': False, 'masterStarted': False, 'FULLExecuted': False,
         'composeUp': False, 'bootstrap420Started': False, 'push': False,
         'compilerRepeated': False, 'materializerRepeated': False, 'imageBuilt': False,
         'hostPackRepeated': False, 'successfulCryptoRepeated': False,
         'historicalReportingCapacityAdmission': False,
         'reportingLinuxUnitTests': {'passed': 33, 'failed': 0, 'skipped': 0},
         'review': {'standardsOpen': 0, 'specOpen': 0, 'historicalCapacityLimitationPreserved': True},
         'preservation': {'stagedPatchSha256': sha(patch), 'trackedPycSha256': sha(bytecode), 'stash': stash},
         'receiptSnapshotCommit': '575064bd4f13633366c18ce73acb437169931b75',
         'receiptSnapshotNote': 'RECEIPT.json pins that historical working snapshot. STATUS/REVIEW were subsequently corrected; use this separate Git/working map for current bytes.',
         'files': references}
with output.open('x', encoding='utf-8') as stream:
    json.dump(value, stream, indent=2)
    stream.write('\n')
print(json.dumps({'file': str(output), 'sha256': sha(output.read_bytes()), 'acceptanceEarned': False}))
