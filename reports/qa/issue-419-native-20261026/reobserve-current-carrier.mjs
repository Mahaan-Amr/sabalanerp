/** Fresh finite inventory. Content receipts are references, never live leases or master tokens. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {prepareOriginalPrivateEvidenceDirectory} from '../../../scripts/lib/original-private-evidence-directory.mjs';
import {inspectPrivateDockerArchive} from '../../../scripts/lib/private-docker-image-archive.mjs';
const dir=import.meta.dirname,repo=path.resolve(dir,'../../..'),operation=randomBytes(16).toString('hex');
const privateDirectory=path.resolve('D:/sabalanerp-online-qa/419-current-observation-'+operation),sha=b=>createHash('sha256').update(b).digest('hex'),commands=originalBackendBaseCommands();
const report={format:'sabalan-419-fresh-maintenance-observation/v1',operation,startedAt:new Date().toISOString(),pass:false,applicationReady:false,runtimeAccepted:false,productionAdmission:false,masterStarted:false,children:[]};let lease;
async function run(executable,args,input){const row=await commands.run(executable,args,{input,cwd:repo,maximum:4*1024**2});
 const sensitive=executable==='docker'&&(args[0]==='inspect'||['image','network','volume'].includes(args[0])&&args[1]==='inspect');
 let ref;if(sensitive){const file=path.join(privateDirectory,'command-'+report.children.length+'.json');fs.writeFileSync(file,JSON.stringify(row),{flag:'wx',mode:0o600});ref={file,sha256:sha(fs.readFileSync(file))};}
 report.children.push({executable,args,originalPid:row.originalPid,code:row.code,signal:row.signal,naturalChildClosure:row.naturalChildClosure,...(sensitive?{privateResult:ref}:{stdout:row.stdout,stderr:row.stderr})});commands.assertSuccessful(row);return row.stdout;}
async function status(){lease.assertHeld();const rows=(await run('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json'])).trim().split(/\r?\n/).map(JSON.parse);assert.ok(rows.length===10&&rows.every(r=>r.Project==='sabalanerp-local'&&r.State==='running'&&r.Health==='healthy'));return rows;}
async function docker(args,input){await status();return run('docker',args,input);}
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};await assert.rejects(acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);report.lease.contenderRefused=true;
 await prepareOriginalPrivateEvidenceDirectory(privateDirectory);report.privateDirectory=privateDirectory;
 report.capacity={backing:{},fullAdmission:false};for(const[p,reserve]of[['C:/',12n*1024n**3n],['D:/',16n*1024n**3n]]){const s=fs.statfsSync(p,{bigint:true}),available=s.bavail*s.bsize;assert.ok(available>=reserve+512n*1024n**2n);report.capacity.backing[p]={availableBytes:String(available),retainedReserveBytes:String(reserve),observationWorkspaceBytes:String(512n*1024n**2n)};}assert.ok(os.freemem()>=512*1024**2);report.capacity.availableMemoryBytes=os.freemem();
 report.existingMasterProcesses=JSON.parse(await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$p=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match 'run-original-online-qualification-master|select-preservation-carrier|build-inquiry-preservation-carrier|exercise-built-carrier'}); ConvertTo-Json -InputObject @($p | Select-Object ProcessId,Name) -Compress"]));assert.equal(report.existingMasterProcesses.length,0,'EXISTING_OWNER_REQUIRES_ORIGINAL_CONTROL');
 const rows=await status(),all=Object.fromEntries(JSON.parse(await docker(['inspect',...rows.map(r=>r.ID)])).map(r=>[r.Config.Labels['com.docker.compose.service'],r]));
 report.identities=Object.fromEntries(Object.entries(all).map(([s,r])=>[s,{id:r.Id,image:r.Image,startedAt:r.State.StartedAt,nativeDescriptor:r.ImageManifestDescriptor}]));
 const build=JSON.parse(fs.readFileSync(path.join(dir,'CARRIER-REPAIR-BUILD-651552eec55a98fb321995b20f92b4ef.json'))),recipeRaw=fs.readFileSync(build.recipe.file);assert.equal(sha(recipeRaw),build.recipe.sha256);const recipe=JSON.parse(recipeRaw);
 const graph=inspectPrivateDockerArchive(fs.realpathSync(build.archive.file),build.graph.index);assert.deepEqual(graph,build.graph);
 const inquiry=all.inquiry,retained=all['backend-retained'];assert.equal(inquiry.Image,graph.index);assert.equal(inquiry.ImageManifestDescriptor.digest,graph.platform);assert.equal(inquiry.ImageManifestDescriptor.size,6179);
 const [image]=JSON.parse(await docker(['image','inspect',graph.index]));assert.equal(image.Id,graph.index);assert.equal(image.Descriptor.digest,graph.index);assert.deepEqual(image.RootFS.Layers,graph.rootfsDiffIds);report.graph=graph;
 const data=inquiry.Mounts.find(m=>m.Destination==='/data');assert.ok(data&&!data.RW);assert.ok(inquiry.Mounts.filter(m=>m.Name===data.Name).every(m=>!m.RW));
 const hashes=JSON.parse(await docker(['exec',inquiry.Id,'node','-e',`const fs=require('fs'),c=require('crypto');console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(recipe.files))}.map(n=>[n,c.createHash('sha256').update(fs.readFileSync('/'+n)).digest('hex')]))));`]));
 for(const [name,row]of Object.entries(recipe.files))assert.equal(hashes[name],row.sha256);report.actualStartupFileHashes=hashes;
 await docker(['exec',inquiry.Id,'/usr/local/bin/node','/app/local-inquiry-preservation-carrier.cjs','health']);
 const response=JSON.parse(await docker(['exec',inquiry.Id,'node','-e',"fetch('http://127.0.0.1:3001/_carrier/conservation').then(async r=>console.log(JSON.stringify({status:r.status,...await r.json()}))).catch(()=>{process.exitCode=1;});"]));assert.equal(response.status,503);assert.equal(response.maintenanceReady,true);assert.equal(response.applicationReady,false);assert.equal(response.runtimeAccepted,false);report.maintenance=response;
 const mount=retained.Mounts.find(m=>m.Name===data.Name);assert.ok(mount&&!mount.RW);
 const guardSource=fs.readFileSync(path.join(repo,'deploy/scripts/local-inquiry-preservation.py'),'utf8').replaceAll('\r\n','\n');assert.equal(sha(guardSource),recipe.sourcePins['deploy/scripts/local-inquiry-preservation.py'].sha256);
 const contractRaw=fs.readFileSync(path.join(build.privateDirectory,'context/local-inquiry-original.json'),'utf8');assert.equal(sha(contractRaw),build.contractSha256);
 const code=String.raw`import sys,json,hashlib
from pathlib import Path
p=json.load(sys.stdin);raw=p['source'].encode();assert hashlib.sha256(raw).hexdigest()==p['sha256'];s={'__name__':'frozen_observer'};exec(compile(raw,'frozen-observer','exec'),s)
f=Path(p['file']);a=s['snapshot'](f);assert a==p['contract']['original'];s['readonly_mount'](f)
print(json.dumps({'snapshot':a,'originalUnchanged':True,'readonlyMount':True}))`;
 report.original=JSON.parse(await docker(['exec','-i',retained.Id,'/usr/bin/python3','-I','-B','-c',code],JSON.stringify({source:guardSource,sha256:sha(guardSource),file:mount.Destination+'/inquiry.db',contract:JSON.parse(contractRaw)})));
 const [network]=JSON.parse(await docker(['network','inspect',...Object.keys(inquiry.NetworkSettings.Networks)]));const volumes=JSON.parse(await docker(['volume','inspect',...inquiry.Mounts.map(m=>m.Name)]));report.resources={network:{id:network.Id,name:network.Name,driver:network.Driver},volumes:volumes.map(v=>({name:v.Name,driver:v.Driver,mountpoint:v.Mountpoint}))};
 report.imageStore=JSON.parse(await docker(['info','--format','{"driver":{{json .Driver}},"driverStatus":{{json .DriverStatus}},"id":{{json .ID}}}']));report.pass=true;
}catch{report.error='FRESH_CURRENT_OBSERVATION_REFUSED';process.exitCode=1;}
finally{report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;}report.completedAt=new Date().toISOString();const file=path.join(dir,'CURRENT-OBSERVATION-'+operation+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({file,pass:report.pass,error:report.error??null,leaseClosed:report.lease?.closed??false}));}
