import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const closed=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
const ts = createRequire(path.join(root, 'backend/package.json'))('typescript');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(service) {
  const row = verify().find(row => row.Service === service); assert.ok(row);
  const [value] = JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }));
  assert.equal(value.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
  return value;
}
function identities() {
  return Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(service => {
    const value = inspect(service); return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }];
  }));
}

const directory='/app/online-runtime-acceptance/inquiry-coherent-7878c93646acd9ac37cef95e27a4029d';
const failedPath=path.join(root,'reports/qa/inquiry-coherent-7878c93646acd9ac37cef95e27a4029d.core.json');
const failedBytes=fs.readFileSync(failedPath),failed=JSON.parse(failedBytes);
assert.equal(failed.pass,false);assert.equal(failed.durableTerminal.rootProcessExitCode,1);
assert.match(failed.stderr,/nativeStatus/);
const before=identities();assert.deepEqual(before,failed.canonicalBefore);
const issuer=inspect('backend-candidate'),consumer=inspect('backend-retained');
assert.equal(consumer.Id,'f23b77c6ccf8509eb46d8b7df8bdac29640393efdccdb2eaa9a9ce6d068bef26');
const sourcePath=path.join(root,'tests/online-deployment/inquiry-restored-continuation.fixture.py');
const code=fs.readFileSync(sourcePath),sha=b=>createHash('sha256').update(b).digest('hex');
verify();execFileSync('docker',['exec','-i',issuer.Id,'node','-e',`const fs=require('fs'),p=${JSON.stringify(directory+'/restored-continuation.py')};const fd=fs.openSync(p,'wx',0o400);try{fs.writeFileSync(fd,fs.readFileSync(0));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const d=fs.openSync(${JSON.stringify(directory)},'r');fs.fsyncSync(d);fs.closeSync(d);`],{input:code});
const token=randomBytes(16).toString('hex');
const wrapper=`import hashlib,json,os,subprocess,sys
from pathlib import Path
r=Path(sys.argv[1]);t=sys.argv[2];os.umask(0o077)
assert hashlib.sha256((r/'restored-continuation.py').read_bytes()).hexdigest()==sys.argv[3]
def save(name,value):
 with (r/name).open('x') as f:json.dump(value,f);f.flush();os.fsync(f.fileno())
 d=os.open(r,os.O_RDONLY|os.O_DIRECTORY);os.fsync(d);os.close(d)
out=os.open(r/('restore-launch-'+t+'.stdout'),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
err=os.open(r/('restore-launch-'+t+'.stderr'),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
os.fsync(out);os.fsync(err)
save('restore-launch-'+t+'.active.json',{'phase':'LAUNCHING','codeSha256':sys.argv[3],'launcherPid':os.getpid()})
child=subprocess.Popen(['/usr/bin/python3','-I','-B',str(r/'restored-continuation.py'),str(r)],stdout=out,stderr=err)
status=child.wait();os.fsync(out);os.fsync(err);os.close(out);os.close(err)
save('restore-launch-'+t+'.terminal.json',{'rootProcessExitCode':status,'rootProcessPid':child.pid,'allNativeWorkClosed':False})
`;
verify();const actor=spawn('docker',['exec',consumer.Id,'python3','-I','-B','-c',wrapper,directory,token,sha(code)],{stdio:['ignore','pipe','pipe']});
let transport='';actor.stdout.on('data',b=>{transport+=b;});actor.stderr.on('data',b=>{transport+=b;});const outcome=await closed(actor);
verify();const result=JSON.parse(execFileSync('docker',['exec',consumer.Id,'python3','-c',`import json,sys
from pathlib import Path
r=Path(sys.argv[1]);t=sys.argv[2]
print(json.dumps({'terminal':json.loads((r/('restore-launch-'+t+'.terminal.json')).read_bytes()),'stdout':(r/('restore-launch-'+t+'.stdout')).read_text(),'stderr':(r/('restore-launch-'+t+'.stderr')).read_text()}))`,directory,token],{encoding:'utf8',maxBuffer:1024*1024}));
const envelope={format:'sabalan-inquiry-restored-continuation-run/v1',pass:false,directory,token,outcome,...result,continuationSha256:sha(code),originalFailedCoreSha256:sha(failedBytes),originalRunPassed:false,productionAdmission:false};
const report=path.join(root,'reports/qa','inquiry-restored-continuation-'+token+'.json');
fs.writeFileSync(report.replace('.json','.core.json'),JSON.stringify(envelope,null,2)+'\n',{flag:'wx'});
assert.deepEqual(outcome,{code:0,signal:null});assert.equal(result.terminal.rootProcessExitCode,0);
const proof=JSON.parse(result.stdout.trim());assert.equal(proof.pass,true);assert.equal(proof.originalRunPassed,false);
assert.deepEqual(identities(),before);assert.equal(sha(fs.readFileSync(sourcePath)),sha(code));
fs.writeFileSync(report,JSON.stringify({...envelope,...proof,pass:true,canonicalUnchanged:before},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({pass:true,report}));
