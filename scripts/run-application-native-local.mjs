import {readExplicitQaMemoryProfile,readQaMemoryProfile} from './lib/application-native-qa-profile.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectInquiryArtifacts} from './lib/application-native-inquiry-artifacts.mjs';
import {collectApplicationPrismaArtifacts} from './lib/application-native-prisma-artifacts.mjs';
import {collectApplicationReadonlyTransportArtifacts} from './lib/application-native-readonly-transport-artifacts.mjs';
import {collectApplicationUiArtifacts} from './lib/application-native-ui-artifacts.mjs';
import {createOriginalRoleCoordinator} from './lib/application-native-role-coordinator.mjs';
import {collectApplicationFullCatalogArtifacts,stageOriginalFullCatalog} from './lib/application-native-full-catalog-artifacts.mjs';
import {observeOriginalPreparedMemory} from './lib/application-native-prepared-memory.mjs';
import {runOriginalRetainedBrowserQualificationRounds,readOriginalRetainedBrowserQualificationCompletion} from './lib/original-retained-browser-qualification.mjs';

export async function runOriginalApplicationNativeQualification({candidateReplacementReceipt,retainedBrowserCompletion,retainedBrowserPlanFile,retainedBrowserPlanSha256,independentOptions,nativeOwnerElfReceipt,prismaQualificationReceipt,frontendSnapshot,fullCatalogSelection}){
if(frontendSnapshot){
 assert.deepEqual(Object.keys(frontendSnapshot).sort(),['file','sha256']);
 const {readMeasuredFrontendSnapshot}=await import('../deploy/scripts/production-frontend-snapshot.mjs');
 readMeasuredFrontendSnapshot(frontendSnapshot.file,frontendSnapshot.sha256);
}
assert.equal(typeof candidateReplacementReceipt,'string','EXPLICIT_ACTUAL_CANDIDATE_REPLACEMENT_RECEIPT_REQUIRED');
assert.ok(path.isAbsolute(candidateReplacementReceipt)&&fs.lstatSync(candidateReplacementReceipt).isFile(),'ACTUAL_CANDIDATE_REPLACEMENT_RECEIPT_REQUIRED_BEFORE_DOCKER');
if(!retainedBrowserCompletion){assert.ok(retainedBrowserPlanFile&&retainedBrowserPlanSha256,'ORIGINAL_RETAINED_BROWSER_PLAN_REQUIRED');retainedBrowserCompletion=await runOriginalRetainedBrowserQualificationRounds({planFile:retainedBrowserPlanFile,planSha256:retainedBrowserPlanSha256});}
const retainedBrowserFacts=readOriginalRetainedBrowserQualificationCompletion(retainedBrowserCompletion);
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),esbuild=require('../backend/node_modules/esbuild');
const loaderFor=name=>{const loader={'.ts':'ts','.js':'js','.mjs':'js','.json':'json'}[path.extname(name)];assert.ok(loader,'unsupported captured module extension');return loader;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),compose=['compose','-f','D:/sabalanerp/docker-compose.local.yml'];
const services=['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained','frontend-candidate','frontend-retained'];
function status(){
  const raw=execFileSync('docker',[...compose,'ps','--format','json'],{encoding:'utf8'});
  let rows;try{const value=JSON.parse(raw);rows=Array.isArray(value)?value:[value];}
  catch{rows=raw.trim().split(/\r?\n/).map(line=>JSON.parse(line));}
  for(const service of services)assert.ok(rows.some(row=>row.Project==='sabalanerp-local' && row.Service===service && row.State==='running' && row.Health==='healthy'));
  return rows;
}
function inspect(){const rows=status(),names=services.map(service=>rows.find(row=>row.Service===service).Name);
  const values=JSON.parse(execFileSync('docker',['inspect',...names],{encoding:'utf8'}));assert.equal(values.length,services.length);
  return Object.fromEntries(values.map(value=>{assert.equal(value.Config.Labels['com.docker.compose.project'],'sabalanerp-local');
    const service=value.Config.Labels['com.docker.compose.service'];assert.ok(services.includes(service));return [service,value];}));}
