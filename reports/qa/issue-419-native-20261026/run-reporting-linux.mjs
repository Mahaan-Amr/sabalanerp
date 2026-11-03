/** Execute the already compiled Reporting tests in the existing Linux carrier. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {backendBaseLocalGuards,backendBaseLocalCapacity} from '../../../scripts/lib/production-backend-base-local-guard.mjs';
import {stableBackendBaseFile} from '../../../scripts/lib/production-backend-base-artifacts.mjs';
const evidence=import.meta.dirname,file=path.join(evidence,'REPORTING-LINUX.json');assert.ok(!fs.existsSync(file));
const archive='D:/sabalanerp-online-qa/ticket413-build-successor-9ee9f382754f465d9a953f77ddeecec0/backend-material.tar.gz';
const materialFile='D:/sabalanerp-online-qa/current-backend-material-e820593bf8ec456993986d7d9e1ee1fe/material-receipt.json';
assert.equal(stableBackendBaseFile(archive).sha256,'2ae8b9dc6fc9a52d9a32e00c9638a32529c3394a7c3072045bbc136a4b4effd7');
assert.equal(stableBackendBaseFile(materialFile).sha256,'6c440e63f97fdef1884f530da43be181aecafb5d03795e66e9691fee993e418b');
const material=JSON.parse(fs.readFileSync(materialFile)),operation=randomBytes(16).toString('hex');
const root='/tmp/issue419-reporting-'+operation;
const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands);
const report={format:'sabalan-419-reporting-linux/v1',operation,root,startedAt:new Date().toISOString(),pass:false,
 sourceCommit:'c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14',compiledMaterial:materialFile,
 compilerRepeated:false,materializerRepeated:false,imageRebuilt:false,productionAdmission:false,runtimeAccepted:false};
const sha=raw=>createHash('sha256').update(raw).digest('hex');
let lease;
async function docker(args,input){lease.assertHeld();await guards.status();const row=await commands.run('docker',args,{input,maximum:8*1024**2});commands.assertSuccessful(row);return row;}
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};
 report.before=await guards.protectedIdentities();report.capacity=backendBaseLocalCapacity({rawBytes:130297585});
 const container=report.before['backend-candidate'].id;report.container=container;
 const required=3*material.files.reduce((n,row)=>n+row.bytes,0)+128*1024**2;
 const prepare=String.raw`import os,json,sys
p=json.load(sys.stdin);s=os.statvfs('/tmp');available=s.f_bavail*s.f_frsize
assert available>=p['required'],'REPORTING_LINUX_SCRATCH_CAPACITY'
os.mkdir(p['root'],0o700)
print(json.dumps({'root':p['root'],'availableBytes':available,'requiredBytes':p['required']}))`;
 report.linuxCapacity=JSON.parse((await docker(['exec','-i',container,'/usr/bin/python3','-I','-B','-c',prepare],JSON.stringify({root,required}))).stdout);
 await docker(['cp',archive,container+':'+root+'/material.tar.gz']);
 const unpack=String.raw`import os,sys,json,tarfile,hashlib
from pathlib import Path
p=json.load(sys.stdin);root=Path(p['root']);archive=root/'material.tar.gz'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==p['archiveSha256']
expected={r['path']:r for r in p['files']};seen=set()
with tarfile.open(archive,'r:gz')as tar:
 for member in tar:
  name=member.name;assert name in expected and name not in seen and member.isfile() and not name.startswith('/') and all(s not in ['.','..','']for s in name.split('/'))
  row=expected[name];assert member.size==row['bytes'];raw=tar.extractfile(member).read();assert hashlib.sha256(raw).hexdigest()==row['sha256']
  target=root/name;target.parent.mkdir(parents=True,exist_ok=True)
  with target.open('xb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
  os.chmod(target,0o400);seen.add(name)
assert seen==set(expected)
scoped=root/'app/node_modules/@sabalanerp';scoped.mkdir(mode=0o700)
for name in ['partner-sales-contracts','contract-product-graph']:os.symlink(str(root/'packages'/name),scoped/name)
print(json.dumps({'filesVerified':len(seen),'archiveSha256':p['archiveSha256'],'root':str(root)}))`;
 report.material=JSON.parse((await docker(['exec','-i',container,'/usr/bin/python3','-I','-B','-c',unpack],JSON.stringify({root,archiveSha256:'2ae8b9dc6fc9a52d9a32e00c9638a32529c3394a7c3072045bbc136a4b4effd7',files:material.files}))).stdout);
 // This original child runs only existing compiled unit tests; application startup is never invoked.
 const runner=String.raw`import os,sys,json,subprocess
p=json.load(sys.stdin);env=dict(os.environ)
for name in list(env):
 if name.startswith(('BACKEND_','INQUIRY_')) or name in ['NODE_OPTIONS','NODE_PATH','RECOVERY_COORDINATION_DIR']:env.pop(name)
env.update(NODE_ENV='test',NODE_PATH=p['root']+'/app/node_modules:/app/node_modules')
args=['/usr/local/bin/node','--max-old-space-size=512','--test',p['root']+'/app/dist/services/__tests__/partnerReporting.test.js',p['root']+'/app/dist/services/__tests__/partnerReportingRevenue.test.js']
child=subprocess.Popen(args,cwd=p['root']+'/app',env=env,stdin=subprocess.DEVNULL)
code=child.wait();sys.exit(code)`;
 lease.assertHeld();await guards.status();
 const test=await commands.run('docker',['exec','-i',container,'/usr/bin/python3','-I','-B','-c',runner],{input:JSON.stringify({root}),maximum:8*1024**2});
 for(const [name,raw]of [['reporting-linux.stdout.tap',test.stdout],['reporting-linux.stderr.txt',test.stderr]])fs.writeFileSync(path.join(evidence,name),raw,{flag:'wx',mode:0o600});
 report.test={originalPid:test.originalPid,code:test.code,signal:test.signal,naturalChildClosure:test.naturalChildClosure,outputBoundExceeded:test.outputBoundExceeded,stdoutSha256:sha(test.stdout),stderrSha256:sha(test.stderr)};
 report.after=await guards.protectedIdentities();assert.deepEqual(report.after,report.before);
 commands.assertSuccessful(test);assert.match(test.stdout,/# fail 0\b/);assert.match(test.stdout,/# skipped 0\b/);
 report.pass=true;
}catch(error){report.error={name:error.name,message:String(error.message).slice(0,1000)};process.exitCode=1;}
finally{report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;report.lease.acknowledgement='LEASE_CLOSED';}report.completedAt=new Date().toISOString();report.temporaryMaterialRetained=true;fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
console.log(JSON.stringify({file,pass:report.pass,error:report.error??null}));
