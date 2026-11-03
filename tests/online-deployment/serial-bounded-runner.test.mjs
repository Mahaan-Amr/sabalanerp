import test from 'node:test';
import assert from 'node:assert/strict';
import {runBoundedSerialFaultProof,compareFrozenOriginalInventories} from '../../scripts/lib/serial-physical/bounded-runner.mjs';
import {LocalBoundedSerialDriver,assessRestartMigrations,restartRunsMigration,assertRecoveryRestartReady} from '../../scripts/lib/serial-physical/local-bounded-driver.mjs';
function driver(failAt){
 const calls=[];let count=0;
 const d={calls};
 for(const name of ['acquireLease','preflight','stage','persistObligation','quietClients','disableRestart','shutdownOriginal','activateIdleWrapper','persistInitialInventory','runFaultProofs','persistFinalInventory','releaseWrapper','restorePostgres','restoreClients','verifyRestoration','persistCompleted','releaseLease'])d[name]=async()=>{calls.push(name);if(name===failAt)throw Error(name);};
 d.inventory=async()=>{calls.push('inventory');return {rows:[{path:'PG_VERSION',sha256:'original'}],rootMetadata:{mtime:count++}};};
 d.recordRootChange=async()=>{calls.push('recordRootChange');};
 d.hold=async()=>{calls.push('hold');};
 return d;
}
test('bounded runner owns lease and durable obligation before quiet/shutdown; restart disabled before smart stop',async()=>{
 const d=driver();await runBoundedSerialFaultProof(d);
 for(const [a,b] of [['acquireLease','preflight'],['persistObligation','quietClients'],['disableRestart','shutdownOriginal'],['persistInitialInventory','runFaultProofs'],['persistFinalInventory','releaseWrapper'],['verifyRestoration','persistCompleted'],['persistCompleted','releaseLease']])assert.ok(d.calls.indexOf(a)<d.calls.indexOf(b),a+' before '+b);
 assert.ok(d.calls.includes('recordRootChange'));
});
test('negative fault-probe result still restores but cannot become successful qualification',async()=>{
 const d=driver('runFaultProofs');await assert.rejects(runBoundedSerialFaultProof(d),/runFaultProofs/);
 assert.ok(d.calls.includes('verifyRestoration'));assert.ok(d.calls.includes('releaseLease'));
});
test('changed originals and finalization failures retain lease and block wrapper release',async()=>{
 const d=driver();let n=0;d.inventory=async()=>({rows:[{sha256:n++?'changed':'original'}]});
 await assert.rejects(runBoundedSerialFaultProof(d),/RESTORATION_HELD/);
 assert.ok(!d.calls.includes('releaseWrapper'));assert.ok(!d.calls.includes('releaseLease'));assert.ok(d.calls.includes('hold'));
 const e=driver('persistCompleted');await assert.rejects(runBoundedSerialFaultProof(e),/RESTORATION_HELD/);assert.ok(!e.calls.includes('releaseLease'));
});
test('failed durable obligation never quiets or shuts the existing service',async()=>{
 const d=driver('persistObligation');await assert.rejects(runBoundedSerialFaultProof(d),/persistObligation/);
 assert.ok(!d.calls.includes('quietClients'));assert.ok(!d.calls.includes('shutdownOriginal'));
});
test('quiet failure restores affected clients without entering the wrapper transition',async()=>{
 const d=driver('quietClients');await assert.rejects(runBoundedSerialFaultProof(d),/quietClients/);
 assert.ok(!d.calls.includes('shutdownOriginal'));assert.ok(!d.calls.includes('releaseWrapper'));assert.ok(d.calls.includes('restoreClients'));
});
test('concrete unknown staging/client-stop/transition outcomes block every restoration entry and lease release',async()=>{
 for(const state of ['staging','client-stop','transition']){
  const d=new LocalBoundedSerialDriver({directory:'.scratch/unexecuted-proof',implementationRoot:'.'});
  d.unknown=true;
  for(const name of ['settleTransitionForRestoration','restoreClients','restorePostgres','releaseWrapper','releaseLease'])await assert.rejects(d[name](),/UNKNOWN_NATIVE_ORIGINAL_HELD/,state+': '+name);
 }
});
test('restart admission distinguishes pending DDL from recorded already-applied checksum warnings',()=>{
 const result=assessRestartMigrations([['applied','newhash'],['pending','pendinghash']],'applied\toldhash\r\n');
 assert.deepEqual(result.pending,[{name:'pending',installedChecksum:'pendinghash'}]);
 assert.deepEqual(result.changed,[{name:'applied',installedChecksum:'newhash',ledgerChecksum:'oldhash'}]);
 assert.equal(assessRestartMigrations([['applied','newhash']],'applied\toldhash\n').pending.length,0);
});
test('only the actual reviewed startup command selects migration admission; direct node and unknown scripts differ',()=>{
 const Entrypoint=['docker-entrypoint.sh'];
 assert.equal(restartRunsMigration({Entrypoint,Cmd:['node','dist/index.js']}),false);
 assert.equal(restartRunsMigration({Entrypoint,Cmd:['sh','-c','node dist/scripts/recovery-database-preflight.js && npx prisma migrate deploy && node dist/index.js']}),true);
 assert.throws(()=>restartRunsMigration({Entrypoint,Cmd:['node','unknown.js']}),/UNREVIEWED_BACKEND_STARTUP/);
});
test('recovery startup cannot rename databases through a present journal, including direct-node startup',()=>{
 for(const migration of [true,false])assert.throws(()=>assertRecoveryRestartReady({journalPresent:true},migration),/PENDING_RECOVERY/);
 assertRecoveryRestartReady({journalPresent:false,installedPreflightSha256:'a'.repeat(64)},true);
 assert.throws(()=>assertRecoveryRestartReady({journalPresent:false},true));
});

