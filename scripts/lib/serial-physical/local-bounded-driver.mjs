/** Concrete existing-project ticket08 owner. No master/point/app authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {acquireSerialHostLease} from './host-lease.mjs';
import {retainSerialChild,isClosedSerialNegative} from './retained-child.mjs';
import {parseFrozenOriginalInventory} from './frozen-inventory.mjs';
import {compareFrozenOriginalInventories} from './bounded-runner.mjs';
import {persistImmutableSerialJson} from './immutable-json.mjs';
import {containerSemantic as semantic} from './container-semantics.mjs';
import {observeReadOnlyDescriptorRefusal} from './held-restoration.mjs';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory} from '../original-private-evidence-directory.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>sha(JSON.stringify(canonical(v)));
const sleep=()=>new Promise(r=>setTimeout(r,1000));
const clients=['frontend','frontend-candidate','frontend-retained','inquiry','backend','backend-candidate','backend-retained'];
const expectedServices=[...clients,'postgres','redis','clamav'].sort();
const DOCKER='C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const TOOL_SHA='f71e5a9fe6a8db10c7296ad6fdf0c1d7d79634e644d7ec1e8a2c18d7dcb52d21';
export function assessRestartMigrations(installed,ledger){
 const applied=new Map(ledger.trim().split(/\r?\n/).filter(Boolean).map(line=>line.split('\t')));
 return {installedCount:installed.length,appliedCount:applied.size,
  pending:installed.filter(([name])=>!applied.has(name)).map(([name,checksum])=>({name,installedChecksum:checksum})),
  changed:installed.filter(([name,checksum])=>applied.has(name)&&applied.get(name)!==checksum).map(([name,checksum])=>({name,installedChecksum:checksum,ledgerChecksum:applied.get(name)}))};
}
export function restartRunsMigration(config){
 assert.equal(hash(config.Entrypoint),hash(['docker-entrypoint.sh']),'UNREVIEWED_BACKEND_ENTRYPOINT');
 if(hash(config.Cmd)===hash(['node','dist/index.js']))return false;
 const guarded=['sh','-c','node dist/scripts/recovery-database-preflight.js && npx prisma migrate deploy && node dist/index.js'];
 assert.equal(hash(config.Cmd),hash(guarded),'UNREVIEWED_BACKEND_STARTUP');return true;
}
export function assertRecoveryRestartReady(recovery,runsMigration){
 if(recovery.journalPresent)throw Error('PENDING_RECOVERY_JOURNAL_BLOCKS_RESTART');
 if(runsMigration)assert.match(recovery.installedPreflightSha256,/^[a-f0-9]{64}$/);
}
export function isSettledReadOnlyFinalizer(receipt,refusal){
 return Boolean(['EBADF','EPERM','EACCES'].includes(refusal)&&receipt?.code===0&&receipt.signal===null&&receipt.stdoutEof&&receipt.stderrEof&&receipt.observationFault&&Array.isArray(receipt.observationFaultKinds)&&hash(receipt.observationFaultKinds)===hash(['receipt-finalization']));
}
function rows(raw){const v=raw.trim();return v.startsWith('[')?JSON.parse(v):v.split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));}
export function semanticFieldHashes(value,prefix='$',result={}){
 result[prefix]=hash(value===undefined?{absent:true}:value);
 if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))semanticFieldHashes(child,prefix+'.'+key,result);
 return result;
}
export class LocalBoundedSerialDriver{
 constructor({directory,implementationRoot,retainedEvidenceRoots=[]}){
  this.directory=path.resolve(directory);this.implementationRoot=path.resolve(implementationRoot);
  this.operation=randomBytes(16).toString('hex');this.owned='serial-physical-'+this.operation;
  this.retainedEvidenceRoots=[...new Set(retainedEvidenceRoots)].sort();for(const name of this.retainedEvidenceRoots){assert.match(name,/^serial-physical-[a-f0-9]{32}$/);assert.notEqual(name,this.owned);}
  this.root='/var/lib/postgresql/data/'+this.owned;this.base='D:/sabalanerp/docker-compose.local.yml';
  this.compose=['compose','--project-name','sabalanerp-local','-f',this.base];
  this.active=new Set();this.receipts=[];this.ordinal=0;this.stoppedClients=[];this.inventoryCount=0;this.unknown=false;
  this.shellBackends=new Set();this.shellRestartPolicies=new Map();
  this.override=path.join(this.directory,'serial-idle-override.json');
 }
 journal(event,details={}){
  assertOriginalPrivateEvidenceDirectory(this.custody,this.directory);
  const fd=fs.openSync(path.join(this.directory,'journal.ndjson'),'a',0o600);
  try{fs.writeFileSync(fd,JSON.stringify({event,operation:this.operation,...details})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }
 save(name,value){
  assertOriginalPrivateEvidenceDirectory(this.custody,this.directory);
  persistImmutableSerialJson(path.join(this.directory,name),value);
 }
 async acquireLease(){
  assert.equal(process.platform,'win32');assert.equal(sha(fs.readFileSync(DOCKER)),TOOL_SHA);
  this.custody=await prepareOriginalPrivateEvidenceDirectory(this.directory);
  const parent='D:/sabalanerp/.deploy-state';if(!fs.existsSync(parent))fs.mkdirSync(parent,{mode:0o700});
  assert.ok(!fs.lstatSync(parent).isSymbolicLink());
  this.lease=await acquireSerialHostLease(path.join(parent,'deployment.lock'));
  // A real competing original must fail to acquire the SAME kernel lease.
  await assert.rejects(acquireSerialHostLease(path.join(parent,'deployment.lock')),/LEASE_BUSY/);
  this.journal('LEASE_ACQUIRED',{originalPid:this.lease.originalPid,contenderRefused:true});
 }
 async execute(argv,phase,{input=null,onData=null,finalizationFault=false}={}){
  this.lastPhase=phase;
  this.lease.assertHeld();assertOriginalPrivateEvidenceDirectory(this.custody,this.directory);
  const name=String(this.ordinal++).padStart(4,'0')+'-'+phase,file=path.join(this.directory,name+'.json');
  const fd=fs.openSync(file,'wx',0o600),output={stdout:[],stderr:[]};let total=0,overflow=false,injected=false,receipt;
  const child=spawn(DOCKER,argv,{windowsHide:true,shell:false,stdio:[input===null?'ignore':'pipe','pipe','pipe']});
  this.active.add(child);
  if(input!==null){child.stdin.on('error',()=>{this.unknown=true;});child.stdin.end(input);}
  const sinks=Object.fromEntries(['stdout','stderr'].map(n=>[n,{write:b=>{total+=b.length;if(total<=64*1024**2)output[n].push(Buffer.from(b));else overflow=true;if(n==='stdout')onData?.(b);return b.length;},sync(){},close(){}}]));
  try{
   await retainSerialChild(child,{phase,sinks,persistReceipt:row=>{
    if(finalizationFault&&!injected){const readonly=fs.openSync(file,'r');try{this.finalizationRefusal=observeReadOnlyDescriptorRefusal(readonly);}finally{fs.closeSync(readonly);}injected=true;assert.ok(this.active.has(child));this.finalizationHeld=true;throw Error('ACTUAL_READONLY_FINALIZATION_REFUSED');}
    receipt={...row,inputSha256:input===null?null:sha(input)};
    fs.ftruncateSync(fd,0);const raw=Buffer.from(JSON.stringify(receipt)+'\n');let at=0;
    while(at<raw.length){const n=fs.writeSync(fd,raw,at,raw.length-at,at);assert.ok(n>0);at+=n;}fs.fsyncSync(fd);
   },finalizeReceipt:()=>fs.closeSync(fd)});
   assert.equal(overflow,false,'BOUNDED_OUTPUT_OVERFLOW');return Buffer.concat(output.stdout).toString('utf8');
  }catch(error){
   // Only this fixed, read-only, no-descendant fault command can be settled
   // after its same original close/EOF and recovered durable finalization.
   const settledFinalizer=finalizationFault&&injected&&isSettledReadOnlyFinalizer(receipt,this.finalizationRefusal);
   if(!isClosedSerialNegative(error)&&!settledFinalizer)this.unknown=true;
   if(settledFinalizer){this.finalizationNegative=receipt;return '';}
   throw error;
  }finally{if(receipt)this.receipts.push(receipt);this.active.delete(child);}
 }
 async census(){
  const current=rows(await this.execute([...this.compose,'ps','--all','--no-trunc','--format','json'],'PS'));
  assert.equal(hash(current.map(x=>x.Service).sort()),hash(expectedServices),'EXISTING_TEN_SERVICE_FLEET_REQUIRED');
  for(const r of current){assert.equal(r.Project,'sabalanerp-local');if(this.identities&&r.Service!=='postgres')assert.equal(r.ID,this.identities[r.Service]);if(r.Service==='postgres'&&this.pgId&&!this.replacingPg)assert.equal(r.ID,this.pgId,'POSTGRES_REPLACED_OUTSIDE_OWNED_TRANSITION');}
  this.latest=current;return current;
 }
 async docker(argv,phase,options){await this.census();return this.execute(argv,phase,options);}
 async inspect(id,phase='INSPECT'){return JSON.parse(await this.docker(['inspect',id],phase))[0];}
 async preflight(){
  const initial=await this.census();assert.ok(initial.every(r=>r.State==='running'&&r.Health==='healthy'),'ALL_TEN_HEALTHY_REQUIRED');
  this.identities=Object.fromEntries(initial.map(r=>[r.Service,r.ID]));this.pgId=this.identities.postgres;
  this.original=await this.inspect(this.pgId);this.originalSemantic=semantic(this.original);
  this.save('configuration-definition.json',{normalization:'docker-unset-dns-arrays/v1',rawSha256:hash(semantic(this.original,{normalizeUnsetDns:false})),normalizedSha256:hash(this.originalSemantic)});
  this.save('original-configuration-field-hashes.json',semanticFieldHashes(this.originalSemantic));
  assert.equal(this.original.Config.Labels['com.docker.compose.project.config_files'].replaceAll('\\','/').toLowerCase(),this.base.toLowerCase());
  assert.equal(this.original.HostConfig.RestartPolicy.Name,'unless-stopped');
  const actual=JSON.parse(await this.docker([...this.compose,'config','--format','json'],'ACTUAL_CONFIG')).services.postgres;
  const source=JSON.parse(await this.docker(['compose','--project-name','sabalanerp-local','-f',path.join(this.implementationRoot,'docker-compose.local.yml'),'config','--format','json'],'SOURCE_CONFIG')).services.postgres;
  assert.equal(hash(actual),hash(source),'AUTHORITATIVE_POSTGRES_CONFIG_CHANGED');
  assert.equal(actual.image,'postgres:15-alpine');assert.equal(actual.volumes.length,1);
  assert.equal(actual.volumes[0].target,'/var/lib/postgresql/data');assert.equal(actual.volumes[0].type,'volume');
  this.effective=actual;this.sourceComposeSha=sha(fs.readFileSync(this.base));
  const resolvedHash=(await this.docker([...this.compose,'config','--hash','postgres'],'PREFLIGHT_CONFIG_HASH')).trim().split(/\s+/)[1];
  assert.equal(resolvedHash,this.original.Config.Labels['com.docker.compose.config-hash'],'ORIGINAL_RESOLVED_COMPOSE_DRIFT');
  this.resolvedComposeHash=resolvedHash;
  const initialImage=JSON.parse(await this.docker(['image','inspect','postgres:15-alpine'],'PREFLIGHT_RESTORE_IMAGE'))[0];
  assert.equal(initialImage.Id,this.original.Image,'ORIGINAL_IMAGE_TAG_NOT_RESTORABLE');
  this.catalog=await this.sql("SELECT json_build_object('system',(SELECT system_identifier::text FROM pg_control_system()),'databases',(SELECT json_agg(x ORDER BY oid) FROM (SELECT oid,datname,datallowconn FROM pg_database) x))::text");
  // Restarting an existing backend must not accidentally deploy migrations as
  // a side effect of this bounded proof. Inspect image bytes/ledger read-only.
  for(const service of ['backend','backend-candidate','backend-retained']){
   const runtime=await this.inspect(this.identities[service]);
   const runsMigration=restartRunsMigration(runtime.Config);
   if(runsMigration){
    this.shellBackends.add(service);
    assert.equal((await this.docker(['exec',runtime.Id,'python3','-I','-B','-c',"import os,signal;assert hasattr(os,'pidfd_open')and hasattr(signal,'pidfd_send_signal');print('PIDFD_READY')"],'SHELL_PIDFD_CAPABILITY')).trim(),'PIDFD_READY');
   }
   const recoveryCode="const f=require('fs'),p=require('path'),c=require('crypto'),dir=process.env.RECOVERY_COORDINATION_DIR||p.join(process.cwd(),'storage','recovery','coordination'),journal=p.join(dir,'pending-restore.json');let present;try{f.lstatSync(journal);present=true;}catch(e){if(e.code!=='ENOENT')throw e;present=false;}const script='/app/dist/scripts/recovery-database-preflight.js';console.log(JSON.stringify({journalPresent:present,journalPathSha256:c.createHash('sha256').update(journal).digest('hex'),installedPreflightSha256:f.existsSync(script)?c.createHash('sha256').update(f.readFileSync(script)).digest('hex'):null}));";
   const recovery=JSON.parse(await this.docker(['exec',runtime.Id,'node','-e',recoveryCode],'RECOVERY_RESTART_GUARD_'+service));
   this.save('restart-recovery-'+service+'.json',{service,...recovery});
   assertRecoveryRestartReady(recovery,runsMigration);
   const url=new URL(runtime.Config.Env.find(v=>v.startsWith('DATABASE_URL=')).slice(13));
   const database=decodeURIComponent(url.pathname.slice(1));assert.match(database,/^[A-Za-z_][A-Za-z0-9_]*$/);
   const code="const f=require('fs'),c=require('crypto'),p='/app/prisma/migrations/';console.log(JSON.stringify(f.readdirSync(p).filter(n=>f.existsSync(p+n+'/migration.sql')).map(n=>[n,c.createHash('sha256').update(f.readFileSync(p+n+'/migration.sql')).digest('hex')])));";
   const installed=JSON.parse(await this.docker(['exec',runtime.Id,'node','-e',code],'INSTALLED_MIGRATIONS_'+service));
   const ledger=await this.docker(['exec','--user','70:70',this.pgId,'psql','-X','-At','-F','\t','-d',database,'-c','SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'],'MIGRATION_LEDGER_'+service);
   const admission=assessRestartMigrations(installed,ledger);
   this.save('restart-migrations-'+service+'.json',{service,...admission,runsMigration,ledgerSha256:sha(ledger),startupSha256:hash({entrypoint:runtime.Config.Entrypoint,cmd:runtime.Config.Cmd})});
   if(runsMigration&&admission.pending.length)throw Error('BACKEND_RESTART_HAS_PENDING_MIGRATIONS:'+service);
   const unfinished=await this.docker(['exec','--user','70:70',this.pgId,'psql','-X','-At','-d',database,'-c','SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL'],'UNFINISHED_MIGRATIONS_'+service);
   assert.equal(unfinished.trim(),'0','UNFINISHED_MIGRATION_BLOCKS_RESTART');
   // migrate deploy warns about already-applied checksum drift; it never
   // reapplies those files. Preserve the observed warning/history unchanged.
   // https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production
  }
  this.tools=await this.docker(['exec',this.pgId,'/bin/sh','-ec','postgres --version; pg_ctl --version; pg_controldata --version; pg_verifybackup --version; pg_waldump --version; df -Pk /var/lib/postgresql/data'],'TOOLS');
  for(const name of this.retainedEvidenceRoots){const owner=(await this.script('set -eu\ntest ! -L /var/lib/postgresql/data/'+name+'\nstat -c %u:%g:%a /var/lib/postgresql/data/'+name+'\n','VERIFY_RETAINED_EVIDENCE')).trim();assert.ok(['0:70:710','70:70:710'].includes(owner),'RETAINED_EVIDENCE_OWNER_DRIFT');}
  this.save('retained-evidence-roots.json',{roots:this.retainedEvidenceRoots,excluded:false,allRowsMustRemainIdentical:true});
  assert.ok(this.tools.split('\n').slice(0,5).every(v=>/\(PostgreSQL\) 15\.[0-9]+/.test(v)));
  const disk=this.tools.trim().split('\n').at(-1).trim().split(/\s+/);assert.ok(Number(disk[3])*1024>=64*1024**2,'WRAPPER_WORKING_SPACE_REQUIRED');
  this.save('preflight.json',{operation:this.operation,identities:this.identities,image:this.original.Image,configSha256:hash(this.originalSemantic),catalogSha256:sha(this.catalog),composeSha256:this.sourceComposeSha,tools:this.tools});
 }
 sql(query){return this.docker(['exec','--user','70:70',this.pgId,'psql','-X','-At','-d','postgres','-c',query],'SQL_OBSERVE');}
 script(script,phase,id=this.pgId){return this.docker(['exec','--user','0:0','-i',id,'/bin/sh','-s'],phase,{input:script});}
 async stage(){
  const scripts=Object.fromEntries(['serial-wrapper.sh','inventory-original.sh'].map(n=>[n,fs.readFileSync(new URL(n,import.meta.url),'utf8').replaceAll('\r\n','\n').replaceAll('OPERATION',this.operation)]));
  let code='set -eu\numask 077\nroot='+this.root+'\ntest ! -e "$root"\ntest ! -L "$root"\nmkdir "$root"\nchown 0:70 "$root"\nchmod 710 "$root"\n';
  for(const [n,raw]of Object.entries(scripts))code+='printf %s '+Buffer.from(raw).toString('base64')+' | base64 -d > "$root/'+n+'"\nchmod 500 "$root/'+n+'"\n';
  code+='sync\n';await this.script(code,'STAGE');
  const observed=await this.script('set -eu\nstat -c %u:%g:%a '+this.root+'\nsha256sum '+this.root+'/serial-wrapper.sh '+this.root+'/inventory-original.sh\n','VERIFY_STAGE');
  const lines=observed.trim().split('\n');assert.equal(lines[0],'0:70:710');
  for(const [i,n]of ['serial-wrapper.sh','inventory-original.sh'].entries())assert.equal(lines[i+1].split(/\s+/)[0],sha(scripts[n]));
  this.idleOverride={services:{postgres:{image:this.original.Image,restart:'no',entrypoint:['/bin/sh',this.root+'/serial-wrapper.sh'],command:['--idle-only']}}};
  this.save('serial-idle-override.json',this.idleOverride);
  this.save('source-pins.json',Object.fromEntries(Object.entries(scripts).map(([n,v])=>[n,sha(v)])));
 }
 async persistObligation(){
  this.save('restoration-obligation.json',{operation:this.operation,originalIds:this.identities,originalImage:this.original.Image,
   originalConfigurationSha256:hash(this.originalSemantic),originalRestart:this.original.HostConfig.RestartPolicy,composeFile:this.base,composeSha256:this.sourceComposeSha});
  this.journal('RESTORATION_REQUIRED');
  await this.script('set -eu\numask 077\n(set -C; printf "RESTORATION_REQUIRED\\n" > '+this.root+'/restoration-obligation)\nsync\n','OBLIGATION');
 }
 async quietClients(){
  for(const name of clients){
   const id=this.identities[name];this.stoppedClients.push(id);this.journal('CLIENT_STOP_REQUESTED',{service:name,id});
   if(this.shellBackends.has(name))await this.stopShellOwnedBackend(id);
   else await this.docker(['stop','--time=-1',id],'QUIET_'+name);
   const stopped=await this.inspect(id);
   if(stopped.State.Running||stopped.State.ExitCode!==0){this.unknown=true;throw Error('CLIENT_NORMAL_CLOSURE_UNPROVEN:'+name);}
   this.journal('CLIENT_NORMALLY_CLOSED',{service:name,id,exitCode:stopped.State.ExitCode});
  }
  const quiet=await this.sql("SELECT (SELECT count(*) FROM pg_stat_activity WHERE backend_type IN ('client backend','walsender') AND pid<>pg_backend_pid())::text || ':' || (SELECT count(*) FROM pg_prepared_xacts)::text");
  assert.equal(quiet.trim(),'0:0','CLIENT_OR_PREPARED_TRANSACTION_REMAINS');this.journal('CLIENTS_QUIET');
 }
 async stopShellOwnedBackend(id){
  const original=await this.inspect(id),policy=original.HostConfig.RestartPolicy;
  assert.equal(policy.Name,'unless-stopped');assert.equal(policy.MaximumRetryCount,0);
  this.shellRestartPolicies.set(id,policy);this.journal('SHELL_BACKEND_RESTART_REQUIRED',{id,policy});
  await this.docker(['update','--restart=no',id],'SUPPRESS_SHELL_RESTART');
  assert.equal((await this.inspect(id)).HostConfig.RestartPolicy.Name,'no');
  const source=fs.readFileSync(new URL('../../../deploy/scripts/serial-graceful-node-stop.py',import.meta.url),'utf8');
  try{await this.docker(['exec','--user','0:0','-i',id,'python3','-I','-B','-','--signal-owned-node'],'GRACEFUL_SHELL_NODE',{input:source});}
  catch(error){if(!isClosedSerialNegative(error))throw error;this.journal('SHELL_SIGNAL_CHILD_CLOSED_NEGATIVE');}
  assert.equal((await this.docker(['wait',id],'WAIT_SHELL_APPLICATION')).trim(),'0');
  // Mark this stopped service as manually stopped before restoring its policy.
  await this.docker(['stop','--time=-1',id],'LATCH_SHELL_MANUAL_STOP');
 }
 async disableRestart(){
  this.journal('RESTART_SUPPRESSION_REQUESTED',{id:this.pgId});
  await this.docker(['update','--restart=no',this.pgId],'DISABLE_RESTART');
  const actual=await this.inspect(this.pgId);assert.equal(actual.HostConfig.RestartPolicy.Name,'no');
  const before=structuredClone(this.originalSemantic),after=semantic(actual);before.host.RestartPolicy=after.host.RestartPolicy;
  assert.equal(hash(before),hash(after),'UNRELATED_CONFIG_DRIFT');this.journal('RESTART_SUPPRESSED');
 }
 async shutdownOriginal(){
  this.shutdownRequested=true;this.journal('SMART_SHUTDOWN_REQUESTED');
  await this.docker(['exec','--user','70:70',this.pgId,'pg_ctl','-D','/var/lib/postgresql/data','-m','smart','-W','stop'],'SMART_STOP');
  await this.observeOriginalExit();
 }
 async observeOriginalExit(){
  assert.equal((await this.docker(['wait',this.identities.postgres],'WAIT_ORIGINAL')).trim(),'0','ORIGINAL_POSTMASTER_NOT_NORMAL');
  const stopped=await this.inspect(this.identities.postgres);
  assert.equal(stopped.State.Running,false);assert.equal(stopped.State.ExitCode,0);
  assert.equal(stopped.RestartCount,this.original.RestartCount);assert.equal(stopped.State.StartedAt,this.original.State.StartedAt);
  this.journal('ORIGINAL_NORMALLY_CLOSED',{restartCount:stopped.RestartCount});this.originalClosed=true;
 }
 async activateIdleWrapper(){
  assert.equal(this.originalClosed,true);assert.equal(hash(JSON.parse(fs.readFileSync(this.override))),hash(this.idleOverride));
  assert.equal(sha(fs.readFileSync(this.base)),this.sourceComposeSha);
  this.replacingPg=true;
  await this.docker([...this.compose,'-f',this.override,'up','-d','--no-deps','--no-build','--pull','never','postgres'],'ACTIVATE_WRAPPER');
  this.pgId=(await this.census()).find(r=>r.Service==='postgres').ID;
  this.replacingPg=false;
  this.wrapperCreated=true;
  const w=await this.inspect(this.pgId);assert.notEqual(w.Id,this.identities.postgres);assert.equal(w.Image,this.original.Image);
  assert.equal(w.State.Running,true);assert.equal(w.HostConfig.RestartPolicy.Name,'no');
  const expected=structuredClone(this.originalSemantic),actual=semantic(w);
  expected.host.RestartPolicy=actual.host.RestartPolicy;expected.config.Cmd=['--idle-only'];expected.config.Entrypoint=['/bin/sh',this.root+'/serial-wrapper.sh'];
  if(hash(actual)!==hash(expected))this.save('wrapper-configuration-drift.json',{expected:semanticFieldHashes(expected),observed:semanticFieldHashes(actual)});
  assert.equal(hash(actual),hash(expected),'WRAPPER_RESOURCE_CONFIG_DRIFT');
  await this.waitMarker('wrapper-ready');this.wrapper=true;this.journal('IDLE_WRAPPER_READY',{id:w.Id});
 }
 async settleTransitionForRestoration(){
  this.assertNoChildren();
  if(!this.shutdownRequested){await this.docker(['update','--restart=unless-stopped',this.identities.postgres],'RESTORE_RESTART');return {wrapper:false};}
  if(!this.originalClosed)await this.observeOriginalExit();
  if(!this.wrapperCreated)await this.activateIdleWrapper();
  else if(!this.wrapper){await this.waitMarker('wrapper-ready');this.journal('WRAPPER_RESTORATION_ONLY',{accepted:false,pinnedComposeHash:this.resolvedComposeHash});}
  return {wrapper:true};
 }
 async waitMarker(name){
  for(let i=0;i<60;i++){
   const result=await this.script('if test -f '+this.root+'/'+name+'; then printf READY; else printf WAIT; fi\n','MARKER_'+name);
   if(result==='READY')return;await sleep();
  }throw Error('WRAPPER_MARKER_NOT_OBSERVED');
 }
 async inventory(){
  const count=this.inventoryCount++,phase=count===0?'initial':'final-'+count;
  const raw=await this.docker(['exec','--user','0:0',this.pgId,'/bin/sh',this.root+'/inventory-original.sh',phase],'INVENTORY_'+phase);
  return parseFrozenOriginalInventory({originalDataExcludedEntry:this.owned,retainedEvidenceRoots:this.retainedEvidenceRoots},raw);
 }
 async mark(name){
  const file=this.root+'/'+name;
  await this.script('set -eu\numask 077\nif test -e '+file+' || test -L '+file+'; then\n test -f '+file+' && test ! -L '+file+'\n test "$(stat -c %u:%a:%h:%s '+file+')" = 0:600:1:2\n test "$(cat '+file+')" = 1\nelse\n (set -C; printf "1\\n" > '+file+')\nfi\nsync\n','COMMIT_'+name);
 }
 async persistInitialInventory(value){this.save('frozen-initial.json',value);await this.mark('original-inventory-committed');}
 async persistFinalInventory(value){this.save('frozen-final.json',value);await this.mark('original-final-inventory-committed');}
 async recordRootChange(before,after){this.save('root-metadata-change.json',{before,after});}
 assertNoChildren(){assert.equal(this.active.size,0,'ORIGINAL_NATIVE_CHILD_STILL_OPEN');assert.equal(this.unknown,false,'UNKNOWN_NATIVE_ORIGINAL_HELD');}
 async runFaultProofs(initial){
  await assert.rejects(this.docker(['exec',this.pgId,'/bin/sh','-ec','exit 7'],'CLOSED_NEGATIVE'),isClosedSerialNegative);
  let ready=false,closed=false;
  await this.census();
  const pending=this.execute(['exec',this.pgId,'/bin/sh','-ec','printf READY; while test ! -f '+this.root+'/probe-release; do sleep 1; done'],'WITHHELD_CHILD',{onData:b=>{if(b.toString().includes('READY'))ready=true;}}).finally(()=>{closed=true;});
  while(!ready&&!closed)await sleep();assert.ok(ready&&!closed);
  assert.throws(()=>this.assertNoChildren(),/STILL_OPEN/);this.journal('WITHHELD_CHILD_BLOCKED_RELEASE');
  await this.mark('probe-release');await pending;this.assertNoChildren();
  const changed=structuredClone(initial),file=changed.rows.find(r=>r.type==='file');file.sha256=file.sha256==='0'.repeat(64)?'1'.repeat(64):'0'.repeat(64);
  this.save('modified-snapshot-negative.json',changed);
  assert.throws(()=>compareFrozenOriginalInventories(changed,initial),/FROZEN_ORIGINAL_CHANGED/);this.journal('MODIFIED_SNAPSHOT_REFUSED',{genuineOriginalsModified:false,gate:'compareFrozenOriginalInventories'});
  await assert.rejects(this.docker(['exec','--user','70:70',this.pgId,'pg_ctl','-D',this.root+'/nonexistent-proof-data','-m','smart','-w','stop'],'CLOSED_SHUTDOWN_NEGATIVE'),isClosedSerialNegative);
  await this.docker(['exec',this.pgId,'/bin/sh','-ec','test ! -e /var/lib/postgresql/data/postmaster.pid'],'READONLY_FINALIZATION_FAULT',{finalizationFault:true});
  assert.ok(this.finalizationHeld&&this.finalizationNegative);this.assertNoChildren();
  this.save('fault-proofs.json',{closedNegative:true,withheldOriginalClosed:true,modifiedSnapshotRefused:true,genuineOriginalsModified:false,
   shutdownNegativeClosed:true,finalizerFaultHeldUntilDurable:true,actualNativeReadOnlyDescriptor:true,readonlyRefusal:this.finalizationRefusal,finalizerReceipt:this.finalizationNegative,physicalReplayQualified:false,productionAdmission:false});
 }
 async releaseWrapper(){
  this.assertNoChildren();const previous=await this.inspect(this.pgId);
  if(!previous.State.Running){assert.equal(previous.State.ExitCode,0);assert.equal(previous.RestartCount,0);this.journal('WRAPPER_NORMALLY_CLOSED');return;}
  await this.mark('request-release-wrapper');await this.waitMarker('wrapper-release-ready');
  await this.docker(['stop','--signal=SIGTERM','--time=-1',this.pgId],'STOP_RELEASED_WRAPPER');
  const w=await this.inspect(this.pgId);assert.equal(w.State.Running,false);assert.equal(w.State.ExitCode,0);assert.equal(w.RestartCount,0);
  this.journal('WRAPPER_NORMALLY_CLOSED');
 }
 async restorePostgres(){
  this.assertNoChildren();assert.equal(sha(fs.readFileSync(this.base)),this.sourceComposeSha);
  const image=JSON.parse(await this.docker(['image','inspect','postgres:15-alpine'],'ORIGINAL_IMAGE'))[0];assert.equal(image.Id,this.original.Image);
  this.replacingPg=true;
  await this.docker([...this.compose,'up','-d','--no-deps','--no-build','--pull','never','postgres'],'RESTORE_POSTGRES');
  this.pgId=(await this.census()).find(r=>r.Service==='postgres').ID;
  this.replacingPg=false;
  await this.waitHealthy('postgres');
  const actual=await this.inspect(this.pgId);assert.equal(hash(semantic(actual)),hash(this.originalSemantic),'RESTORED_CONFIGURATION_DRIFT');
  const catalog=await this.sql("SELECT json_build_object('system',(SELECT system_identifier::text FROM pg_control_system()),'databases',(SELECT json_agg(x ORDER BY oid) FROM (SELECT oid,datname,datallowconn FROM pg_database) x))::text");
  assert.equal(sha(catalog),sha(this.catalog),'ORIGINAL_CLUSTER_CATALOG_CHANGED');this.journal('ORIGINAL_CLUSTER_RESTORED',{image:actual.Image,containerId:this.pgId});
 }
 async restoreClients(){
  this.assertNoChildren();
  for(const id of this.stoppedClients){
   const policy=this.shellRestartPolicies.get(id);
   if(policy){await this.docker(['update','--restart='+policy.Name,id],'RESTORE_SHELL_RESTART');assert.equal(hash((await this.inspect(id)).HostConfig.RestartPolicy),hash(policy));}
   await this.docker(['start',id],'RESTORE_CLIENT');
  }
  for(const name of clients)await this.waitHealthy(name);
 }
 async waitHealthy(service){for(let i=0;i<120;i++){const r=(await this.census()).find(r=>r.Service===service);if(r.State==='running'&&r.Health==='healthy')return;await sleep();}throw Error('SERVICE_NOT_HEALTHY:'+service);}
 async verifyRestoration(){this.assertNoChildren();const current=await this.census();assert.ok(current.every(r=>r.State==='running'&&r.Health==='healthy'));this.save('restored-fleet.json',{services:current.map(({ID,Service,State,Health})=>({ID,Service,State,Health})),originalClusterRestored:true,physicalReplayQualified:false,productionAdmission:false});}
 async persistCompleted(){this.assertNoChildren();this.completionReceipt??={operation:this.operation,originalClusterRestored:true,childrenAtCompletion:this.receipts.length,allChildrenClosed:true,physicalReplayQualified:false,productionAdmission:false};this.journal('RESTORATION_COMPLETED');this.save('completion.json',this.completionReceipt);}
 async releaseLease(){this.assertNoChildren();if(!this.leaseReleased){await this.lease.release();this.leaseReleased=true;if(this.heldOwnerTimer)clearInterval(this.heldOwnerTimer);}this.save('lease-closed.json',{originalPid:this.lease.originalPid,closed:true});}
 retainHeldOwner(){
  if(!this.heldOwnerTimer&&!this.leaseReleased)this.heldOwnerTimer=setInterval(()=>{try{this.lease.assertHeld();}catch{this.unknown=true;}},1000);
 }
 async hold(){this.retainHeldOwner();this.journal('RESTORATION_HELD',{nativeChildren:this.active.size,unknown:this.unknown});}
}
