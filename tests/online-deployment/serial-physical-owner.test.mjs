import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';import{compileSerialExistingPostgresPlan,validateResolvedSerialService,validateFrozenOriginalInventory,runSerialRestorationProtocol}from'../../scripts/lib/serial-physical/serial-owner.mjs';
import {spawn} from 'node:child_process';
import {retainSerialChild} from '../../scripts/lib/serial-physical/retained-child.mjs';
import {compileNativePrimitives,renderSerialSources,validateSerialToolObservation} from '../../scripts/lib/serial-physical/native-primitives.mjs';
import {parseFrozenOriginalInventory} from '../../scripts/lib/serial-physical/frozen-inventory.mjs';
import path from 'node:path';
import {createSerialPhysicalNativeBinding} from '../../scripts/lib/serial-physical/native-binding.mjs';
const root='/var/lib/postgresql/data',op='a'.repeat(32),service={image:'postgres:15-alpine',environment:{POSTGRES_DB:'sabalanerp'},volumes:[{type:'volume',source:'postgres_data',target:root}],ports:[{target:5432,published:'55432',host_ip:'127.0.0.1'}],networks:{default:{}},entrypoint:['docker-entrypoint.sh']};
const physicalInput={postgresUser:'postgres',controlDataRaw:'Database system identifier: 222\nmax_connections setting: 100\nmax_worker_processes setting: 8\nmax_wal_senders setting: 10\nmax_prepared_xacts setting: 0\nmax_locks_per_xact setting: 64\n',layout:{format:'sabalan-original-independent-online-layout/v1',operation:op,physicalReplayQualified:false,productionAdmission:false,sourceDatabase:{database:'actual_source',databaseOid:'123',systemIdentifier:'222'},restorePoint:{name:'sabalan_cut_actual',lsn:'0/120',requiredWalEndLsn:'0/200'},restoredFileCuts:Array.from({length:9},(_,i)=>({name:'root'+i})),coverage:{restorePointLsn:'0/120',startLsn:'0/100',endLsn:'0/300',timeline:1,nativeClosureQualified:false,independentRestoreQualified:false,database:{databaseName:'actual_source',databaseOid:'123',systemIdentifier:'222'}}}};
const plan=()=>compileSerialExistingPostgresPlan({operation:op,originalService:service,originalImage:'sha256:'+'c'.repeat(64),originalSystemIdentifier:'111',physicalInput});
const inventory=()=>({format:'sabalan-original-local-pgdata-frozen-inventory/v1',pgdata:root,excludedEntry:'serial-physical-'+op,normalShutdown:true,postmasterAbsent:true,runningServers:0,fullFileContentsHashed:true,rows:['PG_VERSION','global/pg_control'].map((path,i)=>({path,type:'file',uid:'70',gid:'70',mode:0o600,device:'1',inode:String(i+1),nlink:1,sha256:'d'.repeat(64),bytes:9}))});
test('pure exact same service plan changes only image/env PGDATA/command; no second service or mounts',()=>{const p=plan();assert.deepEqual(Object.keys(p.override.services),['postgres']);assert.deepEqual(Object.keys(p.override.services.postgres).sort(),['command','entrypoint','environment','image']);const resolved=structuredClone(service);Object.assign(resolved,p.override.services.postgres);resolved.environment={...service.environment,...p.override.services.postgres.environment};validateResolvedSerialService(p,service,resolved);for(const mutate of[x=>x.ports[0].published='55433',x=>x.volumes.push({target:'/wal'}),x=>x.entrypoint=['other'],x=>x.networks.other={}]){const b=structuredClone(resolved);mutate(b);assert.throws(()=>validateResolvedSerialService(p,service,b));}assert.equal(p.physicalReplayQualified,false);});
test('only exact owned root excluded; symlink/hardlink/outside/same-source-system refusals',()=>{const p=plan();validateFrozenOriginalInventory(p,inventory());for(const mutate of[x=>x.rows[0].path='../elsewhere',x=>x.rows[0].path=p.originalDataExcludedEntry+'/data/PG_VERSION',x=>x.rows[0].type='symlink',x=>x.rows[0].nlink=2,x=>x.rows[0].mode=0o666,x=>x.runningServers=1]){const b=inventory();mutate(b);assert.throws(()=>validateFrozenOriginalInventory(p,b));}assert.throws(()=>compileSerialExistingPostgresPlan({operation:op,originalService:service,originalImage:'sha256:'+'c'.repeat(64),originalSystemIdentifier:'222',physicalInput}));});
function ports({failAt=null,error,mutateFrozen=false}={}){const calls=[];let snapshots=0;const result={calls};for(const name of ['guardAllTenAndQuiet','verifyAndStageOwnedPhysicalMaterial','persistRestorationObligation','normalShutdownOriginal','activateSameServiceIdleWrapper','verifyWrapperAndOriginalAbsence','persistFrozenOriginalInventory','verifyResolvedOverride','startSameServiceReplay','verifyCanonicalNamedReplay','runBoundRestoredApplications','drainAllReplayOriginals','normalShutdownReplayIfStarted','verifyOriginalComposeAndImage','releaseWrapperAfterInventory','startOriginalSameService','verifyRestoredOriginalClusterAndAllTen','persistRestorationCompleted'])result[name]=async()=>{calls.push(name);if(name===failAt)throw error;return{name,modelOnly:true};};result.frozenOriginalInventory=async()=>{calls.push('frozenOriginalInventory');const x=inventory();if(mutateFrozen&&snapshots++)x.rows[0].sha256='e'.repeat(64);return x;};return result;}
test('ordered model requires durable obligation before shutdown; original fullhash before override and before original restart',async()=>{const p=ports();const r=await runSerialRestorationProtocol(plan(),p);assert.equal(r.originalClusterRestored,true);assert.equal(r.physicalReplayQualified,false);assert.ok(p.calls.indexOf('persistRestorationObligation')<p.calls.indexOf('normalShutdownOriginal'));assert.ok(p.calls.indexOf('frozenOriginalInventory')<p.calls.indexOf('startSameServiceReplay'));assert.ok(p.calls.lastIndexOf('frozenOriginalInventory')<p.calls.indexOf('startOriginalSameService'));assert.equal(p.calls.at(-1),'persistRestorationCompleted');});
test('falsy replay/application failures still restore; failure remains original failure',async()=>{for(const error of[null,undefined,false,0,'']){const p=ports({failAt:'runBoundRestoredApplications',error});let failed=false,caught;try{await runSerialRestorationProtocol(plan(),p);}catch(e){failed=true;caught=e;}assert.equal(failed,true);assert.equal(caught,error);assert.ok(p.calls.includes('persistRestorationCompleted'));}});
test('changed frozen original refuses its start; restoration remains pending and no successful result',async()=>{const p=ports({mutateFrozen:true});await assert.rejects(runSerialRestorationProtocol(plan(),p),/RESTORATION_REQUIRED/);assert.ok(!p.calls.includes('startOriginalSameService'));assert.ok(!p.calls.includes('persistRestorationCompleted'));});
test('source has no Docker invocation and never claims physical admission',()=>{const source=fs.readFileSync(new URL('../../scripts/lib/serial-physical/serial-owner.mjs',import.meta.url),'utf8');assert.ok(!source.includes('spawn('));assert.ok(!source.includes('--force'));assert.ok(!source.includes('docker run'));assert.ok(source.includes('sourceOwnedNativeAdapter:true'));});

