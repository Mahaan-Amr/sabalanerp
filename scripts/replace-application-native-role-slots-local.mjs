import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..'),base='D:/sabalanerp/docker-compose.local.yml';
assert.equal(process.argv.length,3);assert.ok(['--inspect','--replace'].includes(process.argv[2]));
const inspectOnly=process.argv[2]==='--inspect';
const imageReceiptFile='D:/sabalanerp-online-qa/current-backend-image-41f7dd679cc93ae31d18380c1c13786c/image-receipt.json';
const materialReceiptFile='D:/sabalanerp-online-qa/current-backend-material-d320bded734e4af6b7aede2f0c1fa7a9/material-receipt.json';
const imageReceiptRaw=fs.readFileSync(imageReceiptFile),imageReceipt=JSON.parse(imageReceiptRaw);
const materialReceiptRaw=fs.readFileSync(materialReceiptFile),materialReceipt=JSON.parse(materialReceiptRaw);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(imageReceipt.pass,true);assert.equal(imageReceipt.sourceUnchanged,true);assert.equal(imageReceipt.protectedServicesUnchanged,true);
assert.equal(imageReceipt.originalChildren.allOriginalChildrenClosed,true);assert.equal(imageReceipt.originalChildren.interrupted,false);
assert.equal(imageReceipt.materialReceiptSha256,digest(materialReceiptRaw));assert.equal(materialReceipt.materialized,true);
const image='sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186';assert.equal(imageReceipt.image.id,image);
const removedCodeTargets=['/app/dist','/packages/partner-sales-contracts/dist','/packages/contract-product-graph/dist'];
const installedProbeFile=path.join(root,'tests/online-deployment/installed-native-image-probe.fixture.mjs');
const installedProbe=fs.readFileSync(installedProbeFile);
function expectedInventory(prefix){const entries=materialReceipt.files.filter(row=>row.path.startsWith(prefix))
 .map(row=>({bytes:row.bytes,path:row.path.slice(prefix.length),sha256:row.sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 assert.ok(entries.length>0);return{sha256:digest(Buffer.from(JSON.stringify(entries))),entries};}
const expectedDist=expectedInventory('app/dist/'),expectedClient=expectedInventory('app/node_modules/@prisma/client/');
const expectedEntry=materialReceipt.files.find(row=>row.path==='app/dist/onlinePrivateQualification.js');assert.ok(expectedEntry);
const protectedServices=['backend','frontend','postgres','inquiry','redis','clamav','frontend-candidate','frontend-retained'];
const slots=['backend-candidate','backend-retained'];
const rows=raw=>{try{const value=JSON.parse(raw);return Array.isArray(value)?value:[value];}
  catch{return raw.trim().split(/\r?\n/).map(line=>JSON.parse(line));}};
function status(){const values=rows(execFileSync('docker',['compose','-f',base,'ps','--format','json'],{encoding:'utf8'}));
  for(const service of [...protectedServices,...slots])assert.ok(values.some(value=>value.Project==='sabalanerp-local'
    &&value.Service===service&&value.State==='running'&&value.Health==='healthy'));return values;}
function docker(args){status();return execFileSync('docker',args,{encoding:'utf8',maxBuffer:8*1024**2});}
function inspect(service){const [value]=JSON.parse(docker(['inspect','sabalanerp-local-'+service+'-1']));
  assert.equal(value.Config.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(value.Config.Labels['com.docker.compose.service'],service);return value;}
const identity=value=>({id:value.Id,image:value.Image,startedAt:value.State.StartedAt});
const protectedBefore=Object.fromEntries(protectedServices.map(service=>[service,identity(inspect(service))]));
const previous=Object.fromEntries(slots.map(service=>[service,inspect(service)]));
const sourceDist=previous['backend-candidate'].Mounts.find(value=>value.Destination==='/app/dist');assert.ok(!sourceDist||!sourceDist.RW);
const sourceRoot=sourceDist?path.dirname(path.dirname(sourceDist.Source)):root;
assert.equal(previous['backend-retained'].Image,previous['backend-candidate'].Image);
const [installedImage]=JSON.parse(docker(['image','inspect',image]));
assert.equal(installedImage.Id,image);assert.deepEqual(installedImage.RootFS.Layers,imageReceipt.image.layers);
const overlays=['docker-compose.online-acceptance.yml','docker-compose.online-runtime-authority-acceptance.yml',
  'docker-compose.application-native-role-isolation.yml'].map(name=>path.join(root,name));
const env={...process.env,ONLINE_ACCEPTANCE_BASE_COMPOSE:base,ONLINE_ACCEPTANCE_SOURCE_ROOT:sourceRoot,
  ONLINE_ACCEPTANCE_BACKEND_IMAGE:image,ONLINE_ACCEPTANCE_FRONTEND_IMAGE:inspect('frontend-candidate').Image,
  ONLINE_ACCEPTANCE_FRONTEND_DIST:path.join(sourceRoot,'frontend'),ONLINE_ACCEPTANCE_BROWSER_BUILD_ID:'configuration_only_not_deployed'};
const compose=['compose','-f',base,...overlays.flatMap(file=>['-f',file]),'--profile','online-acceptance'];
status();const configuration=JSON.parse(execFileSync('docker',[...compose,'config','--format','json'],{env,encoding:'utf8',maxBuffer:8*1024**2}));
assert.equal(configuration.name,'sabalanerp-local');
for(const service of slots){const wanted=configuration.services[service],old=previous[service];
  assert.equal(wanted.image,image);assert.deepEqual(wanted.command,old.Config.Cmd);assert.equal(Number(wanted.mem_limit),old.HostConfig.Memory);
  assert.equal(wanted.read_only,old.HostConfig.ReadonlyRootfs);assert.deepEqual(wanted.cap_drop??[],old.HostConfig.CapDrop??[]);
  assert.deepEqual(wanted.security_opt??[],old.HostConfig.SecurityOpt??[]);
  assert.equal(Math.round(Number(wanted.cpus)*1e9),old.HostConfig.NanoCpus);
  assert.equal(wanted.privileged??false,old.HostConfig.Privileged);assert.equal(wanted.pids_limit??0,old.HostConfig.PidsLimit??0);
  const wantedPorts=(wanted.ports??[]).map(value=>({host:value.host_ip,port:String(value.published),target:String(value.target)+'/tcp'}));
  const oldPorts=Object.entries(old.HostConfig.PortBindings??{}).flatMap(([target,values])=>values.map(value=>({host:value.HostIp,port:value.HostPort,target})));
  assert.deepEqual(wantedPorts,oldPorts);
  const oldMounts=new Map(old.Mounts.map(value=>[value.Destination,value]));
  for(const target of removedCodeTargets)assert.ok(!wanted.volumes.some(volume=>volume.target===target));
  for(const volume of wanted.volumes){const existing=oldMounts.get(volume.target);
    assert.ok(existing,'unexpected mount '+volume.target);assert.equal(!volume.read_only,existing.RW);
    if(volume.type==='bind')assert.equal(path.resolve(volume.source).toLowerCase(),path.resolve(existing.Source).toLowerCase());
    else assert.equal(configuration.volumes[volume.source].name,existing.Name);
  }
  const remainingOld=old.Mounts.filter(value=>!removedCodeTargets.includes(value.Destination));assert.equal(wanted.volumes.length,remainingOld.length);
  assert.deepEqual(wanted.volumes.map(value=>value.target).sort(),remainingOld.map(value=>value.Destination).sort());
}
const processProbe=String.raw`import os,json,stat
from pathlib import Path
found=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit() or int(p.name)==os.getpid(): continue
 try:
  argv=(p/'cmdline').read_bytes().split(b'\0')
  if any(Path(a.decode(errors='strict')).name in ['online-runtime-owner.py','online-inquiry-owner.py','fixture.py','application-native-candidate-controller.py','run-full-catalog-controller.py','chromium','chrome','chrome_crashpad_handler'] for a in argv if a): found.append(int(p.name))
 except FileNotFoundError: pass
assert not found, 'APPLICATION_ROLE_ORIGINAL_OWNER_STILL_PRESENT'
closed=0; unused=0
def read(file):
 fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size<=4*1024**2
  data=os.read(fd,before.st_size+1);after=os.fstat(fd);named=os.lstat(file)
  identity=lambda value:(value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns)
  assert len(data)==before.st_size and identity(before)==identity(after)==identity(named)
  return json.loads(data)
 finally:os.close(fd)
def grants(value):
 if isinstance(value,dict):
  if isinstance(value.get('scope'),dict) and 'nativeDirectory' in value['scope']:yield value['scope']
  else:
   for child in value.values():yield from grants(child)
 elif isinstance(value,list):
  for child in value:yield from grants(child)
seen=set()
for operation in Path('/app/online-runtime-acceptance').glob('application-native-*'):
 index=operation/'index.json'
 if not index.exists():continue
 for scope in grants(read(index)):
  directory=Path(scope['nativeDirectory']);file=directory/'deployment-runtime-native.json'
  if str(file) in seen:continue
  seen.add(str(file))
  if not file.exists():unused+=1;continue
  native=read(file)
  assert native['phase']=='QUIESCENT' and native['nativeReaped'] is True,'APPLICATION_ROLE_DURABLE_OWNER_UNKNOWN'
  assert native.get('databaseQuiet') is True or native.get('sqliteNativeClosed') is True,'APPLICATION_ROLE_DURABLE_SQL_UNKNOWN'
  work=Path(scope['boundaryDirectory'])/'state.json'
  if work.exists():assert read(work)['phase']=='QUIESCENT','APPLICATION_ROLE_DURABLE_WORK_UNKNOWN'
  closed+=1
print(json.dumps(dict(originalNativeProcesses=0,denyUnknownGrantRecordsChecked=closed,unusedGrantRecords=unused,adoptsOriginalPopen=False)))`;
const processQuiet=()=>Object.fromEntries(slots.map(service=>[service,JSON.parse(docker(['exec',previous[service].Id,'/usr/bin/python3','-I','-B','-c',processProbe]))]));
const sqlQuiet=()=>{const value=JSON.parse(docker(['exec',inspect('postgres').Id,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',
  "SELECT json_build_object('visible',(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member') FROM pg_roles WHERE rolname=current_user),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sabalan-rt-%'),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database LIKE 'qa_application_%'),'system',(SELECT system_identifier::text FROM pg_control_system()))"]));
  assert.equal(value.visible,true);assert.equal(value.sessions,0);assert.equal(value.prepared,0);return value;};
const operation=randomBytes(16).toString('hex'),reportPath=path.join(root,'reports/qa/application-native-role-slots-'+operation+'.json');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inputs=Object.fromEntries([base,...overlays,import.meta.filename,imageReceiptFile,materialReceiptFile,installedProbeFile].map(file=>[file,hash(file)]));
const report={format:'sabalan-application-native-role-slots/v1',operation,pass:false,phase:'INTENT',productionAdmission:false,
  onlyTwoExistingRoles:true,originalLimitsUnchanged:true,protectedBefore,previous:Object.fromEntries(slots.map(service=>[service,identity(previous[service])])),inputs,
  immutableImage:image,materialReceiptSha256:digest(materialReceiptRaw),imageReceiptSha256:digest(imageReceiptRaw),removedCodeTargets,
  nativeQuiet:processQuiet(),sqlQuiet:sqlQuiet()};
const save=()=>{fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');};save();
if(inspectOnly){report.phase='INSPECTION_COMPLETE';report.inspectionOnly=true;save();console.log(JSON.stringify({inspectionOnly:true,reportPath}));process.exit(0);}
const children=[];
try{
  for(const [file,digest]of Object.entries(inputs))assert.equal(hash(file),digest);
  report.preMutationNativeQuiet=processQuiet();report.preMutationSqlQuiet=sqlQuiet();save();
  status();report.up=await new Promise(resolve=>{const child=spawn('docker',[...compose,'up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','120',...slots],{env,stdio:['ignore','pipe','pipe']});
    children.push(child);let stdout='',stderr='';child.stdout.on('data',bytes=>{stdout+=bytes;});child.stderr.on('data',bytes=>{stderr+=bytes;});
    child.on('error',error=>{report.spawnError=error.code;save();});child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});
  save();assert.equal(report.up.code,0);assert.equal(report.up.signal,null);assert.equal(report.spawnError,undefined);
  report.protectedAfter=Object.fromEntries(protectedServices.map(service=>[service,identity(inspect(service))]));assert.deepEqual(report.protectedAfter,protectedBefore);
  const actual=Object.fromEntries(slots.map(service=>[service,inspect(service)]));
  for(const service of slots){const value=actual[service];assert.equal(value.Image,image);
    assert.equal(value.HostConfig.Memory,previous[service].HostConfig.Memory);assert.deepEqual(value.Config.Cmd,previous[service].Config.Cmd);}
  for(const service of slots)assert.ok(!actual[service].Mounts.some(value=>removedCodeTargets.includes(value.Destination)));
  const candidate=actual['backend-candidate'],retained=actual['backend-retained'];
  const mount=(value,target)=>{const found=value.Mounts.find(entry=>entry.Destination===target);assert.ok(found);return found;};
  const http=mount(retained,'/run/sabalan-online'),httpWriter=mount(candidate,'/app/runtime-authority');
  const jobs=mount(candidate,'/run/sabalan-online'),jobsWriter=mount(retained,'/app/jobs-authority');
  assert.equal(http.RW,false);assert.equal(jobs.RW,false);assert.equal(httpWriter.RW,true);assert.equal(jobsWriter.RW,true);
  assert.equal(http.Source,httpWriter.Source);assert.equal(jobs.Source,jobsWriter.Source);assert.notEqual(http.Source,jobs.Source);
  assert.ok(!retained.Mounts.some(value=>value.Source===http.Source&&value.RW));assert.ok(!candidate.Mounts.some(value=>value.Source===jobs.Source&&value.RW));
  report.actual=Object.fromEntries(slots.map(service=>[service,{...identity(actual[service]),host:actual[service].NetworkSettings.Networks['sabalanerp-local_default'].IPAddress,
    mounts:actual[service].Mounts.map(value=>({source:value.Source,target:value.Destination,rw:value.RW}))}]));
  report.installed={};
  for(const service of slots){status();const observation=await new Promise(resolve=>{
    const child=spawn('docker',['exec','-i',actual[service].Id,'node','--input-type=module'],{stdio:['pipe','pipe','pipe']});children.push(child);
    let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=8*1024**2)stdout+=bytes;else failure??='INSTALLED_PROBE_STDOUT_BOUND';});
    child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='INSTALLED_PROBE_STDERR_BOUND';});
    child.stdin.on('error',error=>{failure??=error.code;});child.on('error',error=>{failure??=error.code;});
    child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure}));child.stdin.end(installedProbe);
   });
   report.installed[service]={...observation};save();assert.equal(observation.code,0);assert.equal(observation.signal,null);assert.equal(observation.failure,undefined);
   const result=JSON.parse(observation.stdout);assert.equal(result.format,'sabalan-actual-installed-native-image/v1');
   assert.equal(result.entrySha256,expectedEntry.sha256);assert.equal(result.schemaSha256,materialReceipt.schemaSha256);
   assert.equal(result.dist.sha256,expectedDist.sha256);assert.deepEqual(result.dist.entries,expectedDist.entries);
   assert.equal(result.client.sha256,expectedClient.sha256);assert.deepEqual(result.client.entries,expectedClient.entries);
   assert.equal(result.applicationStarted,false);assert.equal(result.databaseConnected,false);
   report.installed[service]={originalPid:observation.originalPid,code:0,signal:null,stderr:observation.stderr,result};save();
  }
  report.privateQualificationRuntime={entryPath:'/app/dist/onlinePrivateQualification.js',entrySha256:expectedEntry.sha256,
   distTreeSha256:expectedDist.sha256,schemaSha256:materialReceipt.schemaSha256,clientInventorySha256:expectedClient.sha256};
  report.finalProtected=Object.fromEntries(protectedServices.map(service=>[service,identity(inspect(service))]));assert.deepEqual(report.finalProtected,protectedBefore);
  for(const [file,digest]of Object.entries(inputs))assert.equal(hash(file),digest);
  report.pass=true;report.phase='COMPLETE';save();
}catch(error){report.failure={name:error.name,message:error.message};report.phase='FAILED_CLOSED';save();
  if(children.some(child=>child.exitCode===null)){await new Promise(()=>{setInterval(()=>{void children;},30000);});}
  throw error;
}
