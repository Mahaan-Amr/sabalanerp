import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedVersions,validateReceipt} from '../../scripts/clamav-release-readiness.mjs';
test('a bundled bank, old evidence or a mismatched target cannot authorize maintenance',async()=>{
 const versions=await publishedVersions(async()=>[['1.4.6:62:100:1:1:1:99999:339']]);
 assert.deepEqual(versions,{main:62,daily:100,bytecode:339});
 const image='sha256:'+'a'.repeat(64);
 const good={image,checkedAt:new Date().toISOString(),engine:'1.4.6',versions,loadedDaily:100,updaterHealthy:true,signatureVerified:true,loadVerified:true,eicarRejected:true};
 assert.equal(validateReceipt(good,image,versions),good);
 for(const patch of [{versions:{...versions,daily:99}},{updaterHealthy:false},{eicarRejected:false},{signatureVerified:false},{signatureVerified:'yes'},{loadVerified:'yes'},{loadedDaily:99},{checkedAt:'2000-01-01'},{image:'sha256:'+'b'.repeat(64)}]) assert.throws(()=>validateReceipt({...good,...patch},image,versions));
});

test('a maintenance-only repair refuses personnel code and schema changes',async()=>{
 const {validateRepairPaths}=await import('../../scripts/clamav-release-readiness.mjs');
 assert.doesNotThrow(()=>validateRepairPaths(['deploy/clamav/health.sh','backend/src/scripts/deployment-checkpoint.ts']));
 for(const file of ['backend/prisma/migrations/new/migration.sql','backend/src/routes/security.ts','frontend/src/app/page.tsx']) assert.throws(()=>validateRepairPaths([file]));
});

test('real official eight-field DNS record reads bytecode from its documented field',async()=>{
 // Cisco-Talos cvdupdate default_state: main=1, daily=2, bytecode=7.
 const actual=await publishedVersions(async()=>[['1.4.6:63:28157:1792389600:1:90:49192:339']]);
 assert.deepEqual(actual,{main:63,daily:28157,bytecode:339});
});

test('maintenance cannot begin without a rehearsed current rollback pair',async()=>{
 const {validateRollbackProof}=await import('../../scripts/clamav-release-readiness.mjs');
 const versions={main:63,daily:28157,bytecode:339}, image='sha256:'+'a'.repeat(64);
 const value={image,engine:'1.4.6',checkedAt:new Date().toISOString(),versions,restoreRehearsalPassed:true,fullReleaseRehearsalPassed:true,updaterHealthy:true,scannerClean:true,eicarRejected:true,configArchiveSha256:'b'.repeat(64),bankFiles:{'main.cvd':'c'.repeat(64),'daily.cvd':'d'.repeat(64),'bytecode.cvd':'e'.repeat(64)}};
 assert.doesNotThrow(()=>validateRollbackProof(value,image,versions));
 for(const patch of [{engine:'1.4.5'},{restoreRehearsalPassed:false},{fullReleaseRehearsalPassed:false},{versions:{...versions,daily:28150}},{image:'latest'},{bankFiles:{}}])assert.throws(()=>validateRollbackProof({...value,...patch},image,versions));
});

test('maintenance package changes cannot replace deployment gates or hide arbitrary test commands',async()=>{
 const {validateRepairPackage}=await import('../../scripts/clamav-release-readiness.mjs');
 const previous={scripts:{'test:deployment-control':'existing required gates',build:'tsc'},dependencies:{stable:'1'}};
 const target=structuredClone(previous);
 target.scripts['test:deployment-control']+=' && npm --prefix .. run test:clamav-repair';
 assert.doesNotThrow(()=>validateRepairPackage(previous,target,'backend/package.json'));
 target.scripts['test:deployment-control']='echo tests skipped';
 assert.throws(()=>validateRepairPackage(previous,target,'backend/package.json'),/preserve/);
 assert.throws(()=>validateRepairPackage({scripts:{}},{scripts:{'test:clamav-repair:hidden':'echo skipped'}},'package.json'),/Unreviewed/);
 assert.throws(()=>validateRepairPackage(previous,{...previous,dependencies:{stable:'2'}},'backend/package.json'),/dependencies/);
});

