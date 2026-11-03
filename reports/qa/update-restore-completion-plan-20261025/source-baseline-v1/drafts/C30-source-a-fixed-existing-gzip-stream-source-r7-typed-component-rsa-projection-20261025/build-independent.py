"""Pure independent image stream verifier: no new data/key path authority."""
import pathlib,hashlib,json,re,ast,runpy,shlex
HERE=pathlib.Path(__file__).resolve().parent;Q=HERE.parent
PARENT=Q/'C30-backup-transfer-material-source-r2-terminal-cleanup-20261025'
REVIEW='712d64414561ecda9b797f988f23f3d1732cedcd40902ac77f0920739d207b89'
CORE=Q/'C30-source-a-no-workspace-stream-codec-source-r2-close-faults-20261025'
PRODUCTION=Q/'C30-source-a-no-workspace-stream-owner-source-r7-deployment-profile-20261025'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def fixed_guards():
 raw=(PARENT/'source-review.json').read_bytes();assert sha(raw)==REVIEW;review=json.loads(raw)
 ref=next(r for r in review['files']if pathlib.Path(r['file']).name=='remote.py');raw=pathlib.Path(ref['file']).read_bytes();assert sha(raw)==ref['sha256'];text=raw.decode();tree=ast.parse(text)
 constants='\n'.join(ast.get_source_segment(text,n)for n in tree.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id in ['PARENT','NODE','NODE_SHA','NODE_BYTES']for t in n.targets))
 functions='\n\n'.join(ast.get_source_segment(text,n)for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in ['need','sha','identity','host','node','private_directory'])
 assert len([n for n in ast.parse(functions).body if isinstance(n,ast.FunctionDef)])==6
 return 'import os,sys,json,stat,hashlib,subprocess\nfrom pathlib import Path\n'+constants+'\n'+functions+'\n'
def build(operation,expected,service):
 component=runpy.run_path(str(HERE/'components.py'))['select'](service);assert expected['plainBytes']==component['gzip']['bytes']and expected['plainSha256']==component['gzip']['sha256']
 assert re.fullmatch('[a-f0-9]{32}',operation)and set(expected)=={'cipherBytes','cipherSha256','image','plainBytes','plainSha256'}
 assert expected['image']==component['image']
 for name in ['cipherBytes','plainBytes']:assert type(expected[name])is int and 0<expected[name]<=2**31
 for name in ['cipherSha256','plainSha256']:assert re.fullmatch('[a-f0-9]{64}',expected[name])
 raw=(CORE/'source-review.json').read_bytes();assert sha(raw)=='791a38cc41dabd82b4f42c75616fe971e517dbdd334c77f48adbf2703063f6a9';packet=json.loads(raw)
 for r in packet['files'].values():assert sha(pathlib.Path(r['file']).read_bytes())==r['sha256']
 raw=(PRODUCTION/'source-review.json').read_bytes();assert sha(raw)=='2f85bb5addcbc798b485327bf428da0f073ba55cd5c832720b174391f08d5031'
 packet=json.loads(raw)
 for r in packet['files'].values():assert sha(pathlib.Path(r['file']).read_bytes())==r['sha256']
 root='/root/sabalan-recovery-private/source-a-independent-image-'+operation
 node=(HERE/'verify-independent.cjs').read_text();assert node.count('sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3')==1;node=node.replace('sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3',component['image']);assert node.count('const BOUND=null;')==1;node=node.replace('const BOUND=null;','const BOUND='+json.dumps(expected,sort_keys=True)+';')
 collector=(PRODUCTION/'stream-native.py').read_text();assert collector.count('pass_fds=(9,),')==1;collector=collector.replace('pass_fds=(9,),','')
 constants='ROOT=Path('+repr(root)+')\nCOLLECTOR='+repr(collector)+'\nFILES='+repr({'verify.cjs':node.encode(),'stream-codec.cjs':(CORE/'stream-codec.cjs').read_bytes()})+'\nOPERATION='+repr(operation)+'\n'
 functions=(HERE/'remote-independent.py').read_text();runtime=fixed_guards()+constants+functions+'\nif __name__=="__main__":sys.exit(verify())\n';compile(runtime,'fixed-independent-image-stream','exec')
 stage=fixed_guards()+constants+'RUNTIME='+repr(runtime.encode())+'\n'+functions+'\nif __name__=="__main__":sys.exit(stage())\n';compile(stage,'fixed-independent-image-stage','exec')
 bootstrap="import hashlib,os,stat;p="+repr(root+'/runtime.py')+";s=os.lstat(p);assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o077;f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);r=os.read(f,262145);assert len(r)<=262144 and hashlib.sha256(r).hexdigest()=="+repr(sha(runtime.encode()))+";os.close(f);exec(compile(r,p,'exec'),{'__name__':'__main__'})"
 command='python3 -I -B -c '+shlex.quote(bootstrap);assert len(command)<24000
 return {'stageSource':stage.encode(),'runtimeSource':runtime.encode(),'verifyCommand':command,'root':root,'runtimeSha256':sha(runtime.encode()),'expected':expected}
