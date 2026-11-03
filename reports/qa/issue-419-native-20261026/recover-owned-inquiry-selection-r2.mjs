/** Recovery of the same live local owner; never a JSON owner/admission adapter. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {inspectPrivateDockerArchive} from '../../../scripts/lib/private-docker-image-archive.mjs';
const directory=import.meta.dirname,sha=raw=>createHash('sha256').update(raw).digest('hex');
const output=path.join(directory,'INQUIRY-OWNED-RECOVERY-R2.json');
const equal=(a,b,message='RECOVERY_IDENTITY_MISMATCH')=>assert.ok(isDeepStrictEqual(a,b),message);
const environment=rows=>Object.fromEntries(rows.map(row=>{const i=row.indexOf('=');return [row.slice(0,i),row.slice(i+1)];}));
export async function recoverOwnedInquirySelection({lease,before,report}){
 assert.equal(process.pid,29432,'SAME_LIVE_ORIGINAL_PROCESS_REQUIRED');
 assert.equal(path.basename(process.argv[1]),'select-inquiry-native-r3.mjs');
 assert.equal(report.operation,'a3a7aa1b5bcfbb58e69ee66a15474612');
 assert.equal(report.phase,'HELD_RESTORATION_UNPROVEN');assert.equal(report.pass,false);assert.equal(lease.originalPid,33860);lease.assertHeld();
 assert.ok(!fs.existsSync(output),'RECOVERY_ATTEMPT_ALREADY_RETAINED');
 const result={format:'sabalan-419-same-owned-inquiry-recovery/v1',ownerPid:process.pid,leasePid:lease.originalPid,
  operation:report.operation,pass:false,productionAdmission:false,runtimeAccepted:false,issue411Accepted:false,
  originalAttemptRemainsNegative:true,originalRawMetadataRestorationClaimed:false,startedAt:new Date().toISOString()};
 const commands=originalBackendBaseCommands();let corrected=false;
 async function docker(args,input){
  lease.assertHeld();const ps=await commands.run('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json']);commands.assertSuccessful(ps);
  const rows=ps.stdout.trim().split(/\r?\n/).map(JSON.parse);assert.equal(rows.length,10);assert.ok(rows.every(row=>row.Project==='sabalanerp-local'&&row.State==='running'&&row.Health==='healthy'));
  for(const row of rows.filter(row=>row.Service!=='inquiry'))assert.equal(row.ID,before[row.Service].Id,'FOREIGN_SERVICE_RECREATED');
  const row=await commands.run('docker',args,{input,maximum:8*1024**2});commands.assertSuccessful(row);return row.stdout;
 }
 try{
  const proposal=JSON.parse(fs.readFileSync(path.join(directory,'EXISTING-INQUIRY-CARRIER-PROPOSAL.json')));
  const rollback=inspectPrivateDockerArchive(proposal.rollbackArchive.file,proposal.rollbackGraph.index);equal(rollback,proposal.rollbackGraph);
  const [current]=JSON.parse(await docker(['inspect','sabalanerp-local-inquiry-1']));
  const old=before.inquiry;assert.equal(current.ImageManifestDescriptor.digest,rollback.platform);equal(current.NetworkSettings.Ports,old.NetworkSettings.Ports);equal(current.Mounts,old.Mounts);
  // Docker encodes absent DNS collections as null on this new incarnation.
  // Permit only these three independently empty defaults; every other field stays exact.
  const host=structuredClone(current.HostConfig),dns=[];
  for(const key of ['Dns','DnsOptions','DnsSearch'])if(host[key]===null&&Array.isArray(old.HostConfig[key])&&old.HostConfig[key].length===0){dns.push(key);host[key]=[];}
  equal(host,old.HostConfig,'OTHER_HOST_CONFIGURATION_DRIFT');result.emptyDnsRepresentationChanges=dns;
  const rollbackFile=path.join(report.privateDirectory,'rollback.compose.json');
  const rawModel=await docker(['compose','-f','D:/sabalanerp/docker-compose.local.yml','-f',rollbackFile,'config','--format','json']);
  const model=JSON.parse(rawModel);assert.equal(model.services.inquiry.image,rollback.index);
  for(const key of ['dns','dns_opt','dns_search'])assert.ok(!model.services.inquiry[key]||model.services.inquiry[key].length===0,'NONDEFAULT_DNS');
  const config=structuredClone(current.Config);equal(environment(config.Env),environment(old.Config.Env));config.Env=old.Config.Env;
  assert.equal(config.Image,rollback.index);config.Image=old.Config.Image;
  const hash=(await docker(['compose','-f','D:/sabalanerp/docker-compose.local.yml','-f',rollbackFile,'config','--hash','inquiry'])).trim().split(/\s+/);assert.equal(hash[0],'inquiry');
  assert.equal(config.Labels['com.docker.compose.config-hash'],hash[1]);
  assert.equal(config.Labels['com.docker.compose.project.config_files'],old.Config.Labels['com.docker.compose.project.config_files']+','+rollbackFile);
  for(const key of ['com.docker.compose.config-hash','com.docker.compose.project.config_files'])config.Labels[key]=old.Config.Labels[key];
  equal(config,old.Config,'OTHER_APPLICATION_CONFIGURATION_DRIFT');
  equal(Object.keys(current.NetworkSettings.Networks).sort(),Object.keys(old.NetworkSettings.Networks).sort(),'NETWORK_ATTACHMENT_DRIFT');
  for(const name of Object.keys(old.NetworkSettings.Networks)){
   const a=structuredClone(current.NetworkSettings.Networks[name]),b=structuredClone(old.NetworkSettings.Networks[name]);
   for(const key of ['EndpointID','IPAddress','GlobalIPv6Address','MacAddress']){delete a[key];delete b[key];}
   if(a.DNSNames||b.DNSNames){
    assert.ok(Array.isArray(a.DNSNames)&&Array.isArray(b.DNSNames),'DNS_NAMES_SCHEMA_DRIFT');
    const expected=new Set(b.DNSNames),oldShort=old.Id.slice(0,12),newShort=current.Id.slice(0,12);
    // The original Docker-generated hostname equals its old short ID. Preserve
    // that pinned hostname; add only the newly assigned container DNS identity.
    if(oldShort!==old.Config.Hostname&&!(b.Aliases??[]).includes(oldShort))expected.delete(oldShort);
    expected.add(newShort);equal([...a.DNSNames].sort(),[...expected].sort(),'UNEXPECTED_CONTAINER_DNS_NAME');
    delete a.DNSNames;delete b.DNSNames;
   }
   equal(a,b,'OTHER_NETWORK_CONFIGURATION_DRIFT');
  }
  result.configurationPreserved=true;result.nativeDescriptor=current.ImageManifestDescriptor;
  const diagnosis=JSON.parse(fs.readFileSync(path.join(directory,'SQLITE-ROLLBACK-DIAGNOSIS-R2.json')));assert.equal(diagnosis.schemaUnchanged,true);
  const witnessFile=path.join(directory,'SEED-PROVENANCE-R4.json'),witnessRaw=fs.readFileSync(witnessFile),witness=JSON.parse(witnessRaw);
  assert.ok(witness.seedTargetIdentityMatchedPrivately&&witness.seedCredentialVerifiedBeforeAndAfter&&witness.seedTargetsOnlyConfiguredAdmin,'SEED_PROVENANCE_REQUIRED');
  assert.equal(witness.originalContainerId,current.Id);assert.equal(witness.originalStartedAt,current.State.StartedAt);assert.equal(witness.sourceCurrentSha256,diagnosis.sourceCurrentSha256);
  const nextStart=witness.timeline.find(row=>row.kind==='NEXT_START');assert.ok(nextStart&&Date.parse(witness.seedUpdatedAt)<Date.parse(nextStart.at),'SEED_UPDATE_MUST_PRECEDE_NEXT_START');
  result.seedWitness={file:witnessFile,sha256:sha(witnessRaw),seedUpdatedBeforeNextStart:true};
  for(const volume of ['C:/','D:/']){const space=fs.statfsSync(volume,{bigint:true});assert.ok(space.bavail*space.bsize>=2n*1024n**3n,'RECOVERY_BACKING_RESERVE');}
  const sourceMount=before['backend-retained'].Mounts.find(row=>row.Name===old.Mounts.find(row=>row.Destination==='/data').Name);
  const writeMount=before.backend.Mounts.find(row=>row.Name===old.Mounts.find(row=>row.Destination==='/data').Name);assert.ok(sourceMount&&!sourceMount.RW&&writeMount?.RW);
  // Original backup bytes travel only through this owner's private pipe/memory.
  const read=String.raw`import sys,json,hashlib,base64
from pathlib import Path
p=json.load(sys.stdin);f=Path(p['file']);a=f.stat();raw=f.read_bytes();assert a.st_nlink==1 and hashlib.sha256(raw).hexdigest()==p['sha256'];b=f.stat();assert(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_dev,b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns);sys.stdout.write(base64.b64encode(raw).decode())`;
  const protectedBytes=(await docker(['exec','-i',before['backend-retained'].Id,'/usr/bin/python3','-I','-B','-c',read],JSON.stringify(report.sqliteBackup))).trim();
  const backup=Buffer.from(protectedBytes,'base64');assert.equal(sha(backup),report.sqliteBackup.sha256);
  const observedCurrentBytes=(await docker(['exec','-i',before['backend-retained'].Id,'/usr/bin/python3','-I','-B','-c',read],JSON.stringify(diagnosis.preservedCurrent))).trim();
  assert.equal(sha(Buffer.from(observedCurrentBytes,'base64')),diagnosis.preservedCurrent.sha256);
  const seedEnvironment=environment(old.Config.Env);assert.ok(seedEnvironment.ADMIN_EMAIL&&seedEnvironment.ADMIN_PASSWORD,'EXACT_ORIGINAL_SEED_ENVIRONMENT_REQUIRED');
  const repairRoot='/app/recovery-coordination/issue419-inquiry-recovery-'+report.operation;
  const intent={format:'sabalan-419-seed-row-recovery-intent/v1',ownerPid:process.pid,operation:report.operation,
   expectedCurrentSha256:diagnosis.sourceCurrentSha256,protectedBackupSha256:report.sqliteBackup.sha256,
   permittedTable:'Admin',permittedChangedColumns:['passwordHash','updatedAt'],permittedRows:1,
   allOtherRowsMustRemainExact:true,wholeDatabaseRestore:false,productionAdmission:false};
  fs.writeFileSync(path.join(directory,'SQLITE-RECOVERY-INTENT.json'),JSON.stringify(intent,null,2)+'\n',{flag:'wx',mode:0o600});
  const repair=String.raw`import os,sys,json,sqlite3,hashlib,base64,subprocess
from pathlib import Path
p=json.load(sys.stdin);source=Path(p['source']);parent=Path('/app/recovery-coordination');v=os.statvfs(parent);assert v.f_bavail*v.f_frsize>=p['bytes']*4+128*1024**2
assert source.resolve(strict=True)==source and source.stat().st_nlink==1 and str(source.stat().st_ino)==p['inode'] and str(source.stat().st_dev)==p['device']
assert not any(Path(str(source)+s).exists()for s in ['-wal','-shm','-journal']);assert hashlib.sha256(source.read_bytes()).hexdigest()==p['expectedCurrentSha256']
root=Path(p['root']);root.mkdir(mode=0o700);backup=root/'protected-before.db';raw=base64.b64decode(p['protectedBytes'],validate=True);assert hashlib.sha256(raw).hexdigest()==p['backupSha256']
with backup.open('xb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
os.chmod(backup,0o600)
captured=root/'protected-diagnosed-current.db';captured_bytes=base64.b64decode(p['observedCurrentBytes'],validate=True);assert hashlib.sha256(captured_bytes).hexdigest()==p['observedCurrentBackupSha256']
with captured.open('xb')as stream:stream.write(captured_bytes);stream.flush();os.fsync(stream.fileno())
os.chmod(captured,0o600)
observed=sqlite3.connect(captured.as_uri()+'?mode=ro&immutable=1',uri=True)
original=sqlite3.connect(backup.as_uri()+'?mode=ro&immutable=1',uri=True);current=sqlite3.connect(source,timeout=5);committed=False
q=lambda s:'"'+s.replace('"','""')+'"'
schema=lambda d:d.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') ORDER BY type,name").fetchall()
tables=lambda d:[row[0]for row in d.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
def read(d,t):return d.execute('SELECT * FROM '+q(t)).fetchall()
try:
 assert original.execute('PRAGMA integrity_check').fetchall()==[('ok',)] and current.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
 # Preserve the current state independently before the one conditional row repair.
 safety=root/'observed-before-row-repair.db';copy=sqlite3.connect(safety)
 try:current.backup(copy)
 finally:copy.close()
 os.chmod(safety,0o600)
 current.execute('BEGIN IMMEDIATE')
 # Recheck AFTER the write lock: no acknowledged reset can enter the pre-lock gap.
 assert not any(Path(str(source)+s).exists()for s in ['-wal','-shm','-journal'])
 assert hashlib.sha256(source.read_bytes()).hexdigest()==p['expectedCurrentSha256'],'DIAGNOSED_CURRENT_STATE_CHANGED'
 assert schema(original)==schema(current)==schema(observed)
 changed=[];data={}
 for t in tables(original):
  a,b=read(original,t),read(current,t);assert sorted(map(repr,b))==sorted(map(repr,read(observed,t))),'CURRENT_ROW_VALUES_CHANGED';assert len(a)==len(b)
  cols=original.execute('PRAGMA table_info('+q(t)+')').fetchall();names=[r[1]for r in cols];pk=[r[1]for r in sorted(cols,key=lambda r:r[5])if r[5]]
  if not pk:assert sorted(map(repr,a))==sorted(map(repr,b));continue
  key=lambda row:tuple(row[names.index(k)]for k in pk);left={key(row):row for row in a};right={key(row):row for row in b};assert left.keys()==right.keys()
  for k in left:
   differences=[n for n,x,y in zip(names,left[k],right[k])if x!=y]
   if differences:changed.append((t,k,differences));data[(t,k)]=(names,pk,left[k],right[k])
 assert len(changed)==1 and changed[0][0]=='Admin' and set(changed[0][2])=={'passwordHash','updatedAt'},'UNKNOWN_OR_ACKNOWLEDGED_WRITES_PRESENT'
 t,k,_=changed[0];names,pk,a,b=data[(t,k)];columns=['passwordHash','updatedAt'];where=pk+columns
 assert a[names.index('email')]==b[names.index('email')]==p['seedEmail'],'DIFFERENT_SEED_TARGET'
 assert b[names.index('updatedAt')]==p['seedUpdatedAtMilliseconds'],'SEED_UPDATED_AT_CHANGED'
 # Exact captured row values plus the real pre-Next seed timeline bind attribution.
 # Verify both credentials privately using the same original configured seed password.
 verifier="const f=require('fs'),b=require('/app/node_modules/bcryptjs'),p=JSON.parse(f.readFileSync(0,'utf8'));Promise.all([b.compare(p.password,p.before),b.compare(p.password,p.current)]).then(v=>{if(!v.every(Boolean))process.exitCode=1;else process.stdout.write('VERIFIED');}).catch(()=>{process.exitCode=1;});"
 verified=subprocess.run(['/usr/local/bin/node','-e',verifier],input=json.dumps({'password':p['seedPassword'],'before':a[names.index('passwordHash')],'current':b[names.index('passwordHash')]}).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/local/bin:/usr/bin:/bin'})
 assert verified.returncode==0 and verified.stdout==b'VERIFIED' and not verified.stderr,'SEED_CREDENTIAL_VERIFICATION_FAILED'
 sql='UPDATE '+q(t)+' SET '+','.join(q(n)+'=?'for n in columns)+' WHERE '+' AND '.join(q(n)+' IS ?'for n in where)
 values=[a[names.index(n)]for n in columns]+[b[names.index(n)]for n in where]
 assert current.execute(sql,values).rowcount==1
 for t in tables(original):assert sorted(map(repr,read(original,t)))==sorted(map(repr,read(current,t))),'LOGICAL_RESTORATION_MISMATCH'
 current.commit();committed=True;assert current.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
finally:
 if not committed:current.rollback()
 current.close();original.close();observed.close()
assert not any(Path(str(source)+s).exists()for s in ['-wal','-shm','-journal'])
with source.open('rb')as stream:os.fsync(stream.fileno())
print(json.dumps({'format':'sabalan-419-conditional-seed-row-recovery/v1','correctedRows':1,'columns':['passwordHash','updatedAt'],'allTablesAndCredentialBytesMatchProtectedBackup':True,'schemaPreserved':True,'wholeDatabaseRestore':False,'acknowledgedWritesOverwritten':False,'rawSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'originalRawMetadataRestorationClaimed':False,'safetyCopy':str(safety),'protectedBackup':str(backup),'capacity':{'parent':str(parent),'device':str(parent.stat().st_dev),'availableBytes':v.f_bavail*v.f_frsize},'productionAdmission':False}))`;
  const row=JSON.parse(await docker(['exec','-i',before.backend.Id,'/usr/bin/python3','-I','-B','-c',repair],JSON.stringify({source:writeMount.Destination+'/inquiry.db',root:repairRoot,protectedBytes,observedCurrentBytes,observedCurrentBackupSha256:diagnosis.preservedCurrent.sha256,backupSha256:report.sqliteBackup.sha256,expectedCurrentSha256:diagnosis.sourceCurrentSha256,inode:report.sqliteBefore.main.inode,device:report.sqliteBefore.main.device,bytes:report.sqliteBackup.bytes,seedEmail:seedEnvironment.ADMIN_EMAIL,seedPassword:seedEnvironment.ADMIN_PASSWORD,seedUpdatedAtMilliseconds:Date.parse(witness.seedUpdatedAt)})));
  assert.equal(row.allTablesAndCredentialBytesMatchProtectedBackup,true);assert.equal(row.wholeDatabaseRestore,false);result.sqliteRecovery=row;corrected=true;
  const [final]=JSON.parse(await docker(['inspect',current.Id]));assert.equal(final.State.Health.Status,'healthy');assert.equal(final.ImageManifestDescriptor.digest,rollback.platform);
  result.safeLocalBaselineRestored=true;result.phase='LOGICAL_BASELINE_RESTORED_STRICT_ATTEMPT_NEGATIVE';
 }catch(error){const message=String(error.message);result.error={name:error.name,code:/^[A-Z0-9_]{1,96}$/.test(message)?message:'RECOVERY_REFUSED'};result.phase=corrected?'HELD_FINAL_RECHECK':'HELD_RECOVERY_REFUSED';}
 finally{
  result.originalChildren=await commands.close();result.completedAt=new Date().toISOString();
  if(result.safeLocalBaselineRestored){await lease.release();result.leaseClosed=true;result.leaseAcknowledgement='LEASE_CLOSED';}
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 }
 assert.equal(result.safeLocalBaselineRestored,true,'SAME_OWNER_RECOVERY_REMAINS_HELD');return result;
}
