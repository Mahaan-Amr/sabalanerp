import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {prepareSourceMigration,verifySourceMigration,validateSourceMigration,mirrorOrigin} from '../../scripts/clamav-source-migration.mjs';
import {validateIncidentSnapshot, requireIncidentSession, feupIncidentImage} from '../../backend/scripts/clamav-incident-policy.mjs';
import {validateRollbackProof, validateRepairPaths,validateAcquisitionConfiguration} from '../../scripts/clamav-release-readiness.mjs';

const image='sha256:'+'a'.repeat(64);
const evidence=()=>({kind:'DEGRADED_CLAMAV_INCIDENT_V1',image,engine:'1.4.5',checkedAt:new Date().toISOString(),
 versions:{main:63,daily:28138,bytecode:339},bankFiles:Object.fromEntries(['main','daily','bytecode'].map(name=>[name+'.cvd','b'.repeat(64)])),
 configArchiveSha256:'c'.repeat(64),issues:['UPDATER_NOT_LIVE','SIGNATURES_STALE'],reopenOriginal:false});

test('degraded evidence is explicit, fresh and cannot masquerade as a healthy rollback proof',()=>{
 const original=evidence(); assert.equal(validateIncidentSnapshot(original,image),original);
 assert.throws(()=>validateRollbackProof(original,image,{main:63,daily:28159,bytecode:339}));
 for(const patch of [{kind:'repair'},{image:'mutable:latest'},{issues:[]},{issues:['IGNORE_HEALTH']},{reopenOriginal:true},
  {checkedAt:'2000-01-01'},{checkedAt:new Date(Date.now()+10000).toISOString()},{bankFiles:{}},{configArchiveSha256:''},
  {updaterHealthy:true},{updaterHealthy:false},{restoreRehearsalPassed:true},{fullReleaseRehearsalPassed:true}]) {
  assert.throws(()=>validateIncidentSnapshot({...original,...patch},image));
 }
});

test('incident operation and snapshot cannot be switched after its lease-owning session is prepared',()=>{
 const digest='d'.repeat(64),session={clamavOperation:'incident-recovery',clamavIncidentSnapshotSha256:digest};
 assert.doesNotThrow(()=>requireIncidentSession(session,'incident-recovery',digest));
 for(const [s,op,sha] of [[{},'incident-recovery',digest],[session,'repair',digest],[session,'incident-recovery','e'.repeat(64)],
  [{...session,clamavOperation:'repair'},'incident-recovery',digest]])assert.throws(()=>requireIncidentSession(s,op,sha));
});

test('incident scope stays maintenance-only and the fixed mirror preserves publisher verification and independent freshness',async()=>{
 assert.doesNotThrow(()=>validateRepairPaths(['scripts/clamav-incident-recovery.mjs','backend/scripts/clamav-incident-policy.mjs','backend/src/scripts/deployment-control.ts']));
 for(const file of ['backend/prisma/schema.prisma','backend/prisma/migrations/new/migration.sql','backend/src/routes/accounting.ts','frontend/src/app/page.tsx'])assert.throws(()=>validateRepairPaths([file]));
 const config=await fs.readFile(new URL('../../deploy/clamav/freshclam.conf',import.meta.url),'utf8');
 assert.match(config,/^DatabaseMirror https:\/\/mirrors\.fe\.up\.pt\/pub\/clamav$/m);
 assert.match(config,/^DNSDatabaseInfo current\.cvd\.clamav\.net$/m);
 assert.match(config,/^TestDatabases yes$/m);
 assert.doesNotMatch(config,/^(?:PrivateMirror|DatabaseCustomURL|HTTPProxyServer) /m);
 assert.equal(validateAcquisitionConfiguration(config),mirrorOrigin);
 for(const unsafe of [config+'DatabaseMirror database.clamav.net\n',config+'HTTPProxyServer other.invalid\n',config.replace('TestDatabases yes','TestDatabases no'),config.replace(mirrorOrigin,'https://unknown.invalid')])assert.throws(()=>validateAcquisitionConfiguration(unsafe));
});

