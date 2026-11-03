/** Content selection only. Original restore, issuer and bootstrap retain authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateSelection,selectionBinding,canonical,preservationSources} from './preserved-clamav.mjs';
import {productionImageStore} from './production-image-execution-binding.mjs';
import {readPrebuiltMigrationInventory} from './prebuilt-migration-inventory.mjs';

const roles=['backend','frontend','inquiry'],digest=/^[a-f0-9]{64}$/,commit=/^[a-f0-9]{40}$/,image=/^sha256:[a-f0-9]{64}$/;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const keys=(value,expected)=>assert.deepEqual(Object.keys(value).sort(),expected.slice().sort());
const graphKeys=['index','platform','config','rootfsDiffIds','archiveSha256','archiveBytes'];
export function requirePrebuiltScannerSelection(plan){assert.ok(plan.preservedClamav,'PREBUILT_SCANNER_PRESERVATION_SELECTION_REQUIRED');return validateSelection(plan.preservedClamav);}
export function validatePrebuiltReleasePlan(plan,actual){
 keys(plan,['format','applicationCommit','applicationTree','applicationSourceHash','inquirySourceCommit','images','operations',...(Object.hasOwn(plan,'imageStore')?['imageStore']:[]),...(Object.hasOwn(plan,'preservedClamav')?['preservedClamav']:[])]);
 assert.equal(plan.format,'sabalan-prebuilt-protected-release-plan/v1');
 if(plan.preservedClamav){validateSelection(plan.preservedClamav);for(const name of preservationSources)assert.match(plan.operations.files[name],digest);}
 const store=plan.imageStore??'classic';assert.ok(['classic','containerd'].includes(store));assert.equal(actual.imageStore??'classic',store,'PREBUILT_NATIVE_IMAGE_STORE_CHANGED');
 for(const key of ['applicationCommit','applicationTree','inquirySourceCommit'])assert.match(plan[key],commit);
 assert.match(plan.applicationSourceHash,digest);keys(plan.images,roles);keys(plan.operations,['receiptSha256','files']);assert.match(plan.operations.receiptSha256,digest);
 assert.equal(actual.head,plan.applicationCommit,'PREBUILT_APPLICATION_COMMIT_CHANGED');assert.equal(actual.tree,plan.applicationTree,'PREBUILT_APPLICATION_TREE_CHANGED');
 assert.equal(actual.status,'','PREBUILT_APPLICATION_CHECKOUT_DIRTY');assert.equal(actual.inquiryStatus,'','PREBUILT_INQUIRY_CHECKOUT_DIRTY');
 assert.equal(actual.inquiryGitlink,plan.inquirySourceCommit);assert.equal(actual.inquiryHead,plan.inquirySourceCommit);
 assert.deepEqual(actual.operations,plan.operations,'PREBUILT_OPERATIONS_CHANGED');
 for(const name of ['deploy/scripts/deploy.sh','deploy/scripts/online-release-launcher.py','deploy/scripts/prebuilt-release-plan.mjs','deploy/scripts/prebuilt-migration-inventory.mjs','deploy/scripts/normal-migration-projection.mjs','deploy/scripts/deployment-role-binding.mjs','deploy/scripts/migration-control-inspection.mjs','deploy/scripts/migration-control-host.mjs','deploy/scripts/migration-control-state.mjs','deploy/scripts/production-image-execution-binding.mjs','scripts/lib/private-docker-image-archive.mjs','scripts/lib/production-backend-base-process.mjs','deploy/scripts/storage-preflight.sh','deploy/scripts/storage-preflight.mjs','scripts/deployment-storage.mjs','scripts/deployment-capacity.mjs'])assert.match(plan.operations.files[name],digest);
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
 return Object.freeze({applicationCommit:plan.applicationCommit,applicationSourceHash:plan.applicationSourceHash,images:Object.fromEntries(roles.map(role=>[role,plan.images[role].image])),frontendBuildId:plan.images.frontend.browser.id,...(plan.preservedClamav?{preservedClamav:plan.preservedClamav}:{}),releaseAdmission:false});
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
/** Observe the original host lock inherited on FD9; this does not grant a lease. */
export function inspectOriginalDeploymentHostLock(repository){
 const directory=path.join(repository,'.deploy-state'),lock=path.join(directory,'deployment.lock');
 assert.equal(fs.realpathSync(directory),directory);assert.equal(fs.realpathSync(lock),lock);
 const parent=fs.lstatSync(directory,{bigint:true}),named=fs.lstatSync(lock,{bigint:true}),held=fs.fstatSync(9,{bigint:true});
 assert.ok(parent.isDirectory()&&parent.uid===0n&&!(parent.mode&0o022n),'MIGRATION_PROJECTION_DIRECTORY');
 assert.ok(named.isFile()&&named.nlink===1n&&named.uid===0n&&!(named.mode&0o022n)&&held.dev===named.dev&&held.ino===named.ino,'MIGRATION_PROJECTION_LOCK_IDENTITY');
 const info=fs.readFileSync('/proc/self/fdinfo/9','utf8');
 assert.ok([...info.matchAll(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/gm)].some(row=>row[1]===held.ino.toString()),'MIGRATION_PROJECTION_LOCK_UNPROVEN');
 return {directory,device:held.dev.toString(),inode:held.ino.toString()};
}
/** Host-owned projection of an already verified prebuilt selection. It carries
 * evidence only; backend admission and the owned checkpoint remain required. */
