/** Finite local behavioral qualification. No image build/UP or application admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
const directory=import.meta.dirname,nonce=randomBytes(16).toString('hex'),commands=originalBackendBaseCommands();
const output=path.join(directory,'CARRIER-REPAIR-BEHAVIOR-'+nonce+'.json');
const report={format:'sabalan-419-carrier-repair-behavior/v1',operation:nonce,startedAt:new Date().toISOString(),pass:false,
  runtimeAccepted:false,applicationReady:false,productionAdmission:false,composeUp:false,imageBuilt:false,children:[]};
const sha=b=>createHash('sha256').update(b).digest('hex');let lease;
async function run(executable,args,input){
  const result=await commands.run(executable,args,{input,maximum:2*1024**2});
  report.children.push({executable,args,originalPid:result.originalPid,code:result.code,signal:result.signal,naturalChildClosure:result.naturalChildClosure,
    stdout:result.stdout,stderr:result.stderr});commands.assertSuccessful(result);return result.stdout;
}
async function status(){lease.assertHeld();const rows=(await run('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json'])).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(rows.length===10&&rows.every(r=>r.Project==='sabalanerp-local'&&r.Health==='healthy'));return rows;}
async function docker(args,input){await status();return run('docker',args,input);}
try{
  lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};
  await assert.rejects(acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);report.lease.contenderRefused=true;
  report.backingCapacity={};for(const p of ['C:/','D:/']){const s=fs.statfsSync(p,{bigint:true}),available=s.bavail*s.bsize;assert.ok(available>=2n*1024n**3n);report.backingCapacity[p]={availableBytes:String(available),reserveBytes:String(2n*1024n**3n)};}
  assert.ok(os.freemem()>512*1024**2);report.availableMemoryBytes=os.freemem();
  const rows=await status();report.servicesBefore=rows.map(r=>({id:r.ID,service:r.Service}));
  const inspect=JSON.parse(await docker(['inspect',...rows.map(r=>r.ID)]));
  const inquiry=inspect.find(r=>r.Config.Labels['com.docker.compose.service']==='inquiry'),retained=inspect.find(r=>r.Config.Labels['com.docker.compose.service']==='backend-retained');
  const volume=inquiry.Mounts.find(r=>r.Destination==='/data'),mount=retained.Mounts.find(r=>r.Name===volume.Name);assert.ok(mount&&!mount.RW);
  const target='/app/online-runtime-acceptance/issue419-carrier-repair-'+nonce;
  const contents=Object.fromEntries([
    ['local-inquiry-preservation.py','deploy/scripts/local-inquiry-preservation.py'],
    ['local-inquiry-preservation-carrier.cjs','deploy/scripts/local-inquiry-preservation-carrier.cjs'],
    ['inquiry-baseline.json','backend/src/services/inquiryBaseline.json'],
    ['verify-inquiry-database.cjs','deploy/scripts/verify-inquiry-database.cjs'],
    ['local-inquiry-preservation.fixture.py','tests/online-deployment/local-inquiry-preservation.fixture.py'],
    ['local-inquiry-maintenance.fixture.cjs','tests/online-deployment/local-inquiry-maintenance.fixture.cjs']
  ].map(([name,file])=>[name,fs.readFileSync(path.resolve(directory,'../../..',file),'utf8').replaceAll('\r\n','\n')]));
  report.sources=Object.fromEntries(Object.entries(contents).map(([name,source])=>[name,{sha256:sha(source),bytes:Buffer.byteLength(source)}]));
  const setup=String.raw`import json,sys,os,hashlib,importlib.util
from pathlib import Path
p=json.load(sys.stdin);parent=Path('/app/online-runtime-acceptance');v=os.statvfs(parent);required=128*1024**2;assert v.f_bavail*v.f_frsize>=required
root=Path(p['root']);root.mkdir(mode=0o700)
for name,body in p['files'].items():
 assert Path(name).name==name;f=root/name
 with f.open('xb')as stream:stream.write(body.encode());stream.flush();os.fsync(stream.fileno())
 os.chmod(f,0o600)
s=importlib.util.spec_from_file_location('guard',root/'local-inquiry-preservation.py');g=importlib.util.module_from_spec(s);s.loader.exec_module(g)
original=g.snapshot(Path(p['original']));g.readonly_mount(Path(p['original']))
contract={'format':'sabalan-local-inquiry-conservation/v1','role':'CARRIER_READY_NOT_SERVING','original':original,'baselineSha256':hashlib.sha256((root/'inquiry-baseline.json').read_bytes()).hexdigest()}
with(root/'local-inquiry-original.json').open('x')as stream:stream.write(json.dumps(contract,indent=2)+'\n');stream.flush();os.fsync(stream.fileno())
os.chmod(root/'local-inquiry-original.json',0o400)
g.verify(Path(p['original']),contract,root/'inquiry-baseline.json')
print(json.dumps({'directory':str(root),'contract':contract,'capacity':{'destination':str(parent),'device':str(parent.stat().st_dev),'availableBytes':v.f_bavail*v.f_frsize,'requiredBytes':required}}))`;
  report.staged=JSON.parse(await docker(['exec','-i',retained.Id,'/usr/bin/python3','-I','-B','-c',setup],JSON.stringify({root:target,files:contents,original:mount.Destination+'/inquiry.db'})));
  report.python=await docker(['exec','-e','INQUIRY_CONSERVATION_ORIGINAL='+mount.Destination+'/inquiry.db',retained.Id,'/usr/bin/python3','-I','-B',target+'/local-inquiry-preservation.fixture.py']);
  const localEnvironment=['BACKEND_ONLINE_SCOPE_FILE','BACKEND_ONLINE_SCOPE_SHA256','INQUIRY_NATIVE_AUTHORITY_FILE','INQUIRY_NATIVE_CLAIM_SHA256','INQUIRY_RUNTIME_GENERATION','BACKEND_RUNTIME_ROLE'].flatMap(key=>['-u',key]);
  report.node=await docker(['exec','-e','INQUIRY_CONSERVATION_ORIGINAL='+mount.Destination+'/inquiry.db',retained.Id,'env',...localEnvironment,'node','--test',target+'/local-inquiry-maintenance.fixture.cjs']);
  // Exact self-contained fallback source, exercised inside the actual old image.
  // No file/app/DB access is invoked in this maintenance-only process.
  const fallbackSource=contents['local-inquiry-preservation-carrier.cjs'];report.fallbackSourceSha256=sha(fallbackSource);
  const invocation=`\n(async()=>{const s=module.exports.serve({port:0,host:'127.0.0.1',identity:'${sha(JSON.stringify(report.staged.contract))}'});await new Promise(r=>s.once('listening',r));const port=s.address().port;try{await module.exports.health('${sha(JSON.stringify(report.staged.contract))}',port);for(const method of ['GET','POST']){const r=await fetch('http://127.0.0.1:'+port+'/',{method});if(r.status!==503)throw Error('FALLBACK_SERVING');await r.text();}}finally{await new Promise(r=>{s.close(r);s.closeAllConnections();});}console.log(JSON.stringify({maintenanceReady:true,applicationReady:false,databaseOpened:false,listenerClosed:true,readersClosed:true}));})().catch(()=>{console.error('FALLBACK_TEST_FAILED');process.exitCode=1;});`;
  report.fallback=JSON.parse(await docker(['exec',inquiry.Id,'/usr/local/bin/node','-e',fallbackSource+invocation]));
  const final=JSON.parse(await docker(['exec',retained.Id,'/usr/bin/python3','-I','-B',target+'/local-inquiry-preservation.py',mount.Destination+'/inquiry.db',target+'/local-inquiry-original.json',target+'/inquiry-baseline.json']));
  assert.equal(final.originalUnchanged,true);report.finalConservation=final;
  report.servicesAfter=(await status()).map(r=>({id:r.ID,service:r.Service}));assert.deepEqual(report.servicesAfter,report.servicesBefore);
  report.pass=true;
}catch{report.error='LOCAL_CARRIER_BEHAVIOR_REFUSED';process.exitCode=1;}
finally{
  report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;}
  report.completedAt=new Date().toISOString();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({file:output,pass:report.pass,error:report.error??null}));
}