test('explicit source migration preserves exact vendor refusal bytes and initializes only a separately scheduled unhealthy mirror identity',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-source-migration-'));
 assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
 const source=path.join(root,'vendor'),verified=path.join(root,'verified'),output=path.join(root,'mirror');
 try{
  await fs.mkdir(source);await fs.mkdir(verified);
  const attempted=1800000000,deadline=attempted+86400;
  const original={'freshclam.dat':Buffer.from([0,17,32,255,19]),'.sabalan-updater-state':Buffer.from(`${attempted} 0 17 ${deadline}\n`),'.sabalan-freshclam-result':Buffer.from('HTTP 403; vendor refuses requests until tomorrow\n')};
  for(const [name,bytes]of Object.entries(original))await fs.writeFile(path.join(source,name),bytes);
  for(const family of ['main','daily','bytecode'])await fs.writeFile(path.join(verified,family+'.cvd'),'fixture-'+family);
  const manifest=await prepareSourceMigration(source,verified,output);
  assert.equal(manifest.firstEligibleAttempt,attempted+7200);assert.equal(manifest.vendorCooldownUntil,deadline);assert.equal(manifest.cdnFallback,false);
  assert.equal(await fs.readFile(path.join(output,'.sabalan-updater-state'),'utf8'),`${attempted} 0 1 ${attempted+7200}\n`);
  await assert.rejects(fs.stat(path.join(output,'freshclam.dat')),'the vendor identity is not reused as a freshly healthy mirror');
  for(const [name,bytes]of Object.entries(original)){
   assert.deepEqual(await fs.readFile(path.join(source,name)),bytes);
   assert.deepEqual(await fs.readFile(path.join(output,'.source-state/vendor-cdn',name)),bytes);
  }
  assert.deepEqual(await verifySourceMigration(output),manifest);
  await assert.rejects(prepareSourceMigration(source,verified,output),'recreate cannot replace an existing mirror schedule or refusal');
  for(const patch of [{firstEligibleAttempt:attempted+7199},{cdnFallback:true},{targetOrigin:'https://unknown.invalid'},{originalStateFiles:{}},{vendorCooldownUntil:0}])assert.throws(()=>validateSourceMigration({...manifest,...patch}));
  const archived=path.join(output,'.source-state/vendor-cdn/freshclam.dat');await fs.chmod(archived,0o600);await fs.appendFile(archived,'tamper');
  await assert.rejects(verifySourceMigration(output),/bytes changed/);
 }finally{await fs.rm(root,{recursive:true});}
});


