import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {stableFrontendBaseFile} from './lib/production-frontend-base-artifacts.mjs';

const root=path.resolve(import.meta.dirname,'..');assert.equal(process.argv.length,3);assert.equal(process.argv[2],'--replace');
const protectedServices=['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained'];
const base='D:/sabalanerp/docker-compose.local.yml',overlay=path.join(root,'docker-compose.application-browser-acceptance.yml');
const slots=[
  {service:'frontend-retained',receipt:'current-frontend-image-f1d2f35620e97112f093e3f2e8815027.json',material:'current-frontend-bundle-fa93e6481b00ee2bb70b1034030bce2d.json',
    image:'sha256:9df9eec8db41a96b86492a04f9d2e18767e9845e861329e6c8036c4e5b77cdb3',oldImage:'sha256:18115db00c511d287a489fdcf4a8028813502704783ae1c7c56054c65db6cdbd',buildId:'erp_online_final_20261019_5b4cc688a771e5a9'},
  {service:'frontend-candidate',receipt:'current-frontend-image-d7f967153b3d7e9ef9a83834c5afb951.json',material:'current-frontend-bundle-be736bc186b1c92103abf56597d8c77b.json',
    image:'sha256:4f52181ce3f08f0b6829b74229a8c97efce9fcb0806b85ca337ec745d4c80724',oldImage:'sha256:6d92341b93109dcd778614172c5d4dffe44fb2c223357390e173c98b29850768',buildId:'erp_online_final_20261019_a7f56e33eec2eb69'},
];
const env={...process.env,ONLINE_BROWSER_OLD_IMAGE:slots[0].image,ONLINE_BROWSER_NEW_IMAGE:slots[1].image,
  ONLINE_BROWSER_OLD_BUILD_ID:slots[0].buildId,ONLINE_BROWSER_NEW_BUILD_ID:slots[1].buildId};
const compose=['compose','-f',base,'-f',overlay,'--profile','application-browser-acceptance'];
function status(){const r=spawnSync('docker',['compose','-f',base,'ps','--format','json'],{encoding:'utf8',maxBuffer:8*1024**2});assert.equal(r.status,0);
  let rows;try{const v=JSON.parse(r.stdout);rows=Array.isArray(v)?v:[v];}catch{rows=r.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));}
  for(const service of protectedServices)assert.ok(rows.some(row=>row.Project==='sabalanerp-local'&&row.Service===service&&row.State==='running'&&row.Health==='healthy'));
  return rows;}
