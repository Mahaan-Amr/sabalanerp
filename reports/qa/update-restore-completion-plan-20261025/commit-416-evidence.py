"""Commit only ticket416 evidence using an alternate index and ordinary hooks."""
import hashlib
import json
import os
import pathlib
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone

p = pathlib.Path(__file__).resolve().parent
r = p.parents[2]
folder = r / 'reports/qa/ticket-416-coordinator-20261025'
cp = json.loads((p / 'CHECKPOINT.json').read_text(encoding='utf-8'))
sha = lambda b: hashlib.sha256(b).hexdigest()
def git(*args, env=None):
    return subprocess.check_output(['git', '-C', str(r), *args], env=env)
assert sha(git('diff','--cached','--binary')) == cp['stagedPatchSha256']
assert git('rev-parse','HEAD').decode().strip() == 'ee38ae143abb89337e7324454954f5263ea40d4e'
files = [f.relative_to(r).as_posix() for f in sorted(folder.iterdir()) if f.is_file()]
assert all(f.startswith('reports/qa/ticket-416-coordinator-20261025/') for f in files)
index = pathlib.Path(tempfile.gettempdir()) / ('sabalan-ticket416-index-' + uuid.uuid4().hex)
assert index.parent.resolve() == pathlib.Path(tempfile.gettempdir()).resolve() and not index.exists()
env = dict(os.environ, GIT_INDEX_FILE=str(index))
try:
    git('read-tree','HEAD',env=env)
    git('add','--',*files,env=env)
    git('diff','--cached','--check',env=env)
    run = subprocess.run(['git','-C',str(r),'commit','-m','Record #416 coordinator source integration and native prerequisite hold'],env=env,capture_output=True)
    (p / '416-evidence-commit.log').write_bytes(run.stdout + run.stderr)
    assert run.returncode == 0, 'Normal commit/hooks failed; inspect retained log'
    # Add only newly committed matching evidence into the original index; retain its60 staged reports verbatim.
    git('add','--',*files)
finally:
    if index.exists():
        index.unlink()
assert sha(git('diff','--cached','--binary')) == cp['stagedPatchSha256']
assert sha(pathlib.Path(cp['trackedPyc']['file']).read_bytes()) == cp['trackedPyc']['sha256']
assert git('rev-parse','refs/stash').decode().strip() == cp['stashHead']
head = git('rev-parse','HEAD').decode().strip()
state = {'updatedAt':datetime.now(timezone.utc).isoformat(),'repository':str(r),'head':head,'source416':'ee38ae143abb89337e7324454954f5263ea40d4e','originalCheckpointHead':cp['head'],'intentionalHeadAdvance':True,'stagedPatchSha256':cp['stagedPatchSha256'],'trackedPycSha256':cp['trackedPyc']['sha256'],'stashHead':cp['stashHead'],'native416':'NOT_EARNED','postgresStopped':False,'newHeldOriginals':[],'push':False}
(p / 'COORDINATOR-STATE.json').write_text(json.dumps(state,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'commit':head,'committedFiles':len(files),'normalHooks':'passed','stagedPycStashPreserved':True,'native416':'NOT_EARNED','push':False}))