export function writeMigrationProjection(repository,selection,applicationTree,planSha256,inventory,format='sabalan-prebuilt-migration-projection/v1'){
 assert.ok(['sabalan-prebuilt-migration-projection/v1','sabalan-build-migration-projection/v1'].includes(format));
 const deploymentId=process.env.DEPLOYMENT_ID,releaseId=process.env.DEPLOYMENT_RELEASE_ID;
 for(const value of [deploymentId,releaseId])assert.match(value??'',/^[A-Za-z0-9_-]{8,160}$/,'MIGRATION_PROJECTION_OWNER');
 const {directory,device,inode}=inspectOriginalDeploymentHostLock(repository);
 const record={format,deploymentId,releaseId,planSha256,
  applicationCommit:selection.applicationCommit,applicationTree,applicationSourceHash:selection.applicationSourceHash,
  backendImage:selection.images.backend,inventory,hostLock:{device,inode},releaseAdmission:false};
 const bytes=Buffer.from(JSON.stringify(record)+'\n');assert.ok(bytes.length<=1024*1024,'MIGRATION_PROJECTION_BOUND');
 const file=path.join(directory,`migration-projection-${deploymentId}.json`);
 let fd;
 try {fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);}
 catch(error){if(error?.code!=='EEXIST')throw error;read(file,sha(bytes),{privatePlan:true,maximum:1024*1024});return {file,sha256:sha(bytes)};}
 try {fs.writeFileSync(fd,bytes);fs.fchmodSync(fd,0o400);fs.fsyncSync(fd);}
 catch(error){throw Object.assign(new Error('MIGRATION_PROJECTION_PARTIAL_RETAINED',{cause:error}),{code:'MIGRATION_PROJECTION_PARTIAL_RETAINED'});}
 finally {fs.closeSync(fd);}
 const d=fs.openSync(directory,fs.constants.O_RDONLY);try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
 read(file,sha(bytes),{privatePlan:true,maximum:1024*1024});
 return {file,sha256:sha(bytes)};
}
export function prebuiltReleaseExports(value){
 const entries={DEPLOYMENT_TARGET_COMMIT:value.applicationCommit,DEPLOYMENT_TARGET_BACKEND_IMAGE:value.images.backend,DEPLOYMENT_BACKEND_IMAGE:value.images.backend,DEPLOYMENT_FRONTEND_IMAGE:value.images.frontend,DEPLOYMENT_INQUIRY_IMAGE:value.images.inquiry,DEPLOYMENT_PREBUILT_BACKEND_EXECUTION_IMAGE:value.images.backend,DEPLOYMENT_PREBUILT_FRONTEND_EXECUTION_IMAGE:value.images.frontend,DEPLOYMENT_PREBUILT_INQUIRY_EXECUTION_IMAGE:value.images.inquiry,DEPLOYMENT_BROWSER_BUILD_ID:value.frontendBuildId,PERFORMANCE_RELEASE_COMMIT:value.applicationCommit,PERFORMANCE_RELEASE_SOURCE_HASH:value.applicationSourceHash,PERFORMANCE_RELEASE_BACKEND_IMAGE:value.images.backend,PERFORMANCE_RELEASE_FRONTEND_IMAGE:value.images.frontend,PERFORMANCE_RELEASE_INQUIRY_IMAGE:value.images.inquiry};
 if(value.preservedClamav)entries.DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX=Buffer.from(canonical(selectionBinding(value.preservedClamav,value.planSha256))).toString('hex');
 for(const value of Object.values(entries))assert.match(value,/^[a-zA-Z0-9_:-]+$/);
 return Object.entries(entries).map(([key,value])=>`export ${key}='${value}'`).join('\n')+'\n';
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.argv.length,6);originalPipes();
 const [planFile,expected,repository,operationsRoot]=process.argv.slice(2);assert.equal(fs.realpathSync(repository),repository);assert.equal(fs.realpathSync(operationsRoot),operationsRoot);
 const plan=JSON.parse(read(planFile,expected,{privatePlan:true,maximum:8*1024**2})),actual={};
 assert.equal(plan.format,'sabalan-prebuilt-protected-release-plan/v1');requirePrebuiltScannerSelection(plan);keys(plan.images,roles);assert.ok(plan.operations?.files);
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
 const validated=validatePrebuiltReleasePlan(plan,actual);
 // Bind inventory discovery to the already verified Git commit. This output
 // is deliberately not exported as authority; transport and executor binding
 // still require the original host owner and its immutable-image witness.
 const inventory=readPrebuiltMigrationInventory(repository,validated.applicationCommit);
 assert.equal(inventory.commit,validated.applicationCommit);
 assert.equal(inventory.releaseAdmission,false);
 if(process.env.DEPLOYMENT_PREBUILT_WRITE_PROJECTION==='1')writeMigrationProjection(repository,validated,plan.applicationTree,expected,inventory);
 process.stdout.write(prebuiltReleaseExports({...validated,planSha256:expected}));
}