test('shell-owned backend suppresses restart before pidfd signal and observes ordinary wait before manual stop',async()=>{
 const d=new LocalBoundedSerialDriver({directory:'.scratch/unexecuted-proof',implementationRoot:'.'}),calls=[];let suppressed=false;
 d.journal=()=>{};d.inspect=async()=>({HostConfig:{RestartPolicy:{Name:suppressed?'no':'unless-stopped',MaximumRetryCount:0}}});
 d.docker=async(args,phase,options)=>{calls.push(phase);if(phase==='SUPPRESS_SHELL_RESTART')suppressed=true;if(phase==='GRACEFUL_SHELL_NODE'){assert.ok(suppressed);assert.ok(options.input.includes('signal.pidfd_send_signal'));assert.equal(args.at(-1),'--signal-owned-node');}return phase==='WAIT_SHELL_APPLICATION'?'0\n':'';};
 await d.stopShellOwnedBackend('original');assert.deepEqual(calls,['SUPPRESS_SHELL_RESTART','GRACEFUL_SHELL_NODE','WAIT_SHELL_APPLICATION','LATCH_SHELL_MANUAL_STOP']);assert.equal(d.shellRestartPolicies.get('original').Name,'unless-stopped');
});

test('abnormal shell app closure cannot latch manual stop or become client-drain acceptance',async()=>{
 const d=new LocalBoundedSerialDriver({directory:'.scratch/unexecuted-proof',implementationRoot:'.'});let n=0;const calls=[];
 d.journal=()=>{};d.inspect=async()=>({HostConfig:{RestartPolicy:{Name:n++?'no':'unless-stopped',MaximumRetryCount:0}}});
 d.docker=async(args,phase)=>{calls.push(phase);return phase==='WAIT_SHELL_APPLICATION'?'143\n':'';};
 await assert.rejects(d.stopShellOwnedBackend('original'));assert.ok(!calls.includes('LATCH_SHELL_MANUAL_STOP'));
});

test('resource validation failure after wrapper creation does not recreate it during restoration',async()=>{
 const d=new LocalBoundedSerialDriver({directory:'.scratch/unexecuted-proof',implementationRoot:'.'});d.shutdownRequested=true;d.originalClosed=true;d.wrapperCreated=true;const calls=[];
 d.waitMarker=async()=>calls.push('ready');d.journal=()=>{};d.activateIdleWrapper=async()=>{throw Error('MUST_NOT_RECREATE');};
 assert.deepEqual(await d.settleTransitionForRestoration(),{wrapper:true});assert.deepEqual(calls,['ready']);
});

test('failed wrapper acceptance still requires two frozen observations before restoration release',async()=>{
 const d=driver('activateIdleWrapper');d.settleTransitionForRestoration=async()=>({wrapper:true});
 await assert.rejects(runBoundedSerialFaultProof(d),/activateIdleWrapper/);assert.equal(d.calls.filter(x=>x==='inventory').length,2);assert.ok(d.calls.includes('persistInitialInventory'));assert.ok(d.calls.includes('persistFinalInventory'));assert.ok(d.calls.includes('releaseLease'));
});

