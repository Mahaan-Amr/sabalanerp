import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedVersions,validateReceipt} from '../../scripts/clamav-release-readiness.mjs';

test('explicit private transport requires immutable image mode, identical container mode and the one fixed gateway alias',async()=>{
 const {validateTransportIdentity,validateAcquisitionConfiguration}=await import('../../scripts/clamav-release-readiness.mjs');
 const {readFile}=await import('node:fs/promises');
 const config=await readFile(new URL('../../deploy/clamav/freshclam.conf',import.meta.url),'utf8');
 const mode='CLAMAV_ACQUISITION_TRANSPORT=backup-host-http-v1';
 const container={Image:'sha256:'+'a'.repeat(64),Config:{Env:[mode]},HostConfig:{ExtraHosts:['sabalan-clamav-egress:host-gateway']}};
 const image={Id:container.Image,Config:{Env:[mode]}};
 const transport=validateTransportIdentity(container,image);
 const proxy=config+'HTTPProxyServer sabalan-clamav-egress\nHTTPProxyPort 10808\n';
 assert.equal(validateAcquisitionConfiguration(config),'https://mirrors.fe.up.pt/pub/clamav');
 assert.equal(validateAcquisitionConfiguration(proxy,transport),'https://mirrors.fe.up.pt/pub/clamav');
 assert.throws(()=>validateAcquisitionConfiguration(proxy));
 assert.throws(()=>validateAcquisitionConfiguration(config,transport));
 for(const bad of [proxy.replace('10808','10809'),proxy.replace('sabalan-clamav-egress','public.test'),proxy+'HTTPProxyUsername x\n',proxy+'HTTPProxyPort 10808\n',proxy.replace('TestDatabases yes','TestDatabases no'),proxy.replace('current.cvd.clamav.net','elsewhere.test')])assert.throws(()=>validateAcquisitionConfiguration(bad,transport));
 for(const bad of [{...image,Id:'other'},{...image,Config:{Env:[]}},{...image,Config:{Env:[mode,mode]}}])assert.throws(()=>validateTransportIdentity(container,bad));
 for(const bad of [{...container,Config:{Env:[]}},{...container,Config:{Env:[mode,mode]}},{...container,HostConfig:{ExtraHosts:[]}},{...container,HostConfig:{ExtraHosts:['sabalan-clamav-egress:172.17.0.1']}},{...container,HostConfig:{ExtraHosts:['sabalan-clamav-egress:host-gateway','sabalan-clamav-egress:host-gateway']}}])assert.throws(()=>validateTransportIdentity(bad,image));
});

test('actual private candidate inspection refuses container-only mode injection before all scanner evidence',async()=>{
 const {inspectCandidate}=await import('../../scripts/clamav-release-readiness.mjs');
 const {readFile}=await import('node:fs/promises');
 const config=await readFile(new URL('../../deploy/clamav/freshclam.conf',import.meta.url),'utf8');
 let count=0;
 const execute=async(_program,args)=>{
  count++;
  if(args[0]==='inspect')return {stdout:JSON.stringify([{Id:'candidate',Image:'sha256:'+'a'.repeat(64),State:{Running:true},Config:{Env:['CLAMAV_ACQUISITION_TRANSPORT=backup-host-http-v1']},HostConfig:{ExtraHosts:['sabalan-clamav-egress:host-gateway']}}])};
  if(args[0]==='exec')return {stdout:config+'HTTPProxyServer sabalan-clamav-egress\nHTTPProxyPort 10808\n'};
  if(args[0]==='image')return {stdout:JSON.stringify([{Id:'sha256:'+'a'.repeat(64),Config:{Env:['CLAMAV_ACQUISITION_TRANSPORT=direct']}}])};
  throw Error('Unexpected subsequent probe');
 };
 await assert.rejects(()=>inspectCandidate('candidate',execute),/immutable image/);
 assert.equal(count,3);
});

