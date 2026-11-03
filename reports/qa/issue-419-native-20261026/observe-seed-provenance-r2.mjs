/** Private seed attribution witness; no credentials or row identities are published. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const directory=import.meta.dirname,file=path.join(directory,'SEED-PROVENANCE-R2.json');assert.ok(!fs.existsSync(file));
const parent=JSON.parse(fs.readFileSync(path.join(directory,'INQUIRY-SELECTION-EXECUTION-R3.json'))),before=JSON.parse(fs.readFileSync(path.join(parent.privateDirectory,'original-inspections.json')));
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function run(args,input){try{return execFileSync('docker',args,{input,encoding:'utf8',maxBuffer:2*1024**2});}catch{throw Error('SEED_WITNESS_COMMAND_FAILED');}}
function docker(args,input){const status=run(['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json']).trim().split(/\r?\n/).map(JSON.parse);assert.ok(status.length===10&&status.every(row=>row.Project==='sabalanerp-local'&&row.Health==='healthy'),'LOCAL_SCOPE_CHANGED');return run(args,input);}
const [current]=JSON.parse(docker(['inspect','sabalanerp-local-inquiry-1']));assert.equal(current.ImageManifestDescriptor.digest,parent.rollbackGraph.platform);
const env=Object.fromEntries(before.inquiry.Config.Env.map(row=>{const i=row.indexOf('=');return[row.slice(0,i),row.slice(i+1)];}));assert.ok(env.ADMIN_EMAIL&&env.ADMIN_PASSWORD,'EXACT_SEED_ENVIRONMENT_REQUIRED');
const mount=before['backend-retained'].Mounts.find(row=>row.Name===before.inquiry.Mounts.find(row=>row.Destination==='/data').Name);
const read=String.raw`import json,sys,sqlite3,hashlib
from pathlib import Path
p=json.load(sys.stdin);out={}
for name,file in [('before',p['backup']),('current',p['current'])]:
 f=Path(file);a=f.stat();d=sqlite3.connect(f.as_uri()+'?mode=ro&immutable=1',uri=True)
 try:
  rows=d.execute('SELECT id,email,passwordHash,updatedAt FROM Admin WHERE email=?',(p['email'],)).fetchall();assert len(rows)==1;out[name]=dict(zip(['id','email','passwordHash','updatedAt'],rows[0]))
 finally:d.close()
 assert(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==tuple(getattr(f.stat(),k)for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns'])
out['currentSha256']=hashlib.sha256(Path(p['current']).read_bytes()).hexdigest();print(json.dumps(out))`;
const privateRows=JSON.parse(docker(['exec','-i',before['backend-retained'].Id,'/usr/bin/python3','-I','-B','-c',read],JSON.stringify({backup:parent.sqliteBackup.file,current:mount.Destination+'/inquiry.db',email:env.ADMIN_EMAIL})));
assert.ok(privateRows.before.id===privateRows.current.id&&privateRows.before.email===privateRows.current.email,'SEED_TARGET_IDENTITY_CHANGED');
const verify=String.raw`const fs=require('fs'),crypto=require('crypto'),p=JSON.parse(fs.readFileSync(0,'utf8')),bcrypt=require('bcryptjs');(async()=>{
 const script=JSON.parse(fs.readFileSync('/app/package.json','utf8')).scripts['db:seed'];if(script!=='prisma db seed')throw Error('SEED_ENTRY_CHANGED');
 const seed=fs.readFileSync('/app/prisma/seed.cjs','utf8');
 const before=await bcrypt.compare(process.env.ADMIN_PASSWORD,p.before.passwordHash),after=await bcrypt.compare(process.env.ADMIN_PASSWORD,p.current.passwordHash);
 console.log(JSON.stringify({seedSourceSha256:crypto.createHash('sha256').update(seed).digest('hex'),configuredSeedIdentityMatches:p.current.email===process.env.ADMIN_EMAIL,beforeCredentialVerifiesSeed:before,currentCredentialVerifiesSeed:after,currentUpdatedAt:p.current.updatedAt}));
})().catch(()=>{process.stderr.write('SEED_WITNESS_FAILED');process.exitCode=1;});`;
const verified=JSON.parse(docker(['exec','-i',current.Id,'node','-e',verify],JSON.stringify(privateRows)));
const logs=docker(['logs','--timestamps',current.Id]),timeline=[];
for(const line of logs.split(/\r?\n/)){
 const match=/^(\S+)\s+(.*)$/.exec(line);if(!match)continue;const text=match[2];
 const kind=/db:seed/.test(text)?'SEED_SCRIPT':/node prisma\/seed/.test(text)?'SEED_ENTRY':/admin.*seed|seed.*admin|updated.*admin|created.*admin/i.test(text)?'SEED_ADMIN':/Ready in|ready in|ready - started/i.test(text)?'NEXT_READY':/next start/.test(text)?'NEXT_START':null;
 if(kind)timeline.push({at:match[1],kind});
}
const ready=timeline.find(row=>row.kind==='NEXT_READY'),seed=timeline.find(row=>row.kind==='SEED_ENTRY');
const updatedAt=typeof verified.currentUpdatedAt==='number'?verified.currentUpdatedAt:Date.parse(verified.currentUpdatedAt);
assert.ok(ready&&seed&&Number.isFinite(updatedAt),'SEED_STARTUP_TIMELINE_UNPROVEN');
assert.ok(Date.parse(seed.at)<=updatedAt&&updatedAt<Date.parse(ready.at),'SEED_UPDATE_NOT_BEFORE_SERVER_READY');
assert.ok(verified.configuredSeedIdentityMatches&&verified.beforeCredentialVerifiesSeed&&verified.currentCredentialVerifiesSeed,'SEED_CREDENTIAL_PROVENANCE_UNPROVEN');
const diagnosis=JSON.parse(fs.readFileSync(path.join(directory,'SQLITE-ROLLBACK-DIAGNOSIS-R2.json')));assert.equal(privateRows.currentSha256,diagnosis.sourceCurrentSha256);
const result={format:'sabalan-419-startup-seed-provenance-witness/v1',qualified:false,productionAdmission:false,readOnly:true,
 originalContainerId:current.Id,originalStartedAt:current.State.StartedAt,nativeDescriptor:current.ImageManifestDescriptor,
 sourceCurrentSha256:privateRows.currentSha256,seedTargetIdentityMatchedPrivately:true,
 seedCredentialVerifiedBeforeAndAfter:true,updatedBeforeApplicationReady:true,seedUpdatedAt:new Date(updatedAt).toISOString(),timeline,
 originalLogsSha256:sha(logs),seedSourceSha256:verified.seedSourceSha256,retainedCurrentState:diagnosis.preservedCurrent};
fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({file,timeline,seedUpdatedAt:result.seedUpdatedAt,seedTargetIdentityMatchedPrivately:true,credentialsVerifiedPrivately:true}));
