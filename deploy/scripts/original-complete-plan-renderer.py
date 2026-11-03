"""File-only final rendering. The Node factory retains the genuine LOCAL/root
tokens. This process cannot create a lease, native owner, secret or acceptance.
"""
import base64, hashlib, json, pathlib, runpy, sys, ast

def sha(raw):return hashlib.sha256(raw).hexdigest()
def pinned(ref,maximum=32*1024**2):
 p=pathlib.Path(ref['file']);a=p.lstat();assert p.resolve(strict=True)==p and p.is_file()and not p.is_symlink()and a.st_nlink==1 and 0<a.st_size<=maximum
 raw=p.read_bytes();b=p.lstat();assert(a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns)and sha(raw)==ref['sha256'];return raw
def save(root,name,raw):
 p=root/name;assert not p.exists();p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw);p.chmod(0o400);assert sha(p.read_bytes())==sha(raw);return{'file':str(p),'sha256':sha(raw),'bytes':len(raw)}
def once(raw,before,after):
 assert raw.count(before)==1,('COMPLETE_RENDER_SEAM_CHANGED',before[:80]);return raw.replace(before,after)

def render(packet):
 assert packet['format']=='sabalan-original-complete-plan-render-request/v1'and packet['productionAdmission']is False
 root=pathlib.Path(packet['directory']);assert root.is_absolute()and root.resolve(strict=True)==root and root.is_dir()
 recipes=packet['recipes'];pinned(recipes['assemble.py']);m=runpy.run_path(recipes['assemble.py']['file'],run_name='pure_complete_template_functions')
 execution=packet['execution'];m['render_controller_module'].__globals__['_CURRENT_EXECUTION']=execution;m['render_closed_artifact_binding'].__globals__['_CURRENT_EXECUTION']=execution
 assert {**execution['docker'],'file':pathlib.PureWindowsPath(execution['docker']['file']).as_posix()}==m['DOCKER'];execution['docker']=m['DOCKER'];linux=packet['linux'];linux['files']={n:base64.b64decode(v,validate=True)for n,v in linux['files'].items()}
 windows=root/'windows';windows.mkdir(mode=0o700);checkpoint=linux['files']['checkpoint.json'];owner=packet['intendedOwner'];output=packet['auditDirectory']
 controller=base64.b64decode(packet['controller'],validate=True)
 controller=once(controller,b'const BOUND_SOURCE_INPUTS=null;',b"import binding from './controller-binding.mjs';const BOUND_SOURCE_INPUTS=binding;")
 for old,new in [(b"'./protocol.mjs'",b"'./protocol.mjs'"),(b"'./original-complete-controller.mjs'",b"'./complete-ops/source/scripts/lib/original-complete-controller.mjs'"),(b"'./original-complete-counterpart.mjs'",b"'./complete-ops/source/scripts/lib/original-complete-counterpart.mjs'")]:
  if old!=new:controller=once(controller,old,new)
 live=packet['live'];live.update(workerSourceSha256=sha(linux['files']['strict_local_worker.cjs']),controllerSourceSha256=sha(controller))
 binding=m['render_controller_module'](execution,linux,str(windows),output,checkpoint,owner)
 binding=once(binding,b'function read(file,expected,max=16*1024*1024,retain=true){const a=',b'function read(file,expected,max=16*1024*1024,retain=true){assert.ok(path.isAbsolute(file));file=path.resolve(file);const a=')
 extension="""};
import{createOriginalCompleteLiveConnection}from'./complete-ops/source/scripts/lib/original-complete-live-connection.mjs';
let complete;const originalAuthenticate=bind.authenticate;
bind.authenticate=async()=>{await originalAuthenticate();complete=createOriginalCompleteLiveConnection({configuration:COMPLETE,evidenceDirectory:B.output,evidenceCustody:outputCustody,assertOriginalControllerActive:()=>assertOriginalPrivateEvidenceDirectory(outputCustody,B.output)});};
Object.defineProperty(bind,'complete',{get(){assert.ok(complete,'ORIGINAL_COMPLETE_CONNECTION_NOT_INITIALIZED');return complete;}});
export default Object.freeze(bind);
""".replace('configuration:COMPLETE','configuration:'+json.dumps(live,separators=(',',':')))
 binding=once(binding,b'};export default Object.freeze(bind);',extension.encode())
 closed=m['render_closed_artifact_binding'](execution,linux,str(windows),output,controller)
 # Exact current census includes only the genuinely retained LOCAL frontend
 # suspension. No arbitrary unhealthy/exited service allowance is introduced.
 closed['closed-artifact-binding.mjs']=once(closed['closed-artifact-binding.mjs'],b"'C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp/docker-compose.local.yml','ps','--format','json'",b"'D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json'")
 closed['closed-artifact-binding.mjs']=once(closed['closed-artifact-binding.mjs'],b'exactComposeIds:B.execution.composeIds,',b'exactComposeIds:B.execution.composeIds,expectedCensus:B.execution.expectedCensus,')
 projected="v=>({ID:v.ID,Service:v.Service,Project:v.Project,State:v.State,Health:v.Health??''})"
 closed['closed_artifacts.mjs']=once(closed['closed_artifacts.mjs'],b"assert.ok(census.every(v=>v.Project==='sabalanerp-local'&&v.State==='running'&&v.Health==='healthy'));",("assert.deepEqual(census.map("+projected+").sort((a,b)=>a.Service.localeCompare(b.Service)),b.expectedCensus);").encode())
 windows_files={'controller.mjs':controller,'controller-binding.mjs':binding,**closed,'checkpoint.json':checkpoint,'financial-verifier.cjs':pinned(execution['financialVerifier'],8*1024**2)}
 for name in ['fixed-issuer.mjs','protocol.mjs','memory_appkeys.py','backup_credential.py','appkey_delivery.py','backup_material.py']:windows_files[name]=pinned(recipes[name])
 windows_files.update({name:base64.b64decode(raw,validate=True)for name,raw in packet['windowsFiles'].items()})
 for name in ['compiled','material','image']:windows_files['current/'+name+'-receipt.json']=linux['files']['current/'+name+'-receipt.json']
 # Scope helpers use the exact same census projection as the closed-artifact
 # reader. The actual retained Root still revalidates all incarnations.
 cleanup=windows_files['terminal_cleanup.py']
 cleanup=once(cleanup,b"need(len(rows)==10 and {r['Service']:r['ID']for r in rows}==binding['localComposeIds']and all(r['Project']=='sabalanerp-local'and r['State']=='running'and r['Health']=='healthy'for r in rows))",b"need(len(rows)==10 and sorted([dict(ID=r['ID'],Service=r['Service'],Project=r['Project'],State=r['State'],Health=r.get('Health',''))for r in rows],key=lambda r:r['Service'])==binding['expectedCensus'])")
 cleanup=once(cleanup,b"operation=binding['applicationKeyBinding']['operation'];archive=binding['localMaterialArchive'];",b"operation=binding['applicationKeyBinding']['operation'];root_operation=binding['rootOperation'];need(re.fullmatch('[a-f0-9]{32}',root_operation));archive=binding['localMaterialArchive'];")
 cleanup=once(cleanup,b"('C30-complete-final-plan-'+operation)",b"('419-safe-rollback-'+root_operation)/('complete-plan-'+operation)")
 windows_files['terminal_cleanup.py']=cleanup
 # Admission selection changes only to the same fresh, reviewed producer's
 # exact source. The canonical appkey collector/envelope code is unchanged.
 appkey=windows_files['appkey_delivery.py']
 appkey=once(appkey,b"artifacts=ns['build'](spec,request,source)",b"admission=binding['productionAdmissionSource'];read(admission);guard=runpy.run_path(admission['file'],run_name='current_source_admission');guard['validate_spec'](spec)\n artifacts=ns['render'](spec,request,source);pins=json.loads(artifacts['pins.json']);oldpin=sha(artifacts['pins.json']);pins['admission']=admission;artifacts['pins.json']=(json.dumps(pins,sort_keys=True)+'\\n').encode();assert artifacts['observe-appkeys.py'].count(repr(oldpin).encode())==1;artifacts['observe-appkeys.py']=artifacts['observe-appkeys.py'].replace(repr(oldpin).encode(),repr(sha(artifacts['pins.json'])).encode())")
 windows_files['appkey_delivery.py']=appkey
 refs={name:save(windows,name,raw)for name,raw in windows_files.items()}
 # All actual copies keep their original relative dependency graph.
 for name,raw in packet['capsuleFiles'].items():save(windows,'complete-ops/source/'+name,base64.b64decode(raw,validate=True))
 # Archive construction is the reviewed data-only writer; includes the exact
 # old89dd dependencies required by the unchanged canonical financial callback.
 stage=pinned(recipes['build.py']);stage_module=runpy.run_path(recipes['build.py']['file'],run_name='pure_complete_archive_writer')
 archive=stage_module['write_archive'](stage_module['plan'](linux,packet['operation']),root/'linux-material.tar')
 return{'format':'sabalan-original-complete-rendered-plan-parts/v1','windowsFiles':refs,'archive':archive,'live':live,'controllerSha256':sha(controller),'workerSha256':sha(linux['files']['strict_local_worker.cjs']),'runtimeAdmissionClaimed':False,'productionAdmission':False}

if __name__=='__main__':
 assert not sys.flags.optimize;packet=json.load(sys.stdin);print(json.dumps(render(packet)),flush=True)
