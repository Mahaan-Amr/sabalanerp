"""File-only real-source packaging and finite Node code-generation checks."""
import ast,copy,hashlib,json,pathlib,runpy,subprocess,sys
root=pathlib.Path(sys.argv[1]);q=pathlib.Path('D:/sabalanerp-online-qa')
source=runpy.run_path(str(root/'deploy/scripts/original-c3-backend-stream-source.py'))
builder_file=root/'deploy/scripts/original-readonly-storage-source.py';raw=builder_file.read_bytes();builder=source['execute_source'](raw,builder_file,'readonly_storage_source_fixture')
image_source=runpy.run_path(str(root/'deploy/scripts/original-image-repository-source.py'))
inputs=json.loads((q/'419-safe-rollback-36b9f5bf09bf2a9fcf2c30644de47ee5/fresh-pre-up-production-inputs.json').read_bytes());spec=json.loads(pathlib.Path(inputs['runtime']['file']).read_bytes())
canonical={name:(root/name).read_bytes() for name in ['deploy/scripts/storage-preflight.mjs','scripts/deployment-storage.mjs']}
fragments={key:(root/'deploy/scripts'/file).read_bytes() for key,file in {'source':'original-readonly-storage-source-remote.py','backup':'original-readonly-storage-backup-remote.py','backupHost':'original-image-repository-remote.py','channel':'original-image-repository-channel.py'}.items()}
cfg=dict(purpose='COMPLETE_FULL',cipherBytes=1242945672,imageCipherUpperBoundBytes=1250000000,backupCanonicalReserveBytes=1024**3,retirement=None)
package=builder['build'](spec,'d'*32,source,canonical,fragments,cfg,raw,image_source,(root/'deploy/scripts/original-source-runtime-diagnostics.py').read_bytes())
tree=ast.parse(package['source']);names={n.name for n in tree.body if isinstance(n,ast.FunctionDef)}
assert 'observe' not in names and 'run_source_preflight' in names
assert 'source_recovery_readiness' in names and 'recovery_boundary_clear' in names
assert sum(isinstance(n,ast.Call)and isinstance(n.func,ast.Name)and n.func.id=='source_recovery_readiness'for n in ast.walk(tree))==3
assert b'SET TRANSACTION READ ONLY'in package['source']and b'finally{await p.$disconnect();}'in package['source']
assert not any(isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PREFLIGHT' for t in n.targets) for n in tree.body)
assert b"SPEC['freshRuntimeBaseline']['observedAt']" in package['source']
assert b"r['State']['OOMKilled'] is False" in package['source']
owner=builder['original_windows_owner'](source);compile(owner,'readonly-same-original-finite-owner','exec');assert b'interaction=interactive(child)' in owner
try:builder['canonical_plan_code'](canonical,['--mode','apply','--required-bytes','1']);raise RuntimeError('apply accepted')
except AssertionError:pass
# Generator invocation with modeled canonical ports is not a storage PASS.
modeled={'scripts/deployment-storage.mjs':b'export const marker=true;', 'deploy/scripts/storage-preflight.mjs':b"import{marker}from'../../scripts/deployment-storage.mjs';export async function storagePreflight(args){if(!marker||args[args.indexOf('--mode')+1]!=='plan')throw Error('WRONG_MODE');return{availableBytes:4096,plan:{modeled:true}};}"}
code=builder['canonical_plan_code'](modeled,['--mode','plan','--project','fixture','--storage-root','unused','--required-bytes','1'])
child=subprocess.Popen(['C:/Program Files/nodejs/node.exe','--input-type=module','-e',code],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
out,error=child.communicate();assert child.returncode==0 and not error;value=json.loads(out);assert value['mode']=='plan' and value['removed']==[] and value['availableBytes']==4096
# Exercise the actual packaged canonical guard: raw Docker Mounts ordering is
# not admission identity, while every contracted mount/config/incarnation is.
# This is bounded fixture behavior, not a reclassification of c748 recovery.
functions={n.name:ast.get_source_segment(package['source'].decode(),n) for n in tree.body if isinstance(n,ast.FunctionDef)}
guard=dict(copy=copy,json=json,sha=lambda raw:hashlib.sha256(raw).hexdigest(),ROLES=('backend','frontend','inquiry','nginx','postgres','clamav'))
for name in ['canonical','original_service_configuration','validate_current_configuration']:exec(compile(functions[name],'same-packaged-canonical-config','exec'),guard)
rows=[]
for i,role in enumerate([*guard['ROLES'],'foreign-a','foreign-b']):
 rows.append(dict(Id=format(i+1,'064x'),Image='sha256:'+format(i+1,'064x'),RestartCount=0,State=dict(StartedAt='fixture-start',Status='running',Health={'Status':'healthy'}),Config={'Labels':{'com.docker.compose.project':'sabalanerp' if i<6 else 'foreign','com.docker.compose.service':role},'Env':['FIXTURE=1']},HostConfig={'Memory':1024},Mounts=[{'Type':'volume','Source':'/owned/a','Destination':'/a','RW':False,'Propagation':'rprivate'},{'Type':'volume','Source':'/owned/b','Destination':'/b','RW':True,'Propagation':'rprivate'}],NetworkSettings={'Networks':{'owned':{}}}))
expected={'expectedEight':[dict(id=r['Id'],image=r['Image'],startedAt=r['State']['StartedAt'],restartCount=0,status='running',health='healthy',project=r['Config']['Labels']['com.docker.compose.project'],service=r['Config']['Labels']['com.docker.compose.service']) for r in rows],'expectedServiceConfiguration':guard['original_service_configuration'](rows[:6])}
guard['validate_current_configuration'](rows,expected)
reordered=copy.deepcopy(rows)
for row in reordered:row['Mounts'].reverse()
guard['validate_current_configuration'](reordered,expected)
changes=[(('Mounts',0,'Source'),'/changed'),(('Mounts',0,'Destination'),'/changed'),(('Mounts',0,'Type'),'bind'),(('Mounts',0,'RW'),True),(('Mounts',0,'Propagation'),'rshared'),(('Config','Env'),['FIXTURE=2']),(('HostConfig','Memory'),2048),(('NetworkSettings','Networks'),{'different':{}}),(('RestartCount',),1),(('State','StartedAt'),'changed'),(('State','Health','Status'),'unhealthy'),(('Image',),'sha256:'+'f'*64),(('Id',),rows[1]['Id'])]
for parts,new in changes:
 changed=copy.deepcopy(rows);target=changed[0]
 for part in parts[:-1]:target=target[part]
 target[parts[-1]]=new
 try:guard['validate_current_configuration'](changed,expected)
 except (AssertionError,KeyError):pass
 else:raise AssertionError('PACKAGED_CANONICAL_GUARD_ACCEPTED_CHANGED_'+str(parts))
print(json.dumps(dict(canonicalMountOrderVerified=True,canonicalChangedFieldsRejected=len(changes),historicalC748Reclassified=False,sourceOnly=True,sourceBytes=len(package['source']),backupBytes=len(package['backup']),sameOriginalInteractiveOwnerCompiled=True,applyRefused=True,nativeStorageExecuted=False,productionAdmission=False)))
