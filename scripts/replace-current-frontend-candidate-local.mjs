import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {validateCandidatePreflight} from './replace-qualified-application-native-candidate-local.mjs';
import {stableFrontendBaseFile} from './lib/production-frontend-base-artifacts.mjs';

const root=path.resolve(import.meta.dirname,'..');const mode=process.argv[2]??'--inspect';assert.ok(['--inspect','--replace'].includes(mode));const preflightFile=mode==='--replace'?fs.realpathSync(process.argv[4]):null;if(mode==='--replace'){assert.equal(process.argv.length,5);assert.equal(process.argv[3],'--preflight');validateCandidatePreflight(JSON.parse(fs.readFileSync(preflightFile)));}else assert.ok(process.argv.length<=3);
const protectedServices=['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained','frontend-retained'];
const base='D:/sabalanerp/docker-compose.local.yml',overlay=path.join(root,'docker-compose.application-browser-acceptance.yml');
const slots=[
 {service:'frontend-candidate',receipt:'current-frontend-image-792da52dca314b79ba0f2cde7d38c36d.json',material:'current-frontend-bundle-cb97dee63c3d8b1c1243100530c33fb7.json',
 image:'sha256:948a939c55cb17a11ebcd7232ce5dc6ec31b80f71bcf0748f084f2a5236de4d6',
 oldImage:'sha256:923340ff3fd7950f38c4188f9209e1006e4fc3105c49b325c4e1d00a5f4075ae',
 buildId:'erp_online_committed_33bd7e000cc2f1e3'}
];
const retainedImage='sha256:9df9eec8db41a96b86492a04f9d2e18767e9845e861329e6c8036c4e5b77cdb3';
const retainedBuildId='erp_online_final_20261019_5b4cc688a771e5a9';
const approvedReceiptSha256='4a4f2cd82ca4e78feccde5c3d22f7022e1dad672c2576deaffda774ec19c966d';
const approvedMaterialSha256='54a4e1d5311ba9843a6c9fdef7c35b1c3a300ede97ad57d243257fb40a765541';
if(mode==='--inspect'){
 console.log(JSON.stringify({mode,executesDocker:false,productionAdmission:false,target:slots[0],protectedServices,
 retained:{image:retainedImage,buildId:retainedBuildId},requirements:['root heavy token after native original closure','fresh storage cleanup/capacity preflight'],
 action:'ONLY the measured frontend-candidate to the verified committed UI build; no retained-slot replacement, image deletion or rollback'},null,2));process.exit(0);
}
const env={...process.env,ONLINE_BROWSER_OLD_IMAGE:retainedImage,ONLINE_BROWSER_NEW_IMAGE:slots[0].image,
 ONLINE_BROWSER_OLD_BUILD_ID:retainedBuildId,ONLINE_BROWSER_NEW_BUILD_ID:slots[0].buildId};
const compose=['compose','-f',base,'-f',overlay,'--profile','application-browser-acceptance'];
function status(){const r=spawnSync('docker',['compose','-f',base,'ps','--format','json'],{encoding:'utf8',maxBuffer:8*1024**2});assert.equal(r.status,0);
  let rows;try{const v=JSON.parse(r.stdout);rows=Array.isArray(v)?v:[v];}catch{rows=r.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));}
  const expected=[...protectedServices,'frontend-candidate'],projectRows=rows.filter(row=>row.Project==='sabalanerp-local');
  assert.equal(projectRows.length,10);assert.equal(new Set(projectRows.map(row=>row.Service)).size,10);
  assert.equal(new Set(projectRows.map(row=>row.Name)).size,10);
  assert.deepEqual(projectRows.map(row=>row.Service).sort(),expected.sort());
  for(const service of protectedServices)assert.ok(projectRows.some(row=>row.Service===service&&row.State==='running'&&row.Health==='healthy'));
  return rows;}
