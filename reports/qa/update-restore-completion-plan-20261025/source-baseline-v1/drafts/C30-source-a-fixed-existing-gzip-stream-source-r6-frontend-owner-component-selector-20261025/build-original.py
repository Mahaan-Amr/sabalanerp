"""Extract the reviewed same-original R6 binary collector, no lifecycle rewrite."""
import ast,pathlib,hashlib,json
PARENT=pathlib.Path('D:/sabalanerp-online-qa/C30-strict-complete-actual-plan-source-r6-observed-renewal-20261025')
REVIEW='e20fd6ac89c0b78bd4602399ef38a3905f3116a153bcbaac07d0f697d7ff03ca'
def build():
 raw=(PARENT/'source-review.json').read_bytes();assert hashlib.sha256(raw).hexdigest()==REVIEW;review=json.loads(raw)
 refs=[r for r in review['files']if pathlib.Path(r['file']).name=='original_owner.py'];assert len(refs)==1
 ref=refs[0];source=pathlib.Path(ref['file']).read_bytes();assert hashlib.sha256(source).hexdigest()==ref['sha256'];text=source.decode();tree=ast.parse(text)
 definitions='\n\n'.join(ast.get_source_segment(text,n)for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in ['digest','file_sha','save'])
 cls=next(n for n in tree.body if isinstance(n,ast.ClassDef)and n.name=='CompleteRestoreOwner')
 methods=[ast.get_source_segment(text,n)for n in cls.body if isinstance(n,ast.FunctionDef)and n.name in ['__init__','_cancel','close','run_original']];assert len(methods)==4
 result='import hashlib,json,os,pathlib,signal,subprocess,threading\nfrom threading import Event,Lock\n'+definitions+'\n\nclass SourceStreamOwner:\n'+'\n'.join(' '+x.replace('\n','\n ')for x in methods)+'\n'
 old="def run_original(self,argv,phase,secret_input=b'',maximum_stdout=8*1024**2,redact_password=None):";assert result.count(old)==1;result=result.replace(old,old.replace('redact_password=None','redact_password=None,input_file=None,env=None'))
 start=result.index('  assert phase in (');end=result.index('\n',start);result=result[:start]+"  assert phase in ('nativeSshSignature','stageSource','binaryPhase','validateArchive')and isinstance(secret_input,bytes)and(not secret_input or input_file is None)"+result[end:]
 old='child=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE';assert result.count(old)==1;result=result.replace(old,'child=subprocess.Popen(argv,stdin=input_file if input_file is not None else subprocess.PIPE,stdout=subprocess.PIPE')
 old='stderr=subprocess.PIPE,creationflags=';assert result.count(old)==1;result=result.replace(old,'stderr=subprocess.PIPE,env=env,creationflags=')
 compile(result,'source-stream-original','exec');return result.encode()