test('a native legacy rollback requires a live unprivileged daemon and its own recent complete update cycle',async()=>{
 const {validateNativeUpdater}=await import('../../scripts/clamav-release-readiness.mjs');
 const now=Date.now(),versions={main:63,daily:28157,bytecode:339};
 const process=(name,pid)=>({name,pid,state:'S',uid:100,startTicks:9990000,args:name==='freshclam'?['freshclam','--checks=12','--daemon','--foreground','--stdout','--user=clamav']:['clamd','--foreground']});
 const sample={now:now/1000,uptime:100000,hz:100,clamavUid:100,zoneOffset:'+0000',processes:[process('freshclam',12),process('clamd',13)]};
 const config='UpdateLogFile /var/log/clamav/freshclam.log\nDatabaseMirror database.clamav.net\nNotifyClamd /etc/clamav/clamd.conf\nDatabaseOwner clamav\n';
 const stamp=(seconds,text)=>new Date(now-seconds*1000).toISOString()+' '+text;
 const logs=[stamp(90,'ClamAV update process started at '+new Date(now-90000).toUTCString().replace(' GMT','')),...Object.entries(versions).map(([name,version],i)=>stamp(89-i,`${name}.cvd database is up-to-date (version: ${version}, sigs: 100)`))].join('\n');
 sample.updaterLog=logs.split('\n').map(line=>line.slice(line.indexOf(' ')+1)).join('\n');
 assert.equal(validateNativeUpdater(sample,config,logs,versions).intervalSeconds,7200);
 for(const patch of [{processes:[]},{processes:[{...process('freshclam',12),state:'Z'},process('clamd',13)]},{processes:[{...process('freshclam',12),uid:0},process('clamd',13)]},{processes:[process('freshclam',12),process('freshclam',14),process('clamd',13)]},{processes:[{...process('freshclam',12),startTicks:9999500},process('clamd',13)]}])assert.throws(()=>validateNativeUpdater({...sample,...patch},config,logs,versions));
 for(const extra of ['TestDatabases no','PrivateMirror untrusted.test','DatabaseDirectory /other','DatabaseMirror untrusted.test','NotifyClamd /other','Include /other.conf'])assert.throws(()=>validateNativeUpdater(sample,config+extra+'\n',logs,versions));
 for(const extra of [stamp(1,'ERROR: download failed'),stamp(1,'WARNING: cooldown'),stamp(1,'ClamAV update process started at now')])assert.throws(()=>validateNativeUpdater(sample,config,logs+'\n'+extra,versions));
 assert.throws(()=>validateNativeUpdater(sample,config,logs.replace('version: 28157','version: 28150'),versions));
 assert.throws(()=>validateNativeUpdater({...sample,updaterLog:'forged stdout has no dedicated evidence'},config,logs,versions));
 assert.throws(()=>validateNativeUpdater(sample,config,logs.split('\n').filter(line=>!line.includes('main.cvd')).join('\n'),versions));
});

