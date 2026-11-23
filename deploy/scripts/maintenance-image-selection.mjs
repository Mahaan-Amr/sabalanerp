/** Immutable content only; the ordinary maintenance controller owns every release gate. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateImmutableApplicationGraph,validateInstalledApplicationGraph,prebuiltReleaseExports,readPinnedContent,contentCommand} from './prebuilt-release-plan.mjs';
import {maintenanceImageBinding,readMaintenanceRecord,validateMaintenanceResume,validateMaintenanceBinding} from '../../backend/scripts/maintenance-image-binding.mjs';
import {validatePreservationJournal} from './preserved-clamav.mjs';
import {productionImageStore} from './production-image-execution-binding.mjs';
const roles=['backend','frontend','inquiry'],hash=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/,image=/^sha256:[a-f0-9]{64}$/;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const keys=(v,k)=>assert.deepEqual(Object.keys(v).sort(),k.slice().sort());
export function validateMaintenanceSelection(plan,actual){
 keys(plan,['format','applicationCommit','applicationTree','applicationSourceHash','inquirySourceCommit','imageStore','target','operations','images','uploadPolicy']);
 assert.equal(plan.format,'sabalan-maintenance-image-selection/v1');
 for(const k of ['applicationCommit','applicationTree','inquirySourceCommit'])assert.match(plan[k],commit);
 assert.match(plan.applicationSourceHash,hash);assert.ok(['classic','containerd'].includes(plan.imageStore));assert.equal(actual.imageStore,plan.imageStore);
 assert.equal(actual.head,plan.applicationCommit);assert.equal(actual.tree,plan.applicationTree);assert.equal(actual.status,'');assert.equal(actual.inquiryStatus,'');assert.equal(actual.inquiryHead,plan.inquirySourceCommit);assert.equal(actual.inquiryGitlink,plan.inquirySourceCommit);
 keys(plan.target,['composeFile','qaPlanSha256']);assert.ok(['docker-compose.prod.yml','docker-compose.rehearsal.yml'].includes(plan.target.composeFile));
 if(plan.target.composeFile==='docker-compose.rehearsal.yml')assert.match(plan.target.qaPlanSha256,hash);else assert.equal(plan.target.qaPlanSha256,null);
 assert.deepEqual(actual.target,plan.target,'MAINTENANCE_TARGET_CHANGED');
 keys(plan.operations,['commit','tree','files']);assert.match(plan.operations.commit,commit);assert.match(plan.operations.tree,commit);assert.match(plan.operations.files['deploy/scripts/deploy.sh'],hash);assert.deepEqual(actual.operations,plan.operations,'MAINTENANCE_OPERATIONS_CHANGED');
 assert.ok(['no-malware-scan','legacy-scanner'].includes(plan.uploadPolicy));assert.equal(actual.uploadPolicy,plan.uploadPolicy);assert.equal(actual.scannerRetained,plan.uploadPolicy==='legacy-scanner','MAINTENANCE_SOURCE_SCANNER_GRAPH_CHANGED');
 assert.equal(actual.operationsScannerRetained,actual.scannerRetained,'MAINTENANCE_OPERATIONS_SCANNER_GRAPH_INCOMPATIBLE');
 keys(plan.images,roles);
 for(const role of roles){
  const selected=plan.images[role];keys(selected,['image','archiveFile','archiveGraph','browser']);assert.match(selected.image,image);assert.ok(path.posix.isAbsolute(selected.archiveFile));
  validateImmutableApplicationGraph(selected,actual.images[role],actual.archiveReceipts[role],plan.imageStore);
  const labels=actual.images[role].Config.Labels;
  assert.equal(labels['io.sabalan.performance.source-commit'],plan.applicationCommit,'MAINTENANCE_IMAGE_SOURCE_CHANGED');assert.equal(labels['io.sabalan.performance.source-hash'],plan.applicationSourceHash,'MAINTENANCE_IMAGE_SOURCE_BYTES_CHANGED');
  assert.deepEqual(actual.browsers[role],selected.browser,'MAINTENANCE_COMPILED_BROWSER_CHANGED');
  if(role==='backend'){assert.equal(selected.browser,null);assert.equal(labels['io.sabalan.release.upload-policy']||'legacy-scanner',plan.uploadPolicy,'MAINTENANCE_UPLOAD_POLICY_CHANGED');}
  else{keys(selected.browser,['id','nativeBuildId','manifestSha256']);assert.match(selected.browser.id,role==='frontend'?/^erp_[a-z0-9_-]{8,90}$/:/^inquiry_[a-z0-9_-]{8,120}$/);assert.match(selected.browser.nativeBuildId,/^[A-Za-z0-9_-]{1,128}$/);assert.match(selected.browser.manifestSha256,hash);if(role==='frontend')assert.equal(selected.browser.nativeBuildId,selected.browser.id);}
 }
 assert.equal(new Set(roles.map(r=>plan.images[r].image)).size,3);
 return {applicationCommit:plan.applicationCommit,applicationSourceHash:plan.applicationSourceHash,images:Object.fromEntries(roles.map(r=>[r,plan.images[r].image])),frontendBuildId:plan.images.frontend.browser.id,releaseAdmission:false};
}
function assertOrdinaryEnvironment(){
 assert.equal(process.env.DEPLOYMENT_MODE??'release','release');
 for(const name of ['DEPLOYMENT_ONLINE_BOOTSTRAP_REQUEST_FD','DEPLOYMENT_ONLINE_BOOTSTRAP_RESPONSE_FD','DEPLOYMENT_CLAMAV_TARGET_IMAGE'])assert.ok(!process.env[name],'MAINTENANCE_MODE_MIXED');
}
function assertLock(repository){
 const file=path.join(repository,'.deploy-state/deployment.lock');assert.equal(fs.realpathSync(file),file);const named=fs.lstatSync(file,{bigint:true}),held=fs.fstatSync(9,{bigint:true});
 assert.ok(held.isFile()&&held.uid===0n&&held.nlink===1n&&!(held.mode&0o022n)&&held.dev===named.dev&&held.ino===named.ino);
 assert.ok([...fs.readFileSync('/proc/self/fdinfo/9','utf8').matchAll(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/gm)].some(row=>row[1]===String(held.ino)),'MAINTENANCE_FD9_LOCK_REQUIRED');
}
function source(repository){
 const git=(...args)=>contentCommand('git',args,repository).trim();
 return {head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),status:git('status','--porcelain','--untracked-files=all'),inquiryGitlink:git('rev-parse','HEAD:apps/sabalan-inquiry'),inquiryHead:git('-C','apps/sabalan-inquiry','rev-parse','HEAD'),inquiryStatus:git('-C','apps/sabalan-inquiry','status','--porcelain','--untracked-files=all')};
}
function operations(root){
 const git=(...args)=>contentCommand('git',args,root).trim();assert.equal(git('status','--porcelain','--untracked-files=all'),'','MAINTENANCE_OPERATIONS_DIRTY');
 // Ordinary Git source pin: no online generated host pack or online authority.
 const files={};for(const relative of git('ls-files','--','deploy','scripts','backend/scripts','docker-compose*.yml','package.json','package-lock.json').split('\n')){
  assert.ok(relative&&!relative.split('/').includes('..')&&!path.isAbsolute(relative));files[relative]=sha(readPinnedContent(path.join(root,relative)));
 }
 return {commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),files};
}
function archive(repository,operationsRoot,file,selectedImage,role){
 assert.equal(fs.realpathSync(file),file);const stat=fs.lstatSync(file);assert.ok(stat.isFile()&&stat.uid===0&&stat.nlink===1&&!(stat.mode&0o022));
 const result=JSON.parse(contentCommand('python3',[path.join(operationsRoot,'deploy/scripts/maintenance-image-archive.py'),file,selectedImage,role],repository));
 return result;
}
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
 if(process.argv[2]==='resume'){
  assert.equal(process.argv.length,4);
  const sessionFile=process.argv[3],session=JSON.parse(readPinnedContent(sessionFile)),directory=path.dirname(sessionFile);
  assert.match(session.deploymentId,/^[a-zA-Z0-9_-]{1,160}$/);
  const journalRaw=readPinnedContent(path.join(directory,'active-deployment.jsonl'));
  const first=validatePreservationJournal(journalRaw.toString('utf8').split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)));
  const recordFile=path.join(directory,'maintenance-images-'+session.deploymentId+'.json');
  const inherited=process.env.DEPLOYMENT_MAINTENANCE_IMAGE_BINDING_HEX?validateMaintenanceBinding(JSON.parse(Buffer.from(process.env.DEPLOYMENT_MAINTENANCE_IMAGE_BINDING_HEX,'hex'))):null;
  const record=fs.existsSync(recordFile)?readMaintenanceRecord(recordFile,session.maintenanceImages):null;
  const binding=validateMaintenanceResume(session,first,record,inherited);
  if(binding){
   const savedPlan=JSON.parse(Buffer.from(record.planRawBase64,'base64'));
   const current=source(process.cwd());assert.equal(current.head,savedPlan.applicationCommit);assert.equal(current.tree,savedPlan.applicationTree);assert.equal(current.status,'');assert.equal(current.inquiryStatus,'');assert.equal(current.inquiryHead,savedPlan.inquirySourceCommit);assert.equal(current.inquiryGitlink,savedPlan.inquirySourceCommit);
   assert.deepEqual(operations(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')),savedPlan.operations,'MAINTENANCE_RECOVERY_OPERATIONS_CHANGED');
   if(binding.content.target.composeFile==='docker-compose.rehearsal.yml')assert.equal(process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256,binding.content.target.qaPlanSha256);else assert.ok(!process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_FILE&&!process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256);
   const store=productionImageStore(JSON.parse(contentCommand('docker',['info','--format','{{json .}}'],process.cwd())));assert.equal(store,binding.content.imageStore);
   for(const role of roles){const selected=binding.content.images[role],rows=JSON.parse(contentCommand('docker',['image','inspect',selected.image],process.cwd()));assert.equal(rows.length,1);validateInstalledApplicationGraph(selected,rows[0],store);}
   process.stdout.write("export DEPLOYMENT_MAINTENANCE_IMAGE_BINDING_HEX='"+Buffer.from(JSON.stringify(binding)).toString('hex')+"'\nexport DEPLOYMENT_MAINTENANCE_UPLOAD_POLICY='"+binding.content.uploadPolicy+"'\n");
  }
  return;
 }
 assertOrdinaryEnvironment();
 assert.equal(process.argv.length,9);const [mode,file,pin,repository,operationsRoot,composeFile,qaPin]=process.argv.slice(2);
 assert.ok(['attest','verify','bind'].includes(mode));assert.equal(fs.realpathSync(repository),repository);assert.equal(fs.realpathSync(operationsRoot),operationsRoot);process.chdir(repository);
 const planRaw=readPinnedContent(file,pin,{privatePlan:true,maximum:8*1024**2}),input=JSON.parse(planRaw);
 const target={composeFile,qaPlanSha256:qaPin==='production'?null:qaPin};
 if(composeFile==='docker-compose.rehearsal.yml'){
  assert.equal(process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256,qaPin);assert.ok(process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_FILE);
  // Re-run the real selector, including mount/network/Engine identity and both renders.
  const selectorEnvironment={...process.env};
  // Re-render the original plan-pinned QA environment. These are only the
  // content exports this module supplies; all isolation/custody overrides
  // continue through the existing selector's inherited-environment guard.
  for(const name of ['DEPLOYMENT_TARGET_COMMIT','DEPLOYMENT_TARGET_BACKEND_IMAGE','DEPLOYMENT_BACKEND_IMAGE','DEPLOYMENT_FRONTEND_IMAGE','DEPLOYMENT_INQUIRY_IMAGE','DEPLOYMENT_BROWSER_BUILD_ID','PERFORMANCE_RELEASE_COMMIT','PERFORMANCE_RELEASE_SOURCE_HASH','PERFORMANCE_RELEASE_BACKEND_IMAGE','PERFORMANCE_RELEASE_FRONTEND_IMAGE','PERFORMANCE_RELEASE_INQUIRY_IMAGE'])delete selectorEnvironment[name];
  const selector=spawnSync(process.execPath,[path.join(operationsRoot,'deploy/scripts/qa-rehearsal-target.mjs'),process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_FILE,qaPin,repository,process.env.DEPLOYMENT_PREBUILT_ENV_FILE],{cwd:repository,env:selectorEnvironment,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  assert.ifError(selector.error);assert.equal(selector.status,0,'MAINTENANCE_QA_SELECTOR_REFUSED');assert.equal(selector.signal,null);assert.equal(selector.stdout.trim(),composeFile);
 }else{assert.equal(composeFile,'docker-compose.prod.yml');assert.equal(qaPin,'production');assert.ok(!process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_FILE&&!process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256);}
 const actual={...source(repository),operations:operations(operationsRoot),target,imageStore:productionImageStore(JSON.parse(contentCommand('docker',['info','--format','{{json .}}'],repository))),images:{},archiveReceipts:{},browsers:{}};
 if(mode==='attest'){
  assertLock(repository);keys(input,['format','images']);assert.equal(input.format,'sabalan-maintenance-image-observation-request/v1');keys(input.images,roles);
 }
 for(const role of roles){const selected=input.images[role];if(mode==='attest')keys(selected,['image','archiveFile']);assert.match(selected.image,image);
  const inspected=JSON.parse(contentCommand('docker',['image','inspect',selected.image],repository));assert.equal(inspected.length,1);actual.images[role]=inspected[0];
  const observed=archive(repository,operationsRoot,selected.archiveFile,selected.image,role);actual.archiveReceipts[role]=observed.graph;actual.browsers[role]=observed.browser;
 }
 const label=actual.images.backend.Config.Labels['io.sabalan.release.upload-policy'];
 actual.uploadPolicy=label||'legacy-scanner';assert.ok(['no-malware-scan','legacy-scanner'].includes(actual.uploadPolicy),'MAINTENANCE_UPLOAD_POLICY_CHANGED');
 const graphFile=contentCommand('sh',[path.join(operationsRoot,'deploy/scripts/release-compose-file.sh'),composeFile,'0',actual.uploadPolicy],repository).trim();
 const rendered=JSON.parse(contentCommand('docker',['compose','--profile','deployment','--env-file',process.env.DEPLOYMENT_PREBUILT_ENV_FILE,'-f',path.join(repository,graphFile),'-p','sabalanerp','config','--format','json'],repository));
 assert.equal(rendered.name,'sabalanerp');actual.scannerRetained=Object.hasOwn(rendered.services,'clamav');
 const operationsConfig=JSON.parse(contentCommand('docker',['compose','--profile','deployment','--env-file',process.env.DEPLOYMENT_PREBUILT_ENV_FILE,'-f',path.join(operationsRoot,'docker-compose.prod.yml'),'-p','sabalanerp','config','--format','json'],operationsRoot));
 actual.operationsScannerRetained=Object.hasOwn(operationsConfig.services,'clamav');
 let plan=input;
 if(mode==='attest'){
  // The producer measures bytes itself. This receipt makes no build-success,
  // restore, reader-compatibility, release-acceptance or activation claim.
  const {performanceSourceHash}=await import('../../scripts/performance-source-identity.mjs');
  plan={format:'sabalan-maintenance-image-selection/v1',applicationCommit:actual.head,applicationTree:actual.tree,applicationSourceHash:await performanceSourceHash(),inquirySourceCommit:actual.inquiryGitlink,uploadPolicy:actual.uploadPolicy,imageStore:actual.imageStore,target,operations:actual.operations,images:Object.fromEntries(roles.map(role=>[role,{...input.images[role],archiveGraph:actual.archiveReceipts[role],browser:actual.browsers[role]}]))};
 }
 const selected=validateMaintenanceSelection(plan,actual);
 // A changed checkout/operations map during a long archive read is a refusal.
 assert.deepEqual(source(repository),Object.fromEntries(['head','tree','status','inquiryGitlink','inquiryHead','inquiryStatus'].map(k=>[k,actual[k]]))); assert.deepEqual(operations(operationsRoot),actual.operations);
 if(mode==='bind'){
  assertLock(repository);assert.match(process.env.DEPLOYMENT_ID??'',/^deploy-[A-Za-z0-9_-]{1,160}$/);
  const directory=process.env.DEPLOYMENT_MAINTENANCE_REPORT_DIR;assert.ok(path.isAbsolute(directory)&&fs.realpathSync(directory)===directory);
  const record=path.join(directory,'maintenance-images-'+process.env.DEPLOYMENT_ID+'.json'),binding=maintenanceImageBinding(plan,pin);
  const fd=fs.openSync(record,'wx',0o400);try{fs.writeFileSync(fd,JSON.stringify({format:'sabalan-maintenance-image-record/v1',binding,planRawBase64:planRaw.toString('base64')})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const dir=fs.openSync(directory,'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  process.stdout.write("export DEPLOYMENT_MAINTENANCE_IMAGE_BINDING_HEX='"+Buffer.from(JSON.stringify(binding)).toString('hex')+"'\n");
}
 if(mode==='attest'){assertLock(repository);process.stdout.write(JSON.stringify(plan)+'\n');}else process.stdout.write(prebuiltReleaseExports(selected)+"export DEPLOYMENT_MAINTENANCE_UPLOAD_POLICY='"+plan.uploadPolicy+"'\n");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write('MAINTENANCE_IMAGE_SELECTION_INVALID: '+error.message+'\n');process.exitCode=1;});
