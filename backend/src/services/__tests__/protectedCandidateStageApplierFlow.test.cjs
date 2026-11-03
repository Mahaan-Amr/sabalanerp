'use strict';
// Simulated transaction adapter around the actual compiled applier. This is
// orchestration coverage only, not PostgreSQL, lease or native proof.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const esbuild=createRequire(path.resolve('backend/package.json'))('esbuild');
const filename=path.resolve('backend/src/services/protectedBridgeMigrations.ts');
const source=esbuild.transformSync(fs.readFileSync(filename,'utf8'),{loader:'ts',format:'cjs',target:'node18'}).code;

function fixture(){
 const owner={deploymentId:'d',releaseId:'r',leaseToken:'t'},checkpoint='a'.repeat(64),names=Array.from({length:14},(_,i)=>`candidate_${i}`);
 const stat={isFile:()=>true,nlink:1n,size:4n,uid:1000n,mode:0o100600n,dev:1n,ino:2n,mtimeNs:3n,ctimeNs:4n};
 const fakeFs={constants:fs.constants,openSync:f=>{if(String(f).endsWith('deployment-bootstrap-native.json'))throw Object.assign(Error('missing'),{code:'ENOENT'});return 1;},fstatSync:()=>stat,lstatSync:()=>stat,realpathSync:x=>x,readFileSync:()=>JSON.stringify(owner),closeSync:()=>{}};
 const state={prefix:0,receipt:null,committedStatements:0,failAfterPrefix:0,projectionMismatch:false};
 const files=new Map(names.map(name=>[name,Buffer.from(name)]));
 const modules={'node:fs':fakeFs,'node:path':path,'node:crypto':require('node:crypto'),'@prisma/client':{Prisma:{}},
  './runtimeControlOwnership':{assertRuntimeControlOwnership(){}},
  './protectedMigrationHistory':{readProtectedMigrationSources:()=>files,validateProtectedMigrationHistory:()=>new Set()},
  './protectedCandidateMigrationInventory':{exactCandidateMigrationNames:names,exactCandidatePlanSha256:'d'.repeat(64),compileExactCandidatePending:items=>items.map((x,i)=>({name:x.name,sha256:String(i).padStart(64,'0'),statements:['SIMULATED SQL']}))},
  './protectedCandidateStageProjection':{candidateStageProjection:prefix=>({state:'SCOPED_EXPECTATION',tables:{prefix:String(prefix)},functions:{}})},
  './protectedCandidateStageComparison':{compareCandidateStage:async(_tx,prefix)=>({state:state.failAfterPrefix===prefix?'MISMATCH':'SCOPED_MATCH'})},
  './protectedCandidateRelationSecurity':{observeCandidateRelationSecurity:async()=>({state:'SCOPED_MATCH'})},
  './protectedCandidateExplicitDimensions':{observeCandidateExplicitDimensions:async()=>({state:'SCOPED_MATCH'})},
  './protectedCandidateProjection':{readCandidateProjection:()=>{if(state.projectionMismatch)throw Error('CANDIDATE_SOURCE_PROJECTION_UNPROVEN');return {sourceImageBinding:'HOST_REPORTED_NOT_INDEPENDENT'};}},
  './protectedCandidateTransactionObservation':{readCandidateTransactionObservation:async tx=>({checkpointChecksum:checkpoint,targetCommit:'a'.repeat(40),prefixLength:tx.prefix,lastReceiptScopedProjectionSha256:tx.receipt?.afterScopedProjectionSha256??null,stageComparison:{state:'SCOPED_MATCH'},explicitDimensions:{state:'SCOPED_MATCH'},relationSecurity:{state:'SCOPED_MATCH'},unresolvedCatalog:[]})},
 };
 const module={exports:{}},sandbox={require:id=>modules[id]??(()=>{throw Error('unexpected '+id)})(),module,exports:module.exports,__dirname:path.dirname(filename),Buffer,process:{env:{RECOVERY_COORDINATION_DIR:'C:/fixture',DEPLOYMENT_CONTROL_IMAGE:'sha256:'+'f'.repeat(64)},getuid:()=>1000},console};
 vm.runInNewContext(source,sandbox,{filename});
 const database={$transaction:async callback=>{
  const tx={prefix:state.prefix,receipt:state.receipt,statements:0,
   $queryRaw:async strings=>{const q=strings.join('?');if(q.includes('pg_try_advisory'))return [{owned:true}];if(q.includes('deployment_operations'))return [{id:'d',checkpoint:{deploymentId:'d',releaseId:'r',localVerified:true,remoteVerified:true,restoreVerified:true,manifestReadable:true,checksum:checkpoint}}];return [];},
   $executeRawUnsafe:async()=>{tx.statements++;},$executeRaw:async(_strings,...values)=>{tx.receipt=JSON.parse(values[3]);tx.prefix++;}};
  const result=await callback(tx);state.prefix=tx.prefix;state.receipt=tx.receipt;state.committedStatements+=tx.statements;return result;
 }};
 return {state,apply:()=>module.exports.applyProtectedCandidatePlan(database,owner)};
}
test('simulated later-stage failure rolls back its statement and resumes from committed receipt',async()=>{
 const f=fixture();f.state.failAfterPrefix=2;
 await assert.rejects(f.apply(),/CANDIDATE_AFTER_CATALOG_UNPROVEN/);
 assert.equal(f.state.prefix,1);assert.equal(f.state.committedStatements,1);
 f.state.failAfterPrefix=0;const result=await f.apply();
 assert.equal(result.applied,13);assert.equal(f.state.prefix,14);assert.equal(f.state.committedStatements,14);
});
test('simulated wrong source projection stops before DDL',async()=>{
 const f=fixture();f.state.projectionMismatch=true;
 await assert.rejects(f.apply(),/CANDIDATE_SOURCE_PROJECTION_UNPROVEN/);
 assert.equal(f.state.prefix,0);assert.equal(f.state.committedStatements,0);
});
