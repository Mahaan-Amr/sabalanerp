/** Reuse only the authenticated staged material from R3; its failed test stays negative. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {backendBaseLocalGuards} from '../../../scripts/lib/production-backend-base-local-guard.mjs';
const evidence=import.meta.dirname,file=path.join(evidence,'REPORTING-LINUX-R4.json');assert.ok(!fs.existsSync(file));
const parentFile=path.join(evidence,'REPORTING-LINUX-R3.json'),parentRaw=fs.readFileSync(parentFile),parent=JSON.parse(parentRaw);
assert.equal(parent.pass,false);assert.equal(parent.test.code,1);assert.equal(parent.originalChildren.allOriginalChildrenClosed,true);assert.equal(parent.lease.closed,true);assert.equal(parent.material.filesVerified,7096);
const material=JSON.parse(fs.readFileSync(parent.compiledMaterial));
const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands),sha=raw=>createHash('sha256').update(raw).digest('hex');
const report={format:'sabalan-419-reporting-linux-retry/v1',startedAt:new Date().toISOString(),pass:false,
 reusedMaterialFrom:{file:parentFile,sha256:sha(parentRaw)},root:parent.root,sourceCommit:parent.sourceCommit,
 compilerRepeated:false,materializerRepeated:false,stagingRepeated:false,imageRebuilt:false,productionAdmission:false,runtimeAccepted:false};
let lease;
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};
 report.before=await guards.protectedIdentities();assert.equal(report.before['backend-candidate'].id,parent.container);
 const verify=String.raw`import json,sys,hashlib,os
from pathlib import Path
p=json.load(sys.stdin);root=Path(p['root']);assert root.resolve(strict=True)==root
for r in p['files']:
 f=root/r['path'];s=f.lstat();assert f.is_file()and not f.is_symlink()and s.st_nlink==1 and s.st_size==r['bytes'];assert hashlib.sha256(f.read_bytes()).hexdigest()==r['sha256']
print(json.dumps({'filesVerified':len(p['files'])}))`;
 await guards.status();const verified=await commands.run('docker',['exec','-i',parent.container,'/usr/bin/python3','-I','-B','-c',verify],{input:JSON.stringify({root:parent.root,files:material.files})});commands.assertSuccessful(verified);report.materialRecheck=JSON.parse(verified.stdout);
 const runner=String.raw`import os,sys,json,subprocess
p=json.load(sys.stdin);env=dict(os.environ)
for name in list(env):
 if name.startswith(('BACKEND_','INQUIRY_')) or name in ['NODE_OPTIONS','NODE_PATH','RECOVERY_COORDINATION_DIR']:env.pop(name)
env.update(NODE_ENV='test',NODE_PATH=p['root']+'/app/node_modules:/app/node_modules:/packages/contract-product-graph/node_modules:/packages/partner-sales-contracts/node_modules')
child=subprocess.Popen(['/usr/local/bin/node','--max-old-space-size=512','--test',p['root']+'/app/dist/services/__tests__/partnerReporting.test.js',p['root']+'/app/dist/services/__tests__/partnerReportingRevenue.test.js'],cwd=p['root']+'/app',env=env,stdin=subprocess.DEVNULL)
sys.exit(child.wait())`;
 lease.assertHeld();await guards.status();const row=await commands.run('docker',['exec','-i',parent.container,'/usr/bin/python3','-I','-B','-c',runner],{input:JSON.stringify({root:parent.root}),maximum:8*1024**2});
 fs.writeFileSync(path.join(evidence,'reporting-linux-r4.stdout.tap'),row.stdout,{flag:'wx',mode:0o600});fs.writeFileSync(path.join(evidence,'reporting-linux-r4.stderr.txt'),row.stderr,{flag:'wx',mode:0o600});
 report.test={originalPid:row.originalPid,code:row.code,signal:row.signal,naturalChildClosure:row.naturalChildClosure,stdoutSha256:sha(row.stdout),stderrSha256:sha(row.stderr)};
 report.after=await guards.protectedIdentities();assert.deepEqual(report.after,report.before);commands.assertSuccessful(row);assert.match(row.stdout,/# fail 0\b/);assert.match(row.stdout,/# skipped 0\b/);report.pass=true;
}catch(error){report.error={name:error.name,message:String(error.message).slice(0,1000)};process.exitCode=1;}
finally{report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;report.lease.acknowledgement='LEASE_CLOSED';}report.completedAt=new Date().toISOString();report.temporaryMaterialRetained=true;fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
console.log(JSON.stringify({file,pass:report.pass,error:report.error??null}));