const identity=value=>({id:value.Id,image:value.Image,startedAt:value.State.StartedAt});
const initial=inspect(),before=Object.fromEntries(services.map(service=>[service,identity(initial[service])]));
for(const service of ['frontend-retained','frontend-candidate']){const restored=retainedBrowserFacts.report.restoredSlots[service];assert.deepEqual(identity(initial[service]),{id:restored.id,image:restored.image,startedAt:restored.startedAt},'ORIGINAL_RESTORED_UI_INCARNATION_CHANGED');}
const candidate=initial['backend-candidate'],retained=initial['backend-retained'];
const directory='/app/online-runtime-acceptance/application-native-'+randomBytes(16).toString('hex');
const roleTopology=Object.fromEntries([['main',retained],['candidate',candidate]].map(([role,slot])=>[role,
  {containerId:slot.Id,image:slot.Image,host:slot.NetworkSettings.Networks['sabalanerp-local_default'].IPAddress}]));
assert.ok(candidate.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
const candidateAuthority=candidate.Mounts.find(mount=>mount.Destination==='/app/runtime-authority');
const retainedAuthority=retained.Mounts.find(mount=>mount.Destination==='/run/sabalan-online');
assert.ok(candidateAuthority?.RW && retainedAuthority && !retainedAuthority.RW && candidateAuthority.Source===retainedAuthority.Source);
const candidateJobs=candidate.Mounts.find(mount=>mount.Destination==='/run/sabalan-online');
const retainedJobs=retained.Mounts.find(mount=>mount.Destination==='/app/jobs-authority');
assert.ok(candidateJobs&&!candidateJobs.RW&&retainedJobs?.RW&&candidateJobs.Source===retainedJobs.Source
  &&candidateJobs.Source!==candidateAuthority.Source);
assert.ok(!candidate.Mounts.some(mount=>mount.RW&&mount.Source===candidateJobs.Source));
assert.ok(!retained.Mounts.some(mount=>mount.RW&&mount.Source===retainedAuthority.Source));
for(const slot of [candidate,retained])assert.ok(slot.Mounts.some(mount=>mount.Name==='sabalanerp-local_online_runtime_acceptance'
  && mount.RW && mount.Destination==='/app/online-runtime-acceptance'));
const sources={},capture=name=>{const bytes=fs.readFileSync(path.join(root,name)),hash=sha(bytes);
  if(sources[name])assert.equal(sources[name],hash);sources[name]=hash;return bytes;};
capture('scripts/run-application-native-local.mjs');
capture('scripts/lib/application-native-role-coordinator.mjs');
capture('scripts/lib/application-native-prepared-memory.mjs');
for(const source of ['scripts/lib/original-private-legacy-ui-carrier.mjs',
 'scripts/lib/application-native-qa-profile.mjs','scripts/lib/production-legacy-browser-artifacts.mjs','scripts/lib/production-frontend-base-artifacts.mjs',
 'scripts/lib/private-docker-image-archive.mjs','deploy/scripts/production-frontend-snapshot.mjs'])capture(source);
capture('docker-compose.application-native-role-isolation.yml');
const {collectNativeCandidateArtifacts,candidateReplacementReceiptArgument}=await import('./lib/application-native-candidate-artifacts.mjs');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const candidateArtifacts=collectNativeCandidateArtifacts({root,capture,containers:initial,sourceCommit,
 receiptArgument:candidateReplacementReceiptArgument(['--candidate-replacement-receipt',candidateReplacementReceipt])});
const {roleQualificationFile,roleQualificationBytes,roleQualification,privateQualificationRuntime}=candidateArtifacts;
const qaMemoryProfile=(roleQualification.candidateQaMemoryTransition?.format==='sabalan-explicit-local-qa-candidate-memory-transition/v3'||roleQualification.candidateQaMemoryProfile||roleQualification.candidateQaMemoryRecovery)?readExplicitQaMemoryProfile({file:candidateReplacementReceipt,sha256:sha(roleQualificationBytes)}):null;assert.deepEqual(retainedBrowserFacts.report.qaMemoryProfile??null,readQaMemoryProfile(qaMemoryProfile));
const built=await esbuild.build({absWorkingDir:root,entryPoints:['tests/online-deployment/application-native.worker.ts'],
  bundle:true,platform:'node',packages:'external',format:'cjs',target:'node22',write:false,logLevel:'silent',
  plugins:[{name:'capture-application-native-sources',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
    const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(name && !name.startsWith('../') && !path.isAbsolute(name));
    const loader={'.ts':'ts','.js':'js','.mjs':'js','.json':'json'}[path.extname(args.path)];assert.ok(loader);
    return {contents:capture(name),loader,resolveDir:path.dirname(args.path)};
  });}}]});
