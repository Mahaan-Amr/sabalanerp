import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {prepareSourceMigration,verifySourceMigration,validateSourceMigration,mirrorOrigin} from '../../scripts/clamav-source-migration.mjs';
import {validateIncidentSnapshot, requireIncidentSession} from '../../backend/scripts/clamav-incident-policy.mjs';
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
