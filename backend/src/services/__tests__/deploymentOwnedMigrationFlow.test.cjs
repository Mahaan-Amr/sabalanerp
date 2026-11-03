const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const esbuild=require('C:/Users/mahan/.codex/worktrees/immutable-final-package-413/sabalanerp/node_modules/esbuild/lib/main.js');
const actualCandidate=require('../protectedCandidateMigrationInventory.ts');
const actualLegacy=require('../protectedBootstrapMigrations.ts');
const actualHistory=require('../protectedMigrationHistory.ts');
const sourcePath=path.resolve('backend/src/scripts/deployment-owned-migrations.ts');
const source=fs.readFileSync(sourcePath,'utf8');
let compiled=esbuild.transformSync(source,{loader:'ts',format:'cjs',target:'node18'}).code;
// The test VM cannot resolve a TS dynamic import. Replace only its transport;
// main's branching and statements remain the compiled repository source.
const needle='await import("../lib/prisma")';assert.equal(compiled.split(needle).length,2);
compiled=compiled.replace(needle,'await Promise.resolve(require("../lib/prisma"))')+'\nmodule.exports.__testMain=main;';
const inventorySource=fs.readFileSync(path.resolve('backend/src/services/protectedCandidateMigrationInventory.ts'),'utf8');
const candidate=[...inventorySource.slice(inventorySource.indexOf('const definitions = ['),inventorySource.indexOf('] as const;')).matchAll(/\['(\d{14}_[A-Za-z0-9_]+)'/g)].map(match=>match[1]);
assert.equal(candidate.length,14);
const legacyBridge=['20261014120000_hr_vehicle_assignment_plans','20261014140000_online_deployment_control'];
const baseline=JSON.parse(fs.readFileSync(path.resolve('backend/src/services/protectedBootstrapBaseline.json'),'utf8')).migrations.map(item=>item.name);
const sourceDirectory=path.resolve('backend/prisma/migrations');
const full=fs.readdirSync(sourceDirectory,{withFileTypes:true}).filter(item=>item.isDirectory()).map(item=>item.name).sort();
const fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-cli-source-flow-'));
function copyInventory(label,names){const root=path.join(fixtureRoot,label);fs.mkdirSync(root);for(const name of names){const target=path.join(root,name);fs.mkdirSync(target);fs.copyFileSync(path.join(sourceDirectory,name,'migration.sql'),path.join(target,'migration.sql'));}return root;}
const legacyDirectory=copyInventory('legacy',[...baseline,...legacyBridge]);
const partialDirectory=copyInventory('partial',full.filter(name=>name!==candidate[1]));
async function runFlow(kind,pending,projectionState='valid'){
 const events=[],directory=kind==='legacy'?legacyDirectory:kind==='partial'?partialDirectory:sourceDirectory;
 const files=actualHistory.readProtectedMigrationSources(directory),names=[...files.keys()].sort();
 if(kind==='tampered'){const name=candidate[1];files.set(name,Buffer.concat([files.get(name),Buffer.from('\n')]));}
 const skipped=kind==='candidate'&&pending?candidate[0]:names.at(-1);
 const applied=new Set(names.filter(name=>!pending||name!==skipped));
 if(kind==='missing-predecessor')applied.delete('20261014120000_hr_vehicle_assignment_plans');
 const context={targetCommit:'a'.repeat(40),checkpointChecksum:'b'.repeat(64),prefixLength:0,lastReceiptCatalogSha256:null};
 const prisma={$queryRaw:async()=>[], $transaction:async callback=>callback({$queryRaw:async()=>[{owned:true}]})};
 const modules={
  '../lib/prisma':{prisma,disconnectDatabase:async()=>events.push('disconnect')},
  '../services/protectedFinancialDeploymentHandoff':{validateProtectedFinancialDeploymentHandoff(){}},
  '../services/protectedMigrationHistory':{readProtectedMigrationSources:()=>files,validateProtectedMigrationHistory:()=>applied},
  '../services/protectedBridgeMigrations':{assertProtectedBridgeMigrationAuthority:async()=>events.push('authority'),protectedBoundary:()=>()=>events.push('boundary'),
   compileProtectedBridgeMigration:name=>events.push('compile:'+name),applyProtectedBridgeMigration:async(_db,_owner,name)=>{events.push('apply:'+name);return {applied:true};},applyProtectedCandidatePlan:async()=>{events.push('apply:candidate');return {applied:0};},protectedBridgeMigrationNames:legacyBridge},
  '../services/protectedCandidateMigrationInventory':{exactCandidateMigrationNames:candidate,compileExactCandidatePending:items=>{events.push('candidate-compile');return actualCandidate.compileExactCandidatePending(items);}},
  '../services/protectedCandidateTransactionObservation':{readCandidateTransactionObservation:async()=>{events.push('candidate-observe');return context;},readProtectedTransactionHistory:async()=>{events.push('legacy-observe');return context;}},
  '../services/protectedCandidateProjection':{readCandidateProjection:()=>{events.push('projection');if(projectionState!=='valid')throw Object.assign(Error('CANDIDATE_SOURCE_PROJECTION_UNPROVEN'),{code:'CANDIDATE_SOURCE_PROJECTION_UNPROVEN'});return {sourceImageBinding:'HOST_REPORTED_NOT_INDEPENDENT'};}},
  '../services/protectedBootstrapMigrations':{compileProtectedBootstrapSource:()=>{events.push('legacy-compile');return actualLegacy.compileProtectedBootstrapSource(directory);}},
 };
 const fakeRequire=id=>id==='node:path'?require(id):modules[id]??(()=>{throw Error('Unexpected import '+id);})();
 const output=[],module={exports:{}},proc={argv:['node','script'],env:{DEPLOYMENT_ID:'d',DEPLOYMENT_RELEASE_ID:'r',DEPLOYMENT_LEASE_TOKEN:'t',DEPLOYMENT_CONTROL_IMAGE:'sha256:'+'a'.repeat(64)}};
 const sandbox={require:fakeRequire,module,exports:module.exports,__dirname:path.dirname(sourcePath),process:proc,Buffer,console:{log:x=>output.push(JSON.parse(x)),error:()=>{}},setTimeout,clearTimeout};
 vm.runInNewContext(compiled,sandbox,{filename:sourcePath});
 let error;try{await module.exports.__testMain();}catch(e){error=e;}
 return {events,output,error};
}
for(const kind of ['legacy','candidate'])for(const projectionState of ['missing','identity-mismatch']){
 test(`actual CLI ${kind} rejects ${projectionState} projection before DDL`,async()=>{
  const r=await runFlow(kind,true,projectionState);assert.equal(r.error?.code,'CANDIDATE_SOURCE_PROJECTION_UNPROVEN');
  assert.ok(!r.events.some(value=>value.startsWith('apply:')));
 });
}

for(const pending of [true,false]){
 test(`actual CLI main routes legacy ${pending?'pending':'no-pending'} through legacy projection`,async()=>{
  const r=await runFlow('legacy',pending);assert.equal(r.error,undefined);assert.ok(r.events.includes('legacy-compile'));assert.ok(r.events.includes('projection'));assert.ok(r.events.includes('legacy-observe'));assert.ok(!r.events.includes('candidate-observe'));
  assert.equal(r.output.at(-1).sourceClassification,'LEGACY_SOURCE_VERIFIED_IMAGE_HOST_REPORTED');
 });
 test(`actual CLI routes candidate ${pending?'pending':'no-pending'} through owned applier`,async()=>{
  const r=await runFlow('candidate',pending);assert.equal(r.error,undefined);assert.ok(r.events.includes('candidate-observe'));assert.ok(r.events.includes('projection'));assert.ok(r.events.includes('apply:candidate'));
 });
}
test('actual CLI rejects missing unrelated predecessor before candidate DDL',async()=>{
 const r=await runFlow('missing-predecessor',false);assert.equal(r.error?.code,'CANDIDATE_PREDECESSOR_HISTORY_INCOMPLETE');assert.ok(!r.events.some(x=>x.startsWith('apply:')));
});
test('actual CLI main rejects partial candidate before projection or DDL',async()=>{
 const r=await runFlow('partial',false);assert.match(r.error?.message,/PROTECTED_BOOTSTRAP_SOURCE_UNSUPPORTED/);assert.ok(!r.events.includes('projection'));assert.ok(!r.events.some(x=>x.startsWith('apply:')));
});
test('actual CLI main rejects tampered candidate bytes before projection or DDL',async()=>{
 const r=await runFlow('tampered',false);assert.match(r.error?.message,/CANDIDATE_PENDING_IDENTITY_UNPROVEN/);assert.ok(!r.events.includes('projection'));assert.ok(!r.events.some(x=>x.startsWith('apply:')));
});
