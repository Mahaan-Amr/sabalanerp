/** Prepare a reviewable carrier delta; no compiler, build, import or Compose UP. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {backendBaseLocalGuards} from '../../../scripts/lib/production-backend-base-local-guard.mjs';
import {stableBackendBaseFile} from '../../../scripts/lib/production-backend-base-artifacts.mjs';
import {inspectPrivateDockerArchive} from '../../../scripts/lib/private-docker-image-archive.mjs';
import {sanitizeProductionImageInspection} from '../../../deploy/scripts/production-image-execution-binding.mjs';
const evidence=import.meta.dirname,repo=path.resolve(evidence,'../../..'),file=path.join(evidence,'INQUIRY-CARRIER-CHANGE-R2.json');assert.ok(!fs.existsSync(file));
const context=path.join(evidence,'inquiry-carrier-context');assert.ok(!fs.existsSync(context));
const sourceCommit='c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const ref=file=>{const {bytes,sha256}=stableBackendBaseFile(file);return {file,bytes,sha256};};
const baseFile=path.join(repo,'reports/qa/inquiry-native-next-image-20261018.json'),base=JSON.parse(fs.readFileSync(baseFile));
const graph=inspectPrivateDockerArchive(base.archive.archive,base.archive.index);
for(const key of ['index','platform','config','rootfsDiffIds','archiveSha256','archiveBytes'])assert.deepEqual(graph[key],base.archive[key]);
const materialFile='D:/sabalanerp-online-qa/current-backend-material-e820593bf8ec456993986d7d9e1ee1fe/material-receipt.json';
assert.equal(ref(materialFile).sha256,'6c440e63f97fdef1884f530da43be181aecafb5d03795e66e9691fee993e418b');
const material=JSON.parse(fs.readFileSync(materialFile));assert.equal(material.shellSourceProjection.sourceCommit,sourceCommit);
const sourceHashes={},outputs={},names=['onlineInquiryWork','onlineRuntimeScope','onlineCaptureAdmission','kernelWriteAdmission','runtimeBoundaryJournal','runtimeTaskAdmission','runtimeWorkContext'];
const prepared=[];
for(const name of names){
 const source='backend/src/services/'+name+'.ts',raw=fs.readFileSync(path.join(repo,source));
 const blob=execFileSync('git',['hash-object','--path='+source,path.join(repo,source)],{cwd:repo,encoding:'utf8'}).trim();
 assert.equal(blob,execFileSync('git',['rev-parse',sourceCommit+':'+source],{cwd:repo,encoding:'utf8'}).trim());
 assert.equal(sha(raw),material.materialSources[source]);sourceHashes[name+'.ts']=sha(raw);
 const output='app/dist/services/'+name+'.js',row=material.files.find(row=>row.path===output);assert.ok(row);
 const from=path.join(material.context,output),bytes=fs.readFileSync(from);assert.equal(bytes.length,row.bytes);assert.equal(sha(bytes),row.sha256);
 const requires=[...bytes.toString().matchAll(/require\(["']([^"']+)["']\)/g)].map(match=>match[1]);
 assert.ok(requires.every(value=>value.startsWith('node:')||names.some(name=>value==='./'+name)),'INQUIRY_RUNTIME_NONPURE_DEPENDENCY');
 prepared.push({name:'services/'+name+'.js',bytes,input:ref(from)});
}
for(const [source,name]of [['deploy/scripts/online-runtime-scope.py','services/online-runtime-scope.py'],['deploy/scripts/inquiry-compiled-browser.cjs','inquiry-compiled-browser.cjs']]){
 const from=path.join(repo,source),bytes=fs.readFileSync(from);
 if(source.endsWith('.py'))sourceHashes['online-runtime-scope.py']=sha(bytes);
 prepared.push({name,bytes,input:ref(from)});
}
prepared.push({name:'source-hashes.json',bytes:Buffer.from(JSON.stringify(sourceHashes,null,2)+'\n')});
const dockerfile=`FROM ${base.imageReceipt.tag}\nCOPY --chmod=0444 services/ /app/online-runtime/services/\nCOPY --chmod=0444 source-hashes.json /app/online-runtime/source-hashes.json\nCOPY --chmod=0444 inquiry-compiled-browser.cjs /app/inquiry-compiled-browser.cjs\nLABEL io.sabalan.inquiry.runtime-source-commit="${sourceCommit}" \\\n+      io.sabalan.inquiry.native-base-index="${graph.index}"\n`;
prepared.push({name:'Dockerfile',bytes:Buffer.from(dockerfile)});
const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands);
const report={format:'sabalan-419-inquiry-carrier-change-proposal/v1',preparedAt:new Date().toISOString(),executable:false,
 runtimeAccepted:false,productionAdmission:false,buildExecuted:false,imageImported:false,composeUp:false,
 compilerRepeated:false,materializerRepeated:false,hostPackRepeated:false,cryptoRepeated:false,
 runtimeSourceCommit:sourceCommit,baseReceipt:ref(baseFile),baseGraph:graph,baseImage:graph.index,
 existingBackendMaterial:ref(materialFile),context,outputs,
 requiredScopeDecision:'Authorize a distinct native carrier image in the same existing Inquiry service before the source411 RO-only transition; preserve its original image as rollback.',
 pending:['New delta image build from authenticated unchanged native base; no app/Next/Prisma compilation',
  'Fresh complete image graph, native descriptor and compiled browser verification',
  'Review exact same-service image transition and safe restoration before any UP',
  'Fresh COMPLETE/lease/scope/SQLite/owner bindings and actual native acceptance'],
 preservesApplicationImageSourceIdentity:true};
let lease;
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};
 report.before=await guards.protectedIdentities();
 await guards.status();const baseObservation=await commands.run('docker',['image','inspect',graph.index]);report.baseImageObservation={code:baseObservation.code,signal:baseObservation.signal,originalPid:baseObservation.originalPid,stderr:baseObservation.stderr};report.baseNativeInspection=null;if(baseObservation.code===0){commands.assertSuccessful(baseObservation);const [image]=JSON.parse(baseObservation.stdout);assert.equal(image.Id,graph.index);assert.deepEqual(image.RootFS.Layers,graph.rootfsDiffIds);report.baseNativeInspection=sanitizeProductionImageInspection(image);}else{assert.equal(baseObservation.code,1);report.pending.unshift('Authenticate and import the held native base archive under a fresh lease and capacity gate; native namespace is not yet verified');}
 const [original]=JSON.parse(await guards.docker(['inspect',report.before.inquiry.id]));
 report.safeRestoration={originalImage:original.Image,originalId:original.Id,originalStartedAt:original.State.StartedAt,
  configSha256:sha(JSON.stringify(original.Config)),hostConfigSha256:sha(JSON.stringify(original.HostConfig)),
  mountsSha256:sha(JSON.stringify(original.Mounts)),networkSha256:sha(JSON.stringify(original.NetworkSettings.Networks)),
  configurationFiles:original.Config.Labels['com.docker.compose.project.config_files'],
  runtimeMutationPerformed:false,verifiedRestorationEarned:false};
 // Check the actual original image is still locally retrievable before proposing a transition.
 const [rollback]=JSON.parse(await guards.docker(['image','inspect',original.Image]));assert.equal(rollback.Id,original.Image);report.rollbackNativeInspection=sanitizeProductionImageInspection(rollback);
 fs.mkdirSync(context,{mode:0o700});fs.mkdirSync(path.join(context,'services'),{mode:0o700});
 for(const row of prepared){const target=path.join(context,row.name);fs.writeFileSync(target,row.bytes,{flag:'wx',mode:0o400});outputs[row.name]={...ref(target),...(row.input?{input:row.input}:{})};}
 report.after=await guards.protectedIdentities();assert.deepEqual(report.after,report.before);lease.assertHeld();
}catch(error){report.error={name:error.name,message:String(error.message).slice(0,1000)};process.exitCode=1;}
finally{report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;report.lease.acknowledgement='LEASE_CLOSED';}fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
console.log(JSON.stringify({file,prepared:!report.error,error:report.error??null,context}));
