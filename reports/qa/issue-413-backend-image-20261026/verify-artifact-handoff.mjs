/** Read-only acceptance of artifact readiness, distinct from installed/runtime admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {stableBackendBaseFile} from '../../../scripts/lib/production-backend-base-artifacts.mjs';
import {inspectPrivateDockerArchive} from '../../../scripts/lib/private-docker-image-archive.mjs';
const evidence = import.meta.dirname;
const repo = path.resolve(evidence,'../../..');
const reference = JSON.parse(fs.readFileSync(path.join(evidence,'ARTIFACT-PACKAGE-REFERENCE.json')));
function checked(row) {
  const actual = stableBackendBaseFile(row.file);
  assert.equal(actual.sha256,row.sha256);
  if (row.bytes !== undefined) assert.equal(actual.bytes,row.bytes);
  return JSON.parse(fs.readFileSync(row.file));
}
const original = checked(reference.plan);
export function verify(plan) {
  assert.equal(plan.format,'sabalan-413-artifact-ready-install-inputs/v1');
  assert.equal(plan.artifactContentReadyFor419,true); assert.equal(plan.finalPackagingReady,true);
  for (const flag of ['executable','installReady','runtimeAccepted','productionAdmission']) assert.equal(plan[flag],false);
  assert.equal(plan.sourceCommit,'c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14');
  assert.equal(execFileSync('git',['rev-parse',plan.sourceCommit+'^{tree}'],{cwd:repo,encoding:'utf8'}).trim(),plan.sourceTree);
  assert.ok(plan.pending.every(row=>!['SOURCE_A_412_NATIVE_ACCEPTANCE_PENDING','CURRENT_BACKEND_IMAGE_AND_ARCHIVE_REQUIRED'].includes(row.code)));
  assert.ok(plan.pending.some(row=>row.code==='FRESH_ORIGINAL_INSTALL_OBSERVATION_REQUIRED'));
  for (const key of ['sourceArchive','sourceBundle','operationsArchive','backendMaterialArchive','hostPackReceipt']) {
    const value=stableBackendBaseFile(plan[key].file);assert.equal(value.sha256,plan[key].sha256);assert.equal(value.bytes,plan[key].bytes);
  }
  const sourceA=checked(plan.sourceAAcceptance);
  assert.equal(sourceA.acceptanceComplete,true);
  assert.equal(sourceA.manifest.sha256,'1cfa474c213026a565d9ec3b6c601d78ba5296d25c03bfd06c2044b23f3d8831');
  const manifest=checked(sourceA.manifest);
  assert.deepEqual(sourceA.components,manifest.components);
  assert.deepEqual(plan.preservedRecoverySourceA.components,manifest.components);
  assert.deepEqual(plan.preservedRecoverySourceA.retrieval,manifest.retrieval);
  const backend=plan.backendImage, image=checked(backend.receipt), result=checked(plan.boundedProducerReceipt);
  assert.equal(result.pass,true);assert.equal(result.lease.closed,true);assert.equal(result.lease.acknowledgement,'LEASE_CLOSED');
  assert.equal(result.originalChildren.allOriginalChildrenClosed,true);assert.equal(result.originalChildren.interrupted,false);
  assert.deepEqual(result.servicesBefore,result.servicesAfter);
  assert.equal(image.pass,true);assert.equal(image.sourceCommit,plan.sourceCommit);
  assert.equal(backend.sourceCommit,plan.sourceCommit);assert.equal(backend.engineIdentity,image.image.id);
  assert.equal(backend.remoteExecutionNamespaceVerified,false);
  assert.equal(backend.canonicalConfigIdentity,backend.archiveGraph.config);
  assert.equal(image.image.labels['io.sabalan.compact.source-commit'],plan.sourceCommit);
  assert.equal(image.image.labels['io.sabalan.compact.source-inventory-sha256'],checked(plan.backendMaterial).inventorySha256);
  const graph=inspectPrivateDockerArchive(backend.rawArchive.file,backend.engineIdentity);
  assert.deepEqual(graph,backend.archiveGraph);assert.deepEqual(graph.rootfsDiffIds,image.image.layers);
  for (const row of [backend.rawArchive,backend.compressedArchive]) {
    const actual=stableBackendBaseFile(row.file);assert.equal(actual.sha256,row.sha256);assert.equal(actual.bytes,row.bytes);
  }
  const expanded=checked(backend.expandedGraphProof);
  assert.equal(expanded.expandedLayerIdentityVerified,true);
  assert.equal(expanded.sourceArchiveSha256,backend.compressedArchive.sha256);
  assert.equal(expanded.sourceIndex,graph.index);assert.equal(expanded.platformManifest,graph.platform);assert.equal(expanded.configImageId,graph.config);
  assert.deepEqual(expanded.layers.map(row=>row.diffId),graph.rootfsDiffIds);
  return {sourceCommit:plan.sourceCommit,backendImage:backend.engineIdentity,index:graph.index,platform:graph.platform,
    config:graph.config,sourceAAccepted:true,artifactContentReadyFor419:true,installReady:false,runtimeAccepted:false};
}
if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {
const acceptanceFile=path.join(evidence,'ARTIFACT-ACCEPTANCE-FINAL.json');
assert.ok(!fs.existsSync(acceptanceFile),'ARTIFACT_ACCEPTANCE_ALREADY_EXISTS');
const positive=verify(original);
const mutations=[
  p=>p.executable=true, p=>p.installReady=true, p=>p.runtimeAccepted=true, p=>p.productionAdmission=true,
  p=>p.sourceCommit='ae056d6036c62499171f0d91691e1287942e75f7',
  p=>p.preservedRecoverySourceA.components.frontend.sha256='0'.repeat(64),
  p=>p.backendImage.engineIdentity='sha256:a35e0213b92e90528230857fce4193fa2bd76b4d05b96be079e878c5f33790c2',
  p=>p.backendImage.canonicalConfigIdentity=p.backendImage.archiveGraph.index,
  p=>p.backendImage.archiveGraph.config=p.backendImage.archiveGraph.index,
  p=>p.backendImage.compressedArchive.sha256='0'.repeat(64),
  p=>p.backendImage.expandedGraphProof.sha256='0'.repeat(64),
];
for (const mutate of mutations) {
  const candidate=structuredClone(original);mutate(candidate);assert.throws(()=>verify(candidate));
}
// Regression: a proof with identical filesystem layers but a different CONFIG
// must fail even when its ordinary file SHA and length are honestly recomputed.
const fake=checked(original.backendImage.expandedGraphProof);
fake.configImageId='sha256:'+'0'.repeat(64);
const fakeFile=path.join(reference.directory,'negative-expanded-proof-same-layers.json');
const fakeBytes=Buffer.from(JSON.stringify(fake,null,2)+'\n');
fs.writeFileSync(fakeFile,fakeBytes,{flag:'wx',mode:0o600});
const candidate=structuredClone(original);
candidate.backendImage.expandedGraphProof={file:fakeFile,bytes:fakeBytes.length,sha256:createHash('sha256').update(fakeBytes).digest('hex')};
assert.throws(()=>verify(candidate));
fs.writeFileSync(acceptanceFile,JSON.stringify({positive,rejectedMutations:mutations.length+1,
  sameLayersWrongConfigProofRejected:true,negativeProofRetained:candidate.backendImage.expandedGraphProof},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({accepted:true,rejectedMutations:mutations.length+1}));
}
