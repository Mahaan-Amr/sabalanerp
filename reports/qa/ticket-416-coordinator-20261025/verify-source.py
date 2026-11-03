"""Verify integrated source and preserve source-only/native-readonly distinction."""
import hashlib
import json
import pathlib
import subprocess
from datetime import datetime, timezone

p = pathlib.Path(__file__).resolve().parent
r = p.parents[2]
sha = lambda raw: hashlib.sha256(raw).hexdigest()
def git(*args):
    return subprocess.check_output(['git', '-C', str(r), *args])
cp = json.loads((r / 'reports/qa/update-restore-completion-plan-20261025/CHECKPOINT.json').read_text(encoding='utf-8'))
receipt_source = pathlib.Path('C:/Users/mahan/.codex/worktrees/ticket-416-serial-physical/sabalanerp/reports/qa/ticket-416-source-20261025/SOURCE-RECEIPT.json')
raw = receipt_source.read_bytes()
assert sha(raw) == '6e86b3f252454d35863501f8bf0ff37b9f51934f9d20aba22f83054efaec31c3'
source = json.loads(raw)
assert git('rev-parse', 'HEAD').decode().strip() == 'ee38ae143abb89337e7324454954f5263ea40d4e'
assert source['sourceCommit'] == 'fc5b95a3ff4b6ddc9fdd5be8e326d4d75cb4c1d4'
source_rows = []
for f in source['files']:
    blob = git('rev-parse', 'HEAD:' + f['file']).decode().strip()
    assert blob == f['gitBlob'], f['file']
    source_rows.append({'file': f['file'], 'gitBlob': blob, 'worktreeSha256': sha((r / f['file']).read_bytes())})
changes = git('diff', '--name-only', '--', 'scripts/lib/serial-physical', 'tests/online-deployment/serial-physical-owner.test.mjs', 'tests/online-deployment/serial-physical-child.test.mjs').decode().strip()
assert not changes
tests = ['tests/online-deployment/serial-physical-owner.test.mjs','tests/online-deployment/serial-physical-child.test.mjs','tests/online-deployment/independent-physical-replay.test.mjs']
command = ['C:/Program Files/nodejs/node.exe', '--max-old-space-size=512', '--test', *tests]
run = subprocess.run(command, cwd=r, capture_output=True)
log = run.stdout + run.stderr
(p / 'regression.txt').write_bytes(log)
assert run.returncode == 0
preserve = {
    'stagedPatchSha256': sha(git('diff', '--cached', '--binary')),
    'trackedPycSha256': sha(pathlib.Path(cp['trackedPyc']['file']).read_bytes()),
    'stashHead': git('rev-parse', 'refs/stash').decode().strip(),
}
assert preserve['stagedPatchSha256'] == cp['stagedPatchSha256']
assert preserve['trackedPycSha256'] == cp['trackedPyc']['sha256']
assert preserve['stashHead'] == cp['stashHead']
result = {
    'format':'sabalan-ticket416-coordinator-consumption/v1', 'observedAt':datetime.now(timezone.utc).isoformat(),
    'integratedFrom':cp['head'], 'integratedTip':'ee38ae143abb89337e7324454954f5263ea40d4e',
    'integration':'Fast-forward of exactly the three supplied local commits, no duplicated cherry-picks',
    'sourceReceiptSha256':sha(raw), 'files':source_rows,
    'regression':{'command':command,'exitCode':run.returncode,'logSha256':sha(log),'scope':'bounded source tests, not actual wrapper/native acceptance'},
    'preservation':preserve,'nativeFaultAcceptance':'NOT_EARNED',
    'missingNativeBoundary':['Integrated live coordinator/resource lease and19 coordinator ports plus beforeDocker', 'Bounded no-replay fault harness independent of physical/apps lifecycle', 'Source-owned observed original smart-shutdown transition without automatic restart race'],
    'freshReadOnlyNativePreflight':'PREFLIGHT.json', 'actualWrapperLaunched':False, 'postgresStopped':False,
    'sourceFor418':'ee38ae143abb89337e7324454954f5263ea40d4e (source only; ticket08 native acceptance pending)',
    'push':False, 'newHeldOriginals':[],
}
(p / 'RECEIPT.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'filesVerified':len(source_rows),'regressionExit':run.returncode,'preservation':preserve,'nativeFaultAcceptance':'NOT_EARNED'}))