const bundle=Buffer.from(built.outputFiles[0].contents),bundleSha256=sha(bundle);
const files={'application-worker.cjs':bundle};if(qaMemoryProfile)files['qa-memory-replacement-receipt.json']=roleQualificationBytes;
const readonlyTransport=collectApplicationReadonlyTransportArtifacts({capture,sources,bundle,bundleSha256});
Object.assign(files,readonlyTransport.files);
const ui=collectApplicationUiArtifacts({root,capture,containers:initial,inspectImage:image=>{
  status();const raw=execFileSync('docker',['image','inspect',image],{encoding:'utf8'});
  assert.ok(Buffer.byteLength(raw)<4*1024*1024);const values=JSON.parse(raw);assert.equal(values.length,1);return values[0];
}});
const printAssets=['brand/sabalan-logo.jpg','yekan-bakh/YekanBakh-Regular.woff2',
  'yekan-bakh/YekanBakh-SemiBold.woff2','yekan-bakh/YekanBakh-Bold.woff2'];
const printAssetInventory=[];
for(const relative of printAssets){const bytes=capture('backend/public/'+relative),file='print-asset-'+printAssetInventory.length;
  files[file]=bytes;printAssetInventory.push({file,target:relative,sha256:sha(bytes),bytes:bytes.length});}
files['print-assets.json']=Buffer.from(JSON.stringify(printAssetInventory)+'\n');
const routing=await esbuild.build({absWorkingDir:root,entryPoints:['tests/online-deployment/application-native-routing.fixture.mjs'],
  bundle:true,platform:'node',packages:'external',format:'esm',target:'node22',write:false,logLevel:'silent',
  plugins:[{name:'capture-native-application-routing',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
    const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(name && !name.startsWith('../') && !path.isAbsolute(name));
    return {contents:capture(name),loader:loaderFor(name),resolveDir:path.dirname(args.path)};
  });}}]});
files['application-routing.mjs']=Buffer.from(routing.outputFiles[0].contents);
const channelNegative=await esbuild.build({absWorkingDir:root,entryPoints:['tests/online-deployment/readonly-transport-channel-negative.fixture.mjs'],
  bundle:true,platform:'node',packages:'external',format:'esm',target:'node22',write:false,logLevel:'silent',
  plugins:[{name:'capture-readonly-channel-negative',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
    const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(name&&!name.startsWith('../')&&!path.isAbsolute(name));
    return {contents:capture(name),loader:loaderFor(name),resolveDir:path.dirname(args.path)};
  });}}]});
files['readonly-channel-negative.mjs']=Buffer.from(channelNegative.outputFiles[0].contents);

const sealer=await esbuild.build({absWorkingDir:root,entryPoints:['backend/src/scripts/sealNativeVersionedFiles.ts'],
  bundle:true,platform:'node',packages:'external',format:'cjs',target:'node22',write:false,logLevel:'silent',
  plugins:[{name:'capture-native-file-sealer',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
    const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(name && !name.startsWith('../') && !path.isAbsolute(name));
    return {contents:capture(name),loader:loaderFor(name),resolveDir:path.dirname(args.path)};
  });}}]});
