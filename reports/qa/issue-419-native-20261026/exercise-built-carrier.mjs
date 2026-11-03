/** Execute the built artifact's startup tools inside the existing retained service. No UP/new container. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {prepareOriginalPrivateEvidenceDirectory} from '../../../scripts/lib/original-private-evidence-directory.mjs';
const directory=import.meta.dirname,repo=path.resolve(directory,'../../..'),nonce=randomBytes(16).toString('hex');
const local=path.resolve('D:/sabalanerp-online-qa/inquiry-carrier-abi-'+nonce),target='/app/online-runtime-acceptance/issue419-carrier-abi-'+nonce;
const commands=originalBackendBaseCommands(),sha=b=>createHash('sha256').update(b).digest('hex');let lease;
const report={format:'sabalan-419-built-inquiry-executable-probe/v1',operation:nonce,pass:false,applicationReady:false,runtimeAccepted:false,productionAdmission:false,composeUp:false,imageBuilt:false,children:[]};
async function run(executable,args,input){const result=await commands.run(executable,args,{input,maximum:4*1024**2,cwd:repo});
  report.children.push({executable,args,originalPid:result.originalPid,code:result.code,signal:result.signal,naturalChildClosure:result.naturalChildClosure,
    ...(executable==='docker'&&args[0]==='inspect'?{privateStdoutSha256:sha(result.stdout)}:{stdout:result.stdout}),stderr:result.stderr});
  commands.assertSuccessful(result);return result.stdout;}
async function status(){lease.assertHeld();const rows=(await run('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json'])).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(rows.length===10&&rows.every(r=>r.Project==='sabalanerp-local'&&r.Health==='healthy'));return rows;}
async function docker(args,input){await status();return run('docker',args,input);}
try{
  lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};
  await assert.rejects(acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);report.lease.contenderRefused=true;
  await prepareOriginalPrivateEvidenceDirectory(local);report.local=local;report.capacity={backing:{},fullAdmission:false};
  for(const[p,reserve]of[['C:/',12n*1024n**3n],['D:/',16n*1024n**3n]]){const s=fs.statfsSync(p,{bigint:true}),available=s.bavail*s.bsize;assert.ok(available>=reserve+1024n**3n);report.capacity.backing[p]={availableBytes:String(available),retainedReserveBytes:String(reserve),additionalProbeBytes:String(1024n**3n)};}
  const buildFile=path.join(directory,'CARRIER-REPAIR-BUILD-651552eec55a98fb321995b20f92b4ef.json'),build=JSON.parse(fs.readFileSync(buildFile));assert.equal(build.pass,true);
  report.build={file:buildFile,sha256:sha(fs.readFileSync(buildFile)),graph:build.graph};
  const program=path.join(repo,'scripts/exercise-local-inquiry-carrier-artifact.py');report.program={file:program,sha256:sha(fs.readFileSync(program))};
  const packed=JSON.parse(await run('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B',program,'pack',build.archive.file,build.archive.sha256,build.graph.index,path.join(local,'startup-tools.tar')]));report.pack=packed;
  const identities=rows=>Object.fromEntries(rows.map(r=>[r.Config.Labels['com.docker.compose.service'],{id:r.Id,image:r.Image,startedAt:r.State.StartedAt}]));
  const before=JSON.parse(await docker(['inspect',...(await status()).map(r=>r.ID)]));report.identitiesBefore=identities(before);
  const retained=before.find(r=>r.Config.Labels['com.docker.compose.service']==='backend-retained'),inquiry=before.find(r=>r.Config.Labels['com.docker.compose.service']==='inquiry');
  const mount=retained.Mounts.find(r=>r.Name===inquiry.Mounts.find(r=>r.Destination==='/data').Name);assert.ok(mount&&!mount.RW);
  const behavior=JSON.parse(fs.readFileSync(path.join(directory,'CARRIER-REPAIR-BEHAVIOR-22a7a4d49ffed7a22af66cf2508ba246.json')));
  async function conserve(){const root=behavior.staged.directory;return JSON.parse(await docker(['exec',retained.Id,'/usr/bin/python3','-I','-B',root+'/local-inquiry-preservation.py',mount.Destination+'/inquiry.db',root+'/local-inquiry-original.json',root+'/inquiry-baseline.json']));}
  report.originalBefore=await conserve();
  const stage=String.raw`import sys,json,os
from pathlib import Path
p=json.load(sys.stdin);parent=Path('/app/online-runtime-acceptance');v=os.statvfs(parent);assert v.f_bavail*v.f_frsize>=1024**3
root=Path(p['root']);root.mkdir(mode=0o700);f=root/'exercise.py'
with f.open('x')as stream:stream.write(p['source']);stream.flush();os.fsync(stream.fileno())
os.chmod(f,0o600)
assert not(root/'startup-tools.tar').exists();print(json.dumps({'destination':str(root),'device':str(parent.stat().st_dev),'availableBytes':v.f_bavail*v.f_frsize,'requiredBytes':1024**3}))`;
  report.capacity.destination=JSON.parse(await docker(['exec','-i',retained.Id,'/usr/bin/python3','-I','-B','-c',stage],JSON.stringify({root:target,source:fs.readFileSync(program,'utf8')})));
  await docker(['cp',packed.file,retained.Id+':'+target+'/startup-tools.tar']);
  report.execution=JSON.parse(await docker(['exec',retained.Id,'/usr/bin/python3','-I','-B',target+'/exercise.py','exercise',target+'/startup-tools.tar',packed.sha256,target+'/rootfs']));assert.equal(report.execution.pass_,true);
  report.originalAfter=await conserve();assert.deepEqual(report.originalAfter,report.originalBefore);
  report.identitiesAfter=identities(JSON.parse(await docker(['inspect',...(await status()).map(r=>r.ID)])));assert.deepEqual(report.identitiesAfter,report.identitiesBefore);
  assert.equal(sha(fs.readFileSync(program)),report.program.sha256);report.pass=true;
}catch{report.error='BUILT_CARRIER_EXECUTABLE_PROBE_REFUSED';process.exitCode=1;}
finally{
  report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;}
  report.completedAt=new Date().toISOString();fs.writeFileSync(path.join(directory,'CARRIER-REPAIR-ABI-'+nonce+'.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({pass:report.pass,operation:nonce,error:report.error??null}));
}