test('obligation persistence failure never stops or recreates the original',async()=>{
 const p=ports({failAt:'persistRestorationObligation',error:Error('DISK')});
 await assert.rejects(runSerialRestorationProtocol(plan(),p),/DISK/);
 assert.ok(!p.calls.includes('normalShutdownOriginal'));assert.ok(!p.calls.includes('startOriginalSameService'));
});
test('unknown drain, shutdown and finalization failures leave restoration pending',async()=>{
 for(const failAt of ['drainAllReplayOriginals','normalShutdownReplayIfStarted','persistRestorationCompleted']){
  const p=ports({failAt,error:Error('HELD')});
  await assert.rejects(runSerialRestorationProtocol(plan(),p),/RESTORATION_REQUIRED/);
  if(failAt!=='persistRestorationCompleted')assert.ok(!p.calls.includes('startOriginalSameService'));
 }
});
test('failed original shutdown cannot proceed to wrapper activation or assume frozen files',async()=>{
 const p=ports({failAt:'normalShutdownOriginal',error:Error('SMART_STOP_UNKNOWN')});
 await assert.rejects(runSerialRestorationProtocol(plan(),p),/RESTORATION_REQUIRED/);
 assert.ok(!p.calls.includes('activateSameServiceIdleWrapper'));assert.ok(!p.calls.includes('startOriginalSameService'));
});
test('root metadata changes are reported separately; every held file metadata field is preserved',async()=>{
 const p=ports();let call=0;p.frozenOriginalInventory=async()=>({...inventory(),rootMetadata:{mtime:String(call++)}});
 p.persistRootDirectoryMetadataChange=async(_plan,before,after)=>{p.rootChange={before,after};};
 await runSerialRestorationProtocol(plan(),p);assert.deepEqual(p.rootChange,{before:{mtime:'0'},after:{mtime:'1'}});
});
test('genuine closed-negative drain permits restoration while qualification still rejects',async()=>{
 const child=spawn(process.execPath,['-e','process.exitCode=9'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 let saved,negative;try{
  await retainSerialChild(child,{phase:'NEGATIVE',sinks:Object.fromEntries(['stdout','stderr'].map(n=>[n,{write:b=>b.length,sync(){},close(){}}])),persistReceipt:r=>{saved=r;}});
 }catch(error){negative=error;}
 assert.equal(saved.code,9);
 for(const phase of ['drainAllReplayOriginals','normalShutdownReplayIfStarted']){
  const p=ports();p[phase]=async()=>{throw negative;};
  await assert.rejects(runSerialRestorationProtocol(plan(),p),error=>error===negative);
  assert.ok(p.calls.includes('persistRestorationCompleted'));
 }
});
test('withheld live drain cannot recreate service until the SAME owner closes',async()=>{
 const p=ports();let release;const held=new Promise(resolve=>{release=resolve;});
 p.drainAllReplayOriginals=async()=>held;
 const result=runSerialRestorationProtocol(plan(),p);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.ok(!p.calls.includes('startOriginalSameService'));
 release();await result;assert.ok(p.calls.includes('persistRestorationCompleted'));
});
test('fixed native compiler pins same project/service, smart stop, exact backup/WAL checks and rendered operation',()=>{
 const p=plan();const commands=compileNativePrimitives(p,{originalPostgresId:'1'.repeat(64),overrideFile:path.resolve('serial-postgres-override.json'),restoreFile:path.resolve('serial-postgres-original.json')});
 assert.ok(commands.originalShutdown.argv.includes('smart'));
 assert.ok(commands.activateWrapper.argv.includes('--no-deps'));assert.ok(commands.restoreOriginal.argv.includes('--pull'));
 assert.equal(commands.restoreOriginal.argv.at(-1),'postgres');
 const wrapper=commands.forActualWrapper('2'.repeat(64));
 assert.deepEqual(wrapper.verifyBackup.argv.slice(-3),['pg_verifybackup','--no-parse-wal',p.root+'/data']);
 assert.ok(wrapper.verifyWal.argv.includes(p.root+'/wal'));
 assert.throws(()=>commands.forActualWrapper('1'.repeat(64)));
 assert.throws(()=>compileNativePrimitives(JSON.parse(JSON.stringify(p)),{}),/SOURCE_COMPILED/);
 for(const row of Object.values(renderSerialSources(p))){assert.ok(!row.raw.includes('OPERATION'));assert.match(row.sha256,/^[a-f0-9]{64}$/);}
 assert.throws(()=>p.canonicalReplay.verifyBackup.push('arbitrary'));
});
test('actual tool versions, PG_VERSION, control bytes and measured free space are mandatory',()=>{
 const p=plan();const raw=['postgres','pg_verifybackup','pg_waldump','pg_controldata'].map(n=>'TOOL\t'+n+'\t'+n+' (PostgreSQL) 15.16\n').join('')+'PG_VERSION\t15\nCAPACITY\t/dev/sda 10000 10 9000 1% /data\nCONTROL\n'+physicalInput.controlDataRaw;
 assert.equal(validateSerialToolObservation(p,raw,{requiredFreeBytes:1024}).postgresVersion,'15.16');
 for(const bad of [raw.replace('15.16','14.5'),raw.replace('PG_VERSION\t15','PG_VERSION\t16'),raw.replace(' 9000 ',' 0 '),raw.replace('identifier: 222','identifier: 333')])assert.throws(()=>validateSerialToolObservation(p,bad,{requiredFreeBytes:1024}));
});
test('frozen native inventory decoder preserves file metadata and rejects links, cross mounts and malformed producer rows',()=>{
 const p=plan(),meta='1|1|41c0|70|70|2|4096|2026-10-25 10:00:00 +0000|2026-10-25 10:00:00 +0000';
 const file=(name,ino)=>'F\t./'+name+'\t1|'+ino+'|8180|70|70|1|9|mtime|ctime\t'+'d'.repeat(64)+'\n';
 const raw='R\t.\t'+meta+'\n'+file('PG_VERSION',2)+file('global/pg_control',3);
 const decoded=parseFrozenOriginalInventory(p,raw);assert.equal(decoded.rows.length,2);assert.equal(decoded.rows[0].ctime,'ctime');
 for(const bad of [raw.replace('F\t./PG_VERSION','F\t../PG_VERSION'),raw.replace('|8180|','|a180|'),raw.replace('1|2|8180','9|2|8180'),raw.replace('|70|70|1|9|','|70|70|2|9|'),raw.replace('R\t.','D\t.')])assert.throws(()=>parseFrozenOriginalInventory(p,bad));
});
test('native binding refuses absent live coordinator ports before any native command',()=>{
 assert.throws(()=>createSerialPhysicalNativeBinding(plan(),{coordinator:{},native:{},requiredFreeBytes:1024}),/LIVE_COORDINATOR_PORT_REQUIRED/);
});
test('native custody fault remains held even when coordinator drain subsequently succeeds',async()=>{
 const coordinator=new Proxy({},{get:()=>async()=>{}});
 const binding=createSerialPhysicalNativeBinding(plan(),{originalService:service,originalPostgresId:'1'.repeat(64),
  overrideFile:path.resolve('serial-postgres-override.json'),restoreFile:path.resolve('serial-postgres-original.json'),
  coordinator,requiredFreeBytes:1024,native:{custody:{},directory:path.resolve('.scratch/no-native-custody'),beforeDocker:async()=>{throw Error('MUST_NOT_RUN');}}});
 await assert.rejects(binding.verifyAndStageOwnedPhysicalMaterial(),/ORIGINAL_PRIVATE_EVIDENCE_DIRECTORY_REQUIRED/);
 await assert.rejects(binding.drainAllReplayOriginals(),/SERIAL_NATIVE_OBSERVATION_REMAINS_HELD/);
});