files['native-file-sealer.cjs']=Buffer.from(sealer.outputFiles[0].contents);
const migration=await esbuild.build({absWorkingDir:root,entryPoints:['tests/online-deployment/application-native-migration.worker.ts'],
  bundle:true,platform:'node',packages:'external',format:'cjs',target:'node22',write:false,logLevel:'silent',
  plugins:[{name:'capture-native-application-migration',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
    const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(name&&!name.startsWith('../')&&!path.isAbsolute(name));
    return {contents:capture(name),loader:loaderFor(name),resolveDir:path.dirname(args.path)};
  });}}]});
files['application-migration.cjs']=Buffer.from(migration.outputFiles[0].contents);
const baseline=await esbuild.build({absWorkingDir:root,entryPoints:['tests/online-deployment/application-native-restored-baseline.worker.ts'],
  bundle:true,platform:'node',packages:'external',format:'cjs',target:'node22',write:false,logLevel:'silent',
  plugins:[{name:'capture-restored-native-baseline',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
    const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(name&&!name.startsWith('../')&&!path.isAbsolute(name));
    return {contents:capture(name),loader:loaderFor(name),resolveDir:path.dirname(args.path)};
  });}}]});
files['application-restored-baseline.cjs']=Buffer.from(baseline.outputFiles[0].contents);
const qualificationWorker=await esbuild.build({absWorkingDir:root,
  entryPoints:['tests/online-deployment/online-private-qualification-native.worker.ts'],bundle:true,platform:'node',
  packages:'external',format:'cjs',target:'node22',write:false,metafile:true,logLevel:'silent',
  plugins:[{name:'capture-fixed-image-qualification-wrapper',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
    const name=path.relative(root,args.path).split(path.sep).join('/');
    assert.ok(['tests/online-deployment/online-private-qualification-native.worker.ts',
      'tests/online-deployment/online-private-qualification-control.fixture.ts'].includes(name));
    return {contents:capture(name),loader:loaderFor(name),resolveDir:path.dirname(args.path)};
  });}}]});
assert.equal(Object.keys(qualificationWorker.metafile.inputs).length,2);
files['online-private-qualification-worker.cjs']=Buffer.from(qualificationWorker.outputFiles[0].contents);
const domainWriters=await esbuild.build({absWorkingDir:root,entryPoints:['tests/online-deployment/installed-domain-writers.worker.ts'],
 bundle:true,platform:'node',packages:'external',format:'cjs',target:'node22',write:false,metafile:true,logLevel:'silent',
 plugins:[{name:'capture-installed-http-domain-observer',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
  const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(name.startsWith('tests/online-deployment/installed-'),'INSTALLED_DOMAIN_MUST_NOT_IMPORT_BACKEND_GRAPH');
  return{contents:capture(name),loader:loaderFor(name),resolveDir:path.dirname(args.path)};
 });}}]});
assert.ok(Object.keys(domainWriters.metafile.inputs).every(name=>name.startsWith('tests/online-deployment/installed-')));
files['installed-domain-writers.cjs']=Buffer.from(domainWriters.outputFiles[0].contents);
const pristineWorker=await esbuild.build({absWorkingDir:root,entryPoints:['tests/online-deployment/installed-pristine-performance.worker.ts'],
 bundle:true,platform:'node',packages:'external',format:'cjs',target:'node22',write:false,metafile:true,logLevel:'silent',
 plugins:[{name:'capture-installed-pristine-profile-observer',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
  const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(name.startsWith('tests/online-deployment/installed-'));
  return{contents:capture(name),loader:loaderFor(name),resolveDir:path.dirname(args.path)};
 });}}]});
assert.equal(Object.keys(pristineWorker.metafile.inputs).length,2);
files['installed-pristine-performance.cjs']=Buffer.from(pristineWorker.outputFiles[0].contents);
const installedBrowser=await esbuild.build({absWorkingDir:root,entryPoints:['tests/online-deployment/installed-paired-browser.fixture.mjs'],
 bundle:true,platform:'node',packages:'external',format:'esm',target:'node22',write:false,logLevel:'silent',
 plugins:[{name:'capture-original-installed-paired-browser',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
  const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(name&&!name.startsWith('../')&&!name.startsWith('backend/'));
  return{contents:capture(name),loader:loaderFor(name),resolveDir:path.dirname(args.path)};
 });}}]});
