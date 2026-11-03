import ast, copy, hashlib, json, pathlib, runpy, uuid
Q=pathlib.Path('D:/sabalanerp-online-qa')
R7=Q/'C30-source-a-fixed-existing-gzip-stream-source-r7-typed-component-rsa-projection-20261025'
def pinned(file,digest):
 raw=file.read_bytes();assert hashlib.sha256(raw).hexdigest()==digest;return raw
pinned(Q/'C30-observed-second-backend-restart-current-admission-source-r2-20261025/admission.py','8c7dc32fd6ad614f2931865141ee46f63c83c19506176730de7383ccdc38003b')
review=json.loads(pinned(R7/'source-review.json','ad4abcdfc79a7ce2c6a7dd4ca9b40087952d00e498b6390938c315a28a722cc7'))
for row in review['files'].values():pinned(pathlib.Path(row['file']),row['sha256'])
pinned(Q/'C30-strict-complete-actual-plan-source-r6-observed-renewal-20261025/prepare.py','0e11fddceb398d90eced7650f59b6be92a223277c7bdd971376ccbd4f8ba28cb')
old=runpy.run_path(str(Q/'C30-observed-second-backend-restart-current-admission-source-r2-20261025/admission.py'))
spec,_,_=old['observed_transition']()
baseline=json.loads((Q/'source-install-healthy-baseline-20261026T061109827783Z.json').read_bytes())['result']
expected=copy.deepcopy(spec['expectedEight'])
row=next(r for r in expected if r['service']=='backend')
assert row['restartCount']==2
row.update(restartCount=4,startedAt='2026-10-26T06:04:29.230523694Z')
assert expected==baseline['expectedEight'] and baseline['protectedBefore']==spec['protectedFiles']
spec['expectedEight']=expected
kernel=(Q/'C29-installed45cab-healthy-baseline-source-r2-exact-bytes-20261024/read-only-kernel.py').read_bytes()
assert hashlib.sha256(kernel).hexdigest()=='36c1c3de4a74b3c858b9b9e7eaced6607f6604d7fecd52b6000b78b754afa262'
guards=old['original_service_configuration'].__globals__
source=pathlib.Path(old['__file__']).read_text()
nodes=ast.parse(source).body
functions='\n\n'.join(ast.get_source_segment(source,n) for n in nodes if isinstance(n,ast.FunctionDef) and n.name in ['sha','canonical','original_service_configuration','validate_current_configuration'])
remote='import json,hashlib,datetime,copy,os\nROLES='+repr(old['ROLES'])+'\nKERNEL='+repr(kernel.decode())+'\nSPEC='+repr(spec)+'\n'+functions+'''
k={'__name__':'same_reviewed_readonly_kernel'}
exec(compile(KERNEL,'same-readonly-kernel','exec'),k)
h=k['NativeHost'](SPEC,None)
try:
 h.acquire();h.baseline=SPEC['expectedEight']
 h.run(['docker','compose','--env-file','/opt/sabalanerp/deploy/.env.prod','-f','/opt/sabalanerp/docker-compose.prod.yml','ps'])
 before=h.census();assert before==h.baseline
 h.no_lease();h.source_baseline_guard()
 assert h.protected()==SPEC['protectedFiles'];h.cron()
 rows=json.loads(h.run(['docker','container','inspect',*[r['id'] for r in before]]))
 validate_current_configuration(rows,SPEC)
 backend=next(r for r in rows if r['Config']['Labels'].get('com.docker.compose.service')=='backend')
 state=backend['State'];assert state['Running'] and not any(state[k] for k in ['Paused','Restarting','OOMKilled','Dead'])
 assert state['Status']=='running' and state['ExitCode']==0 and not state['Error']
 assert state['Health']['Status']=='healthy' and state['Health']['FailingStreak']==0
 after=h.census();assert after==before;h.no_lease();h.source_baseline_guard()
 assert h.protected()==SPEC['protectedFiles'];h.cron();h.lock_guard()
 print(json.dumps({'format':'sabalan-source-a-fourth-restart-readonly/v1','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'currentEight':after,'expectedServiceConfigurationSha256':sha(canonical(SPEC['expectedServiceConfiguration'])),'protectedFilesUnchanged':True,'cronUnchanged':True,'sourceCheckoutUnchanged':True,'backendStateVerified':True,'restartCauseProven':False,'allOriginalChildrenClosed':True,'children':h.children,'productionAdmission':False}),flush=True)
finally:h.close()
'''
compile(remote,'source-a-current-readonly','exec')
out=Q/('ticket413-current-readonly-'+uuid.uuid4().hex)
private=runpy.run_path(str(Q/'C30-strict-complete-actual-plan-source-r6-observed-renewal-20261025/prepare.py'))
private['private_output'](out)
private['write'](out/'remote-source.py',remote.encode())
core={};exec(compile(runpy.run_path(str(R7/'build-original.py'))['build'](),'same-original-owner','exec'),core)
owner=core['SourceStreamOwner'](out)
helpers=runpy.run_path(str(R7/'windows-owner.template.py'))
profile=json.loads((Q/'fixed-production-openssh-profile-20261020.json').read_bytes())
custody=runpy.run_path(str(Q/'C30-postcheckpoint-terminal-context-source-r2-current-original-pins-20261024/custody.py'))
for key,pin in [('sshExecutable','sshExecutableSha256'),('privateKeyPath','privateKeySha256'),('knownHostsPath','knownHostsSha256')]:custody['pin'](profile[key],profile[pin],installed_ssh=key=='sshExecutable')
try:
 row=helpers['pinned_ssh'](owner,custody,profile,[*helpers['ssh_argv'](profile),'python3 -I -B -'],'stageSource',secret_input=remote.encode(),maximum_stdout=2*1024**2)
 assert row['stderrBytes']==0
 value=json.loads(pathlib.Path(row['stdout']['file']).read_bytes())
 assert value['currentEight']==expected and value['allOriginalChildrenClosed'] is True
 result=private['write'](out/'observation.json',(json.dumps({'result':value,'original':row,'source':{'file':str(out/'remote-source.py'),'sha256':hashlib.sha256(remote.encode()).hexdigest()}},indent=2)+'\n').encode())
 print(json.dumps(result))
finally:owner.close()
