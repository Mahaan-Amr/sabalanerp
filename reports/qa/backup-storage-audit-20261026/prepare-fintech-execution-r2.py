import ast,base64,hashlib,json,pathlib,zlib
p=pathlib.Path(__file__).resolve().parent
root=pathlib.Path('C:/Users/mahan/.codex/worktrees/native-complete-419/sabalanerp/reports/qa/issue-419-native-20261026')
full=json.loads((p/'FINTECH-REMOVAL-PLAN-R4.json').read_text(encoding='utf-8'))
plan={k:full[k] for k in ['machineUuidSha256','sabalanReferenceMatches']}
plan['paths']=[{k:x[k] for k in ['path','dev','ino','uid','realpath']} for x in full['paths']]
plan['volumes']=[{k:x[k] for k in ['name','driver','mountpoint','root']} for x in full['volumes']]
plan['images']=[{k:x[k] for k in ['id','nonFintechReferences','otherTags','fintechTags']} for x in full['images']]
plan['systemdUnits']=[{k:x[k] for k in ['path','sha256']} for x in full['systemdUnits']]
raw=json.dumps(plan,separators=(',',':')).encode()
template=(root/'fintech-retire-executor.template.py').read_text(encoding='utf-8')
source=template.replace('PLAN_BASE64',base64.b64encode(raw).decode());ast.parse(source)
remote=root/'fintech-retire-execute-remote-r2.py';assert not remote.exists();remote.write_text(source,encoding='utf-8')
digest=hashlib.sha256(remote.read_bytes()).hexdigest()
helper=(root/'fintech-retire-execute.py').read_text(encoding='utf-8')
old=hashlib.sha256((root/'fintech-retire-execute-remote.py').read_bytes()).hexdigest()
helper=helper.replace('fintech-retire-execute-remote.py',remote.name).replace(old,digest)
helper=helper.replace('import base64','import base64,zlib')
helper=helper.replace("base64.b64decode('","zlib.decompress(base64.b64decode('")
helper=helper.replace('base64.b64encode(remote.encode()).decode()', 'base64.b64encode(zlib.compress(remote.encode(),9)).decode()')
helper=helper.replace("\"'),'<fixed-readonly-backup-capacity>'", "\"')),'<fixed-readonly-backup-capacity>'")
ast.parse(helper)
# Preserve the existing24000-character transport gate; do not weaken it.
wire=base64.b64encode(zlib.compress(source.encode(),9))
assert len(wire)+200<24000 and zlib.decompress(base64.b64decode(wire))==source.encode()
python=root/'fintech-retire-execute-r2.py';assert not python.exists();python.write_text(helper,encoding='utf-8')
outer=(root/'fintech-retire-execute.mjs').read_text(encoding='utf-8').replace('fintech-retire-execute.py',python.name).replace('FINTECH-RETIREMENT-','FINTECH-RETIREMENT-R2-')
node=root/'fintech-retire-execute-r2.mjs';assert not node.exists();node.write_text(outer,encoding='utf-8')
(p/'FINTECH-EXECUTION-TRANSPORT-R2.json').write_text(json.dumps({'sourceSha256':digest,'planSubsetSha256':hashlib.sha256(raw).hexdigest(),'sourceBytes':len(source.encode()),'compressedBase64Bytes':len(wire),'transportLimit':24000,'remoteSemantics':'Same reviewed code, only unused observation fields omitted from PLAN; compressed transport roundtrip exact','mutationsInPriorAttempt':False},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'sourceBytes':len(source.encode()),'wireBytes':len(wire),'transportWithinOriginalLimit':True}))