files['installed-paired-browser.mjs']=Buffer.from(installedBrowser.outputFiles[0].contents);
const installedLegacyBrowser=await esbuild.build({absWorkingDir:root,entryPoints:['tests/online-deployment/installed-legacy-paired-browser.fixture.mjs'],
 bundle:true,platform:'node',packages:'external',format:'esm',target:'node22',write:false,logLevel:'silent',
 plugins:[{name:'capture-original-installed-legacy-browser',setup(build){build.onLoad({filter:/.*/,namespace:'file'},args=>{
  const name=path.relative(root,args.path).split(path.sep).join('/');assert.ok(name&&!name.startsWith('../')&&!name.startsWith('backend/'));
  return{contents:capture(name),loader:loaderFor(name),resolveDir:path.dirname(args.path)};
 });}}]});
files['installed-legacy-paired-browser.mjs']=Buffer.from(installedLegacyBrowser.outputFiles[0].contents);
const fullCatalog=collectApplicationFullCatalogArtifacts({root,capture,selection:fullCatalogSelection,prismaQualificationReceipt});
Object.assign(files,fullCatalog.files);
capture('scripts/lib/application-native-private-qualification.mjs');
for(const [name,bytes]of Object.entries(collectInquiryArtifacts({repositoryRoot:root,captureSource:capture}))){
  if(files[name])assert.deepEqual(files[name],bytes);else files[name]=bytes;
}
for(const [name,bytes]of Object.entries(collectApplicationPrismaArtifacts({repositoryRoot:root,captureSource:capture}))){
  if(files[name])assert.deepEqual(files[name],bytes);else files[name]=bytes;
}
// Reuse the actual qualified official artifact, never regenerate a shared or
// operation client during application admission. This is diagnostic custody,
// not a production image or migration-history adoption certificate.
const prismaReceiptRelative=prismaQualificationReceipt?path.relative(root,path.resolve(prismaQualificationReceipt)).split(path.sep).join('/'):'reports/qa/application-prisma-adc49c06e111ddb62501a67feceb6eca.json';
assert.match(prismaReceiptRelative,/^reports\/qa\/application-prisma-[a-f0-9]{32}\.json$/);
const qualificationReceipt=capture(prismaReceiptRelative);
const qualification=JSON.parse(qualificationReceipt);
assert.equal(qualification.pass,true);assert.equal(qualification.result.databaseRetiredWithoutForce,true);
const prismaMigrations=fs.readdirSync(path.join(root,'backend/prisma/migrations'),{withFileTypes:true}).filter(x=>x.isDirectory()&&fs.existsSync(path.join(root,'backend/prisma/migrations',x.name,'migration.sql')));
assert.equal(qualification.result.migrationCount,prismaMigrations.length);
assert.equal(qualification.result.generated.linuxArtifact.format,'sabalan-official-linux-prisma-artifact/v1');
assert.equal(qualification.result.generated.linuxArtifact.linuxGenerated,true);
assert.equal(qualification.result.generated.hostArtifact,undefined);
assert.equal(qualification.result.generated.schemaSha256,sha(capture('backend/prisma/schema.prisma')));
status();const qualifiedProof=execFileSync('docker',['exec',candidate.Id,'cat',qualification.directory+'/generated-prisma-proof.json']);
assert.deepEqual(JSON.parse(qualifiedProof),qualification.result.generated);
files['qualified-prisma-receipt.json']=qualificationReceipt;
files['qualified-prisma-capsule.json']=Buffer.from(JSON.stringify({sourceRoot:qualification.directory,
  receiptSha256:sha(qualificationReceipt),proofSha256:sha(qualifiedProof)})+'\n');
