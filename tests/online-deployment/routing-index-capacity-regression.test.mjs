/** Public synthetic capacity regression. No authority, database or runtime is created. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import test from 'node:test';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const routingFile=new URL('./application-native-routing.fixture.mjs',import.meta.url);
const producerFile=new URL('./application-native.fixture.py',import.meta.url);
const source=fs.readFileSync(routingFile,'utf8');
const begin=source.indexOf('function privateRead('),end=source.indexOf('\nconst input=',begin);
assert.ok(begin>0&&end>begin);const functionSource=source.slice(begin,end);
const root='/app/online-runtime-acceptance/application-native-'+'a'.repeat(32);
function grant(ordinal){const id=String(ordinal).padStart(64,'0'),coordinationDirectory=root+'/restored-coordination';return{name:'synthetic-'+ordinal,file:'/run/sabalan-online/'+id+'.json',sha256:'0'.repeat(64),scope:{format:'sabalan-online-runtime-scope/v2',runtimeId:id,releaseId:'synthetic-capacity-only',manifestSha256:'0'.repeat(64),sourceCommit:'0'.repeat(40),image:'sha256:'+'0'.repeat(64),nonce:'0'.repeat(64),purpose:ordinal<2?'http':'jobs',role:ordinal<2?'serving':'control',coordinationDirectory,nativeDirectory:coordinationDirectory+'/online/native/'+id,boundaryDirectory:coordinationDirectory+'/online/work/'+id,gate:{device:'1',inode:'2',ownerUid:0},interlock:{device:'1',inode:'3',ownerUid:0},worker:{device:'1',inode:'4',ownerUid:0},admission:{directory:coordinationDirectory+'/online/admission',scopeSha256:'0'.repeat(64)},database:{systemIdentifier:'1',name:'qa_application_'+'a'.repeat(32)}}};}
const grants=Array.from({length:17},(_,i)=>grant(i+1));grants[0].scope.purpose=grants[1].scope.purpose='http';grants[2].scope.purpose='capture';
const index={database:'qa_application_'+'a'.repeat(32),oid:'1',grants:grants.slice(0,4),restoredGrant:grants[4],restoredBaselineGrant:grants[5],pristinePerformanceGrant:grants[6],onlinePointInquiryGrant:grants[7],privateQualification:{httpGrant:grants[8],httpGrants:grants.slice(8,10),oldJobsGrant:grants[10],jobsGrant:grants[11],onlinePointCaptureGrant:grants[12],domainRestore:{captureGrant:grants[13],baselineGrant:grants[14]}},inquiryGrants:{source:grants[15],restored:grants[16]},catalog:{operation:'a'.repeat(32),sourceManifestSha256:'0'.repeat(64),caseInventorySha256:'0'.repeat(64),caseInventory:Array.from({length:310},(_,i)=>({file:'tests/full-catalog/synthetic-public-regression-'+String(i).padStart(3,'0')+'.spec.ts',line:i+1,projects:['chromium'],title:'Synthetic public catalog capacity coverage '+String(i)+' '+ 'bounded input contract '.repeat(4)}))}};
const bytes=Buffer.from(JSON.stringify(index)+'\n');assert.ok(bytes.length>65536&&bytes.length<=524288);
function reader(data=bytes,changes={}){
 let position=0;
 // Explicit Linux metadata shim: these are synthetic descriptors in memory,
 // so Windows host mode/uid semantics cannot accidentally qualify a Linux file.
 const state={isFile:()=>true,nlink:1n,uid:0n,mode:0o100400n,size:BigInt(data.length),dev:7n,ino:12n,mtimeNs:1n,ctimeNs:1n,...changes};
 const fake={constants:{O_RDONLY:0,O_NOFOLLOW:1,O_NONBLOCK:2},openSync:()=>42,closeSync:()=>{},fstatSync:()=>state,lstatSync:()=>state,readSync:(fd,target,offset,length)=>{const n=Math.min(length,data.length-position);data.copy(target,offset,position,position+n);position+=n;return n;}};
 const ctx={fs:fake,assert,Buffer,process:{getuid:()=>0}};vm.runInNewContext(functionSource+';globalThis.read=privateRead',ctx);return ctx.read;
}
test('310 public cases plus17 representative grants exceed the old64KiB bound',()=>{assert.equal(index.catalog.caseInventory.length,310);assert.equal(index.grants.filter(g=>g.scope.purpose==='http').length,2);assert.throws(()=>reader()('/index'));assert.deepEqual(reader()('/index',524288),bytes);});
test('only the producer index consumer selects512KiB; default remains64KiB',()=>{assert.ok(source.includes("index=JSON.parse(privateRead(path.join(root,'index.json'),512*1024));"));assert.ok(functionSource.startsWith('function privateRead(file,maximum=65536)'));assert.throws(()=>reader(Buffer.alloc(65537,1))('/other'));});
test('index ceiling accepts524288 bytes and refuses524289',()=>{assert.equal(reader(Buffer.alloc(524288,1))('/index',524288).length,524288);assert.throws(()=>reader(Buffer.alloc(524289,1))('/index',524288));});
for(const[name,change]of[['nonregular',{isFile:()=>false}],['alias',{nlink:2n}],['wrongowner',{uid:1n}],['publicmode',{mode:0o100444n}],['empty',{size:0n}]])test('index keeps original private metadata guard: '+name,()=>assert.throws(()=>reader(bytes,change)('/index',524288)));
test('exact Python producer guard runs before original0400 write and enforces both boundaries',()=>{
 const program=String.raw`import ast,pathlib,sys
source=pathlib.Path(sys.argv[1]).read_text();tree=ast.parse(source)
nodes=[n for n in ast.walk(tree)if isinstance(n,ast.Expr)and isinstance(n.value,ast.Call)and isinstance(n.value.func,ast.Name)and n.value.func.id=='check'and any(isinstance(x,ast.Constant)and x.value=='APPLICATION_NATIVE_INDEX_CAPACITY_EXCEEDED'for x in n.value.args)]
assert len(nodes)==1;n=nodes[0];lines=source.splitlines();assert "write(root / 'index.json', index_bytes)"in lines[n.end_lineno];assert 'index_bytes = encoded(dict('in source;assert 'def write(file, data, permissions=0o400):'in source
code=compile(ast.Module(body=[n],type_ignores=[]),'source-owned-index-capacity','exec')
def check(value,message):
 if not value:raise AssertionError(message)
for length,accepted in [(0,False),(104197,True),(524288,True),(524289,False)]:
 try:exec(code,{'check':check,'index_bytes':bytes(length)})
 except AssertionError:assert not accepted
 else:assert accepted
`;
 const result=spawnSync('python',['-I','-B','-c',program,fileURLToPath(producerFile)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);
});