test('held owner remains retained even when durable hold journaling fails',async()=>{
 const d=new LocalBoundedSerialDriver({directory:'.scratch/unexecuted-proof',implementationRoot:'.'});d.lease={assertHeld(){}};d.journal=()=>{throw Error('DISK_FAILURE');};
 try{await assert.rejects(d.hold(),/DISK_FAILURE/);assert.ok(d.heldOwnerTimer.hasRef());}finally{clearInterval(d.heldOwnerTimer);}
});

import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {persistImmutableSerialJson} from '../../scripts/lib/serial-physical/immutable-json.mjs';
import {restoreBoundedSerialOwner} from '../../scripts/lib/serial-physical/bounded-runner.mjs';
import {semanticFieldHashes} from '../../scripts/lib/serial-physical/local-bounded-driver.mjs';

test('falsy probe rejection remains negative after verified restoration',async()=>{
 for(const reason of [undefined,null,false,0,'']){const d=driver();d.runFaultProofs=async()=>{throw reason;};let rejected=false;try{await runBoundedSerialFaultProof(d);}catch(actual){rejected=true;assert.equal(actual,reason);}assert.equal(rejected,true);assert.ok(d.calls.includes('releaseLease'));}
});

test('same-owner retry settles exact existing JSON and refuses different or partial evidence',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'serial-immutable-')),file=path.join(dir,'evidence.json');
 try{persistImmutableSerialJson(file,{restored:true});persistImmutableSerialJson(file,{restored:true});assert.throws(()=>persistImmutableSerialJson(file,{restored:false}),/OWNED_EVIDENCE_CONFLICT/);fs.writeFileSync(file,'{');assert.throws(()=>persistImmutableSerialJson(file,{restored:true}),/OWNED_EVIDENCE_CONFLICT/);}finally{fs.rmSync(dir,{recursive:true});}
});

test('retry after a partial final-inventory commit retains the original snapshot and finishes restoration only',async()=>{
 const d=driver('runFaultProofs');let first=true;d.persistFinalInventory=async()=>{d.calls.push('persistFinalInventory');if(first){first=false;throw Error('MARKER_FAILED_AFTER_JSON');}};
 await assert.rejects(runBoundedSerialFaultProof(d),/RESTORATION_HELD/);await restoreBoundedSerialOwner(d);assert.equal(d.calls.filter(x=>x==='runFaultProofs').length,1);assert.equal(d.boundedState.leased,false);assert.ok(d.calls.includes('releaseWrapper'));
});

test('already normally closed original wrapper can settle release without another exec or stop',async()=>{
 const d=new LocalBoundedSerialDriver({directory:'.scratch/unexecuted-proof',implementationRoot:'.'});d.inspect=async()=>({State:{Running:false,ExitCode:0},RestartCount:0});d.journal=()=>{};d.docker=async()=>{throw Error('MUST_NOT_EXEC_STOPPED_WRAPPER');};d.mark=async()=>{throw Error('MUST_NOT_RECREATE_MARKER');};await d.releaseWrapper();
});

test('configuration diagnostic retains only hashes, including credentials and absent fields',()=>{
 const secret='DO_NOT_PERSIST_CREDENTIAL';const facts=semanticFieldHashes({Env:['PASSWORD='+secret],StopSignal:undefined});assert.ok(!JSON.stringify(facts).includes(secret));assert.match(facts['$.Env.0'],/^[a-f0-9]{64}$/);assert.match(facts['$.StopSignal'],/^[a-f0-9]{64}$/);
});

import {containerSemantic} from '../../scripts/lib/serial-physical/container-semantics.mjs';
test('Docker null and empty DNS lists normalize without omitting actual DNS entries or other resources',()=>{
 const original={Image:'immutable',Config:{Env:[],Cmd:['postgres']},HostConfig:{Dns:[],DnsOptions:[],DnsSearch:[],Memory:512},Mounts:[],NetworkSettings:{Networks:{}}};const recreated=structuredClone(original);for(const key of ['Dns','DnsOptions','DnsSearch'])recreated.HostConfig[key]=null;
 assert.deepEqual(containerSemantic(original),containerSemantic(recreated));assert.notDeepEqual(containerSemantic(original,{normalizeUnsetDns:false}),containerSemantic(recreated,{normalizeUnsetDns:false}));
 for(const key of ['Dns','DnsOptions','DnsSearch']){const configured=structuredClone(recreated);configured.HostConfig[key]=['192.0.2.53'];assert.notDeepEqual(containerSemantic(original),containerSemantic(configured));}
 const changed=structuredClone(recreated);changed.HostConfig.Memory++;assert.notDeepEqual(containerSemantic(original),containerSemantic(changed));assert.equal(recreated.HostConfig.Dns,null);
});

