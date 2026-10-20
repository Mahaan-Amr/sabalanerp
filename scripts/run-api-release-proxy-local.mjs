import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..'),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const compose=['compose','-f','D:/sabalanerp/docker-compose.local.yml'];
function status(){
  const raw=execFileSync('docker',[...compose,'ps','--format','json'],{encoding:'utf8'});
  let rows;try{const value=JSON.parse(raw);rows=Array.isArray(value)?value:[value];}
  catch{rows=raw.trim().split(/\r?\n/).map(line=>JSON.parse(line));}
  for(const service of ['backend','frontend','postgres','inquiry','backend-candidate'])
    assert.ok(rows.some(row=>row.Project==='sabalanerp-local' && row.Service===service && row.State==='running' && row.Health==='healthy'));
  return rows;
}
const services=['backend','frontend','postgres','inquiry','backend-candidate'];
function inspectServices(){
  const rows=status(),names=services.map(service=>rows.find(row=>row.Service===service).Name);
  const values=JSON.parse(execFileSync('docker',['inspect',...names],{encoding:'utf8'}));
  assert.equal(values.length,services.length);
  return Object.fromEntries(values.map(value=>{
    assert.equal(value.Config.Labels['com.docker.compose.project'],'sabalanerp-local');
    const service=value.Config.Labels['com.docker.compose.service'];assert.ok(services.includes(service));return [service,value];
  }));
}
const identity=value=>({id:value.Id,image:value.Image,startedAt:value.State.StartedAt});
const initial=inspectServices(),before=Object.fromEntries(services.map(service=>[service,identity(initial[service])]));
const slot=initial['backend-candidate'];assert.ok(slot.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
assert.ok(slot.Mounts.some(mount=>mount.Type==='volume' && mount.RW && mount.Name==='sabalanerp-local_online_runtime_acceptance'
  && mount.Destination==='/app/online-runtime-acceptance'));
const directory='/app/online-runtime-acceptance/api-release-'+randomBytes(16).toString('hex');
const names=['deploy/scripts/api-release-routing.mjs','deploy/scripts/browser-release-routing.mjs',
  'deploy/scripts/browser-release-proxy.mjs','deploy/scripts/browser-operation-journal.mjs','deploy/scripts/browser-routing-store.mjs',
  'tests/online-deployment/api-release-routing.test.mjs','tests/online-deployment/api-release-proxy.test.mjs',
  'tests/online-deployment/api-v2-publication-binding.test.mjs',
  'tests/online-deployment/browser-release-proxy.test.mjs','tests/online-deployment/browser-routing-store.test.mjs'];
const files=Object.fromEntries(names.map(name=>[name,fs.readFileSync(path.join(root,name))]));
const sources=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha(bytes)]));
sources['scripts/run-api-release-proxy-local.mjs']=sha(fs.readFileSync(import.meta.filename));
const bootstrap=`const fs=require('fs'),path=require('path');process.umask(0o077);const root=${JSON.stringify(directory)};
  fs.mkdirSync(root,{mode:0o700});const input=JSON.parse(fs.readFileSync(0,'utf8'));
  for(const [name,value]of Object.entries(input)){const target=path.resolve(root,name);if(!target.startsWith(root+'/')||name.includes('..'))throw Error('UNSAFE_SOURCE');
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});const fd=fs.openSync(target,'wx',0o400);
    try{fs.writeFileSync(fd,Buffer.from(value,'base64'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}`;
status();execFileSync('docker',['exec','-i',slot.Id,'node','-e',bootstrap],{
  input:JSON.stringify(Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,bytes.toString('base64')])))});
status();const outcome=await new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec',slot.Id,'node','--test',...names.filter(name=>name.endsWith('.test.mjs')).map(name=>directory+'/'+name)],
    {stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',bytes=>{stdout+=bytes;});child.stderr.on('data',bytes=>{stderr+=bytes;});child.once('error',reject);
  child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
});
const report={format:'sabalan-api-release-native/v1',pass:false,productionAdmission:false,workingRoot:directory,sources,before,...outcome};
const reportPath=path.join(root,'reports/qa',path.basename(directory)+'.json');
const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
const after=inspectServices();for(const [service,expected]of Object.entries(before))assert.deepEqual(identity(after[service]),expected);
for(const [name,expected]of Object.entries(sources))assert.equal(sha(fs.readFileSync(path.join(root,name))),expected,'Captured source changed: '+name);
report.identitiesUnchanged=true;report.sourcesUnchanged=true;
report.pass=outcome.code===0 && outcome.signal===null && /# tests 17\r?\n/.test(outcome.stdout)
  && /# fail 0\r?\n/.test(outcome.stdout) && /# skipped 0\r?\n/.test(outcome.stdout);save();
console.log(JSON.stringify({pass:report.pass,reportPath}));assert.equal(report.pass,true,'API_RELEASE_NATIVE_ACCEPTANCE_FAILED');