function docker(args){status();const r=spawnSync('docker',args,{env,encoding:'utf8',maxBuffer:8*1024**2});assert.equal(r.status,0);return r.stdout;}
function inspectContainer(service){const rows=JSON.parse(docker(['inspect','sabalanerp-local-'+service+'-1']));assert.equal(rows.length,1);const row=rows[0];
  assert.equal(row.Config.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(row.Config.Labels['com.docker.compose.service'],service);return row;}
function summary(row){return{id:row.Id,image:row.Image,startedAt:row.State.StartedAt,status:row.State.Status,health:row.State.Health?.Status,
  mounts:row.Mounts.map(m=>({type:m.Type,source:m.Source,destination:m.Destination,rw:m.RW})),ports:row.HostConfig.PortBindings??{}};}
function protectedIdentities(){return Object.fromEntries(protectedServices.map(service=>[service,summary(inspectContainer(service))]));}
const inputs={baseFile:stableFrontendBaseFile(base),overlayFile:stableFrontendBaseFile(overlay),helperFile:stableFrontendBaseFile(import.meta.filename)};
const measured=slots.map(slot=>{const file=path.join(root,'reports/qa',slot.receipt),materialFile=path.join(root,'reports/qa',slot.material);
  const receiptFile=stableFrontendBaseFile(file),materialReceiptFile=stableFrontendBaseFile(materialFile);
  const receipt=JSON.parse(fs.readFileSync(file)),material=JSON.parse(fs.readFileSync(materialFile));
  assert.equal(receipt.phase,'COMPLETE');assert.equal(receipt.pass,true);assert.equal(receipt.imageQualified,true);assert.equal(receipt.build.code,0);assert.equal(receipt.build.signal,null);
  assert.equal(receipt.outputImage.id,slot.image);assert.equal(receipt.buildId,slot.buildId);assert.equal(material.bundle.buildId,slot.buildId);
  assert.equal(receipt.materializationReceiptSha256,materialReceiptFile.sha256);
  const image=JSON.parse(docker(['image','inspect',slot.image]))[0];assert.equal(image.Id,slot.image);assert.deepEqual(image.RootFS.Layers,receipt.outputImage.layers);
  assert.deepEqual(Object.keys(image.Config.Volumes??{}),[]);
  const oldImage=JSON.parse(docker(['image','inspect',slot.oldImage]))[0];assert.equal(oldImage.Id,slot.oldImage);
  const before=inspectContainer(slot.service);assert.ok([slot.oldImage,slot.image].includes(before.Image));
  const asset=material.bundle.assets.find(value=>value.path.endsWith('.js'));assert.ok(asset);assert.match(asset.sha256,/^[a-f0-9]{64}$/);
  return{slot,receiptFile,materialReceiptFile,cmd:image.Config.Cmd,entrypoint:image.Config.Entrypoint??null,
    layers:image.RootFS.Layers,asset,before:summary(before)};});
const configuration=JSON.parse(docker([...compose,'config','--format','json']));assert.equal(configuration.name,'sabalanerp-local');
for(const {slot}of measured){const config=configuration.services[slot.service];assert.equal(config.image,slot.image);
  assert.equal(config.read_only,true);assert.equal(config.pull_policy,'never');assert.ok(!config.build&&!config.command&&!config.entrypoint);
  assert.deepEqual(config.ports??[],[]);assert.deepEqual(config.volumes??[],[]);}
const operation=randomBytes(16).toString('hex'),scratch=path.resolve('D:/sabalanerp-online-qa/application-browser-slot-replacement-'+operation);
fs.mkdirSync(scratch,{mode:0o700});const evidence=path.join(root,'reports/qa/application-browser-slot-replacement-'+operation);
const report={format:'sabalan-application-browser-slot-replacement/v1',operation,phase:'INTENT',pass:false,inputs,measured,
  protectedBefore:protectedIdentities(),productionAdmission:false,oldImagesRetained:true,onlyTwoExplicitDiagnosticSlots:true};
const publish=(suffix,value)=>{const fd=fs.openSync(evidence+suffix+'.json','wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
publish('-intent',report);let failure;
try{
  assert.deepEqual(stableFrontendBaseFile(base),inputs.baseFile);assert.deepEqual(stableFrontendBaseFile(overlay),inputs.overlayFile);
  const stdoutPath=path.join(scratch,'up.stdout'),stderrPath=path.join(scratch,'up.stderr');
  const out=fs.openSync(stdoutPath,'wx',0o600),err=fs.openSync(stderrPath,'wx',0o600);let up;
  try{status();up=await new Promise(resolve=>{const child=spawn('docker',[...compose,'up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','120',...slots.map(v=>v.service)],{env,stdio:['ignore',out,err]});
    let spawnError;child.once('error',error=>{spawnError=error.code??'COMPOSE_UP_SPAWN_FAILED';});child.once('close',(code,signal)=>resolve({code,signal,spawnError}));});}
  finally{fs.fsyncSync(out);fs.fsyncSync(err);fs.closeSync(out);fs.closeSync(err);}
  report.up={...up,stdoutPath,stderrPath,stdoutFile:stableFrontendBaseFile(stdoutPath),stderrFile:stableFrontendBaseFile(stderrPath)};publish('-up-result',report.up);
  report.protectedAfter=protectedIdentities();assert.deepEqual(report.protectedAfter,report.protectedBefore);
  assert.equal(up.code,0);assert.equal(up.signal,null);assert.equal(up.spawnError,undefined);
  report.slots=[];
  for(const point of measured){const {slot}=point,row=inspectContainer(slot.service);assert.equal(row.Image,slot.image);assert.equal(row.State.Health.Status,'healthy');
    assert.deepEqual(row.Config.Cmd,point.cmd);assert.deepEqual(row.Config.Entrypoint??null,point.entrypoint);
    assert.equal(row.HostConfig.ReadonlyRootfs,true);assert.deepEqual(row.Mounts,[]);assert.deepEqual(row.HostConfig.PortBindings??{},{});
    assert.ok(row.HostConfig.CapDrop.includes('ALL'));assert.ok(row.HostConfig.SecurityOpt.includes('no-new-privileges:true'));
    const code="const assert=require('node:assert/strict'),crypto=require('node:crypto');(async()=>{const [build,asset,hash,bytes]=process.argv.slice(1);const r=await fetch('http://127.0.0.1:3000/');assert.equal(r.ok,true);const html=await r.text();assert.ok(html.includes(build));const a=await fetch('http://127.0.0.1:3000'+asset);assert.equal(a.status,200);const body=Buffer.from(await a.arrayBuffer());assert.equal(body.length,Number(bytes));assert.equal(crypto.createHash('sha256').update(body).digest('hex'),hash);console.log(JSON.stringify({healthyHttp:true,compiledHtmlBuildId:build,compiledAssetSha256:hash,compiledAssetBytes:body.length}));})().catch(e=>{console.error(e.message);process.exitCode=1});";
    const http=JSON.parse(docker(['exec',row.Id,'node','-e',code,slot.buildId,point.asset.path,point.asset.sha256,String(point.asset.bytes)]));
    report.slots.push({...summary(row),service:slot.service,http});
    assert.deepEqual(stableFrontendBaseFile(path.join(root,'reports/qa',slot.receipt)),point.receiptFile);
    assert.deepEqual(stableFrontendBaseFile(path.join(root,'reports/qa',slot.material)),point.materialReceiptFile);
    assert.equal(JSON.parse(docker(['image','inspect',slot.oldImage]))[0].Id,slot.oldImage);
  }
  assert.deepEqual(protectedIdentities(),report.protectedBefore);
  assert.deepEqual(stableFrontendBaseFile(import.meta.filename),inputs.helperFile);
  Object.assign(report,{phase:'COMPLETE',pass:true,protectedEightUnchanged:true});
}catch(error){failure=error;Object.assign(report,{phase:'FAILED_HELD',pass:false,error:error instanceof Error?error.message:'SLOT_REPLACEMENT_FAILED'});}
publish('',report);console.log(JSON.stringify({phase:report.phase,pass:report.pass,evidence:evidence+'.json',productionAdmission:false}));if(failure)throw failure;