import {createHash} from 'node:crypto';
import {reconstructExactOriginal,observeReadOnlyDescriptorRefusal,completeHeldRestoration} from '../../scripts/lib/serial-physical/held-restoration.mjs';
test('held continuation reconstructs exact raw baseline only; resource changes cannot use the DNS correction',()=>{
 const w={Image:'immutable',Config:{Env:[],Cmd:['--idle-only'],Entrypoint:['/bin/sh','owned']},HostConfig:{Dns:null,DnsOptions:null,DnsSearch:null,RestartPolicy:{Name:'no'},Memory:512},Mounts:[],NetworkSettings:{Networks:{}}},image={Id:'immutable',Config:{Cmd:['postgres'],Entrypoint:['docker-entrypoint.sh']}},goal={originalImage:'immutable',originalRestart:{Name:'unless-stopped'}};
 const original=containerSemantic(w);original.config.Cmd=image.Config.Cmd;original.config.Entrypoint=image.Config.Entrypoint;original.host.RestartPolicy=goal.originalRestart;
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;goal.originalConfigurationSha256=createHash('sha256').update(JSON.stringify(canonical(original))).digest('hex');
 assert.deepEqual(reconstructExactOriginal(w,image,goal),original);const changed=structuredClone(w);changed.HostConfig.Memory++;assert.throws(()=>reconstructExactOriginal(changed,image,goal),/EXACT_ORIGINAL_RECONSTRUCTION_FAILED/);
});
test('readonly finalization fault is a real OS write refusal and leaves receipt bytes unchanged',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'serial-real-readonly-')),file=path.join(dir,'receipt');fs.writeFileSync(file,'ORIGINAL');const fd=fs.openSync(file,'r');try{assert.ok(['EBADF','EPERM','EACCES'].includes(observeReadOnlyDescriptorRefusal(fd)));assert.equal(fs.readFileSync(file,'utf8'),'ORIGINAL');}finally{fs.closeSync(fd);fs.rmSync(dir,{recursive:true});}
});
test('serialized facts cannot register native continuation without original live lease',async()=>{
 let native=false;const d={lease:{assertHeld(){throw Error('LIVE_ORIGINAL_REQUIRED');}},inspect(){native=true;}};await assert.rejects(completeHeldRestoration(d,{obligation:{},preflight:{}}),/LIVE_ORIGINAL_REQUIRED/);assert.equal(native,false);
});

test('wrapper manual stop explicitly uses TERM instead of PostgreSQL image default INT, without force timeout',async()=>{
 const d=new LocalBoundedSerialDriver({directory:'.scratch/unexecuted-proof',implementationRoot:'.'});let observed=0,stop;
 d.inspect=async()=>observed++?{State:{Running:false,ExitCode:0},RestartCount:0}:{State:{Running:true}};d.mark=async()=>{};d.waitMarker=async()=>{};d.journal=()=>{};d.docker=async args=>{stop=args;};await d.releaseWrapper();assert.deepEqual(stop,['stop','--signal=SIGTERM','--time=-1',undefined]);
});

import {validateFrozenOriginalInventory} from '../../scripts/lib/serial-physical/serial-owner.mjs';
test('retained prior operation evidence is hashed and compared, never excluded or allowed elsewhere',()=>{
 const prior='serial-physical-'+'b'.repeat(32),current='serial-physical-'+'a'.repeat(32),plan={originalDataExcludedEntry:current,retainedEvidenceRoots:[prior]};
 const file=(name,uid='70',gid='70',mode=0o600,inode='1')=>({path:name,type:'file',uid,gid,mode,device:'1',inode,nlink:1,bytes:1,sha256:'c'.repeat(64)});
 const initial={format:'sabalan-original-local-pgdata-frozen-inventory/v1',pgdata:'/var/lib/postgresql/data',excludedEntry:current,normalShutdown:true,postmasterAbsent:true,runningServers:0,fullFileContentsHashed:true,rows:[file('PG_VERSION'),file('global/pg_control','70','70',0o600,'2'),{path:prior,type:'directory',uid:'0',gid:'70',mode:0o710,device:'1',inode:'3'},file(prior+'/serial-wrapper.sh','0','0',0o500,'4')]};
 validateFrozenOriginalInventory(plan,initial);assert.throws(()=>validateFrozenOriginalInventory({originalDataExcludedEntry:current},initial),/UNDECLARED/);const changed=structuredClone(initial);changed.rows[3].sha256='d'.repeat(64);assert.throws(()=>compareFrozenOriginalInventories(initial,changed),/FROZEN_ORIGINAL_CHANGED/);const unsafe=structuredClone(initial);unsafe.rows[3].path='global/root-owned';assert.throws(()=>validateFrozenOriginalInventory(plan,unsafe),/UNDECLARED/);
});

