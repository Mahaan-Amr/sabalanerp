import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {validateFailedLegacyCaptureJournal, validateFailedLegacySignal, verifyRecoveredPreviousIncarnations, validateCurrentLegacyNode, observeBoundedChild, validateHistoricalCheckoutMigrationDelta} from '../../deploy/scripts/reopen-failed-legacy-capture.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
function journal(phases=['PREFLIGHT','LEASE_ACQUIRED','MAINTENANCE_REQUESTED','TRAFFIC_BLOCKED','RECOVERY_REQUIRED']){
 let previousHash=null;
 return Buffer.from(phases.map((phase,i)=>{const unsigned={sequence:i+1,at:'2026-11-12T10:07:00Z',deploymentId:'deploy_incident',phase,event:i===0?'deployment-prepared':i===phases.length-1?'deployment-finished':'phase-transition',previousHash};const hash=sha(JSON.stringify(unsigned));previousHash=hash;return JSON.stringify({...unsigned,hash});}).join('\n')+'\n');
}
test('failed pre-checkpoint capture journal proves terminal no-mutation and rejects later phases',()=>{
 assert.equal(validateFailedLegacyCaptureJournal(journal(),'deploy_incident').checkpointReached,false);
 for(const phases of [['PREFLIGHT','TRAFFIC_BLOCKED','SERVICES_DRAINED','RECOVERY_REQUIRED'],['PREFLIGHT','TRAFFIC_BLOCKED','LOCAL_CHECKPOINT_VERIFIED','RECOVERY_REQUIRED'],['PREFLIGHT','TRAFFIC_BLOCKED','MUTATION_STARTED','RECOVERY_REQUIRED'],['PREFLIGHT','RECOVERY_REQUIRED']])assert.throws(()=>validateFailedLegacyCaptureJournal(journal(phases),'deploy_incident'));
 assert.throws(()=>validateFailedLegacyCaptureJournal(Buffer.from(journal().toString().replace('phase-transition','altered')),'deploy_incident'));
});
const older='b58c53c0f88d2d89da3cb6a45949e6eca97e4308',checkout='aa7d384b2fce1dee7cface249699e0d82d495f6a';
let localGitObjects=true;try{execFileSync('git',['rev-parse','--verify',older],{stdio:'ignore'});}catch{localGitObjects=false;}
const gitDeltaFixture=process.env.INCIDENT434_GIT_DELTA_FILE;
test('the clean live checkout may add exactly the known fifteen migrations after the failed operation target',{skip:!localGitObjects&&!gitDeltaFixture},()=>{
 const delta=gitDeltaFixture?fs.readFileSync(gitDeltaFixture,'utf8'):execFileSync('git',['diff','--name-status',older,checkout,'--','backend/prisma/migrations'],{encoding:'utf8'});
 assert.equal(validateHistoricalCheckoutMigrationDelta(delta).added,15);
 assert.throws(()=>validateHistoricalCheckoutMigrationDelta(delta.replace(/^A\t/m,'M\t')));
 assert.throws(()=>validateHistoricalCheckoutMigrationDelta(delta+'A\tbackend/prisma/migrations/unknown/migration.sql\n'));
});
test('failed signal receipt binds original stopped Node and refuses a successful or replaced observation',()=>{
 const snapshot={container:{kind:'KNOWN_LEGACY_SHELL',containerId:'a'.repeat(64),image:'sha256:'+ 'b'.repeat(64),created:'2026-11-06T22:01:49Z',startedAt:'2026-11-12T08:41:47Z',initHostPid:128083},node:{pid:128146,startTicks:'379448204'},bootId:'boot'};
 const plan={format:'sabalan-legacy-backend-signal/v2',deploymentId:'deploy_incident',releaseId:'release_incident',snapshot,signalDelivered:false,productionMutation:false,legacyExternalEffectRisk:{image:snapshot.container.image,containerId:snapshot.container.containerId,startedAt:snapshot.container.startedAt,nodeStartTicks:snapshot.node.startTicks,taxpayerBrokerEndpointVerifiedAbsentAtPreflight:true,ownerAcceptedPossibleDuplicateOrUnknownSms:true,externalEffectsCompleted:false,exactlyOnceSmsProven:false}};
 const intent={deploymentId:plan.deploymentId,releaseId:plan.releaseId,planSha256:'c'.repeat(64),target:snapshot,signal:'SIGTERM'};
 const result={deploymentId:plan.deploymentId,releaseId:plan.releaseId,planSha256:intent.planSha256,passResult:false,signalDelivered:true,signalAttempted:true,error:'LEGACY_SIGNAL_OBSERVER_NOT_CLOSED',legacyExternalEffectRisk:plan.legacyExternalEffectRisk,originalChildren:[{role:'docker-wait',closed:true,code:-15,deadlineExceeded:true}]};
 const held={passResult:false,deadlineExceeded:true,originalOwnerRetained:true,nativeCompletionUnknown:true};
 assert.equal(validateFailedLegacySignal(plan,intent,result,held,{deploymentId:plan.deploymentId,releaseId:plan.releaseId,planSha256:intent.planSha256,backendImage:snapshot.container.image}).captureQualified,false);
 for(const change of [v=>{v.result.passResult=true},v=>{v.result.signalDelivered=false},v=>{v.result.legacyExternalEffectRisk.exactlyOnceSmsProven=true},v=>{v.intent.target.container.containerId='d'.repeat(64)},v=>{v.held.deadlineExceeded=false}]){const value={plan:structuredClone(plan),intent:structuredClone(intent),result:structuredClone(result),held:structuredClone(held)};change(value);assert.throws(()=>validateFailedLegacySignal(value.plan,value.intent,value.result,value.held,{deploymentId:plan.deploymentId,releaseId:plan.releaseId,planSha256:intent.planSha256,backendImage:snapshot.container.image}));}
});
test('same old backend container may restart, nginx may recreate, and other four identities stay fixed',()=>{
 const services=Object.fromEntries(['backend','frontend','inquiry','nginx','postgres','clamav'].map(role=>[role,{image:'sha256:'+role.padEnd(64,'a'),configSha256:'c'.repeat(64),hostConfigSha256:'d'.repeat(64),mounts:[],networks:['sabalan']} ]));
 const identities=Object.fromEntries(Object.keys(services).map(role=>[role,{id:role.padEnd(64,'a'),image:services[role].image,created:'2026-11-06T00:00:00Z'}]));
 const current=structuredClone(identities);current.nginx={...current.nginx,id:'n'.repeat(64),created:'2026-11-12T10:07:18Z'};
 const facts={backendOriginalStartedAt:'2026-11-12T08:41:47Z',backendCurrentStartedAt:'2026-11-12T10:07:31Z',backendPreviousFinishedAt:'2026-11-12T10:07:31Z',oldNodeAbsent:true,oldSqlSessions:0,backendRestartCountNow:8};
 assert.equal(verifyRecoveredPreviousIncarnations({services,identities,currentServices:structuredClone(services),currentIdentities:current,facts}).originalCaptureGuardPassed,false);
 for(const change of [v=>{v.currentIdentities.backend.id='e'.repeat(64)},v=>{v.currentIdentities.frontend.id='f'.repeat(64)},v=>{v.currentServices.nginx.image='sha256:'+'f'.repeat(64)},v=>{v.facts.oldNodeAbsent=false},v=>{v.facts.oldSqlSessions=1},v=>{v.facts.backendRestartCountNow=0}]){const value={services:structuredClone(services),identities:structuredClone(identities),currentServices:structuredClone(services),currentIdentities:structuredClone(current),facts:structuredClone(facts)};change(value);assert.throws(()=>verifyRecoveredPreviousIncarnations(value));}
});
test('current old-release Node birth is pinned and cannot silently change before reopen',()=>{
 const expected={pid:293012,startTicks:'379962651'},actual={pid:293012,ppid:292960,startTicks:'379962651',argv:['node','dist/index.js']},old={pid:128146,startTicks:'379448204'};
 assert.deepEqual(validateCurrentLegacyNode(expected,actual,292960,old),expected);
 for(const change of [v=>{v.actual.pid=123},v=>{v.actual.ppid=123},v=>{v.actual.startTicks='379962652'},v=>{v.actual.argv=['node','other.js']},v=>{v.old.pid=293012}]){const v={expected:structuredClone(expected),actual:structuredClone(actual),old:structuredClone(old)};change(v);assert.throws(()=>validateCurrentLegacyNode(v.expected,v.actual,292960,v.old));}
});
test('a stuck native observer is terminated, reaped and reported as timed out',async()=>{
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore','pipe','pipe']});
 const events=[];const result=await observeBoundedChild(child,50,75,kind=>events.push(kind));
 assert.equal(result.deadlineExceeded,true);assert.equal(result.closed,true);assert.ok(result.code!==0||result.signal);assert.ok(events.includes('deadline'));
});
test('isolated Docker-like process group reaps an inherited-pipe grandchild', {skip:process.platform!=='linux'}, async()=>{
 const source="const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','process.on(\"SIGTERM\",()=>{});setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});console.log(c.pid);process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)";
 const child=spawn(process.execPath,['-e',source],{stdio:['ignore','pipe','pipe'],detached:true});let stdout='';child.stdout.on('data',part=>{stdout+=part;});child.stderr.resume();
 const events=[];const result=await observeBoundedChild(child,200,100,kind=>events.push(kind),{ownedProcessGroup:true});
 assert.equal(result.closed,true);assert.equal(result.deadlineExceeded,true);assert.ok(events.includes('deadline')&&events.includes('force'));
 const descendant=Number(stdout.trim());assert.ok(Number.isSafeInteger(descendant)&&descendant>1);
 await new Promise(resolve=>setTimeout(resolve,100));const fs=await import('node:fs');
 if(fs.existsSync('/proc/'+descendant)){const raw=fs.readFileSync('/proc/'+descendant+'/stat','utf8');assert.equal(raw.slice(raw.lastIndexOf(')')+2).split(' ')[0],'Z');}
});
