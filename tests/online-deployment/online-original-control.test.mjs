import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const source=path.resolve('deploy/scripts/online-release-inner-controller.py');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const scope='a'.repeat(64),session='b'.repeat(64);
const base={format:'sabalan-online-original-control/v1',session,scopeSha256:scope,sequence:1,command:'START',input:{databaseUrl:'postgresql://private@postgres/isolated',startupDecision:{},protectedBootstrap:null}};
const harness=String.raw`
import ast,base64,io,json,os,pathlib,subprocess,sys
request=json.loads(sys.stdin.read());tree=ast.parse(pathlib.Path(request['source']).read_text())
selected=[]
for node in tree.body:
 if isinstance(node,ast.Assign) and any(isinstance(name,ast.Name) and name.id=='VERIFY' for name in node.targets):selected.append(node)
 if isinstance(node,ast.FunctionDef) and node.name in ('require','encode','original','receive'):selected.append(node)
context={'json':json,'base64':base64,'subprocess':subprocess,'sys':sys,'PUBLIC':request['publicFile'],'session':request['session'],'scope_sha':request['scope'],'sequence':0,'children':[]}
actual_popen=subprocess.Popen
class Adapter:
 PIPE=subprocess.PIPE
 def Popen(self,argv,**kwargs):
  assert argv[0]=='/usr/local/bin/node' and argv[1]=='-e'
  return actual_popen([request['node'],*argv[1:]],**kwargs)
context['subprocess']=Adapter()
exec(compile(ast.Module(body=selected,type_ignores=[]),request['source'],'exec'),context)
sys.stdin=io.TextIOWrapper(io.BytesIO(request['wire'].encode()))
accepted=False
try:context['receive']();accepted=True
except Exception:pass
assert all(child.poll() is not None for child in context['children'])
print(json.dumps({'accepted':accepted,'originalVerifierStatuses':[child.returncode for child in context['children']],'nativeQualification':False}))
`;
function check(value,{tamper=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'original-control-unit-'));
 try{
  const file=path.join(dir,'public.pem');fs.writeFileSync(file,publicKey.export({type:'spki',format:'pem'}));
  const signature=sign(null,Buffer.from('sabalan-online-original-control/v1\n'+JSON.stringify(canonical(value))),privateKey).toString('base64');
  const decision=structuredClone(value);if(tamper)decision.input.databaseUrl+='changed';
  const result=spawnSync('python',['-I','-B','-c',harness],{input:JSON.stringify({source,node:process.execPath,publicFile:file,scope,session,wire:JSON.stringify({decision,signature})+'\n'}),encoding:'utf8',maxBuffer:65536});
  assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
 }finally{fs.rmSync(dir,{recursive:true});}
}
test('actual original verifier accepts exact Ed25519 frame and original verifier closes0',()=>{
 assert.deepEqual(check(base),{accepted:true,originalVerifierStatuses:[0],nativeQualification:false});
});
test('actual signed body substitution is refused after original verifier closes1',()=>{
 assert.deepEqual(check(base,{tamper:true}),{accepted:false,originalVerifierStatuses:[1],nativeQualification:false});
});
test('wrong original session, scope and sequence refuse before any verifier/native child',()=>{
 for(const patch of [{session:'c'.repeat(64)},{scopeSha256:'d'.repeat(64)},{sequence:2}])
  assert.deepEqual(check({...base,...patch}),{accepted:false,originalVerifierStatuses:[],nativeQualification:false});
});
