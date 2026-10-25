import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';import crypto from 'node:crypto';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const repo=fileURLToPath(new URL('../..',import.meta.url)),require=createRequire(path.join(repo,'backend/package.json')),ts=require('typescript');
const source=fs.readFileSync(path.join(repo,'backend/src/services/restoredQaFileAdoptionAuthority.ts'),'utf8');
const relative=['storage/hr-hiring','uploads/images','uploads/security-shift-log','uploads/security-vehicle-pairs','storage/contracts','storage/accounting-contracts','storage/dispatch-documents','storage/performance-exports','storage/support-tickets'];
const hash=raw=>crypto.createHash('sha256').update(raw).digest('hex');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'qa-adoption-unit-')),coord=path.join(root,'recovery-coordination');fs.mkdirSync(coord);
 const owner={deploymentId:'unit-qa-owner',releaseId:'unit-qa-release',leaseToken:'unit-only-lease'},proof={},baseline={},material={},database={name:'sabalan_checkpoint_verify_123456789abc',oid:'2',systemIdentifier:'3'};
 const gate=path.join(coord,'deployment-write-admission.lock');fs.writeFileSync(gate,'');const named=fs.lstatSync(gate,{bigint:true});
 const live=relative.map(r=>path.join(root,r));for(const p of live)fs.mkdirSync(p,{recursive:true});
 const payload=Buffer.from('unit source business file');fs.writeFileSync(path.join(live[0],'business'),payload);
 const context={proof:{database,rawHistorySha256:hash('unit native440')},manifest:{components:[{path:'files/hr-hiring/business',size:payload.length,sha256:hash(payload)}]}};
 const state={active:true,gateClosed:false,quiet:true,lease:true,sourceChanged:false,failedReadback:false,pending:false,foreignRoot:false,rootsChanged:false,ports:0,opened:0,closed:0};
 const environment={BACKEND_RUNTIME_ROLE:'control',BACKEND_CAPTURE_GATE_FD:'10',BACKEND_CAPTURE_GATE_FILE:gate,BACKEND_CAPTURE_GATE_DEVICE:String(named.dev),BACKEND_CAPTURE_GATE_INODE:String(named.ino)};
 const shim=Object.create(fs);shim.fstatSync=(fd,opts)=>{if(fd!==10)return fs.fstatSync(fd,opts);if(state.gateClosed){if(state.reused)return fs.lstatSync(state.reused,{bigint:true});throw Object.assign(Error('unit closed descriptor'),{code:'EBADF'});}return new Proxy(named,{get:(t,k)=>k==='mode'?(t.mode&~0o777n)|0o600n:Reflect.get(t,k)});};
 shim.lstatSync=(file,opts)=>{const actual=fs.lstatSync(file,opts);return file===gate&&opts?.bigint?new Proxy(actual,{get:(t,k)=>k==='mode'?(t.mode&~0o777n)|0o600n:Reflect.get(t,k)}):actual;};
 shim.readFileSync=(file,...rest)=>file==='/proc/self/fdinfo/10'?`lock: 1: FLOCK ADVISORY WRITE 123 0:0:${named.ino} 0 EOF\n`:fs.readFileSync(file,...rest);
 shim.readdirSync=(file,...args)=>file==='/proc/self/fd'?(state.reused?['10']:[]):fs.readdirSync(file,...args);
 shim.closeSync=fd=>{assert.equal(fd,10);assert.equal(state.gateClosed,false);state.gateClosed=true;};
 const tx={$queryRaw:async()=>[{foreignSessions:state.quiet?0:1,prepared:0}]};let exports;
 const mocks={
 './systemRecoveryEngine':{assertActiveStrictRestoreProof:p=>{assert.ok(p===proof&&state.active);return context;},withSystemRecoveryDatabaseClient:async(name,work)=>{assert.equal(name,database.name);state.opened++;try{return await work({$transaction:work=>work(tx)});}finally{state.closed++;}}},
 './restoredQaWorkingMaterial':{assertRestoredQaWorkingMaterial:(m,o)=>{assert.equal(m,material);assert.deepEqual(o,owner);return{root,roots:{'recovery-coordination':coord},database};}},
 './restoredQaMigrationBaseline':{assertRestoredQaMigrationBaseline:(b,o)=>{assert.equal(b,baseline);assert.deepEqual(o,owner);assert.ok(state.active);return{targetDatabase:database};},assertRestoredQaMigrationLease:async(_tx,b,o)=>{assert.equal(b,baseline);assert.deepEqual(o,owner);assert.ok(state.lease,'unit expired lease');}},
 './hrPersonnelErasureGraph':{get HR_PERSONNEL_ERASURE_STORAGE_ROOTS(){return state.rootsChanged?[...live.slice(0,4),path.join(root,'foreign')]:live.slice(0,4);}},
 './documentPdfFileRuntime':{DOCUMENT_PDF_RETAINED_ROOTS:live.slice(4,6)},'./dispatchFileRuntime':{DISPATCH_DOCUMENT_STORAGE_ROOT:live[6]},'./performanceFileRuntime':{performanceExportStorageDirectory:()=>live[7]},'./supportFileRuntime':{supportTicketStorageDirectory:()=>live[8]},
 './protectedLegacyFileInventory':{inventoryProtectedLegacyFiles:async(directory,owned)=>{owned();assert.equal(state.sourceChanged,false,'unit changed file');return{files:directory===live[0]?[{key:'business',bytes:payload.length,sha256:hash(fs.readFileSync(path.join(directory,'business')))}]:[],directories:[directory],identity:{device:'unit',inode:'unit'}};}},
 './versionedFilePublication':{VersionedFilePublication:{openForRestoredQaLegacyAdoption:async authority=>{exports.assertRestoredQaFileAdoptionAuthority(authority);await authority.assertSource();await authority.assertLease();state.ports++;const pending=path.join(authority.source.root,'pending');fs.mkdirSync(pending);return{adoptLegacy:async()=>{assert.equal(state.failedReadback,false,'unit unproven readback');if(state.pending)fs.writeFileSync(path.join(pending,'unresolved'),'unit');if(state.foreignRoot)fs.mkdirSync(path.join(path.dirname(authority.source.root),'foreign'),{recursive:true});return{sha256:hash('unit actual-algorithm-tested-separately'),publicOnlineAdmission:false};}};}}},
 };
 const module={exports:{}};new Function('exports','require','module','process',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText)(module.exports,id=>id==='node:fs'?shim:mocks[id]??require(id),module,{platform:'linux',getuid:()=>0,cwd:()=>root,env:environment});exports=module.exports;
 return{...exports,owner,proof,baseline,material,state,environment,root,gate,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('nine source-bound adoptions require quiet clients and finish before only Node-owned EX10 closes',async()=>{const f=fixture();try{const result=await f.adoptRestoredQaLegacyFiles(f.proof,f.baseline,f.material,f.owner);assert.equal(f.state.ports,9);assert.equal(f.state.gateClosed,true);assert.equal(f.state.opened,f.state.closed);assert.equal(result.proof.records.length,9);assert.equal(result.proof.productionAdmission,false);f.assertRestoredQaAdoptionCompletion(result.completion,f.baseline,f.owner);assert.throws(()=>f.assertRestoredQaAdoptionCompletion({...result.completion},f.baseline,f.owner));f.state.active=false;assert.throws(()=>f.assertRestoredQaAdoptionCompletion(result.completion,f.baseline,f.owner));}finally{f.cleanup();}});
test('foreign proof/root/lease/SQL or unresolved readback/pending preserves held EX10 and returns no cap',async()=>{for(const change of [f=>{f.proof={};},f=>{f.state.rootsChanged=true;},f=>{f.state.lease=false;},f=>{f.state.quiet=false;},f=>{f.state.failedReadback=true;},f=>{f.state.pending=true;},f=>{f.state.foreignRoot=true;},f=>{f.environment.BACKEND_CAPTURE_GATE_INODE='999';}]){const f=fixture();try{change(f);await assert.rejects(f.adoptRestoredQaLegacyFiles(f.proof,f.baseline,f.material,f.owner));assert.equal(f.state.gateClosed,false);assert.equal(f.state.opened,f.state.closed);}finally{f.cleanup();}}});
test('source file mutation prevents its adoption and preserves gate closure refusal',async()=>{const f=fixture();try{fs.writeFileSync(path.join(f.root,relative[0],'business'),Buffer.from('changed actual unit file'));await assert.rejects(f.adoptRestoredQaLegacyFiles(f.proof,f.baseline,f.material,f.owner));assert.ok(f.state.ports<9);assert.equal(f.state.gateClosed,false);}finally{f.cleanup();}});
test('ordinary protected adoption retains exact original algorithm statements behind private delegation',()=>{const current=fs.readFileSync(path.join(repo,'backend/src/services/versionedFilePublication.ts'),'utf8');const old=require('node:child_process').execFileSync('git',['show','HEAD:backend/src/services/versionedFilePublication.ts'],{cwd:repo,encoding:'utf8'});const parse=s=>ts.createSourceFile('x.ts',s.replaceAll('\r\n','\n'),ts.ScriptTarget.Latest,true);const method=(s,name)=>{let found;const walk=n=>{if(ts.isMethodDeclaration(n)&&n.name?.getText()==name)found=n;ts.forEachChild(n,walk);};walk(parse(s));assert.ok(found);return found;};const oldBody=method(old,'openForProtectedLegacyAdoption').body.statements.map(s=>s.getText());const newBody=method(current,'openLegacyAdoption').body.statements.map(s=>s.getText());assert.deepEqual(newBody,oldBody.slice(1));assert.equal(method(current,'adoptLegacy').getText(),method(old,'adoptLegacy').getText());});

test('opaque completion permits a genuinely different reopened descriptor 10 and refuses original-gate alias',async()=>{const f=fixture();try{const result=await f.adoptRestoredQaLegacyFiles(f.proof,f.baseline,f.material,f.owner);const unrelated=path.join(f.root,'unrelated');fs.writeFileSync(unrelated,'actual independent inode');f.state.reused=unrelated;f.assertRestoredQaAdoptionCompletion(result.completion,f.baseline,f.owner);f.state.reused=f.gate;assert.throws(()=>f.assertRestoredQaAdoptionCompletion(result.completion,f.baseline,f.owner),/ORIGINAL_GATE_REOPENED/);}finally{f.cleanup();}});
test('finite original Python reproduces actual descriptor10 close and unrelated real reuse',()=>{const code=`import os,tempfile,json
from pathlib import Path
with tempfile.TemporaryDirectory()as d:
 a=Path(d)/'gate';b=Path(d)/'unrelated';a.write_bytes(b'');b.write_bytes(b'unrelated')
 fd=os.open(a,os.O_RDONLY);os.dup2(fd,10);original=os.fstat(10)
 if fd!=10:os.close(fd)
 os.close(10)
 try:os.fstat(10);raise AssertionError('not closed')
 except OSError as e:assert e.errno==9
 held=[]
 try:
  while True:
   n=os.open(b,os.O_RDONLY);held.append(n)
   if n==10:break
   assert n<10
  reused=os.fstat(10);assert (original.st_dev,original.st_ino)!=(reused.st_dev,reused.st_ino)
  print(json.dumps({'originalClosed':True,'descriptorReused':10,'sameInode':False}))
 finally:
  for n in held:os.close(n)
`;const r=require('node:child_process').execFileSync('python',['-I','-B','-c',code],{encoding:'utf8'});assert.deepEqual(JSON.parse(r),{originalClosed:true,descriptorReused:10,sameInode:false});});