test('UFPR preparation copies the observed FEUP cooldown and schedule without modifying the source',{skip:process.platform==='win32'},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-ufpr-stage-'));
 const source=path.join(root,'feup'),output=path.join(root,'ufpr');
 const snapshotFile=path.join(root,'snapshot.json');
 const script=fileURLToPath(new URL('../../scripts/clamav-incident-recovery.mjs',import.meta.url));
 const prepare=destination=>promisify(execFile)(process.execPath,[script,'prepare-ufpr',snapshotFile,source,destination]);
 const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 try{
  const current=Math.floor(Date.now()/1000);
  const attempted=current-7300;
  const next=attempted+7200;
  const files={
   'freshclam.dat':Buffer.from([0,17,32,255,19]),
   '.sabalan-updater-state':Buffer.from(`${attempted} ${attempted+1} 0 ${next}\n`),
   '.sabalan-freshclam-result':Buffer.from('Original result evidence'),
  };
  const vendor=Object.fromEntries(Object.keys(files).map(name=>[name,Buffer.from('vendor:'+name)]));
  const vendorHashes=Object.fromEntries(Object.entries(vendor).map(([name,bytes])=>[name,{sha256:sha256(bytes)}]));
  const sourceMigration={kind:'CLAMAV_ACQUISITION_SOURCE_MIGRATION_V1',originalOrigin:'https://database.clamav.net',
   targetOrigin:mirrorOrigin,intervalSeconds:7200,lastActualAttempt:attempted-15000,
   firstEligibleAttempt:attempted-7800,vendorCooldownUntil:attempted-7800,originalStateFiles:vendorHashes,cdnFallback:false};
  const migrationBytes=Buffer.from(JSON.stringify(sourceMigration));
  await fs.mkdir(path.join(source,'.source-state','vendor-cdn'),{recursive:true});
  await fs.writeFile(path.join(source,'.source-state','migration.json'),migrationBytes);
  for(const [name,bytes] of Object.entries({...files,'main.cvd':'main','daily.cvd':'daily','bytecode.cvd':'bytecode'})){
   await fs.writeFile(path.join(source,name),bytes);
  }
  for(const [name,bytes] of Object.entries(vendor))await fs.writeFile(path.join(source,'.source-state','vendor-cdn',name),bytes);
  const snapshot={...evidence(),image:feupIncidentImage,checkedAt:new Date((current-150)*1000).toISOString(),
   bankFiles:Object.fromEntries(['main','daily','bytecode'].map(name=>[name+'.cvd',sha256(name)])),
   acquisition:{origin:mirrorOrigin,attempted,succeeded:attempted+1,result:0,next,sourceMigration,
    migrationSha256:sha256(migrationBytes),
    stateFileHashes:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha256(bytes)]))}};
  const snapshotBytes=Buffer.from(JSON.stringify(snapshot));
  await fs.writeFile(snapshotFile,snapshotBytes);
  const report=JSON.parse((await prepare(output)).stdout);
  assert.deepEqual(report,{stagingOriginalSha256:sha256(snapshotBytes),next});
  const archive=path.join(output,'.source-state','feup-predecessor');
  assert.deepEqual(await fs.readFile(path.join(archive,'snapshot.json')),snapshotBytes);
  for(const [name,bytes] of Object.entries(files)){
   assert.deepEqual(await fs.readFile(path.join(source,name)),bytes);
   assert.deepEqual(await fs.readFile(path.join(output,name)),bytes);
   assert.deepEqual(await fs.readFile(path.join(archive,name)),bytes);
  }
  const targetImage='sha256:27b42e1a6c76b8d3ad9e88738c45b2c6e54339cb92dfba66205868a9c357c941';
  const stagedResult=Buffer.from('Fixture result bound to the qualified cycle');
  const stageAttempt=current-75;
  await fs.writeFile(path.join(output,'.sabalan-updater-state'),`${stageAttempt} ${stageAttempt+1} 0 ${stageAttempt+7200}\n`);
  await fs.writeFile(path.join(output,'.sabalan-freshclam-result'),stagedResult);
  const bank=path.join(root,'target-bank.tar');
  const run=promisify(execFile);
  await run('tar',['-cf',bank,'-C',output,'.']);
  const receiptFile=path.join(root,'target.json');
  const receipt={image:targetImage,engine:'1.4.6',checkedAt:new Date().toISOString(),versions:snapshot.versions,
   loadedDaily:snapshot.versions.daily,updaterHealthy:true,signatureVerified:true,loadVerified:true,eicarRejected:true,
   acquisitionOrigin:'https://clamavdb.c3sl.ufpr.br',sourceMigration,bankSha256:sha256(await fs.readFile(bank)),
   ufprCycle:{containerStartedAt:new Date((current-120)*1000).toISOString(),attempted:stageAttempt,succeeded:stageAttempt+1,
    next:stageAttempt+7200,resultSha256:sha256(stagedResult)}};
  await fs.writeFile(receiptFile,JSON.stringify(receipt));
  const fakeDns=path.join(root,'fixture-dns.mjs');
  await fs.writeFile(fakeDns,`import dns from 'node:dns/promises';
    import {syncBuiltinESMExports} from 'node:module';
    dns.resolveTxt=async()=>[['1.4.6:63:28138:0:0:0:0:339']];syncBuiltinESMExports();`);
  const verify=path.resolve(path.dirname(script),'clamav-release-readiness.mjs');
  const verifyArgs=['--import',fakeDns,verify,'verify-incident',receiptFile,targetImage,snapshotFile,'5000'];
  const verification={env:{...process.env,DEPLOYMENT_CLAMAV_OPERATION:'incident-recovery',
   DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE:feupIncidentImage,DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256:sha256(snapshotBytes),
   DEPLOYMENT_CLAMAV_UFPR_STAGING_ORIGINAL_SHA256:sha256(snapshotBytes)}};
  assert.equal((await run(process.execPath,verifyArgs,verification)).stdout.trim(),sha256(await fs.readFile(receiptFile)));
  await fs.chmod(path.join(archive,'freshclam.dat'),0o600);
  await fs.appendFile(path.join(archive,'freshclam.dat'),'candidate ancestry changed');
  await run('tar',['-cf',bank,'-C',output,'.']);
  await fs.writeFile(receiptFile,JSON.stringify({...receipt,bankSha256:sha256(await fs.readFile(bank))}));
  await assert.rejects(run(process.execPath,verifyArgs,verification),/bank contents differ/);
  await assert.rejects(prepare(output),/EEXIST/);
  await fs.appendFile(path.join(source,'freshclam.dat'),'changed after capture');
  await assert.rejects(prepare(path.join(root,'superseded')),/differs from the reviewed staging original: freshclam.dat/);
 }finally{await fs.rm(root,{recursive:true});}
});
