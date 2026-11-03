/** Bind already-produced artifacts into a new inert handoff. No native operations. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {stableBackendBaseFile} from '../../../scripts/lib/production-backend-base-artifacts.mjs';
import {inspectPrivateDockerArchive} from '../../../scripts/lib/private-docker-image-archive.mjs';

const evidence = import.meta.dirname;
const outputReference = path.join(evidence,'ARTIFACT-PACKAGE-REFERENCE.json');
assert.ok(!fs.existsSync(outputReference),'ARTIFACT_HANDOFF_ALREADY_EXISTS');
const ref = file => {const {bytes,sha256}=stableBackendBaseFile(file);return {file,bytes,sha256};};
const checked = row => {
  const actual = ref(row.file); assert.equal(actual.sha256,row.sha256);
  if (row.bytes !== undefined) assert.equal(actual.bytes,row.bytes);
  return JSON.parse(fs.readFileSync(row.file));
};
const resultFile = path.join(evidence,'BOUNDED-IMAGE-RESULT-R2.json');
const result = JSON.parse(fs.readFileSync(resultFile));
assert.equal(result.pass,true);
assert.equal(result.sourceCommit,'c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14');
assert.equal(result.lease.closed,true); assert.equal(result.lease.acknowledgement,'LEASE_CLOSED');
assert.equal(result.originalChildren.allOriginalChildrenClosed,true);
assert.equal(result.originalChildren.interrupted,false);
assert.deepEqual(result.servicesBefore,result.servicesAfter);
const image = checked(result.imageReceipt);
assert.equal(image.pass,true); assert.equal(image.sourceCommit,result.sourceCommit);
assert.equal(image.protectedServicesUnchanged,true); assert.equal(image.existingAliasesUnchanged,true);
assert.equal(image.originalChildren.allOriginalChildrenClosed,true); assert.equal(image.originalChildren.interrupted,false);
assert.equal(image.materialReceiptSha256,result.reusedMaterial.sha256);
assert.equal(image.image.id,result.image.id);
assert.notEqual(image.image.id,'sha256:a35e0213b92e90528230857fce4193fa2bd76b4d05b96be079e878c5f33790c2');
const compiler = checked(result.reusedCompiler), material = checked(result.reusedMaterial);
assert.equal(compiler.pass,true); assert.equal(material.materialized,true);
assert.equal(material.compiledReceiptSha256,result.reusedCompiler.sha256);
assert.equal(material.shellSourceProjection.sourceCommit,result.sourceCommit);
assert.deepEqual(ref(result.rawArchive.file),result.rawArchive);
assert.deepEqual(ref(result.compressedArchive.file),result.compressedArchive);
assert.deepEqual(inspectPrivateDockerArchive(result.rawArchive.file,result.image.id),result.archiveGraph);
assert.deepEqual(result.archiveGraph.rootfsDiffIds,image.image.layers);
const expanded = checked(result.expandedGraphProof);
assert.equal(expanded.expandedLayerIdentityVerified,true);
assert.equal(expanded.sourceArchiveSha256,result.compressedArchive.sha256);
assert.equal(expanded.sourceIndex,result.archiveGraph.index);
assert.equal(expanded.platformManifest,result.archiveGraph.platform);
assert.equal(expanded.configImageId,result.archiveGraph.config);
assert.deepEqual(expanded.layers.map(row=>row.diffId),result.archiveGraph.rootfsDiffIds);
const sourceAFile = path.join(evidence,'SOURCE-A-CONSUMED.json');
const sourceA = JSON.parse(fs.readFileSync(sourceAFile));
assert.equal(sourceA.acceptanceComplete,true); assert.equal(sourceA.historicalPendingSuperseded,true);
assert.equal(sourceA.manifest.sha256,'1cfa474c213026a565d9ec3b6c601d78ba5296d25c03bfd06c2044b23f3d8831');
const acceptedSourceA = checked(sourceA.manifest);
assert.equal(acceptedSourceA.acceptanceComplete,true);
assert.deepEqual(sourceA.components,acceptedSourceA.components);
assert.deepEqual(sourceA.retrieval,acceptedSourceA.retrieval);
for (const row of sourceA.verified) assert.deepEqual(ref(row.file),row);

const previousFile = 'D:/sabalanerp-online-qa/ticket413-build-successor-9ee9f382754f465d9a953f77ddeecec0/install-plan-final.json';
assert.equal(ref(previousFile).sha256,'b3f0817381e2fb03247474dd6115c76c96bcb4423edff09021fcd084fec967e2');
const previous = JSON.parse(fs.readFileSync(previousFile));
assert.equal(previous.sourceCommit,result.sourceCommit);
for (const key of ['sourceArchive','sourceBundle','operationsArchive','backendMaterialArchive','hostPackReceipt']) {
  const actual = ref(previous[key].file);
  assert.equal(actual.bytes,previous[key].bytes); assert.equal(actual.sha256,previous[key].sha256);
}
const pending = previous.pending.filter(row=>!['SOURCE_A_412_NATIVE_ACCEPTANCE_PENDING','CURRENT_BACKEND_IMAGE_AND_ARCHIVE_REQUIRED'].includes(row.code));
const plan = {...previous,
  format:'sabalan-413-artifact-ready-install-inputs/v1',
  supersedesPlan:ref(previousFile),
  artifactContentReadyFor419:true, finalPackagingReady:true,
  readinessDefinition:'Complete immutable artifact content only; no installation or runtime authority.',
  sourceOnly:false, inert:true, executable:false, installReady:false, runtimeAccepted:false, productionAdmission:false,
  sourceAAcceptance:ref(sourceAFile),
  preservedRecoverySourceA:{acceptanceComplete:true, acceptanceCommit:sourceA.sourceCommit,
    manifest:sourceA.manifest, components:sourceA.components, retrieval:sourceA.retrieval},
  backendImage:{receipt:result.imageReceipt, engineIdentity:result.image.id,
    canonicalConfigIdentity:result.archiveGraph.config, archiveGraph:result.archiveGraph,
    rawArchive:result.rawArchive, compressedArchive:result.compressedArchive,
    expandedGraphProof:result.expandedGraphProof, sourceCommit:result.sourceCommit,
    observedLocalImageStore:result.imageStore, remoteExecutionNamespaceVerified:false},
  boundedProducerReceipt:ref(resultFile), pending,
  readinessBoundaries:{sourceBuild:'COMPLETE_REUSED_WITHOUT_REEXECUTION',backendImageArchive:'COMPLETE',
    native412:'ACCEPTED_CONTENT_COMPONENTS',operational419:'PENDING_FRESH_ACTUAL_RESOURCES_AND_RUNTIME_ACCEPTANCE'},
};
const directory = path.join('D:/sabalanerp-online-qa','ticket413-artifact-ready-'+randomUUID().replaceAll('-',''));
fs.mkdirSync(directory,{mode:0o700});
const target = path.join(directory,'install-plan-final.json');
fs.writeFileSync(target,JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
const handoff = {format:'sabalan-413-artifact-handoff/v1',state:'ARTIFACT_CONTENT_READY_FOR_419',
  sourceCommit:plan.sourceCommit,sourceTree:plan.sourceTree,plan:ref(target),
  backendImage:plan.backendImage,sourceAAcceptance:plan.sourceAAcceptance,
  sourceArchive:plan.sourceArchive,sourceBundle:plan.sourceBundle,operationsArchive:plan.operationsArchive,
  backendMaterial:plan.backendMaterial,backendMaterialArchive:plan.backendMaterialArchive,
  hostPackReceipt:plan.hostPackReceipt,executable:false,installReady:false,runtimeAccepted:false,productionAdmission:false,pending};
const handoffFile = path.join(directory,'ARTIFACT-HANDOFF.json');
fs.writeFileSync(handoffFile,JSON.stringify(handoff,null,2)+'\n',{flag:'wx',mode:0o600});
const reference = {directory,plan:ref(target),handoff:ref(handoffFile)};
fs.writeFileSync(outputReference,JSON.stringify(reference,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(reference));
