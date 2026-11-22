import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const ts=require('typescript');
function load(){
 const source=fs.readFileSync(new URL('../../backend/src/services/protectedLegacyFileAdoptionAuthority.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
 const nativeSource=fs.readFileSync(new URL('../../backend/src/services/runtimeControlOwnership.ts',import.meta.url),'utf8');
 const native={exports:{}};new Function('module','exports','require',ts.transpileModule(nativeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText)(native,native.exports,key=>key.startsWith('node:')?require(key):{assertNativeRuntimeControlBoundary(){assert.fail('unowned control reached native boundary');}});
 const module={exports:{}};new Function('module','exports','require',code)(module,module.exports,key=>{
  if(key.startsWith('node:'))return require(key);
  if(key==='./runtimeControlOwnership')return native.exports;
  if(key==='./protectedBridgeMigrations')return {protectedBoundary(){assert.fail('unowned control reached protected boundary');}};
  if(key==='./protectedLegacyFileRoots')return {protectedLegacyFileRoots(){assert.fail('unowned control reached roots');}};
  if(key==='./protectedLegacyFileInventory')return {inventoryProtectedLegacyFiles(){assert.fail('unowned control reached files');}};
  assert.fail('unexpected dependency '+key);
 });return module.exports;
}
const owner={deploymentId:'deployment_123',releaseId:'release_123',leaseToken:'actual_owner'};
function point(){return {deploymentId:owner.deploymentId,releaseId:owner.releaseId,localVerified:true,remoteVerified:true,localRestoreVerified:true,restoreVerified:true,manifestReadable:true,compatibility:{local:{compatible:true},remote:{compatible:true}},checksum:'a'.repeat(64),size:100,manifest:{packageType:'COMPLETE',sanitized:false,components:[]}};}
test('checkpoint predicate requires exact owner and verified full local/remote restoration; never issues authority',()=>{
 const module=load();assert.equal(module.validateProtectedFileCheckpoint(owner,point()),undefined);
 for(const edit of [p=>p.releaseId='another_release',p=>p.localVerified=false,p=>p.remoteVerified=false,p=>p.localRestoreVerified=false,p=>p.restoreVerified=false,p=>p.manifestReadable=false,p=>p.compatibility.remote.compatible=false,p=>p.manifest.packageType='SANITIZED_TEST',p=>p.manifest.sanitized=true,p=>p.size=0]){const p=point();edit(p);assert.throws(()=>module.validateProtectedFileCheckpoint(owner,p),/CHECKPOINT_UNVERIFIED/);}
 let invoked=false;assert.throws(()=>module.assertProtectedLegacyFileAdoptionAuthority({assertOwned(){invoked=true;}}),/AUTHORITY_REQUIRED/);assert.equal(invoked,false);
});
test('real unowned control/FD rejection occurs BEFORE any SQL, source reads or authority issuance',async()=>{
 const module=load();let queries=0;const database={$queryRaw(){queries++;throw Error('unexpected SQL');}};
 await assert.rejects(module.ProtectedLegacyFileAdoptionAuthority.open(database,owner,{root:'/app/recovery-coordination/online-file-versions/invalid',liveRoot:'/app/storage/contracts'},'a'.repeat(64)),/RUNTIME_CONTROL_OWNERSHIP_REQUIRED/);
 assert.equal(queries,0);
});