test('Linux actual transport helper rejects altered config, runtime mode and wrong or duplicate gateway addresses',
 {skip:process.platform!=='linux'},async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const {spawnSync}=await import('node:child_process');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'clamav-transport-unit-'));
 try {
  const original=await fs.readFile(new URL('../../deploy/clamav/acquisition-transport.sh',import.meta.url),'utf8');
  const canonical=await fs.readFile(new URL('../../deploy/clamav/freshclam.conf',import.meta.url),'utf8');
  const file=name=>path.join(root,name);
  const source=original.replaceAll('/usr/local/share/sabalan-clamav-transport',file('mode'))
   .replaceAll('/usr/local/share/sabalan-clamav-freshclam.conf',file('canonical'))
   .replaceAll('/etc/clamav/freshclam.conf',file('config')).replaceAll('/etc/hosts',file('hosts'));
  await fs.writeFile(file('helper.sh'),source);await fs.writeFile(file('canonical'),canonical);
  const check=mode=>spawnSync('sh',[file('helper.sh')],{env:{...process.env,CLAMAV_ACQUISITION_TRANSPORT:mode},encoding:'utf8'}).status;
  await fs.writeFile(file('mode'),'direct\n');await fs.writeFile(file('config'),canonical);
  assert.equal(check('direct'),0);assert.notEqual(check('backup-host-http-v1'),0);
  const proxy=canonical+'HTTPProxyServer sabalan-clamav-egress\nHTTPProxyPort 10808\n';
  await fs.writeFile(file('mode'),'backup-host-http-v1\n');await fs.writeFile(file('config'),proxy);await fs.writeFile(file('hosts'),'172.17.0.1 sabalan-clamav-egress\n');
  assert.equal(check('backup-host-http-v1'),0);
  for(const hosts of ['0.0.0.0 sabalan-clamav-egress\n','172.17.0.1 wrong\n','172.17.0.1 sabalan-clamav-egress\n172.17.0.1 sabalan-clamav-egress\n']){await fs.writeFile(file('hosts'),hosts);assert.notEqual(check('backup-host-http-v1'),0);}
  await fs.writeFile(file('hosts'),'172.17.0.1 sabalan-clamav-egress\n');
  for(const config of [proxy.replace('TestDatabases yes','TestDatabases no'),proxy.replace('https://mirrors.fe.up.pt','http://mirrors.fe.up.pt'),proxy+'HTTPProxyPassword x\n']){await fs.writeFile(file('config'),config);assert.notEqual(check('backup-host-http-v1'),0);}
  await fs.writeFile(file('config'),proxy);assert.equal(check('backup-host-http-v1'),0);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
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

test('actual managed private rollback checks image mode and gateway alias before and after scanner qualification',async()=>{
 const {inspectRollback}=await import('../../scripts/clamav-release-readiness.mjs');
 const {readFile}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const config=await readFile(new URL('../../deploy/clamav/freshclam.conf',import.meta.url),'utf8');
 for(const kind of ['healthy','missingAlias','wrongAlias','wrongImageMode','wrongContainerMode','lateMissingAlias','lateWrongContainerMode']) {
  const f=nativeFixture();
  f.proof.engine='1.4.6';f.proof.runtimeVerifier='managed-1.4.6-v1';
  f.proof.configArchiveSha256=createHash('sha256').update(f.configArchive).digest('hex');
  const env=['CLAMAV_ACQUISITION_TRANSPORT=backup-host-http-v1'];let inspected=0;
  const execute=async(program,args,options)=>{
   const result=stdout=>({stdout,stderr:''});
   if(args[0]==='inspect'){
    inspected++;
    let hosts=['sabalan-clamav-egress:host-gateway'];let containerEnv=env;
    if(kind==='missingAlias'||(kind==='lateMissingAlias'&&inspected>1))hosts=[];
    if(kind==='wrongAlias')hosts=['sabalan-clamav-egress:127.0.0.1'];
    if(kind==='wrongContainerMode'||(kind==='lateWrongContainerMode'&&inspected>1))containerEnv=['CLAMAV_ACQUISITION_TRANSPORT=direct'];
    return result(JSON.stringify([{Id:'fixture-container',Image:f.proof.image,State:{Running:true,StartedAt:'stable'},Config:{Env:containerEnv},HostConfig:{ExtraHosts:hosts}}]));
   }
   if(args[0]==='image')return result(JSON.stringify([{Id:f.proof.image,Config:{Env:kind==='wrongImageMode'?['CLAMAV_ACQUISITION_TRANSPORT=direct']:env}}]));
   if(args[0]==='exec'){
    if(args[2]==='cat'&&args[3].endsWith('freshclam.conf'))return result(config+'HTTPProxyServer sabalan-clamav-egress\nHTTPProxyPort 10808\n');
    if(args[2]==='/usr/local/bin/sabalan-clamav-acquisition-transport')return result('');
    if(args[2]==='freshclam'||(args[2]==='clamdscan'&&args.includes('--version')))return result('ClamAV 1.4.6/28157/date');
   }
   return f.execute(program,args,options);
  };
  if(kind==='healthy')assert.equal((await inspectRollback('fixture',f.proof,execute,f.resolve)).acquisitionTransport,'backup-host-http-v1');
  else await assert.rejects(()=>inspectRollback('fixture',f.proof,execute,f.resolve),/immutable image|gateway alias/,kind);
  assert.equal(f.calls.some(args=>args.includes('freshclam')&&!args.includes('--version')),false,'rollback inspection never forces an update');
 }
});
