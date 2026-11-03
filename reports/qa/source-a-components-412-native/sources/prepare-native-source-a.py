import ast, hashlib, json, pathlib, runpy, sys
ROOT=pathlib.Path(__file__).resolve().parent.parent
Q=pathlib.Path('D:/sabalanerp-online-qa')
R7=Q/'C30-source-a-fixed-existing-gzip-stream-source-r7-typed-component-rsa-projection-20261025'
R8=Q/'C30-source-a-fixed-existing-gzip-stream-source-r8-third-restart-20261025'
private=runpy.run_path(str(Q/'C30-strict-complete-actual-plan-source-r6-observed-renewal-20261025/prepare.py'))
sha=lambda b:hashlib.sha256(b).hexdigest()
def write(p,raw):return private['write'](p,raw)
if not R8.exists():
 private['private_output'](R8)
 review_raw=(R7/'source-review.json').read_bytes();assert sha(review_raw)=='ad4abcdfc79a7ce2c6a7dd4ca9b40087952d00e498b6390938c315a28a722cc7'
 review=json.loads(review_raw);files={}
 admission=(ROOT/'scripts/lib/source-a-current-admission.py').read_bytes()
 for name,row in review['files'].items():
  raw=pathlib.Path(row['file']).read_bytes();assert sha(raw)==row['sha256']
  if name=='prepare-phase.py':
   text=raw.decode();old="AD=Q/'C30-observed-second-backend-restart-current-admission-source-r2-20261025/admission.py';AD_SHA='8c7dc32fd6ad614f2931865141ee46f63c83c19506176730de7383ccdc38003b'"
   assert text.count(old)==1;text=text.replace(old,"AD=HERE/'current-admission.py';AD_SHA="+repr(sha(admission)))
   raw=text.encode()
  files[name]=write(R8/name,raw)
 files['current-admission.py']=write(R8/'current-admission.py',admission)
 write(R8/'source-review.json',(json.dumps({'format':'sabalan-fixed-existing-gzip-source-review/v8','parent':{'file':str(R7/'source-review.json'),'sha256':sha(review_raw)},'files':files,'delta':'Only current-admission.py plus prepare-phase AD pin; exact third-restart observation, unchanged finite crypto owners/builders','productionAdmission':False,'runtimeExecuted':False},indent=2)+'\n').encode())
baseline={'file':sys.argv[1],'sha256':sys.argv[2]}
ad=runpy.run_path(str(R8/'current-admission.py'));spec=ad['current_spec'](baseline);ad['validate_spec'](spec)
out=Q/('ticket412-native-preflight-'+pathlib.Path(baseline['file']).stem.removeprefix('source-install-healthy-baseline-'))
private['private_output'](out)
runtime=write(out/'current-runtime-spec.json',json.dumps(spec,sort_keys=True,separators=(',',':')).encode())
old_path=Q/'C30-frontend-local-decrypt-fresh-storage-20261025T0739/run-original.py'
text=old_path.read_text()
mapping={
 'source-install-healthy-baseline-20261025T073846300122Z':pathlib.Path(baseline['file']).stem,
 '7cf30f409061cd0f54ce6278f6da78e6fab29663ca7da228f48a1cd443f91347':baseline['sha256'],
 'cd5712742099cf7412d3a0d1c816548cd06e77d7b0a30f2a3d82d0d49a997815':sha(pathlib.Path(baseline['file'].removesuffix('.json')+'-original.json').read_bytes()),
 'C30-frontend-local-decrypt-fresh-storage-20261025T0739/current-runtime-spec.json':out.name+'/current-runtime-spec.json',
 '0b49ca1389abdcdc724bb124a31c2a5ec3767f9c6a86326862aa36ab1d5d6d80':runtime['sha256'],
 'C30-observed-second-backend-restart-current-admission-source-r2-20261025':R8.name,
 '8c7dc32fd6ad614f2931865141ee46f63c83c19506176730de7383ccdc38003b':sha((R8/'current-admission.py').read_bytes()),
}
# Update constants only, preserving all canonical preflight policy and ownership.
changes={}
for n in ast.walk(ast.parse(text)):
 if isinstance(n,ast.Constant) and isinstance(n.value,str):
  v=n.value
  for a,b in mapping.items():v=v.replace(a,b)
  if v!=n.value:
   v=v.replace('/'+R8.name+'/admission.py','/'+R8.name+'/current-admission.py').replace('\\'+R8.name+'\\admission.py','\\'+R8.name+'\\current-admission.py')
   changes[ast.get_source_segment(text,n)]=repr(v)
for old,new in changes.items():text=text.replace(old,new)
# R is only the report output directory, not production/source identity.
tree=ast.parse(text)
for n in tree.body:
 if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='R' for t in n.targets):
  text=text.replace(ast.get_source_segment(text,n),'R=pathlib.Path('+repr(str(ROOT))+')')
compile(text,'fresh-native-source-a-preflight','exec')
source=write(out/'run-original.py',text.encode())
print(json.dumps({'source':source,'baseline':baseline,'runtime':runtime,'producerReview':{'file':str(R8/'source-review.json'),'sha256':sha((R8/'source-review.json').read_bytes())}}))
