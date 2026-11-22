import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureUnit, verifyUnit, restoreUnit, requireBoundary, immutableImage } from '../../backend/scripts/clamav-checkpoint.mjs';

test('only an owned maintenance lease and the correct journal phase permit bank mutation', () => {
 const session={deploymentId:'test',leaseToken:'secret',phase:'MUTATION_STARTED'};
 const active={id:'test',leaseToken:'secret',phase:'MUTATION_STARTED',leaseExpiresAt:new Date(Date.now()+60000)};
 const maintenance={deploymentId:'test'};
 assert.doesNotThrow(()=>requireBoundary({session,active,maintenance,id:'test',token:'secret',phase:'MUTATION_STARTED'}));
 for(const patch of [{token:'other'},{phase:'SERVICES_DRAINED'},{maintenance:null},{active:{...active,leaseExpiresAt:new Date(0)}},{session:{...session,phase:'TRAFFIC_OPENED'}},{active:{...active,leaseExpiresAt:'invalid'}}]) {
   assert.throws(()=>requireBoundary({session,active,maintenance,id:'test',token:'secret',phase:'MUTATION_STARTED',...patch}));
 }
 assert.throws(()=>immutableImage('clamav/clamav:1.4'));
 assert.equal(immutableImage('sha256:'+'a'.repeat(64)), 'sha256:'+'a'.repeat(64));
});

test('bank, cooldown, configuration and numeric ownership survive rollback; tamper fails before live changes', async () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'clamav-checkpoint-'));
 try {
 const bank=path.join(root,'bank'), unit=path.join(root,'clamav-checkpoint-test');
 fs.mkdirSync(bank); fs.mkdirSync(unit);
 fs.writeFileSync(path.join(bank,'daily.cvd'),'signed-fixture');
 fs.writeFileSync(path.join(bank,'freshclam.dat'),'cooldown');
 fs.writeFileSync(path.join(bank,'.sabalan-updater-state'),'1 1 0 7201\n',{mode:0o600});
 fs.writeFileSync(path.join(unit,'config.tar'),'opaque-config-archive');
 const owner=process.getuid()===0 ? 100 : process.getuid();
 const group=process.getuid()===0 ? 101 : process.getgid();
 fs.chownSync(path.join(bank,'daily.cvd'),owner,group);
 const metadata=await captureUnit({bank,unit,id:'test',image:'sha256:'+'a'.repeat(64)});
 const manifest={components: Object.entries(metadata.files).map(([file,item])=>({path:`recovery-coordination/clamav-checkpoint-test/${file}`,...item}))};
 // The manifest also protects unit metadata rather than trusting its own checksums.
 const {createHash}=await import('node:crypto');
 const bytes=fs.readFileSync(path.join(unit,'unit.json'));
 manifest.components.push({path:'recovery-coordination/clamav-checkpoint-test/unit.json',sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length});
 const checkpoint={deploymentId:'test',localVerified:true,remoteVerified:true,manifest,rollbackReleaseSet:{clamav:metadata.image}};
 await verifyUnit({unit,id:'test',checkpoint});
 fs.writeFileSync(path.join(bank,'daily.cvd'),'changed'); fs.writeFileSync(path.join(bank,'new.cvd'),'newer');
 await restoreUnit({bank,unit,id:'test',checkpoint});
 assert.equal(fs.readFileSync(path.join(bank,'daily.cvd'),'utf8'),'signed-fixture');
 assert.equal(fs.readFileSync(path.join(bank,'freshclam.dat'),'utf8'),'cooldown');
 assert.equal(fs.existsSync(path.join(bank,'new.cvd')),false);
 assert.equal(fs.statSync(path.join(bank,'.sabalan-updater-state')).mode & 0o777,0o600);
 assert.equal(fs.statSync(path.join(bank,'daily.cvd')).uid,owner);
 assert.equal(fs.statSync(path.join(bank,'daily.cvd')).gid,group);
 fs.appendFileSync(path.join(unit,'bank.tar'),'tamper');
 fs.writeFileSync(path.join(bank,'daily.cvd'),'retain-on-invalid-restore');
 await assert.rejects(()=>restoreUnit({bank,unit,id:'test',checkpoint}));
 assert.equal(fs.readFileSync(path.join(bank,'daily.cvd'),'utf8'),'retain-on-invalid-restore');
 await assert.rejects(()=>verifyUnit({unit,id:'test',checkpoint:{...checkpoint,remoteVerified:false}}));
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});