import {isSettledReadOnlyFinalizer} from '../../scripts/lib/serial-physical/local-bounded-driver.mjs';
test('known readonly finalization cannot settle unrelated observation or stream faults',()=>{
 const r={code:0,signal:null,stdoutEof:true,stderrEof:true,observationFault:true,observationFaultKinds:['receipt-finalization']};assert.equal(isSettledReadOnlyFinalizer(r,'EBADF'),true);
 for(const cause of ['observation','stdout-write','sink-finalization'])assert.equal(isSettledReadOnlyFinalizer({...r,observationFaultKinds:[...r.observationFaultKinds,cause]},'EBADF'),false);
 assert.equal(isSettledReadOnlyFinalizer(r,undefined),false);assert.equal(isSettledReadOnlyFinalizer({...r,stderrEof:false},'EBADF'),false);assert.equal(isSettledReadOnlyFinalizer({...r,signal:'SIGTERM'},'EBADF'),false);
});

test('retained controls chowned by installed PostgreSQL entrypoint remain fully covered, without admitting group0 outside history',()=>{
 const prior='serial-physical-'+'b'.repeat(32),current='serial-physical-'+'a'.repeat(32),plan={originalDataExcludedEntry:current,retainedEvidenceRoots:[prior]};const row=(name,gid,inode)=>({path:name,type:'file',uid:'70',gid,mode:0o600,device:'1',inode,nlink:1,bytes:1,sha256:'c'.repeat(64)});const snapshot={format:'sabalan-original-local-pgdata-frozen-inventory/v1',pgdata:'/var/lib/postgresql/data',excludedEntry:current,normalShutdown:true,postmasterAbsent:true,runningServers:0,fullFileContentsHashed:true,rows:[row('PG_VERSION','70','1'),row('global/pg_control','70','2'),row(prior+'/restoration-obligation','0','3')]};validateFrozenOriginalInventory(plan,snapshot);snapshot.rows[2].path='global/group0-file';assert.throws(()=>validateFrozenOriginalInventory(plan,snapshot),/UNDECLARED/);
});

import {resumeHeldInventoryPrimitives} from '../../scripts/lib/serial-physical/resume-held-inventory.mjs';
test('only canonical historical inventory lists may retain observed 0644; other controls remain strict',()=>{
 const prior='serial-physical-'+'b'.repeat(32),current='serial-physical-'+'a'.repeat(32),plan={originalDataExcludedEntry:current,retainedEvidenceRoots:[prior]},row=(name,inode,mode=0o600,gid='70')=>({path:name,type:'file',uid:'70',gid,mode,device:'1',inode,nlink:1,bytes:1,sha256:'c'.repeat(64)});const snapshot={format:'sabalan-original-local-pgdata-frozen-inventory/v1',pgdata:'/var/lib/postgresql/data',excludedEntry:current,normalShutdown:true,postmasterAbsent:true,runningServers:0,fullFileContentsHashed:true,rows:[row('PG_VERSION','1'),row('global/pg_control','2'),row(prior+'/inventory-final-1.sorted','3',0o644,'0')]};validateFrozenOriginalInventory(plan,snapshot);for(const name of [prior+'/restoration-obligation',prior+'/other.paths','global/inventory-final.sorted',prior+'/nested/inventory-final.sorted']){const bad=structuredClone(snapshot);bad.rows[2].path=name;assert.throws(()=>validateFrozenOriginalInventory(plan,bad));}const changed=structuredClone(snapshot);changed.rows[2].sha256='d'.repeat(64);assert.throws(()=>compareFrozenOriginalInventories(snapshot,changed),/FROZEN_ORIGINAL_CHANGED/);
});
test('held inventory resumption rejects serialized or cloned driver authority before runtime',async()=>{
 let invoked=false;const serialized={lease:{assertHeld(){invoked=true;}}};await assert.rejects(resumeHeldInventoryPrimitives(serialized,{},{sourceCommit:'fake',sourcePins:{}}),/ORIGINAL_DRIVER_REQUIRED/);assert.equal(invoked,false);
});
