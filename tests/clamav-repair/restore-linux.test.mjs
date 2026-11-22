import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const cwd=new URL('../../',import.meta.url).pathname;
const docker=(...args)=>execFileSync('docker',args,{cwd,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024}).trim();
const av='sabalanerp-local-clamav-1', backend='sabalanerp-local-backend-1';

test('a real encrypted bank can reconstruct lost coordination files and scan after isolated restore',{timeout:360000},async()=>{
 assert.match(docker('compose','-f','docker-compose.local.yml','ps'),/sabalanerp-local-clamav-1/);
 docker('exec',av,'clamdscan','--ping=1');
 const host=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-bank-rehearsal-'));
 const job='/tmp/sabalan-bank-rehearsal-'+path.basename(host);
 const state=()=>docker('exec',av,'sh','-ec','sha256sum /var/lib/clamav/freshclam.dat /var/lib/clamav/.sabalan-updater-state');
 const before=state();
 try {
  docker('exec',av,'mkdir','-m','700',job);
  docker('exec',backend,'mkdir','-m','700',job);
  docker('exec',av,'flock','/var/lib/clamav/.sabalan-updater.lock','tar','-cpf',job+'/bank.tar','-C','/var/lib/clamav','.');
  docker('cp',av+':'+job+'/bank.tar',host+'/bank.tar');
  docker('cp',host+'/bank.tar',backend+':'+job+'/bank.tar');
  docker('cp',path.join(cwd,'backend/scripts/clamav-checkpoint.mjs'),backend+':'+job+'/checkpoint.mjs');
  const runner=String.raw`
   const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
   const {execFileSync}=require('node:child_process');
   const {encryptRecoveryArchive,decryptRecoveryArchive}=require('/app/dist/services/recoveryCrypto');
   (async()=>{
    const job=process.argv[1], {captureUnit,recoverUnit,restoreUnit}=await import(job+'/checkpoint.mjs');
    const bank=job+'/bank', payload=job+'/payload',unit=payload+'/recovery-coordination/clamav-checkpoint-local';
    fs.mkdirSync(bank);fs.mkdirSync(unit,{recursive:true});
    execFileSync('tar',['-xpf',job+'/bank.tar','-C',bank]);
    fs.writeFileSync(unit+'/config.tar','isolated configuration fixture; no live configuration restored');
    const metadata=await captureUnit({bank,unit,id:'local',image:'sha256:'+'a'.repeat(64)});
    const components=fs.readdirSync(unit).map(file=>{const value=fs.readFileSync(unit+'/'+file);return {path:'recovery-coordination/clamav-checkpoint-local/'+file,sha256:crypto.createHash('sha256').update(value).digest('hex'),size:value.length};});
    const checkpoint={deploymentId:'local',localVerified:true,remoteVerified:true,rollbackReleaseSet:{clamav:metadata.image},manifest:{components}};
    execFileSync('tar',['-czf',job+'/payload.tar.gz','-C',payload,'.']);
    const secret=crypto.randomBytes(32).toString('hex');
    await encryptRecoveryArchive(job+'/payload.tar.gz',job+'/checkpoint.sabrec',secret);
    fs.rmSync(payload,{recursive:true});fs.rmSync(job+'/payload.tar.gz');
    fs.rmSync(bank,{recursive:true});fs.mkdirSync(bank);
    await recoverUnit({unit:job+'/reconstructed',id:'local',checkpoint,readArchive:destination=>decryptRecoveryArchive(job+'/checkpoint.sabrec',destination,secret)});
    await restoreUnit({bank,unit:job+'/reconstructed',id:'local',checkpoint});
    // The complete real bank is compared, including native cooldown and scheduler state.
    const original=job+'/original';fs.mkdirSync(original);execFileSync('tar',['-xpf',job+'/bank.tar','-C',original]);
    const fingerprint=root=>fs.readdirSync(root).sort().map(file=>{const p=root+'/'+file,s=fs.statSync(p);return [file,s.mode&511,s.uid,s.gid,s.isFile()?crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'):'directory'];});
    assert.deepEqual(fingerprint(bank),fingerprint(original));
    execFileSync('tar',['-cpf',job+'/restored.tar','-C',bank,'.']);
    console.log(JSON.stringify({encryptedRoundTrip:true,lostCoordinationRecovered:true,realBankOwnershipAndContentsPreserved:true,fullReleaseRehearsal:false,remoteStoreExercised:false}));
   })().catch(error=>{console.error(error);process.exitCode=1;});`;
  const result=docker('exec',backend,'node','-e',runner,job);
  assert.equal(JSON.parse(result).realBankOwnershipAndContentsPreserved,true);
  docker('cp',backend+':'+job+'/restored.tar',host+'/restored.tar');
  docker('cp',host+'/restored.tar',av+':'+job+'/restored.tar');
  docker('exec',av,'sh','-ec',`mkdir '${job}/bank'; tar -xpf '${job}/restored.tar' -C '${job}/bank'`);
  // No FreshClam call, schedule reset, or live-bank replacement. One offline load
  // exercises restored signatures alongside the actual running scanner.
  const scan=docker('exec',av,'sh','-ec',`
   printf '%s' 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > '${job}/eicar';
   cat /sys/fs/cgroup/memory.events > '${job}/events-before';
   base=$(cat /sys/fs/cgroup/memory.current); peak=$base; anon_peak=0;
   (set +e; clamscan --database='${job}/bank' --no-summary /etc/hosts '${job}/eicar' > '${job}/scan.log' 2>&1; echo $? > '${job}/scan.exit') & scan_pid=$!;
   while kill -0 "$scan_pid" 2>/dev/null; do current=$(cat /sys/fs/cgroup/memory.current); [ "$current" -le "$peak" ] || peak=$current; anon=$(awk '$1 == "anon" {print $2}' /sys/fs/cgroup/memory.stat); [ "$anon" -le "$anon_peak" ] || anon_peak=$anon; sleep .1; done;
   wait "$scan_pid";
   test "$(cat '${job}/scan.exit')" = 1;
   grep -q '/etc/hosts: OK' '${job}/scan.log'; grep -q 'Eicar.*FOUND' '${job}/scan.log';
   echo "BASE_BYTES=$base PEAK_BYTES=$peak ANON_PEAK_BYTES=$anon_peak LIMIT_BYTES=$(cat /sys/fs/cgroup/memory.max)";
   echo MEMORY_EVENTS_BEFORE; cat '${job}/events-before'; echo MEMORY_EVENTS_AFTER; cat /sys/fs/cgroup/memory.events;
   cat '${job}/scan.log';
   # The kernel may reclaim file cache at memory.max without an allocation failure.
   # Fail on OOM/kill changes; report max/reclaim pressure without calling it headroom proof.
   awk '$1 ~ /^oom/ {print}' '${job}/events-before' > '${job}/oom-before';
   awk '$1 ~ /^oom/ {print}' /sys/fs/cgroup/memory.events > '${job}/oom-after';
   cmp '${job}/oom-before' '${job}/oom-after';
   clamdscan --ping=1 >/dev/null;
  `);
  assert.match(scan,/Eicar.*FOUND/);
  const memory=scan.match(/ANON_PEAK_BYTES=(\d+) LIMIT_BYTES=(\d+)/);
  assert.ok(memory,'the real load must report measured memory evidence');
  assert.ok(Number(memory[1])<=Number(memory[2])*0.8,'the tested bank needs at least 20% anonymous-memory reserve; increase local capacity and retest, never disable database tests');
  assert.equal(state(),before,'native cooldown and updater schedule must remain unchanged');
  console.log(result);console.log(scan);
 } finally {
  for(const container of [av,backend]){try{docker('exec',container,'rm','-rf',job);}catch(error){console.error('QA cleanup failed for '+container);throw error;}}
  fs.rmSync(host,{recursive:true,force:true});
 }
});