for(const [name,source]of Object.entries({
  'fixture.py':'tests/online-deployment/application-native.fixture.py',
  'application-native-capture.fixture.py':'tests/online-deployment/application-native-capture.fixture.py',
  'application-native-capture.worker.py':'tests/online-deployment/application-native-capture.worker.py',
  'application-native-migration.fixture.py':'tests/online-deployment/application-native-migration.fixture.py',
  'original-host-controller-channel.py':'tests/online-deployment/original-host-controller-channel.fixture.py',
  'application-native-role-client.py':'tests/online-deployment/application-native-role-client.fixture.py',
  'application-native-candidate-controller.py':'tests/online-deployment/application-native-candidate-controller.fixture.py',
  'private-qualification-observer.py':'tests/online-deployment/private-qualification-observer.fixture.py',
  'application-native-private-old-jobs.fixture.py':'tests/online-deployment/application-native-private-old-jobs.fixture.py',
  'private-installed-runtime-observer.py':'tests/online-deployment/private-installed-runtime-observer.fixture.py',
  'installed-writer-coverage.fixture.py':'tests/online-deployment/installed-writer-coverage.fixture.py',
  'application-native-private-pair.fixture.py':'tests/online-deployment/application-native-private-pair.fixture.py',
  'installed-domain-coherent-restore.fixture.py':'tests/online-deployment/installed-domain-coherent-restore.fixture.py',
  'private-pair-bridge-probe.mjs':'tests/online-deployment/private-pair-bridge-probe.fixture.mjs',
  'full-catalog-stage.py':'tests/online-deployment/full-catalog-stage.fixture.py',
  'private-qualification-materialize.py':'tests/online-deployment/private-qualification-materialize.fixture.py',
  'private-qualification-bootstrap.sql':'tests/online-deployment/private-qualification-bootstrap.fixture.sql',
  'application-native-cdp-proxy.fixture.mjs':'tests/online-deployment/application-native-cdp-proxy.fixture.mjs',
  'application-native-browser-ingress.fixture.mjs':'tests/online-deployment/application-native-browser-ingress.fixture.mjs',
  'native-private-network.fixture.mjs':'tests/online-deployment/native-private-network.fixture.mjs',
  'backend-runtime-owner.py':'deploy/scripts/backend-runtime-owner.py',
  'online-runtime-owner.py':'deploy/scripts/online-runtime-owner.py',
  'online-runtime-scope.py':'deploy/scripts/online-runtime-scope.py',
  'online-capture-admission.py':'deploy/scripts/online-capture-admission.py',
  ...Object.fromEntries(['capture-coherent-components.py','recovery-database-freeze.py','recovery-file-generations.py',
    'coherent-versioned-file-cuts.py','recovery-versioned-files.py','native-versioned-file-sealer.py',
    'online-backend-boundary.py','online-inquiry-boundary.py'].map(name=>[name,'deploy/scripts/'+name])),
  'hr-file-expansion.sql':'backend/prisma/migrations/20261019020000_hr_versioned_file_cleanup/migration.sql',
}))files[name]=capture(source);
assert.match(files['hr-file-expansion.sql'].toString(),/^-- Generated bounded online expansion: 20261019020000_hr_versioned_file_cleanup\r?\nALTER TABLE "public"\."hr_deletion_file_cleanups" ADD COLUMN "versionedFileState" jsonb;\r?\n$/);
files['original-retained-browser-result.json']=fs.readFileSync(retainedBrowserFacts.reportFile);
assert.equal(sha(files['original-retained-browser-result.json']),retainedBrowserFacts.reportSha256);
const fileHashes=Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,sha(bytes)]));
const coordinator=createOriginalRoleCoordinator({directory,topology:roleTopology,fileHashes,retainedBrowserCompletion,originalServiceIdentities:before,independentOptions,nativeOwnerElfReceipt,frontendSnapshot,qaMemoryProfile,
  onHeld:value=>{const reportPath=path.join(root,'reports/qa',path.basename(directory)+'-role-held.json');fs.writeFileSync(reportPath,JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify({format:'sabalan-original-inner-controller-held/v1',event:'ORIGINAL_INNER_CONTROLLER_HELD',status:'ROLEHELD',reportPath,reason:'ORIGINAL_CONTROLLER_HELD'}));}});
