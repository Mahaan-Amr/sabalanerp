import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { validateIncidentSnapshot, requireIncidentSession } from './clamav-incident-policy.mjs';
const exec = promisify(execFile);
const fail = (message) => { throw new Error(message); };
const validId = id => /^[a-zA-Z0-9_-]{1,160}$/.test(id) ? id : fail('Unsafe deployment id');
export const immutableImage = value => /^(?:[a-zA-Z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/.test(value || '') ? value : fail('An immutable ClamAV image digest is required');
export function requireBoundary({session, active, maintenance, id, token, phase}) {
 if (!['SERVICES_DRAINED','MUTATION_STARTED','ROLLBACK_STARTED'].includes(phase)
   || !token || session?.deploymentId !== id || session?.leaseToken !== token || session?.phase !== phase
   || active?.id !== id || active?.leaseToken !== token || active?.phase !== phase
   || !Number.isFinite(new Date(active.leaseExpiresAt).getTime()) || new Date(active.leaseExpiresAt).getTime() <= Date.now() || maintenance?.deploymentId !== id) fail('ClamAV operation requires the owned lease, journal phase and maintenance boundary');
}
async function digest(file) {
 const stat=await fs.lstat(file);
 if(!stat.isFile() || stat.isSymbolicLink()) fail('Checkpoint component must be a regular file');
 const hash=crypto.createHash('sha256');
 for await (const chunk of createReadStream(file)) hash.update(chunk);
 return {sha256:hash.digest('hex'),size:stat.size};
}
async function safeTree(root) {
 for (const entry of await fs.readdir(root,{withFileTypes:true})) {
   if (/\n|\r/.test(entry.name) || (!entry.isDirectory() && !entry.isFile())) fail('Unsafe ClamAV bank file type or name');
   if(entry.isDirectory()) await safeTree(path.join(root,entry.name));
 }
}
export async function captureUnit({bank,unit,id,image}) {
 validId(id); immutableImage(image);
 await safeTree(bank);
 await fs.mkdir(unit,{recursive:true,mode:0o700});
 if(await fs.stat(path.join(unit,'unit.json')).catch(()=>null)) fail('Checkpoint unit already exists; refusing overwrite');
 await exec('tar',['-cpf',path.join(unit,'bank.tar'),'-C',bank,'.']);
 const incident = await fs.stat(path.join(unit,'incident-snapshot.json')).catch(()=>null);
 if (incident && await fs.stat(path.join(unit,'rollback-proof.json')).catch(()=>null)) fail('Incident evidence cannot be substituted for a healthy rollback proof');
 const evidenceFile = incident ? 'incident-snapshot.json' : 'rollback-proof.json';
 if(await fs.stat(path.join(unit,evidenceFile)).catch(()=>null)) {
  const proof=JSON.parse(await fs.readFile(path.join(unit,evidenceFile),'utf8'));
  if (incident) validateIncidentSnapshot(proof, image);
  if(proof.image!==image || proof.configArchiveSha256!==(await digest(path.join(unit,'config.tar'))).sha256) fail('Rehearsed rollback configuration/image differs from the drained snapshot');
  if(Object.keys(proof.bankFiles || {}).length!==3) fail('Rollback bank evidence is incomplete');
  for(const [file,expected] of Object.entries(proof.bankFiles)) {
   if(!/^(main|daily|bytecode)[.](cvd|cld)$/.test(file) || (await digest(path.join(bank,file))).sha256!==expected) fail('Rollback bank changed after rehearsal; refusing maintenance mutation');
  }
 }
 const files={};
 for(const file of ['bank.tar','config.tar','target-bank.tar','target.json','rollback-proof.json','incident-snapshot.json']) {
   if((file.startsWith('target') || file==='rollback-proof.json' || file==='incident-snapshot.json') && !await fs.stat(path.join(unit,file)).catch(()=>null)) continue;
   files[file]=await digest(path.join(unit,file));
 }
 const metadata={version:1,deploymentId:id,image,files};
 await fs.writeFile(path.join(unit,'unit.json'),JSON.stringify(metadata)+'\n',{mode:0o600,flag:'wx'});
 return metadata;
}
export async function verifyUnit({unit,id,checkpoint}) {
 validId(id);
 const metadata=JSON.parse(await fs.readFile(path.join(unit,'unit.json'),'utf8'));
 if(metadata.version!==1 || metadata.deploymentId!==id) fail('ClamAV checkpoint identity mismatch');
 immutableImage(metadata.image);
 if(checkpoint && (checkpoint.deploymentId!==id || !checkpoint.localVerified || !checkpoint.remoteVerified || checkpoint.rollbackReleaseSet?.clamav!==metadata.image)) fail('ClamAV rollback requires the verified coordinated checkpoint and previous image');
 if (!metadata.files?.['bank.tar'] || !metadata.files?.['config.tar'] || Object.keys(metadata.files).some(file=>!['bank.tar','config.tar','target-bank.tar','target.json','rollback-proof.json','incident-snapshot.json'].includes(file))
  || (metadata.files['incident-snapshot.json'] && metadata.files['rollback-proof.json'])) fail('Invalid checkpoint components');
 for(const file of [...Object.keys(metadata.files),'unit.json']) {
   const actual=await digest(path.join(unit,file));
   if(file!=='unit.json' && JSON.stringify(actual)!==JSON.stringify(metadata.files[file])) fail('ClamAV unit checksum changed');
   if(checkpoint) {
     const expected=checkpoint.manifest?.components?.find(item=>item.path===`recovery-coordination/clamav-checkpoint-${id}/${file}`);
     if(!expected || expected.sha256!==actual.sha256 || expected.size!==actual.size) fail('ClamAV unit is absent from the verified encrypted checkpoint manifest');
   }
 }
 return metadata;
}
export async function recoverUnit({unit,id,checkpoint,readArchive}) {
 validId(id);
 if(checkpoint?.deploymentId!==id || !checkpoint.localVerified || !checkpoint.remoteVerified) fail('Unit recovery requires the verified coordinated checkpoint');
 const prefix=`recovery-coordination/clamav-checkpoint-${id}/`;
 const components=checkpoint.manifest?.components?.filter(item=>item.path.startsWith(prefix)) || [];
 const allowed=['unit.json','bank.tar','config.tar','target-bank.tar','target.json','rollback-proof.json','incident-snapshot.json'];
 const files=components.map(item=>item.path.slice(prefix.length));
 if(!['unit.json','bank.tar','config.tar'].every(file=>files.includes(file)) || new Set(files).size!==files.length || files.some(file=>!allowed.includes(file))) fail('Invalid protected ClamAV unit manifest');
 await fs.mkdir(path.dirname(unit),{recursive:true,mode:0o700});
 const previous=await fs.lstat(unit).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
 if(previous && (!previous.isDirectory() || previous.isSymbolicLink())) fail('Unsafe coordination unit destination');
 const job=await fs.mkdtemp(path.join(path.dirname(unit),'.clamav-recover-'));
 const recovered=path.join(job,'unit'), backup=path.join(job,'previous');
 try {
  const archive=path.join(job,'payload.tar.gz');
  // The caller authenticates/decrypts the already checksum-verified recovery package.
  await readArchive(archive);
  const names=(await exec('tar',['-tzf',archive],{maxBuffer:16*1024*1024})).stdout.split(/\r?\n/).filter(Boolean);
  await fs.mkdir(recovered,{mode:0o700});
  for(const component of components) {
   const matches=names.filter(name=>name.replace(/^\.\//,'')===component.path);
   if(matches.length!==1) fail('Missing or duplicate protected unit archive entry');
   const destination=path.join(recovered,component.path.slice(prefix.length));
   // Stream selected content to a newly created regular file. Never extract paths,
   // ownership or links from the enclosing archive into the coordination directory.
   const child=spawn('tar',['-xzOf',archive,matches[0]],{stdio:['ignore','pipe','pipe']});
   child.stderr.resume();
   const exited=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close',code=>code===0?resolve():reject(new Error('Protected unit extraction failed')));
   });
   try {await Promise.all([pipeline(child.stdout,createWriteStream(destination,{flags:'wx',mode:0o600})),exited]);}
   finally {if(child.exitCode===null)child.kill();}
   const actual=await digest(destination);
   if(actual.sha256!==component.sha256 || actual.size!==component.size) fail('Recovered unit failed encrypted manifest validation');
  }
  await verifyUnit({unit:recovered,id,checkpoint});
  if(previous)await fs.rename(unit,backup);
  try {await fs.rename(recovered,unit);}
  catch(error){if(previous)await fs.rename(backup,unit);throw error;}
 } finally {await fs.rm(job,{recursive:true,force:true});}
}
export async function validateBankArchive(archive) {
 const names=(await exec('tar',['-tf',archive])).stdout.split('\n').filter(Boolean);
 const entries=(await exec('tar',['-tvf',archive])).stdout.split('\n').filter(Boolean);
 if(!names.length || entries.length!==names.length || entries.some(line=>!['-','d'].includes(line[0]))
   || names.some(name=>name.startsWith('/') || /^[a-z]:/i.test(name) || name.includes('\\') || name.split('/').includes('..'))) fail('Unsafe bank archive paths or file types');
}
export async function restoreUnit({bank,unit,id,checkpoint,archive='bank.tar',beforeMutation}) {
 const verified=await verifyUnit({unit,id,checkpoint});
 if(!['bank.tar','target-bank.tar'].includes(archive) || !verified.files[archive]) fail('Unprotected bank archive');
 await validateBankArchive(path.join(unit,archive));
 // Only archives produced by captureUnit and authenticated by the recovery manifest reach extraction.
 const staging=await fs.mkdtemp(path.join(os.tmpdir(),'clamav-restore-'));
 try {
   await exec('tar',['-xpf',path.join(unit,archive),'-C',staging]);
   await safeTree(staging);
   // The scanner and updater must remain stopped under the owned deployment lease.
   await safeTree(bank);
   if (beforeMutation) await beforeMutation();
   for(const entry of await fs.readdir(bank)) await fs.rm(path.join(bank,entry),{recursive:true,force:true});
   await exec('tar',['-xpf',path.join(unit,archive),'-C',bank]);
 } finally {await fs.rm(staging,{recursive:true,force:true});}
}
async function main() {
 const {createRequire}=await import('node:module');
 const require=createRequire(import.meta.url);
 const {prisma,disconnectDatabase}=require('../dist/lib/prisma.js');
 try {
  const id=validId(process.env.DEPLOYMENT_ID || '');
  const coordination=process.env.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination';
  const reports=process.env.DEPLOYMENT_REPORT_DIR || '/app/deployment-reports';
  const session=JSON.parse(await fs.readFile(path.join(reports,'active-deployment-session.json'),'utf8'));
  const active=await prisma.deploymentOperation.findUnique({where:{activeKey:'production'}});
  const maintenance=JSON.parse(await fs.readFile(path.join(coordination,'deployment-maintenance.json'),'utf8'));
  const phase=process.argv[2]==='capture'?'SERVICES_DRAINED':'MUTATION_STARTED';
  requireBoundary({session,active,maintenance,id,token:process.env.DEPLOYMENT_LEASE_TOKEN,phase});
  const unit=path.join(coordination,`clamav-checkpoint-${id}`);
  const incident = process.env.DEPLOYMENT_CLAMAV_OPERATION === 'incident-recovery';
  if (incident) requireIncidentSession(session, process.env.DEPLOYMENT_CLAMAV_OPERATION, process.env.DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256);
  else if (session.clamavOperation === 'incident-recovery') fail('Incident operation cannot be downgraded to ordinary repair');
  if(process.argv[2]==='capture') {
   const evidence = incident ? 'incident-snapshot.json' : 'rollback-proof.json';
   const expected = incident ? process.env.DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256 : process.env.DEPLOYMENT_CLAMAV_ROLLBACK_PROOF_SHA256;
   if((await digest(path.join(unit,evidence))).sha256!==expected) fail('Original-instance evidence changed after preflight');
   await captureUnit({bank:'/app/recovery-sources/clamav',unit,id,image:process.env.DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE});
  } else if(process.argv[2]==='activate') {
    const checkpoint=JSON.parse(await fs.readFile(path.join(coordination,'deployment-checkpoint.json'),'utf8'));
    await verifyUnit({unit,id,checkpoint});
    const receipt=JSON.parse(await fs.readFile(path.join(unit,'target.json'),'utf8'));
    const actual=await digest(path.join(unit,'target-bank.tar'));
    if(receipt.image!==immutableImage(process.env.DEPLOYMENT_CLAMAV_TARGET_IMAGE) || receipt.bankSha256!==actual.sha256) fail('Target image/bank binding failed');
    await restoreUnit({bank:'/app/recovery-sources/clamav',unit,id,checkpoint,archive:'target-bank.tar',beforeMutation: async () => {
      const liveSession=JSON.parse(await fs.readFile(path.join(reports,'active-deployment-session.json'),'utf8'));
      const liveMaintenance=JSON.parse(await fs.readFile(path.join(coordination,'deployment-maintenance.json'),'utf8'));
      const liveActive=await prisma.deploymentOperation.findUnique({where:{activeKey:'production'}});
      requireBoundary({session:liveSession,active:liveActive,maintenance:liveMaintenance,id,token:process.env.DEPLOYMENT_LEASE_TOKEN,phase:'MUTATION_STARTED'});
      if (incident) requireIncidentSession(liveSession, process.env.DEPLOYMENT_CLAMAV_OPERATION, process.env.DEPLOYMENT_CLAMAV_INCIDENT_SNAPSHOT_SHA256);
    }});
  } else fail('Unsupported ClamAV checkpoint command');
  console.log(JSON.stringify({ok:true,unit:id}));
 } finally {await disconnectDatabase();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(error.message);process.exitCode=1;});
