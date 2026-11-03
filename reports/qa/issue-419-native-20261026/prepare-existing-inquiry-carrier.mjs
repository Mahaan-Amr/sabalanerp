/** Select existing bytes and render an inert same-service carrier proposal. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {backendBaseLocalGuards} from '../../../scripts/lib/production-backend-base-local-guard.mjs';
import {stableBackendBaseFile} from '../../../scripts/lib/production-backend-base-artifacts.mjs';
import {inspectPrivateDockerArchive} from '../../../scripts/lib/private-docker-image-archive.mjs';
import {sanitizeProductionImageInspection,productionImageStore,productionInspectionSha256,assertExecutionBindingSelection} from '../../../deploy/scripts/production-image-execution-binding.mjs';
const evidence=import.meta.dirname,repo=path.resolve(evidence,'../../..'),output=path.join(evidence,'EXISTING-INQUIRY-CARRIER-PROPOSAL.json');assert.ok(!fs.existsSync(output));
const directory='D:/sabalanerp-online-qa/inquiry-startup-refresh-native-1fd3e1d9d41b9ab5dcae6b3c2b0d728c';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const ref=file=>{const {bytes,sha256}=stableBackendBaseFile(file);return {file,bytes,sha256};};
const imageFile=directory+'/image.json',image=JSON.parse(fs.readFileSync(imageFile)),archiveFile=directory+'/native-image-archive.json',archive=JSON.parse(fs.readFileSync(archiveFile));
assert.equal(ref(imageFile).sha256,'3a0fd9643119530e395697d9a4fdc059d896018e19e5f49bded50a68f956428f');
assert.equal(archive.imageReceiptSha256,ref(imageFile).sha256);
assert.equal(image.image,'sha256:ff0e0b21d2ea6d036946621085f7a6c90437f07b610e5f7129479cd31e4c2740');
const graph=inspectPrivateDockerArchive(archive.archive,image.image),rollbackGraph=inspectPrivateDockerArchive(image.baseArchive,image.baseIndexId);
for(const key of ['index','platform','config','rootfsDiffIds','archiveSha256','archiveBytes'])assert.deepEqual(graph[key],archive[key]);
assert.equal(rollbackGraph.archiveSha256,image.baseArchiveSha256);assert.equal(rollbackGraph.config,image.baseConfigId);
assert.equal(image.inquirySourceCommit,'63407dd94f17471b030b0aa59c80313c107c3a54');
const closureFile=directory+'/original-commands-closed.json',closure=JSON.parse(fs.readFileSync(closureFile));
assert.equal(closure.pass,true);assert.equal(closure.originalClosure.allOriginalChildrenClosed,true);assert.equal(closure.originalClosure.interrupted,false);
assert.equal(ref(closureFile).sha256,image.startupRefresh.originalBuildClosure.sha256);
const proofFile=directory+'/startup-overlay-proof.json',proof=JSON.parse(fs.readFileSync(proofFile));
assert.equal(ref(proofFile).sha256,image.startupRefresh.wholeArchiveProofSha256);assert.equal(proof.pass,true);assert.equal(proof.allLayersExpandedAndFullDiffIdsVerified,true);assert.equal(proof.noBusinessOrCompiledRuntimeContentChanges,true);assert.equal(proof.index,graph.index);assert.equal(proof.archiveSha256,graph.archiveSha256);
const runtimeSourceMatch={};
for(const [name,pin]of Object.entries(image.runtimeSourceHashes)){
 const file=path.join(repo,name.endsWith('.py')?'deploy/scripts':'backend/src/services',name),raw=fs.readFileSync(file);
 const crlf=Buffer.from(raw.toString('utf8').replaceAll('\r\n','\n').replaceAll('\n','\r\n'));
 assert.ok(sha(raw)===pin||sha(crlf)===pin,'CARRIER_RUNTIME_SOURCE_CHANGED:'+name);
 runtimeSourceMatch[name]={file,workingSha256:sha(raw),artifactSourceSha256:pin,lineEndingsOnly:sha(raw)!==pin};
}
const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands);
const report={format:'sabalan-419-existing-inquiry-carrier-proposal/v1',preparedAt:new Date().toISOString(),
 prepared:false,executable:false,runtimeAccepted:false,productionAdmission:false,sourceIssue411Accepted:false,
 compilerRepeated:false,materializerRepeated:false,imageBuilt:false,hostPackRepeated:false,cryptoRepeated:false,composeUp:false,
 imageReceipt:ref(imageFile),archiveReceipt:ref(archiveFile),archive:ref(archive.archive),graph,
 sourceCommit:image.sourceCommit,inquirySourceCommit:image.inquirySourceCommit,applicationSourceRelabeled:false,
 runtimeSourceMatch,originalClosureReceipt:ref(closureFile),expandedGraphProof:ref(proofFile),
 rollbackGraph,rollbackArchive:ref(image.baseArchive),
 scope:'One reviewed image-selection prerequisite in existing sabalanerp-local/inquiry, followed by the unchanged source411 RO-only mount contract on that selected image.',
 pending:['Review/authorize the actual same-service image transition; no source-only receipt grants execution',
 'Fresh capacity, native/SQL/readers, preserved SQLite and full configuration comparisons before UP',
 'Real immutable-image baseline restoration on post-UP failure',
 'Fresh COMPLETE owner/worker/controller bindings; same original master retained across milestones',
 'Actual source411 native/SQLite/browser/stop/retirement acceptance; no historical source plan is executable'],
};
let lease;
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};
 report.before=await guards.protectedIdentities();
 const info=JSON.parse(await guards.docker(['info','--format','{"Driver":{{json .Driver}},"DriverStatus":{{json .DriverStatus}}}']));
 const store=productionImageStore(info);assert.equal(store,'containerd');
 const [selected]=JSON.parse(await guards.docker(['image','inspect',graph.index]));
 const native=sanitizeProductionImageInspection(selected);
 report.selection={format:'sabalan-production-image-execution-binding/v1',store,executionImageId:selected.Id,graph,nativeInspection:native,inspectionSha256:productionInspectionSha256(native)};
 assertExecutionBindingSelection(report.selection,graph,selected.Id);
 const [original]=JSON.parse(await guards.docker(['inspect',report.before.inquiry.id]));
 assert.equal(original.ImageManifestDescriptor.digest,rollbackGraph.platform,'ORIGINAL_NATIVE_PLATFORM_DESCRIPTOR_MISMATCH');
 const [rollback]=JSON.parse(await guards.docker(['image','inspect',rollbackGraph.index]));
 const rollbackNative=sanitizeProductionImageInspection(rollback);
 report.rollbackSelection={format:'sabalan-production-image-execution-binding/v1',store,executionImageId:rollback.Id,graph:rollbackGraph,nativeInspection:rollbackNative,inspectionSha256:productionInspectionSha256(rollbackNative)};
 assertExecutionBindingSelection(report.rollbackSelection,rollbackGraph,rollback.Id);
 report.original={id:original.Id,legacyContainerImageString:original.Image,nativePlatformDescriptor:original.ImageManifestDescriptor,
  configSha256:sha(JSON.stringify(original.Config)),hostConfigSha256:sha(JSON.stringify(original.HostConfig)),mountsSha256:sha(JSON.stringify(original.Mounts)),
  ports:original.NetworkSettings.Ports,hostname:original.Config.Hostname,configurationFiles:original.Config.Labels['com.docker.compose.project.config_files']};
 const proposalFile=path.join(evidence,'inquiry-native-selection.compose.json');
 const proposal={services:{inquiry:{image:selected.Id,hostname:original.Config.Hostname}}};
 fs.writeFileSync(proposalFile,JSON.stringify(proposal,null,2)+'\n',{flag:'wx',mode:0o600});report.composeProposal=ref(proposalFile);
 // config is a pure read/render operation. Never save its secret-bearing output.
 await guards.status();const rendered=await commands.run('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','-f',proposalFile,'config','--format','json']);commands.assertSuccessful(rendered);
 const model=JSON.parse(rendered.stdout);assert.equal(model.name,'sabalanerp-local');assert.equal(model.services.inquiry.image,selected.Id);
 report.renderedConfigurationSha256=sha(rendered.stdout);report.renderedServiceNames=Object.keys(model.services).sort();
 report.after=await guards.protectedIdentities();assert.deepEqual(report.after,report.before);lease.assertHeld();report.prepared=true;
}catch(error){report.error={name:error.name,message:String(error.message).slice(0,1000)};process.exitCode=1;}
finally{report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;report.lease.acknowledgement='LEASE_CLOSED';}fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
console.log(JSON.stringify({file:output,prepared:report.prepared,error:report.error??null}));
