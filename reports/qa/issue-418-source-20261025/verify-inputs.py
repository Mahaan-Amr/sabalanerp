"""Read-only input, ancestry and original-checkout preservation audit."""
import hashlib,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3]
ORIGINAL=pathlib.Path('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp')
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args])
def sha(raw):return hashlib.sha256(raw).hexdigest()
base='ae056d6036c62499171f0d91691e1287942e75f7'
packet=ORIGINAL/'reports/qa/update-restore-completion-plan-20261025'
checkpoint=json.loads((packet/'CHECKPOINT.json').read_bytes())
assert sha((packet/'source-baseline-v1/BASELINE.json').read_bytes())=='815a2124aa1973a51d027ca05134a5cbf546ff9f7aa5e83893bdd025ea36c6e8'
inputs=[]
for issue,source,evidence,file,checksum,source_file in [
 (416,'230f52c69a7abd8b743afdc6d77275497f2e2b1b','c554c9cc68ecb520b79812686b22eae9c0999483','reports/qa/ticket-416-bounded-native-20261025/NATIVE-RECEIPT.json','2d2606bab5030376704374909b994ed955c169e80ff4f6cc8bca043452f47122','reports/qa/ticket-416-bounded-native-20261025/SOURCE.json'),
 (417,'cad15639f977bb1afeab9674deb7b09ff40f4c4b','c6528a3139cdb09b8bbf6c3584c5843c4e94f40d','reports/qa/issue-417-complete-20261025/RECEIPT.json','300ad1f634171407600e4b745ca3caf0da4ff83bfe6274703831e4a5c209554a','reports/qa/issue-417-complete-20261025/RECEIPT.json')]:
 for ancestor,descendant in [(base,source),(source,evidence),(evidence,'HEAD')]:
  subprocess.run(['git','-C',str(ROOT),'merge-base','--is-ancestor',ancestor,descendant],check=True)
 raw=git(ROOT,'show',evidence+':'+file);assert sha(raw)==checksum,(issue,'receipt')
 receipt=json.loads(git(ROOT,'show',evidence+':'+source_file));rows=receipt.get('sourceFiles',receipt.get('files'))
 verified=[]
 for row in rows:
  file_name=row.get('file');actual=git(ROOT,'show',source+':'+file_name)
  assert sha(actual)==row['gitBlobSha256'],(issue,file_name)
  verified.append(dict(file=file_name,sha256=sha(actual)))
 inputs.append(dict(issue=issue,sourceCommit=source,evidenceCommit=evidence,receipt=file,receiptSha256=checksum,verifiedSourceFiles=verified))
preservation=dict(stagedPatchSha256=sha(git(ORIGINAL,'diff','--cached','--binary')),stagedPathCount=len(git(ORIGINAL,'diff','--cached','--name-only','-z').split(b'\0'))-1,
 trackedPycSha256=sha(pathlib.Path(checkpoint['trackedPyc']['file']).read_bytes()),stashHead=git(ORIGINAL,'rev-parse','refs/stash').decode().strip())
assert preservation['stagedPatchSha256']==checkpoint['stagedPatchSha256']
assert preservation['stagedPathCount']==checkpoint['stagedPathCount']
assert preservation['trackedPycSha256']==checkpoint['trackedPyc']['sha256']
assert preservation['stashHead']==checkpoint['stashHead']
result=dict(format='sabalan-source12-inputs/v1',baselineCommit=base,integrationCommit='f883044e271b19e7e7672b0e85189720da9260f0',inputs=inputs,
 preservation=preservation,sourceOnly=True,nativeOperationsPerformed=False,pushPerformed=False)
(pathlib.Path(__file__).parent/'INPUTS.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(inputReceiptsVerified=len(inputs),sourceFilesVerified=sum(len(x['verifiedSourceFiles'])for x in inputs),ancestryVerified=True,preservation=preservation)))
