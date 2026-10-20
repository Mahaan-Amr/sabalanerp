import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveTxt } from 'node:dns/promises';
import { pathToFileURL } from 'node:url';
import { immutableImage } from '../backend/scripts/clamav-checkpoint.mjs';
const exec=promisify(execFile);
const managedVerifier='managed-1.4.6-v1', nativeVerifier='native-1.4-daemon-v1';
export function validateNativeUpdater(sample,config,logs,versions,clamdConfig='') {
 const fail=()=>{throw new Error('Native rollback updater evidence is incomplete, stale or unsafe');};
 const options=text=>{
  const values=new Map();
  for(const raw of text.split(/\r?\n/)) {
   const line=raw.trim(); if(!line || line.startsWith('#'))continue;
   const match=line.match(/^(\S+)\s+(.+?)\s*$/); if(!match)fail();
   const key=match[1].toLowerCase();
   if(values.has(key))fail(); values.set(key,match[2]);
  }
  return values;
 };
 const settings=options(config), daemonSettings=options(clamdConfig);
 for(const values of [settings,daemonSettings]) {
  if(values.has('include') || (values.has('databasedirectory') && values.get('databasedirectory')!=='/var/lib/clamav'))fail();
 }
 if(settings.get('databasemirror')!=='database.clamav.net' || settings.get('notifyclamd')!=='/etc/clamav/clamd.conf' || settings.get('updatelogfile')!=='/var/log/clamav/freshclam.log'
  || ['privatemirror','databasecustomurl','httpproxyserver'].some(key=>settings.has(key))
  || ['testdatabases','scriptedupdates','bytecode'].some(key=>settings.has(key) && settings.get(key)!=='yes')
  || (settings.has('dnsdatabaseinfo') && settings.get('dnsdatabaseinfo')!=='current.cvd.clamav.net')
  || (settings.has('databaseowner') && settings.get('databaseowner')!=='clamav'))fail();
 if(!sample || ![sample.now,sample.uptime,sample.hz,sample.clamavUid].every(value=>Number.isFinite(value) && value>0)
  || sample.processes?.length!==2 || !/^[+-]\d{4}$/.test(sample.zoneOffset || ''))fail();
 let freshclam;
 for(const name of ['freshclam','clamd']) {
  const matches=sample.processes.filter(p=>p.name===name);
  if(matches.length!==1)fail();
  const p=matches[0];
  if(!Number.isSafeInteger(p.pid) || p.pid<=1 || p.uid!==sample.clamavUid || !/^[RSDI]$/.test(p.state)
   || !Number.isSafeInteger(p.startTicks) || p.startTicks<=0 || p.startTicks/sample.hz>sample.uptime)fail();
  const allowed=name==='freshclam'?[/^--checks=\d+$/,/^--daemon$/,/^--foreground$/,/^--stdout$/,/^--user=clamav$/]:[/^--foreground$/];
  if(!Array.isArray(p.args) || path.posix.basename(p.args[0] || '')!==name || p.args.slice(1).some(arg=>!allowed.some(pattern=>pattern.test(arg)))
   || new Set(p.args.slice(1)).size!==p.args.length-1 || !p.args.includes('--foreground'))fail();
  if(name==='freshclam') {
   if(!['--daemon','--stdout','--user=clamav'].every(arg=>p.args.includes(arg)) || p.args.filter(arg=>arg.startsWith('--checks=')).length!==1)fail();
   freshclam=p;
  }
 }
 const checks=Number(freshclam.args.find(arg=>arg.startsWith('--checks=')).slice(9));
 if(!Number.isInteger(checks) || checks<12 || checks>24)fail();
 const intervalSeconds=86400/checks;
 const started=sample.now-sample.uptime+freshclam.startTicks/sample.hz;
 let cycle=null;
 for(const line of logs.split(/\r?\n/)) {
  if(!line.trim())continue;
  const match=line.match(/^(\S+)\s+(.*)$/); if(!match)fail();
  const at=Date.parse(match[1])/1000; if(!Number.isFinite(at))fail();
  if(/^ClamAV update process started at /.test(match[2]))cycle={at,lines:[]};
  if(cycle)cycle.lines.push({at,text:match[2]});
 }
 if(!cycle || cycle.at<started-2 || cycle.at>sample.now+2 || sample.now-cycle.at>intervalSeconds*2
  || cycle.lines.some(line=>line.at<cycle.at || line.at>sample.now+2 || /cool.?down|rate.?limit|blocked|ERROR:|HTTP[^0-9]*(429|403)/i.test(line.text)))fail();
 const headerTime=Date.parse(cycle.lines[0].text.slice('ClamAV update process started at '.length)+' '+sample.zoneOffset)/1000;
 if(!Number.isFinite(headerTime) || Math.abs(headerTime-cycle.at)>2)fail();
 // Correlate stdout with FreshClam's own regular-file log. Scanner file names
 // must not be able to forge update evidence in the shared container output.
 let dedicated=null;
 for(const raw of String(sample.updaterLog || '').split(/\r?\n/)) {
  const line=raw.replace(/^[A-Z][a-z]{2} [A-Z][a-z]{2}\s+\d+ \d\d:\d\d:\d\d \d{4} -> /,'');
  if(/^ClamAV update process started at /.test(line))dedicated=[];
  if(dedicated)dedicated.push(line);
 }
 if(!dedicated || dedicated[0]!==cycle.lines[0].text || dedicated.some(line=>/cool.?down|rate.?limit|blocked|ERROR:|HTTP[^0-9]*(429|403)/i.test(line)))fail();
 for(const name of ['main','daily','bytecode']) {
  const successes=cycle.lines.map(line=>line.text.match(new RegExp('(^|\\s)'+name+'[.](cvd|cld) (database is up-to-date|updated) \\(version: (\\d+)[,)]'))).filter(Boolean);
  if(!successes.length || successes.some(match=>Number(match[4])!==versions[name]) || !dedicated.some(line=>cycle.lines.some(observed=>observed.text===line && new RegExp('^'+name+'[.](cvd|cld) ').test(line))))fail();
 }
 return {runtimeVerifier:nativeVerifier,intervalSeconds,lastSuccessfulCycle:new Date(cycle.at*1000).toISOString(),pid:freshclam.pid,startTicks:freshclam.startTicks};
}
export async function publishedVersions(resolve=resolveTxt) {
 const text=(await resolve('current.cvd.clamav.net')).map(parts=>parts.join(''));
 if(text.length!==1) throw new Error('Ambiguous ClamAV DNS response');
 const fields=text[0].split(':');
 // Official record schema: Cisco-Talos cvdupdate default_state DNS field indices.
 const versions={main:Number(fields[1]),daily:Number(fields[2]),bytecode:Number(fields[7])};
 if(Object.values(versions).some(value=>!Number.isSafeInteger(value)||value<=0)) throw new Error('Invalid published database versions');
 return versions;
}
export function validateRepairPaths(files) {
 const allowed=new Set(['backend/Dockerfile','backend/package.json','package.json','docker-compose.prod.yml','docker-compose.local.yml','deploy/scripts/deploy.sh','backend/src/scripts/deployment-checkpoint.ts','backend/src/scripts/deployment-rollback.ts','backend/scripts/clamav-checkpoint.mjs','backend/scripts/clamav-checkpoint.d.mts','scripts/clamav-release-readiness.mjs','docs/operations/clamav-repair.md']);
 for(const file of files) if(!allowed.has(file) && !/^deploy\/clamav\/[a-zA-Z0-9_.-]+$/.test(file) && !/^tests\/clamav-repair\/[a-zA-Z0-9_.-]+$/.test(file)) throw new Error('ClamAV maintenance release contains unrelated source or migrations');
}
export function validateRepairPackage(previousValue,targetValue,file) {
 const previous=structuredClone(previousValue), target=structuredClone(targetValue);
 const commands={
  'test:clamav-repair':'node --test tests/clamav-repair/health.test.mjs tests/clamav-repair/checkpoint.test.mjs tests/clamav-repair/readiness.test.mjs tests/clamav-repair/controller.test.mjs',
  'test:clamav-repair:docker':'node --test tests/clamav-repair/updater-linux.test.mjs',
  'test:clamav-repair:lifecycle:docker':'node --test tests/clamav-repair/lifecycle-linux.test.mjs',
  'test:clamav-repair:restore:docker':'node --test tests/clamav-repair/restore-linux.test.mjs',
 };
 if(file==='backend/package.json') {
  const original=previous.scripts?.['test:deployment-control'];
  const next=target.scripts?.['test:deployment-control'];
  if(next!==original && (!original || next!==original+' && npm --prefix .. run test:clamav-repair')) throw new Error('Repair must preserve every existing deployment test');
  if(previous.scripts)delete previous.scripts['test:deployment-control'];
  if(target.scripts)delete target.scripts['test:deployment-control'];
 } else if(file==='package.json') {
  for(const value of [previous,target]) for(const key of Object.keys(value.scripts || {})) if(key.startsWith('test:clamav-repair')) {
   if(value.scripts[key]!==commands[key]) throw new Error('Unreviewed ClamAV test command');
   delete value.scripts[key];
  }
 }
 if(JSON.stringify(previous)!==JSON.stringify(target)) throw new Error('Repair changes dependencies or unrelated commands');
}
async function verifyRepairScope(base) {
 const identity=JSON.parse(process.env.DEPLOYMENT_PREVIOUS_PERFORMANCE_ENVIRONMENT || '{}');
 if(!/^[a-f0-9]{40}$/.test(base || '') || identity.PERFORMANCE_RELEASE_COMMIT!==base) throw new Error('Repair base must match the proven running release identity');
 const files=(await exec('git',['diff','--name-only',base,'HEAD'])).stdout.trim().split('\n').filter(Boolean);
 validateRepairPaths(files);
 for(const file of ['package.json','backend/package.json']) {
  const previous=JSON.parse((await exec('git',['show',`${base}:${file}`])).stdout);
  const target=JSON.parse(await fs.readFile(file,'utf8'));
  validateRepairPackage(previous,target,file);
 }
}
export async function fileDigest(file) { const hash=crypto.createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
export function validateReceipt(value,image,versions,now=Date.now()) {
 immutableImage(image);
 if(value?.image!==image || value.engine!=='1.4.6' || value.updaterHealthy!==true || value.signatureVerified!==true || value.loadVerified!==true || value.eicarRejected!==true
  || value.loadedDaily!==versions.daily
  || !Number.isFinite(Date.parse(value.checkedAt)) || now-Date.parse(value.checkedAt)<0 || now-Date.parse(value.checkedAt)>24*3600000
  || ['main','daily','bytecode'].some(name=>value.versions?.[name]!==versions[name])) throw new Error('ClamAV readiness is missing, stale or does not match the image and published signatures');
 return value;
}
export function validateRollbackProof(value,image,versions,now=Date.now()) {
 immutableImage(image);
 const families=['main','daily','bytecode'];
 const verifier=value?.runtimeVerifier || managedVerifier;
 // Native rollback has its own strict read-only verifier; target promotion stays managed-only.
 if(value?.image!==image || !((value.engine==='1.4.6' && verifier===managedVerifier) || (/^1\.4\.(5|6)$/.test(value.engine || '') && verifier===nativeVerifier && value.bankFiles?.['main.cvd']))
  || !Number.isFinite(Date.parse(value.checkedAt)) || now-Date.parse(value.checkedAt)<0 || now-Date.parse(value.checkedAt)>24*3600000
  || ['restoreRehearsalPassed','fullReleaseRehearsalPassed','updaterHealthy','scannerClean','eicarRejected'].some(key=>value[key]!==true)
  || families.some(name=>value.versions?.[name]!==versions[name]) || !/^[a-f0-9]{64}$/.test(value.configArchiveSha256 || '')
  || Object.keys(value.bankFiles || {}).length!==3
  || families.some(name=>Object.entries(value.bankFiles || {}).filter(([file,hash])=>new RegExp('^'+name+'[.](cvd|cld)$').test(file) && /^[a-f0-9]{64}$/.test(hash)).length!==1)) throw new Error('A rehearsed current rollback image, bank and configuration are required before maintenance');
 return value;
}
async function inspectBank(container,inspect,run,execute) {
 if(!inspect.State.Running) throw new Error('Candidate is not running');
 const image=immutableImage(inspect.Image);
 const engine=(await run(['exec',container,'freshclam','--version'])).match(/^ClamAV ([0-9.]+)/)?.[1];
 const versions={};
 for(const name of ['main','daily','bytecode']) {
   // FreshClam can replace cvd by cld; require exactly one readable signed database per family.
   const info=await run(['exec',container,'sh','-ec',`set -- /var/lib/clamav/${name}.c[vl]d; test "$#" -eq 1; test -f "$1"; sigtool --info "$1"`]);
   if(!/Verification OK/.test(info)) throw new Error('Signature verification failed');
   versions[name]=Number(info.match(/^Version: (\d+)/m)?.[1]);
 }
 const loaded=(await run(['exec',container,'clamdscan','--version'])).match(/^ClamAV ([0-9.]+)\/(\d+)/);
 if(loaded?.[1]!==engine || Number(loaded?.[2])!==versions.daily) throw new Error('Daemon has not loaded the verified current database');
 // A real scan checks that the target engine loaded the bank; health checks the successful update cycle.
 await run(['exec',container,'clamdscan','--no-summary','/etc/hosts']);
 // Stream the standard fixture, without creating a file in the inspected container.
 const eicar=String.raw`printf '%s' 'X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' | clamdscan --stream --no-summary -`;
 let detected=false;
 try {await execute('docker',['exec',container,'sh','-ec',eicar],{maxBuffer:4*1024*1024});}
 catch(error){if(Number(error.code)===1 && /Eicar[^\n]*FOUND/i.test(String(error.stdout)+String(error.stderr)))detected=true;else throw error;}
 if(!detected)throw new Error('Scanner did not reject the streamed EICAR fixture');
 return {checkedAt:new Date().toISOString(),image,engine,versions,loadedDaily:Number(loaded[2]),updaterHealthy:true,signatureVerified:true,loadVerified:true,eicarRejected:true};
}
export async function inspectCandidate(container,execute=exec,resolve=resolveTxt) {
 // A caller prepares an inactive candidate under separate authorization. This command only inspects it.
 const run=async(args)=> (await execute('docker',args,{maxBuffer:4*1024*1024})).stdout.trim();
 const inspect=JSON.parse(await run(['inspect',container]))[0];
 if(!inspect.State.Running)throw new Error('Candidate is not running');
 await run(['exec',container,'/usr/local/bin/sabalan-clamav-health']);
 const value=await inspectBank(container,inspect,run,execute);
 return validateReceipt(value,value.image,await publishedVersions(resolve));
}
export function parseNativeProbe(text) {
 const lines=text.trim().split('\n').map(line=>line.split('\t'));
 const header=lines.shift();
 if(header?.[0]!=='CLOCK' || header.length!==6)throw new Error('Invalid native process probe');
 const processes=lines.map(fields=>{
  if(fields[0]!=='PROCESS' || fields.length!==7)throw new Error('Invalid native process record');
  const name=fields[1], args=Buffer.from(fields[6],'base64').toString().split('\0').filter(Boolean);
  // QEMU user-mode may prepend its executable and the guest binary; keep the actual argv.
  const start=args.findLastIndex(arg=>path.posix.basename(arg)===name);
  return {name,pid:Number(fields[2]),uid:Number(fields[3]),state:fields[4],startTicks:Number(fields[5]),args:start>=0?args.slice(start):[]};
 });
 return {now:Number(header[1]),uptime:Number(header[2]),hz:Number(header[3]),clamavUid:Number(header[4]),zoneOffset:header[5],processes};
}
export async function inspectRollback(container,proof,execute=exec,resolve=resolveTxt) {
 const published=await publishedVersions(resolve);
 validateRollbackProof(proof,proof.image,published);
 const run=async(args)=> (await execute('docker',args,{maxBuffer:4*1024*1024})).stdout.trim();
 const before=JSON.parse(await run(['inspect',container]))[0];
 if(!before.State.Running || before.Image!==proof.image)throw new Error('Running rollback image differs from its reviewed proof');
 const verifier=proof.runtimeVerifier || managedVerifier;
 const probe=await fs.readFile(new URL('../deploy/clamav/inspect-native.sh',import.meta.url),'utf8');
 const snapshot=async()=>parseNativeProbe(await run(['exec',container,'sh','-ec',probe]));
 const nativeEvidence=async()=>{
  const sample=await snapshot();
  const config=await run(['exec',container,'cat','/etc/clamav/freshclam.conf']);
  const daemonConfig=await run(['exec',container,'cat','/etc/clamav/clamd.conf']);
  sample.updaterLog=await run(['exec',container,'sh','-ec','test -f /var/log/clamav/freshclam.log; test ! -L /var/log/clamav/freshclam.log; tail -c 4194304 /var/log/clamav/freshclam.log']);
  const result=await execute('docker',['logs','--timestamps','--since',new Date((sample.now-14400)*1000).toISOString(),'--tail','20000',container],{maxBuffer:4*1024*1024});
  const logs=(String(result.stdout)+'\n'+String(result.stderr || '')).split('\n').filter(Boolean).sort((a,b)=>Date.parse(a.split(' ')[0])-Date.parse(b.split(' ')[0])).join('\n');
  return {sample,evidence:validateNativeUpdater(sample,config,logs,published,daemonConfig)};
 };
 let native, first;
 if(verifier===nativeVerifier) {
  const result=await nativeEvidence(); first=result.sample; native=result.evidence;
 } else await run(['exec',container,'/usr/local/bin/sabalan-clamav-health']);
 const fingerprints=async()=>{
  const hashes={};
  for(const file of Object.keys(proof.bankFiles))hashes[file]=(await run(['exec',container,'sha256sum','/var/lib/clamav/'+file])).split(/\s/)[0];
  const archive=await execute('docker',['cp',`${container}:/etc/clamav/.`,'-'],{encoding:'buffer',maxBuffer:4*1024*1024});
  if(crypto.createHash('sha256').update(archive.stdout).digest('hex')!==proof.configArchiveSha256 || Object.entries(proof.bankFiles).some(([file,expected])=>hashes[file]!==expected))throw new Error('Rollback bank or effective configuration differs from its reviewed proof');
  return hashes;
 };
 await fingerprints();
 const value=await inspectBank(container,before,run,execute);
 if(value.engine!==proof.engine || ['main','daily','bytecode'].some(name=>value.versions[name]!==published[name]))throw new Error('Rollback engine or verified bank is not current');
 await fingerprints();
 const after=JSON.parse(await run(['inspect',container]))[0];
 if(!after.State.Running || after.Id!==before.Id || after.Image!==before.Image || after.State.StartedAt!==before.State.StartedAt)throw new Error('Rollback container restarted during qualification');
 if(native) {
  const result=await nativeEvidence(), last=result.sample;
  const signature=p=>p.processes.map(({name,pid,uid,startTicks,args})=>({name,pid,uid,startTicks,args})).sort((a,b)=>a.pid-b.pid);
  if(last.processes.some(p=>!/^[RSDI]$/.test(p.state)) || JSON.stringify(signature(first))!==JSON.stringify(signature(last)))throw new Error('Native daemon changed during qualification');
  native=result.evidence;
 } else await run(['exec',container,'/usr/local/bin/sabalan-clamav-health']);
 return {...value,runtimeVerifier:verifier,configAndBankMatched:true,...(native?{nativeUpdater:native}:{})};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 const [command,input,image]=process.argv.slice(2);
 try {
  if(command==='scope') await verifyRepairScope(input);
  else if(command==='inspect') process.stdout.write(JSON.stringify(await inspectCandidate(input),null,2)+'\n');
  else if(command==='inspect-rollback') process.stdout.write(JSON.stringify(await inspectRollback(input,JSON.parse(await fs.readFile(image,'utf8'))),null,2)+'\n');
  else if(command==='export') {
   const receipt=await inspectCandidate(input);
   await fs.mkdir(image,{recursive:true,mode:0o700});
   const temporary=`/tmp/sabalan-clamav-candidate-${crypto.randomBytes(12).toString('hex')}.tar`;
   try {
    await exec('docker',['exec',input,'flock','/var/lib/clamav/.sabalan-updater.lock','tar','-cpf',temporary,'-C','/var/lib/clamav','.']);
    const bank=path.join(image,'target-bank.tar');
    await exec('docker',['cp',`${input}:${temporary}`,bank]);
    const after=await inspectCandidate(input);
    if(JSON.stringify(receipt.versions)!==JSON.stringify(after.versions)) throw new Error('Bank changed while preparing candidate; review without a forced update');
    await fs.writeFile(path.join(image,'target.json'),JSON.stringify({...after,bankSha256:await fileDigest(bank)},null,2)+'\n',{mode:0o600,flag:'wx'});
   } finally {await exec('docker',['exec',input,'rm','-f',temporary]);}
  }
  else if(command==='rollback-proof') validateRollbackProof(JSON.parse(await fs.readFile(input,'utf8')),image,await publishedVersions());
  else if(command==='verify') {
   const receipt=validateReceipt(JSON.parse(await fs.readFile(input,'utf8')),image,await publishedVersions());
   if(receipt.bankSha256!==await fileDigest(path.join(path.dirname(input),'target-bank.tar'))) throw new Error('Prepared signature bank checksum mismatch');
  }
  else throw new Error('Use inspect/export <inactive-container> [output-directory] or verify <receipt> <immutable-image>');
 } catch(error){console.error(error.message);process.exitCode=1;}
}
