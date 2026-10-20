// Run after backend build. Exercises the real control CLI with private files and
// an intentionally unreachable database, so a hidden database dependency fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {appendDeploymentHostJournal}=require('../../backend/dist/services/deploymentHostJournal.js');
const cli=fileURLToPath(new URL('../../backend/dist/scripts/deployment-control.js',import.meta.url));

test('real incident boundary CLI uses marker, phase and authenticated journal; malformed evidence fails closed',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-incident-boundary-'));
 assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
 const reports=path.join(root,'reports'),coordination=path.join(root,'coordination');
 fs.mkdirSync(reports);fs.mkdirSync(coordination);
 const sessionFile=path.join(reports,'active-deployment-session.json'),journalFile=path.join(reports,'active-deployment.jsonl'),markerFile=path.join(coordination,'deployment-maintenance.json');
 const digest='a'.repeat(64),id='incident-boundary-fixture';
 try{
  const run=async({phase='PREFLIGHT',marker=null,activated=false,missingJournal=false,tamper=false}={})=>{
   fs.writeFileSync(sessionFile,JSON.stringify({deploymentId:id,clamavOperation:'incident-recovery',clamavIncidentSnapshotSha256:digest,phase}));
   fs.rmSync(journalFile,{force:true});fs.rmSync(markerFile,{force:true});
   if(marker)fs.writeFileSync(markerFile,JSON.stringify(marker));
   if(!missingJournal)await appendDeploymentHostJournal(journalFile,{deploymentId:id,phase:'PREFLIGHT',event:'deployment-prepared'});
   if(activated)await appendDeploymentHostJournal(journalFile,{deploymentId:id,phase,event:'maintenance-activated'});
   if(tamper)fs.appendFileSync(journalFile,'{}\n');
   const before=fs.readFileSync(sessionFile);
   const result=spawnSync(process.execPath,[cli,'incident-boundary-state'],{encoding:'utf8',timeout:20000,env:{...process.env,NODE_ENV:'test',DATABASE_URL:'postgresql://unused:unused@127.0.0.1:1/unused?connection_limit=1&pool_timeout=1',DEPLOYMENT_REPORT_DIR:reports,RECOVERY_COORDINATION_DIR:coordination,DEPLOYMENT_ID:id,DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256:digest}});
   assert.deepEqual(fs.readFileSync(sessionFile),before,'boundary inspection cannot rewrite its session');
   return result;
  };
  for(const phase of ['PREFLIGHT','LEASE_ACQUIRED','MAINTENANCE_REQUESTED']){
   const before=await run({phase});assert.equal(before.status,0,before.stderr);assert.equal(before.stdout.trim(),'PRE_MAINTENANCE');
   const after=await run({phase,marker:{deploymentId:id}});assert.equal(after.status,0,after.stderr);assert.equal(after.stdout.trim(),'PROTECTED');
  }
  for(const phase of ['TRAFFIC_BLOCKED','SERVICES_DRAINED','LOCAL_CHECKPOINT_VERIFIED','REMOTE_CHECKPOINT_VERIFIED']){
   const result=await run({phase});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'PROTECTED');
  }
  const lostMarker=await run({activated:true});assert.equal(lostMarker.status,0,lostMarker.stderr);assert.equal(lostMarker.stdout.trim(),'PROTECTED');
  for(const invalid of [{marker:{deploymentId:'another-operation'}},{missingJournal:true},{tamper:true}]){
   const result=await run(invalid);assert.notEqual(result.status,0,'unproven history cannot classify an incident as pre-maintenance');
  }
 }finally{fs.rmSync(root,{recursive:true});}
});
