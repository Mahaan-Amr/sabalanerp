const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const esbuild=require('C:/Users/mahan/.codex/worktrees/immutable-final-package-413/sabalanerp/node_modules/esbuild/lib/main.js');
const file=path.resolve('backend/src/services/protectedBridgeMigrations.ts');
const source=esbuild.transformSync(fs.readFileSync(file,'utf8'),{loader:'ts',format:'cjs',target:'node18'}).code;
async function run(mode){
 const events=[],owner={deploymentId:'d',releaseId:'r',leaseToken:'t'},checksum='a'.repeat(64);
 const stat={isFile:()=>true,nlink:1n,size:4n,uid:1000n,mode:0o100600n,dev:1n,ino:2n,mtimeNs:3n,ctimeNs:4n};
 const fakeFs={constants:fs.constants,openSync:file=>{if(String(file).endsWith('deployment-bootstrap-native.json'))throw Object.assign(Error('missing'),{code:'ENOENT'});return 1;},fstatSync:()=>stat,lstatSync:()=>stat,realpathSync:x=>x,readFileSync:()=>JSON.stringify(owner),closeSync:()=>{}};
 const names=Array.from({length:14},(_,i)=>`candidate_${i}`),files=new Map(names.map(name=>[name,Buffer.from(name)]));
 const modules={'node:fs':fakeFs,'node:path':require('node:path'),'node:crypto':require('node:crypto'),'@prisma/client':{Prisma:{}},
  './runtimeControlOwnership':{assertRuntimeControlOwnership:()=>events.push('boundary')},
  './protectedMigrationHistory':{readProtectedMigrationSources:()=>files,validateProtectedMigrationHistory:()=>new Set()},
  './protectedCandidateMigrationInventory':{exactCandidateMigrationNames:names,exactCandidatePlanSha256:'d'.repeat(64),compileExactCandidatePending:items=>{events.push('compile');assert.equal(items.length,14);if(mode==='bad-source')throw Error('BAD_SOURCE');return items.map(x=>({name:x.name,sha256:'e'.repeat(64),statements:['SELECT 1']}));}},
  './protectedCandidateStageProjection':{candidateStageProjection:()=>({state:'UNKNOWN'})},
  './protectedCandidateStageComparison':{compareCandidateStage:async()=>({state:'UNKNOWN'})},
  './protectedCandidateRelationSecurity':{observeCandidateRelationSecurity:async()=>({state:'UNKNOWN'})},
  './protectedCandidateExplicitDimensions':{observeCandidateExplicitDimensions:async()=>({state:'UNKNOWN'})},
  './protectedCandidateProjection':{readCandidateProjection:()=>({sourceImageBinding:'HOST_REPORTED_NOT_INDEPENDENT'})},
  './protectedCandidateTransactionObservation':{readCandidateTransactionObservation:async()=>{events.push('catalog');if(mode==='mismatch')throw Error('CATALOG_MISMATCH');return {checkpointChecksum:checksum,targetCommit:'a'.repeat(40),prefixLength:0,stageComparison:{state:'UNKNOWN'},explicitDimensions:{state:'UNKNOWN'},relationSecurity:{state:'UNKNOWN'},unresolvedCatalog:['source-map']};}},
 };
 const fakeRequire=id=>modules[id]??(()=>{throw Error('unexpected import '+id);})();const module={exports:{}};
 const sandbox={require:fakeRequire,module,exports:module.exports,__dirname:path.dirname(file),Buffer,process:{env:{RECOVERY_COORDINATION_DIR:'C:/fixture',DEPLOYMENT_CONTROL_IMAGE:'sha256:'+'f'.repeat(64)},getuid:()=>1000},console};
 vm.runInNewContext(source,sandbox,{filename:file});
 let dml=0;const tx={$queryRaw:async strings=>{const sql=strings.join('?');if(sql.includes('pg_try_advisory')){events.push('advisory');return [{owned:true}];}
  if(sql.includes('deployment_operations')){events.push('lease');return [{id:'d',checkpoint:{deploymentId:'d',releaseId:'r',localVerified:true,remoteVerified:true,restoreVerified:true,manifestReadable:true,checksum}}];}
  return [];},$executeRaw:async()=>{dml++;},$executeRawUnsafe:async()=>{dml++;}};
 const database={$transaction:async callback=>callback(tx)};let error;
 try{await module.exports.applyProtectedCandidatePlan(database,owner);}catch(e){error=e;}
 return {events,error,dml};
}
test('candidate private transaction rejects UNKNOWN before DDL',async()=>{const r=await run('unknown');assert.equal(r.error?.code,'CANDIDATE_EXECUTOR_CATALOG_UNQUALIFIED',String(r.error?.stack));assert.equal(r.dml,0);assert.ok(r.events.includes('advisory'));assert.ok(r.events.filter(x=>x==='lease').length>=2);assert.ok(r.events.includes('catalog'));});
test('candidate transaction rejects mismatch and source tamper before DDL',async()=>{for(const mode of ['mismatch','bad-source']){const r=await run(mode);assert.equal(r.error?.message,mode==='mismatch'?'CATALOG_MISMATCH':'BAD_SOURCE');assert.ok(r.events.includes('advisory'));assert.ok(r.events.includes('compile'));assert.equal(r.dml,0);}});
