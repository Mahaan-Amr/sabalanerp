"""Pure finite phase renderer; no runtime main, SSH, secret or native action.
Each production phase requires a newly authenticated current spec/preflight.
"""
import ast,hashlib,json,pathlib,re,runpy
HERE=pathlib.Path(__file__).resolve().parent;Q=pathlib.Path('D:/sabalanerp-online-qa')
PARENT=Q/'C30-production81-source-preparer-r2-production-only-capacity-20261025'
CORE=Q/'C30-source-a-no-workspace-stream-codec-source-r2-close-faults-20261025'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def manifest(directory,name,digest):
 p=directory/name;raw=p.read_bytes();assert sha(raw)==digest;value=json.loads(raw)
 rows=value['files'].values()if directory==CORE else value['files']
 for row in rows:assert sha(pathlib.Path(row['file']).read_bytes())==row['sha256']
 return value
def render(spec,operation,output,preflight,phase,expected_cipher=None,service=None):
 assert re.fullmatch('[a-f0-9]{32}',operation)and phase in ['encrypt-existing','local-decrypt']
 if phase=='encrypt-existing':assert expected_cipher is None
 else:assert set(expected_cipher)=={'bytes','sha256'}and type(expected_cipher['bytes'])is int and 0<expected_cipher['bytes']<=2**31 and re.fullmatch('[a-f0-9]{64}',expected_cipher['sha256'])
 manifest(PARENT,'source-review.json','18fa39f5c94fd7710baae9c49f200fa578c4627b3a6b5a3cf3d51c006261acd9')
 manifest(CORE,'source-review.json','791a38cc41dabd82b4f42c75616fe971e517dbdd334c77f48adbf2703063f6a9')
 renderer=Q/'C30-production81-source-preparer-r3-observed-backend-restart-20261025/backend_export.py';assert sha(renderer.read_bytes())=='47ddc1e8bafc766f9edb50b8563e0b4653adac312875d157f6ced646806756a4'
 parent=runpy.run_path(str(renderer),run_name='fixed_source_a_observed_restart_parent')
 component=runpy.run_path(str(HERE/'components.py'))['select'](service);assert next(r for r in spec['expectedEight']if r['service']==service)['image']==component['image']
 validator=runpy.run_path(str(PARENT/'source-a-preflight.py'));fresh=validator['validate'](preflight);bound_preflight={'sha256':preflight['sha256'],'observedAt':fresh['observedAt']}
 artifacts=parent['render'](spec,operation,output,bound_preflight)
 return compile_phase(artifacts['remote.py'],operation,phase,expected_cipher,spec,component)
def compile_phase(raw_remote,operation,phase,expected_cipher,spec,component):
 assert re.fullmatch('[a-f0-9]{32}',operation)and phase in ['encrypt-existing','local-decrypt']
 remote=raw_remote.decode();base=remote[:remote.index('def observe(h):')]
 image_nodes=[n for n in ast.parse(base).body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='IMAGE'for t in n.targets)];assert len(image_nodes)==1 and ast.literal_eval(image_nodes[0].value)=='sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3'
 line=ast.get_source_segment(base,image_nodes[0]);assert base.count(line)==1;base=base.replace(line,'IMAGE='+repr(component['image']))
 maximum=2**31;root='/root/sabalan-recovery-private/source-a-existing-'+component['service']+'-'+phase+'-'+operation
 constants='\n'.join(name+'='+repr(value)for name,value in [('PHASE',phase),('COMPONENT',component),('REMOTE_ROOT',root),('MAXIMUM_OUTPUT',maximum),('EXPECTED_CIPHER',expected_cipher),('SOURCE_WORKSPACE_BOUND',2*1024**2),('STREAM_CODEC',(CORE/'stream-codec.cjs').read_text()),('PIPELINE',(HERE/'pipeline.cjs').read_text()),('COLLECTOR',(HERE/'stream-native.py').read_text())])+'\n'
 functions=(HERE/'remote-phase.py').read_text();runtime=base+constants+functions+'\nif __name__=="__main__":sys.exit(stream())\n';compile(runtime,'fixed-source-a-stream-runtime','exec')
 stage=base+constants+'RUNTIME='+repr(runtime)+'\n'+functions+'\nif __name__=="__main__":sys.exit(stage())\n';compile(stage,'fixed-source-a-stream-stage','exec')
 assert len(runtime.encode())+len((CORE/'stream-codec.cjs').read_bytes())+len((HERE/'pipeline.cjs').read_bytes())<2*1024**2
 command="python3 -I -B -c "+__import__('shlex').quote("import hashlib,os,stat; p="+repr(root+'/runtime.py')+";s=os.lstat(p);assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o077;f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);r=os.read(f,2097153);assert len(r)<=2097152 and hashlib.sha256(r).hexdigest()=="+repr(sha(runtime.encode()))+";os.close(f);exec(compile(r,p,'exec'),{'__name__':'__main__'})")
 assert len(command)<32700
 return {'stageSource':stage.encode(),'runtimeSource':runtime.encode(),'remoteCommand':command,'phase':phase,'operation':operation,'root':root,'runtimeSpecSha256':sha(json.dumps(spec,sort_keys=True,separators=(',',':')).encode())}
