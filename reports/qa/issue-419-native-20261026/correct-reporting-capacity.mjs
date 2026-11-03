/** Append actual destination capacity; never rewrite past admission evidence. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {backendBaseLocalGuards} from '../../../scripts/lib/production-backend-base-local-guard.mjs';
const directory=import.meta.dirname,output=path.join(directory,'REPORTING-CAPACITY-CORRECTION.json');assert.ok(!fs.existsSync(output));
const parentFile=path.join(directory,'REPORTING-LINUX-R5.json'),parentRaw=fs.readFileSync(parentFile),parent=JSON.parse(parentRaw);
assert.equal(parent.pass,true);assert.equal(parent.test.code,0);assert.equal(parent.originalChildren.allOriginalChildrenClosed,true);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands);
const report={format:'sabalan-419-reporting-capacity-correction/v1',observedAt:new Date().toISOString(),
 parent:{file:parentFile,sha256:sha(parentRaw)},readOnly:true,productionAdmission:false,runtimeAccepted:false,
 historicalDestinationCapacityAdmission:false,historicalCapacityRecordAppliesTo:'/tmp',
 historicalStagingDestination:'/app/online-runtime-acceptance',testResultUnchanged:{passed:33,failed:0,skipped:0},
 retroactiveAdmissionClaimed:false,successfulTestsRepeated:false};
let lease;
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};
 report.before=await guards.protectedIdentities();assert.equal(report.before['backend-candidate'].id,parent.container);
 const probe=String.raw`import os,json,sys
from pathlib import Path
p=json.load(sys.stdin);mounts=[line.split()for line in Path('/proc/self/mountinfo').read_text().splitlines()]
result={}
for name in ['/tmp','/app/online-runtime-acceptance',p['root']]:
 target=Path(name);assert target.resolve(strict=True)==target
 before=target.stat();space=os.statvfs(target);device=before.st_dev
 candidates=[r for r in mounts if name==r[4]or name.startswith(r[4].rstrip('/')+'/')];row=max(candidates,key=lambda r:len(r[4]));separator=row.index('-')
 result[name]={'device':str(device),'inode':str(before.st_ino),'availableBytes':space.f_bavail*space.f_frsize,'mountId':row[0],'parentMountId':row[1],'mountDevice':row[2],'mountPoint':row[4],'options':row[5].split(','),'filesystem':row[separator+1]}
 after=target.stat();assert(before.st_dev,before.st_ino)==(after.st_dev,after.st_ino)
assert result[p['root']]['device']==result['/app/online-runtime-acceptance']['device']
assert result[p['root']]['mountPoint']=='/app/online-runtime-acceptance'
print(json.dumps(result))`;
 await guards.status();const row=await commands.run('docker',['exec','-i',parent.container,'/usr/bin/python3','-I','-B','-c',probe],{input:JSON.stringify({root:parent.root})});commands.assertSuccessful(row);
 report.observations=JSON.parse(row.stdout);report.original={originalPid:row.originalPid,code:row.code,signal:row.signal,naturalChildClosure:row.naturalChildClosure,stdoutSha256:sha(row.stdout),stderrSha256:sha(row.stderr)};
 report.after=await guards.protectedIdentities();assert.deepEqual(report.after,report.before);lease.assertHeld();
}catch(error){report.error={name:error.name,message:String(error.message).slice(0,1000)};process.exitCode=1;}
finally{report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;report.lease.acknowledgement='LEASE_CLOSED';}fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
console.log(JSON.stringify({file:output,error:report.error??null,retroactiveAdmissionClaimed:false}));