files['config.json']=Buffer.from(JSON.stringify({sourceCommit,...(qaMemoryProfile?{qaMemoryProfile:{...readQaMemoryProfile(qaMemoryProfile),receiptFile:'qa-memory-replacement-receipt.json'}}:{}),
  retainedBrowserReport:{file:'original-retained-browser-result.json',sha256:retainedBrowserFacts.reportSha256},
  image:retained.Image,bundleSha256,roleTopology,roleQualification:{file:roleQualificationFile,sha256:sha(roleQualificationBytes)},
  privateQualificationRuntime,
  privateQualificationRuntimes:roleQualification.privateQualificationRuntimes,
  privateQualificationSourceCommits:roleQualification.privateQualificationSourceCommits,
  originalHostEnrollment:coordinator.enrollment,
  catalog:fullCatalog.catalog,
  inquiryRegistryDescriptor:(()=>{const receipt=JSON.parse(capture('reports/qa/inquiry-native-next-image-20261018.json')).imageReceipt;assert.match(receipt.image,/^sha256:[a-f0-9]{64}$/);assert.match(receipt.archiveSha256,/^[a-f0-9]{64}$/);return{id:'inquiry_unrouted_'+receipt.archiveSha256.slice(0,32),application:'inquiry',slotId:'inquiry_unrouted_fixed',image:receipt.image,manifestSha256:receipt.archiveSha256,assets:[],actionIds:[],retiredAt:null,supportUntil:null};})(),
  uiArtifacts:ui.artifacts,uiQualification:ui.proof,readonlyTransport:readonlyTransport.proof})+'\n');
fileHashes['config.json']=sha(files['config.json']);
const bootstrap=`const fs=require('fs'),path=require('path');process.umask(0o077);const root=${JSON.stringify(directory)};
  fs.mkdirSync(root,{mode:0o700});const input=JSON.parse(fs.readFileSync(0,'utf8'));
  for(const [name,value]of Object.entries(input)){const file=path.resolve(root,name);if(!file.startsWith(root+'/')||name.includes('..'))throw Error('UNSAFE_SOURCE');
    const fd=fs.openSync(file,'wx',0o400);try{fs.writeFileSync(fd,Buffer.from(value,'base64'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}`;
status();execFileSync('docker',['exec','-i',candidate.Id,'node','-e',bootstrap],{
  input:JSON.stringify(Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,bytes.toString('base64')])))});
const report={format:'sabalan-application-native-local/v1',pass:false,productionAdmission:false,workingRoot:directory,
  before,sources,bundleSha256,uiQualification:ui.proof,readonlyTransport:readonlyTransport.proof,diagnosticOverlay:true,
  retainedBrowser:{reportFile:retainedBrowserFacts.reportFile,reportSha256:retainedBrowserFacts.reportSha256,restoredSlots:retainedBrowserFacts.report.restoredSlots,actualProductionLegacy55Qualified:false}};
const reportPath=path.join(root,'reports/qa',path.basename(directory)+'.json');const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
report.fullCatalogSource=fullCatalog.proof;save();
report.fullCatalogStage=await stageOriginalFullCatalog({prepared:fullCatalog,directory,containerId:candidate.Id,beforeDocker:status,
  onObservation:value=>{report.fullCatalogStageObservation=value;save();}});save();
async function run(slot,mode){status();return await new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec',slot.Id,'python3','-I','-B',directory+'/fixture.py',directory,mode],{stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',bytes=>{stdout+=bytes;});child.stderr.on('data',bytes=>{stderr+=bytes;});
  child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr}));
});}
report.prepare=await run(candidate,'prepare');save();assert.equal(report.prepare.code,0);assert.equal(report.prepare.signal,null);
assert.equal(JSON.parse(report.prepare.stdout).prepared,true);
report.prepareCache=await run(candidate,'prepare-cache');save();assert.equal(report.prepareCache.code,0);
assert.equal(report.prepareCache.signal,null);const cachePreparation=JSON.parse(report.prepareCache.stdout);
assert.equal(cachePreparation.cacheCreditUsed,false);
// The closed Python preparation statistics remain diagnostic; sample fresh now.
report.preparedMemory=await observeOriginalPreparedMemory({containerId:candidate.Id,beforeDocker:status,qaMemoryProfile,
  onObservation:value=>{report.preparedMemoryObservation=value;save();}});save();