function nativeFixture() {
 const now=Date.now(),versions={main:63,daily:28157,bytecode:339},image='sha256:'+'a'.repeat(64), configArchive=Buffer.from('effective-config-fixture');
 const config='UpdateLogFile /var/log/clamav/freshclam.log\nDatabaseMirror database.clamav.net\nNotifyClamd /etc/clamav/clamd.conf\nDatabaseOwner clamav\n';
 const args=['freshclam','--checks=12','--daemon','--foreground','--stdout','--user=clamav'];
 const encode=a=>Buffer.from(a.join('\0')+'\0').toString('base64');
 const probe=`CLOCK\t${now/1000}\t100000\t100\t100\t+0000\nPROCESS\tfreshclam\t12\t100\tS\t9990000\t${encode(args)}\nPROCESS\tclamd\t13\t100\tS\t9990000\t${encode(['clamd','--foreground'])}\n`;
 const logs=[`${new Date(now-90000).toISOString()} ClamAV update process started at ${new Date(now-90000).toUTCString().replace(' GMT','')}`,...Object.entries(versions).map(([name,version],i)=>`${new Date(now-(89-i)*1000).toISOString()} ${name}.cvd database is up-to-date (version: ${version}, sigs: 100)`) ].join('\n');
 // Synthetic qualification evidence only; never saved as a deployable rehearsal proof.
 const proof={image,engine:'1.4.5',runtimeVerifier:'native-1.4-daemon-v1',checkedAt:new Date(now).toISOString(),versions,restoreRehearsalPassed:true,fullReleaseRehearsalPassed:true,updaterHealthy:true,scannerClean:true,eicarRejected:true,configArchiveSha256:null,bankFiles:{'main.cvd':'b'.repeat(64),'daily.cvd':'c'.repeat(64),'bytecode.cvd':'d'.repeat(64)}};
 const calls=[], mode={};let inspections=0,logReads=0;
 const execute=async(command,a)=>{
  assert.equal(command,'docker');calls.push(a);
  const result=stdout=>({stdout,stderr:''});
  if(a[0]==='inspect'){inspections++;return result(JSON.stringify([{Id:'fixture-container',Image:mode.image || image,State:{Running:true,StartedAt:mode.restart && inspections>1?'changed':'stable'}}]));}
  if(a[0]==='cp'){assert.equal(a.at(-1),'-');return result(mode.configChanged?Buffer.from('changed'):configArchive);}
  if(a[0]==='logs'){logReads++;return result(mode.lateFailure&&logReads>1?logs+'\n'+new Date().toISOString()+' ERROR: updater failed after first probe':mode.log || logs);}
  assert.equal(a[0],'exec');
  const program=a[2];
  if(program==='/usr/local/bin/sabalan-clamav-health')return result('');
  if(program==='cat')return result(a.at(-1).endsWith('freshclam.conf')?config:'DatabaseDirectory /var/lib/clamav\n');
  if(program==='sha256sum')return result((mode.bankChanged?'0'.repeat(64):proof.bankFiles[a.at(-1).split('/').at(-1)])+'  bank');
  if(program==='freshclam'){assert.deepEqual(a.slice(2),['freshclam','--version']);return result('ClamAV 1.4.5/28157/date');}
  if(program==='clamdscan')return result(a.includes('--version')?'ClamAV 1.4.5/28157/date':'/etc/hosts: OK');
  assert.equal(program,'sh');
  if(a.at(-1).includes('getconf CLK_TCK'))return result(mode.probe || probe);
  if(a.at(-1).includes('tail -c 4194304'))return result(mode.dedicated || logs.split('\n').map(line=>line.slice(line.indexOf(' ')+1)).join('\n'));
  if(a.at(-1).includes('sigtool --info')){const name=a.at(-1).match(/clamav\/(main|daily|bytecode)/)[1];return result(`Version: ${versions[name]}\nVerification OK`);}
  if(a.at(-1).includes('EICAR-STANDARD')){if(mode.eicarClean)return result('stdin: OK');throw Object.assign(new Error('Expected detection'),{code:1,stdout:'stdin: Eicar-Test-Signature FOUND',stderr:''});}
  throw Error('Unexpected inspector operation: '+JSON.stringify(a));
 };
 return {proof,execute,mode,calls,probe,logs,configArchive,resolve:async()=>[['1.4.6:63:28157:1792389600:1:90:49192:339']]};
}

test('the actual rollback inspection path admits a verified native daemon without admitting it as the new target',async()=>{
 const {inspectRollback,inspectCandidate}=await import('../../scripts/clamav-release-readiness.mjs');
 const {createHash}=await import('node:crypto');
 const f=nativeFixture();f.proof.configArchiveSha256=createHash('sha256').update(f.configArchive).digest('hex');
 const value=await inspectRollback('fixture',f.proof,f.execute,f.resolve);
 assert.equal(value.runtimeVerifier,'native-1.4-daemon-v1');assert.equal(value.eicarRejected,true);assert.equal(value.configAndBankMatched,true);
 assert.equal(f.calls.some(a=>a.includes('/usr/local/bin/sabalan-clamav-health')),false,'native path must prove its real updater rather than assume the managed helper exists');
 assert.equal(f.calls.some(a=>a.includes('freshclam')&&!a.includes('--version')),false,'inspection must never invoke an update');
 await assert.rejects(()=>inspectCandidate('fixture',f.execute,f.resolve),/readiness/,'legacy qualification must not permit target promotion');
});

test('rollback inspection refuses dead workers, cooldown, altered bindings, scanner false-clean and mid-check restarts',async()=>{
 const {inspectRollback}=await import('../../scripts/clamav-release-readiness.mjs');const {createHash}=await import('node:crypto');
 for(const kind of ['zombie','cooldown','configChanged','bankChanged','eicarClean','restart','image','lateFailure']) {
  const f=nativeFixture();f.proof.configArchiveSha256=createHash('sha256').update(f.configArchive).digest('hex');
  if(kind==='zombie')f.mode.probe=f.probe.replace('\tS\t9990000','\tZ\t9990000');
  else if(kind==='cooldown')f.mode.log=f.logs+'\n'+new Date().toISOString()+' WARNING: cooldown';
  else if(kind==='image')f.mode.image='sha256:'+'e'.repeat(64);
  else f.mode[kind]=true;
  await assert.rejects(()=>inspectRollback('fixture',f.proof,f.execute,f.resolve),kind);
 }
});
