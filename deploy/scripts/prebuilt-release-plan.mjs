/** Content selection only. Original restore, issuer and bootstrap retain authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {productionImageStore} from './production-image-execution-binding.mjs';

const roles=['backend','frontend','inquiry'],digest=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/,image=/^sha256:[a-f0-9]{64}$/;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const keys=(value,expected)=>assert.deepEqual(Object.keys(value).sort(),expected.slice().sort());
const graphKeys=['index','platform','config','rootfsDiffIds','archiveSha256','archiveBytes'];
export function validatePrebuiltReleasePlan(plan,actual){
 keys(plan,['format','applicationCommit','applicationTree','applicationSourceHash','inquirySourceCommit','images','operations',...(Object.hasOwn(plan,'imageStore')?['imageStore']:[])]);
 assert.equal(plan.format,'sabalan-prebuilt-protected-release-plan/v1');
 const store=plan.imageStore??'classic';assert.ok(['classic','containerd'].includes(store));assert.equal(actual.imageStore??'classic',store,'PREBUILT_NATIVE_IMAGE_STORE_CHANGED');
 for(const key of ['applicationCommit','applicationTree','inquirySourceCommit'])assert.match(plan[key],commit);
 assert.match(plan.applicationSourceHash,digest);keys(plan.images,roles);keys(plan.operations,['receiptSha256','files']);assert.match(plan.operations.receiptSha256,digest);
 assert.equal(actual.head,plan.applicationCommit,'PREBUILT_APPLICATION_COMMIT_CHANGED');assert.equal(actual.tree,plan.applicationTree,'PREBUILT_APPLICATION_TREE_CHANGED');
 assert.equal(actual.status,'','PREBUILT_APPLICATION_CHECKOUT_DIRTY');assert.equal(actual.inquiryStatus,'','PREBUILT_INQUIRY_CHECKOUT_DIRTY');
 assert.equal(actual.inquiryGitlink,plan.inquirySourceCommit);assert.equal(actual.inquiryHead,plan.inquirySourceCommit);
 assert.deepEqual(actual.operations,plan.operations,'PREBUILT_OPERATIONS_CHANGED');
 for(const name of ['deploy/scripts/deploy.sh','deploy/scripts/online-release-launcher.py','deploy/scripts/prebuilt-release-plan.mjs','deploy/scripts/storage-preflight.sh','deploy/scripts/storage-preflight.mjs','scripts/deployment-storage.mjs','scripts/deployment-capacity.mjs'])assert.match(plan.operations.files[name],digest);
 for(const role of roles){
  const selected=plan.images[role],observed=actual.images[role],receipt=actual.buildReceipts[role];
  keys(selected,['image','sourceCommit','archiveGraph','archiveReceipt','buildReceipt',...(role==='backend'?[]:['browser'])]);
  assert.match(selected.image,image);assert.match(selected.sourceCommit,commit);
  for(const reference of [selected.buildReceipt,selected.archiveReceipt]){keys(reference,['file','sha256']);assert.ok(path.posix.isAbsolute(reference.file));assert.match(reference.sha256,digest);}
  keys(selected.archiveGraph,graphKeys);const graph=selected.archiveGraph;
  for(const key of ['index','platform','config'])assert.match(graph[key],image);
  assert.equal(store==='containerd'?graph.index:graph.config,selected.image,'PREBUILT_ACTIVATION_EXECUTION_NAMESPACE_CHANGED');assert.match(graph.archiveSha256,digest);assert.ok(Number.isSafeInteger(graph.archiveBytes)&&graph.archiveBytes>0);
  assert.ok(Array.isArray(graph.rootfsDiffIds)&&graph.rootfsDiffIds.length>0&&graph.rootfsDiffIds.length<=128);for(const layer of graph.rootfsDiffIds)assert.match(layer,image);
  for(const key of graphKeys)assert.deepEqual(actual.archiveReceipts[role][key],graph[key],'PREBUILT_ARCHIVE_GRAPH_CHANGED');
  assert.equal(observed.Id,selected.image,'PREBUILT_INSTALLED_EXECUTION_CHANGED');assert.equal(observed.Os,'linux');assert.equal(observed.Architecture,'amd64');assert.deepEqual(observed.RootFS.Layers,graph.rootfsDiffIds,'PREBUILT_INSTALLED_LAYERS_CHANGED');
  if(store==='containerd'){assert.equal(observed.Descriptor?.digest,graph.index);assert.ok(['application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json'].includes(observed.Descriptor?.mediaType));assert.ok(Number.isSafeInteger(observed.Descriptor.size)&&observed.Descriptor.size>0);}
  else assert.ok(!observed.Descriptor);
  if(role==='backend'){
   assert.equal(selected.sourceCommit,plan.applicationCommit);assert.equal(receipt.format,'sabalan-current-backend-image/v1');assert.equal(receipt.pass,true);assert.equal(receipt.sourceUnchanged,true);
   assert.equal(receipt.sourceCommit,plan.applicationCommit);assert.equal(receipt.image.id,graph.index);assert.equal(receipt.performanceSourceHash,plan.applicationSourceHash);
   assert.equal(receipt.image.labels['io.sabalan.performance.source-commit'],plan.applicationCommit);assert.equal(receipt.image.labels['io.sabalan.performance.source-hash'],plan.applicationSourceHash);
   assert.equal(observed.Config.Labels['io.sabalan.performance.source-commit'],plan.applicationCommit);assert.equal(observed.Config.Labels['io.sabalan.performance.source-hash'],plan.applicationSourceHash);
  }else{
   keys(selected.browser,['id','nativeBuildId','manifestSha256']);assert.match(selected.browser.nativeBuildId,/^[A-Za-z0-9_-]{1,128}$/);assert.match(selected.browser.manifestSha256,digest);
   if(role==='frontend'){
    assert.equal(receipt.format,'sabalan-current-frontend-image-build/v2');assert.equal(receipt.pass,true);assert.equal(receipt.phase,'COMPLETE');assert.equal(receipt.outputImage.id,graph.index);assert.equal(receipt.sourceCommit,selected.sourceCommit);
    assert.match(selected.browser.id,/^erp_[a-z0-9_-]{8,90}$/);assert.equal(receipt.buildId,selected.browser.id);assert.equal(selected.browser.nativeBuildId,selected.browser.id);assert.equal(receipt.manifestSha256,selected.browser.manifestSha256);
   }else{
    const value=receipt.imageReceipt??receipt;assert.equal(value.format,'sabalan-inquiry-native-image-diagnostic/v1');assert.equal(value.image,graph.index);assert.equal(selected.sourceCommit,plan.inquirySourceCommit);assert.equal(value.inquirySourceCommit,plan.inquirySourceCommit);
    assert.match(selected.browser.id,/^inquiry_[a-z0-9_-]{8,120}$/);assert.equal(value.browserDeploymentId,selected.browser.id);
    // Inquiry's native Next BUILD_ID differs from its deploymentId. The
    // original compiled-browser carrier independently verifies both at runtime.
   }
  }
 }
 assert.equal(new Set(roles.map(role=>plan.images[role].image)).size,3);
 return Object.freeze({applicationCommit:plan.applicationCommit,applicationSourceHash:plan.applicationSourceHash,images:Object.fromEntries(roles.map(role=>[role,plan.images[role].image])),frontendBuildId:plan.images.frontend.browser.id,releaseAdmission:false});
}

function read(file,expected,{privatePlan=false,maximum=128*1024**2}={}){
 assert.ok(path.isAbsolute(file)&&fs.realpathSync(file)===file);const before=fs.lstatSync(file,{bigint:true});
 assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.uid===0n&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(maximum)&&!(before.mode&0o022n));
 if(privatePlan)assert.equal(before.mode&0o777n,0o400n);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK),pin=s=>['dev','ino','size','mtimeNs','ctimeNs','uid','mode','nlink'].map(key=>String(s[key]));
 try{assert.deepEqual(pin(fs.fstatSync(fd,{bigint:true})),pin(before));const raw=fs.readFileSync(fd);assert.deepEqual(pin(fs.fstatSync(fd,{bigint:true})),pin(before));assert.deepEqual(pin(fs.lstatSync(file,{bigint:true})),pin(before));if(expected){assert.match(expected,digest);assert.equal(sha(raw),expected,'PREBUILT_PINNED_BYTES_CHANGED');}return raw;}finally{fs.closeSync(fd);}
}
function command(executable,args,cwd){const child=spawnSync(executable,args,{cwd,encoding:'utf8',maxBuffer:16*1024**2,stdio:['ignore','pipe','pipe']});assert.ifError(child.error);assert.equal(child.signal,null,'PREBUILT_ORIGINAL_CHILD_SIGNAL');assert.equal(child.status,0,'PREBUILT_ORIGINAL_CHILD_FAILED');return child.stdout;}
function originalPipes(){
 assert.equal(process.env.DEPLOYMENT_MODE??'release','release');const descriptors=['DEPLOYMENT_ONLINE_BOOTSTRAP_REQUEST_FD','DEPLOYMENT_ONLINE_BOOTSTRAP_RESPONSE_FD'].map(key=>{assert.match(process.env[key]??'',/^[1-9][0-9]*$/);const fd=Number(process.env[key]);assert.ok(fd>=3&&fs.fstatSync(fd).isFIFO(),'PREBUILT_ORIGINAL_PIPE_REQUIRED');return fd;});assert.notEqual(descriptors[0],descriptors[1]);
}
export function prebuiltReleaseExports(value){
 const entries={DEPLOYMENT_TARGET_COMMIT:value.applicationCommit,DEPLOYMENT_TARGET_BACKEND_IMAGE:value.images.backend,DEPLOYMENT_BACKEND_IMAGE:value.images.backend,DEPLOYMENT_FRONTEND_IMAGE:value.images.frontend,DEPLOYMENT_INQUIRY_IMAGE:value.images.inquiry,DEPLOYMENT_PREBUILT_BACKEND_EXECUTION_IMAGE:value.images.backend,DEPLOYMENT_PREBUILT_FRONTEND_EXECUTION_IMAGE:value.images.frontend,DEPLOYMENT_PREBUILT_INQUIRY_EXECUTION_IMAGE:value.images.inquiry,DEPLOYMENT_BROWSER_BUILD_ID:value.frontendBuildId,PERFORMANCE_RELEASE_COMMIT:value.applicationCommit,PERFORMANCE_RELEASE_SOURCE_HASH:value.applicationSourceHash,PERFORMANCE_RELEASE_BACKEND_IMAGE:value.images.backend,PERFORMANCE_RELEASE_FRONTEND_IMAGE:value.images.frontend,PERFORMANCE_RELEASE_INQUIRY_IMAGE:value.images.inquiry};
 for(const value of Object.values(entries))assert.match(value,/^[a-zA-Z0-9_:-]+$/);
 return Object.entries(entries).map(([key,value])=>`export ${key}='${value}'`).join('\n')+'\n';
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.argv.length,6);originalPipes();
 const [planFile,expected,repository,operationsRoot]=process.argv.slice(2);assert.equal(fs.realpathSync(repository),repository);assert.equal(fs.realpathSync(operationsRoot),operationsRoot);
 const plan=JSON.parse(read(planFile,expected,{privatePlan:true,maximum:8*1024**2})),actual={};
 assert.equal(plan.format,'sabalan-prebuilt-protected-release-plan/v1');keys(plan.images,roles);assert.ok(plan.operations?.files);
 for(const role of roles){assert.match(plan.images[role].image,image);assert.equal(plan.images[role].image,(plan.imageStore==='containerd'?plan.images[role].archiveGraph.index:plan.images[role].archiveGraph.config));}
 const git=(...args)=>command('git',args,repository).trim();actual.head=git('rev-parse','HEAD');actual.tree=git('rev-parse','HEAD^{tree}');actual.status=git('status','--porcelain','--untracked-files=all');actual.inquiryGitlink=git('rev-parse','HEAD:apps/sabalan-inquiry');actual.inquiryHead=git('-C','apps/sabalan-inquiry','rev-parse','HEAD');actual.inquiryStatus=git('-C','apps/sabalan-inquiry','status','--porcelain','--untracked-files=all');
 // Git tree identity and build-input byte identity are separate namespaces:
 // Windows CRLF build hashes must never be equated to Linux checkout bytes.
 const receipt=JSON.parse(read(path.join(operationsRoot,'host-pack-receipt.json'),plan.operations.receiptSha256));assert.equal(receipt.format,'sabalan-online-controller-host-pack/v1');assert.equal(receipt.packagingComplete,true);
 actual.operations={receiptSha256:plan.operations.receiptSha256,files:{}};for(const [relative,pin]of Object.entries(receipt.outputs)){assert.ok(/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(relative)&&!relative.split('/').includes('..'));actual.operations.files[relative]=sha(read(path.join(operationsRoot,relative),pin.sha256));}
 actual.buildReceipts={};actual.archiveReceipts={};actual.images={};
 actual.imageStore=productionImageStore(JSON.parse(command('docker',['info','--format','{{json .}}'],repository)));
 for(const role of roles){const selected=plan.images[role];actual.buildReceipts[role]=JSON.parse(read(selected.buildReceipt.file,selected.buildReceipt.sha256,{privatePlan:true}));actual.archiveReceipts[role]=JSON.parse(read(selected.archiveReceipt.file,selected.archiveReceipt.sha256,{privatePlan:true}));
  command('docker',['compose','--env-file',process.env.DEPLOYMENT_PREBUILT_ENV_FILE,'-f',path.join(repository,'docker-compose.prod.yml'),'-p','sabalanerp','ps','--format','json'],repository);
  const rows=JSON.parse(command('docker',['image','inspect',selected.image],repository));assert.equal(rows.length,1);actual.images[role]=rows[0];
 }
 process.stdout.write(prebuiltReleaseExports(validatePrebuiltReleasePlan(plan,actual)));
}