function docker(args){status();const r=spawnSync('docker',args,{env,encoding:'utf8',maxBuffer:8*1024**2});assert.equal(r.status,0);return r.stdout;}
function inspectContainer(service){const rows=JSON.parse(docker(['inspect','sabalanerp-local-'+service+'-1']));assert.equal(rows.length,1);const row=rows[0];
  assert.equal(row.Config.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(row.Config.Labels['com.docker.compose.service'],service);return row;}
function summary(row){return{id:row.Id,image:row.Image,startedAt:row.State.StartedAt,status:row.State.Status,health:row.State.Health?.Status,
  mounts:row.Mounts.map(m=>({type:m.Type,source:m.Source,destination:m.Destination,rw:m.RW})),ports:row.HostConfig.PortBindings??{}};}
function protectedIdentities(){return Object.fromEntries(protectedServices.map(service=>[service,summary(inspectContainer(service))]));}
const preflightRaw=fs.readFileSync(preflightFile),preflightPin=stableFrontendBaseFile(preflightFile);
const inputs={preflight:{file:preflightFile,pin:preflightPin},baseFile:stableFrontendBaseFile(base),overlayFile:stableFrontendBaseFile(overlay),helperFile:stableFrontendBaseFile(import.meta.filename),preflightHelperFile:stableFrontendBaseFile(path.join(root,'scripts/replace-qualified-application-native-candidate-local.mjs'))};
const measured=slots.map(slot=>{const file=path.join(root,'reports/qa',slot.receipt),materialFile=path.join(root,'reports/qa',slot.material);
  const receiptFile=stableFrontendBaseFile(file),materialReceiptFile=stableFrontendBaseFile(materialFile);
  assert.equal(receiptFile.sha256,approvedReceiptSha256);assert.equal(materialReceiptFile.sha256,approvedMaterialSha256);
  const receipt=JSON.parse(fs.readFileSync(file)),material=JSON.parse(fs.readFileSync(materialFile));
  assert.equal(receipt.phase,'COMPLETE');assert.equal(receipt.pass,true);assert.equal(receipt.imageQualified,true);assert.equal(receipt.build.code,0);assert.equal(receipt.build.signal,null);
  assert.equal(receipt.outputImage.id,slot.image);assert.equal(receipt.buildId,slot.buildId);assert.equal(material.bundle.buildId,slot.buildId);
  assert.equal(receipt.materializationReceiptSha256,materialReceiptFile.sha256);
  const image=JSON.parse(docker(['image','inspect',slot.image]))[0];assert.equal(image.Id,slot.image);assert.deepEqual(image.RootFS.Layers,receipt.outputImage.layers);
  assert.deepEqual(Object.keys(image.Config.Volumes??{}),[]);
  const oldImage=JSON.parse(docker(['image','inspect',slot.oldImage]))[0];assert.equal(oldImage.Id,slot.oldImage);
  const before=inspectContainer(slot.service);assert.equal(before.Image,slot.oldImage,'Only the previous measured candidate may be replaced');
  const assets=material.bundle.assets.filter(value=>/^\/_next\/static\/chunks\/app\/dashboard\/support\/new\/page-[a-zA-Z0-9_-]+\.js$/.test(value.path));
  assert.equal(assets.length,1);const asset=assets[0];assert.match(asset.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(asset.bytes)&&asset.bytes>0);
  return{slot,receiptFile,materialReceiptFile,cmd:image.Config.Cmd,entrypoint:image.Config.Entrypoint??null,
    layers:image.RootFS.Layers,asset,before:summary(before)};});
assert.equal(inspectContainer('frontend-retained').Image,retainedImage);
const configuration=JSON.parse(docker([...compose,'config','--format','json']));assert.equal(configuration.name,'sabalanerp-local');
for(const {slot}of measured){const config=configuration.services[slot.service];assert.equal(config.image,slot.image);
  assert.equal(config.read_only,true);assert.equal(config.pull_policy,'never');assert.ok(!config.build&&!config.command&&!config.entrypoint);
  assert.deepEqual(config.ports??[],[]);assert.deepEqual(config.volumes??[],[]);}
const operation=randomBytes(16).toString('hex'),scratch=path.resolve('D:/sabalanerp-online-qa/committed-frontend-candidate-replacement-'+operation);
fs.mkdirSync(scratch,{mode:0o700});const evidence=path.join(root,'reports/qa/committed-frontend-candidate-replacement-'+operation);
const report={format:'sabalan-committed-frontend-candidate-replacement/v1',operation,phase:'INTENT',pass:false,inputs,measured,
  protectedBefore:protectedIdentities(),productionAdmission:false,oldImagesRetained:true,onlyOneExplicitDiagnosticSlot:true};
const publish=(suffix,value)=>{const fd=fs.openSync(evidence+suffix+'.json','wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
publish('-intent',report);let failure;
try{
  assert.deepEqual(stableFrontendBaseFile(base),inputs.baseFile);assert.deepEqual(stableFrontendBaseFile(overlay),inputs.overlayFile);
  assert.deepEqual(stableFrontendBaseFile(path.join(root,'scripts/replace-qualified-application-native-candidate-local.mjs')),inputs.preflightHelperFile);
  const stdoutPath=path.join(scratch,'up.stdout'),stderrPath=path.join(scratch,'up.stderr');
  const out=fs.openSync(stdoutPath,'wx',0o600),err=fs.openSync(stderrPath,'wx',0o600);let up;
  try{validateCandidatePreflight(JSON.parse(fs.readFileSync(preflightFile)));assert.deepEqual(stableFrontendBaseFile(preflightFile),preflightPin);status();up=await new Promise(resolve=>{const child=spawn('docker',[...compose,'up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','120',...slots.map(v=>v.service)],{env,stdio:['ignore',out,err]});
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
    const code="const assert=require('node:assert/strict'),crypto=require('node:crypto');(async()=>{const [build,asset,hash,bytes]=process.argv.slice(1);const r=await fetch('http://127.0.0.1:3000/dashboard/support/new');assert.equal(r.ok,true);const html=await r.text();assert.ok(html.includes(build));const a=await fetch('http://127.0.0.1:3000'+asset);assert.equal(a.status,200);const body=Buffer.from(await a.arrayBuffer());assert.equal(body.length,Number(bytes));assert.equal(crypto.createHash('sha256').update(body).digest('hex'),hash);console.log(JSON.stringify({healthyHttp:true,compiledHtmlBuildId:build,compiledAssetSha256:hash,compiledAssetBytes:body.length}));})().catch(e=>{console.error(e.message);process.exitCode=1});";
    const http=JSON.parse(docker(['exec',row.Id,'node','-e',code,slot.buildId,point.asset.path,point.asset.sha256,String(point.asset.bytes)]));
    report.slots.push({...summary(row),service:slot.service,http});
    assert.deepEqual(stableFrontendBaseFile(path.join(root,'reports/qa',slot.receipt)),point.receiptFile);
    assert.deepEqual(stableFrontendBaseFile(path.join(root,'reports/qa',slot.material)),point.materialReceiptFile);
    assert.equal(JSON.parse(docker(['image','inspect',slot.oldImage]))[0].Id,slot.oldImage);
  }
  assert.deepEqual(protectedIdentities(),report.protectedBefore);
  assert.deepEqual(stableFrontendBaseFile(import.meta.filename),inputs.helperFile);
  assert.deepEqual(stableFrontendBaseFile(path.join(root,'scripts/replace-qualified-application-native-candidate-local.mjs')),inputs.preflightHelperFile);
  Object.assign(report,{phase:'COMPLETE',pass:true,protectedNineUnchanged:true});
}catch(error){failure=error;Object.assign(report,{phase:'FAILED_HELD',pass:false,error:error instanceof Error?error.message:'SLOT_REPLACEMENT_FAILED'});}
publish('',report);console.log(JSON.stringify({phase:report.phase,pass:report.pass,evidence:evidence+'.json',productionAdmission:false}));if(failure)throw failure;