test('bank archives containing links are refused before extraction', async()=>{
 const {execFileSync}=await import('node:child_process');
 const {validateBankArchive}=await import('../../backend/scripts/clamav-checkpoint.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'clamav-archive-'));
 try {
  fs.mkdirSync(path.join(root,'bank'));
  fs.symlinkSync('../outside',path.join(root,'bank','link'));
  execFileSync('tar',['-cpf',path.join(root,'unsafe.tar'),'-C',path.join(root,'bank'),'.']);
  await assert.rejects(()=>validateBankArchive(path.join(root,'unsafe.tar')));
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('a reviewed rollback proof must match the bank and effective configuration actually drained',async()=>{
 const {createHash}=await import('node:crypto');
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'clamav-rollback-proof-'));
 try {
  const bank=path.join(root,'bank'), unit=path.join(root,'clamav-checkpoint-proof');
  fs.mkdirSync(bank);fs.mkdirSync(unit);
  for(const name of ['main','daily','bytecode'])fs.writeFileSync(path.join(bank,`${name}.cvd`),name);
  fs.writeFileSync(path.join(unit,'config.tar'),'config');
  const proof={image:'sha256:'+'a'.repeat(64),configArchiveSha256:hash('config'),bankFiles:Object.fromEntries(['main','daily','bytecode'].map(name=>[`${name}.cvd`,hash(name)]))};
  fs.writeFileSync(path.join(unit,'rollback-proof.json'),JSON.stringify(proof));
  fs.writeFileSync(path.join(bank,'daily.cvd'),'changed-since-rehearsal');
  await assert.rejects(()=>captureUnit({bank,unit,id:'proof',image:proof.image}),/bank changed/);
  assert.equal(fs.existsSync(path.join(unit,'unit.json')),false,'an unproven snapshot cannot become a verified unit');
  fs.writeFileSync(path.join(bank,'daily.cvd'),'daily');
  const captured=await captureUnit({bank,unit,id:'proof',image:proof.image});
  assert.ok(captured.files['rollback-proof.json']);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('rollback reconstructs a lost coordination unit only from authenticated checkpoint components', async () => {
 const { recoverUnit } = await import('../../backend/scripts/clamav-checkpoint.mjs');
 const {execFileSync}=await import('node:child_process');
 const {createHash}=await import('node:crypto');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'clamav-recover-'));
 try {
  const bank=path.join(root,'bank'), payload=path.join(root,'payload');
  const unit=path.join(payload,'recovery-coordination','clamav-checkpoint-lost');
  fs.mkdirSync(bank);fs.mkdirSync(unit,{recursive:true});
  fs.writeFileSync(path.join(bank,'daily.cvd'),'original');
  fs.writeFileSync(path.join(unit,'config.tar'),'config');
  const metadata=await captureUnit({bank,unit,id:'lost',image:'sha256:'+'a'.repeat(64)});
  const components=fs.readdirSync(unit).map(file=>{const bytes=fs.readFileSync(path.join(unit,file));return {path:`recovery-coordination/clamav-checkpoint-lost/${file}`,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
  const checkpoint={deploymentId:'lost',localVerified:true,remoteVerified:true,manifest:{components},rollbackReleaseSet:{clamav:metadata.image}};
  const archive=path.join(root,'payload.tar.gz');
  execFileSync('tar',['-czf',archive,'-C',payload,'recovery-coordination']);
  fs.rmSync(payload,{recursive:true});
  const destination=path.join(root,'recovered');
  await recoverUnit({unit:destination,id:'lost',checkpoint,readArchive:target=>fs.promises.copyFile(archive,target)});
  await verifyUnit({unit:destination,id:'lost',checkpoint});
  fs.writeFileSync(path.join(bank,'daily.cvd'),'mutated');
  await restoreUnit({bank,unit:destination,id:'lost',checkpoint});
  assert.equal(fs.readFileSync(path.join(bank,'daily.cvd'),'utf8'),'original');
  // A missing or tampered encrypted component must not replace even one existing unit file.
  fs.writeFileSync(path.join(destination,'config.tar'),'retain-on-failure');
  const invalid={...checkpoint,manifest:{components:components.map(c=>c.path.endsWith('bank.tar')?{...c,sha256:'0'.repeat(64)}:c)}};
  await assert.rejects(()=>recoverUnit({unit:destination,id:'lost',checkpoint:invalid,readArchive:target=>fs.promises.copyFile(archive,target)}));
  assert.equal(fs.readFileSync(path.join(destination,'config.tar'),'utf8'),'retain-on-failure');
  await assert.rejects(()=>recoverUnit({unit:destination,id:'lost',checkpoint:{...checkpoint,remoteVerified:false},readArchive:()=>{throw Error('must not decrypt');}}),/verified/);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