report.roleAuthorityIssue=await run(retained,'issue-role-authorities');save();assert.equal(report.roleAuthorityIssue.code,0);
assert.equal(report.roleAuthorityIssue.signal,null);assert.equal(JSON.parse(report.roleAuthorityIssue.stdout).issued,true);
status();const roleIndex=JSON.parse(execFileSync('docker',['exec',candidate.Id,'cat',directory+'/index.json'],{encoding:'utf8'}));
const roleEnrollment={requestId:randomBytes(32).toString('hex'),index:roleIndex,files:fileHashes,roleTopology};
let candidateController;
try{
report.candidateQualification=candidateArtifacts.revalidate();save();
candidateController=coordinator.launch('candidate');await candidateController.ready;
coordinator.enrollCandidate(roleEnrollment);
const mainController=coordinator.launch('main');await mainController.ready;coordinator.enrollMain(roleEnrollment,files['config.json']);
report.exercise=await mainController.closed;save();assert.equal(report.exercise.code,0);assert.equal(report.exercise.signal,null);
coordinator.closeCandidate();report.candidateController=await candidateController.closed;save();
assert.equal(report.candidateController.code,0);assert.equal(report.candidateController.signal,null);
const result=JSON.parse(report.exercise.stdout);assert.equal(result.passResult,true);assert.equal(result.productionAdmission,false);
assert.equal(result.originalNativeClosures.length,2);assert.equal(result.originalDatabaseRetiredWithoutForce,true);
const after=inspect();const legacyRestoration=coordinator.readOriginalPrivateLegacyRestoration();
for(const service of services){
 const expected=service==='frontend-retained'&&legacyRestoration?legacyRestoration.restored:before[service];
 assert.deepEqual(identity(after[service]),expected);
}
candidateArtifacts.revalidate();
for(const [name,hash]of Object.entries(sources))assert.equal(sha(fs.readFileSync(path.join(root,name))),hash,'Captured source changed: '+name);
report.result=result;report.identitiesUnchanged=!legacyRestoration;report.originalLegacyUiRestoration=legacyRestoration;
report.protectedServiceIdentitiesVerified=true;report.sourcesUnchanged=true;report.pass=true;save();
}catch(error){
  try{
    report.pass=false;report.roleCoordinator=coordinator.status();report.failure={name:error.name,message:error.message};save();
    await coordinator.waitKnownFailedCandidate();
    if(coordinator.knownFailureCanClose()){
      coordinator.closeKnownFailedCandidate();report.failedCandidateClosure=await candidateController.closed;
      report.roleCoordinator=coordinator.status();report.knownFailedOriginalClosure=coordinator.allControllersClosed();save();
    }
  }catch(cleanupError){
    await coordinator.retainOnFailure(cleanupError);
  }
  if(coordinator.allControllersClosed())throw error;
  await coordinator.retainOnFailure(error);
}
readOriginalRetainedBrowserQualificationCompletion(retainedBrowserCompletion);
return Object.freeze({completion:coordinator.finishOriginalQualification(),retainedBrowserCompletion,report,reportPath});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
 assert.equal(process.argv.length,4,'EXPLICIT_ACTUAL_CANDIDATE_REPLACEMENT_RECEIPT_REQUIRED');assert.equal(process.argv[2],'--candidate-replacement-receipt');
 const result=await runOriginalApplicationNativeQualification({candidateReplacementReceipt:process.argv[3]});
 console.log(JSON.stringify({pass:true,reportPath:result.reportPath}));
}
