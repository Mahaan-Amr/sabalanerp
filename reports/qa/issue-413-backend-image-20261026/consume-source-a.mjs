/** Consume accepted content; never replay encryption, transfer, publication or native phases. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stableBackendBaseFile} from '../../../scripts/lib/production-backend-base-artifacts.mjs';
const file = path.join(import.meta.dirname,'SOURCE-A-FINAL-ACCEPTANCE.json');
const sha = raw => createHash('sha256').update(raw).digest('hex');
assert.equal(sha(fs.readFileSync(file)),'1cfa474c213026a565d9ec3b6c601d78ba5296d25c03bfd06c2044b23f3d8831');
const manifest = JSON.parse(fs.readFileSync(file));
assert.equal(manifest.acceptanceComplete,true);
assert.equal(manifest.successfulFiniteOriginalsClosed,true);
assert.equal(manifest.temporaryCredentialFilesRemaining,0);
assert.deepEqual(manifest.remainingLiveOriginals,[]);
const verified = [];
function checked(row) {
  const actual = stableBackendBaseFile(row.file);
  assert.equal(actual.sha256,row.sha256);
  if (row.bytes !== undefined) assert.equal(actual.bytes,row.bytes);
  verified.push({file:row.file,bytes:actual.bytes,sha256:actual.sha256});
  return JSON.parse(fs.readFileSync(row.file));
}
const components = {};
for (const [service, entry] of Object.entries(manifest.components)) {
  const component = checked(entry);
  components[service] = component;
  if (service === 'backend') continue; // Historical SourceA backend remains separate from the new application backend.
  assert.equal(component.format,'sabalan-source-a-closed-stream-image-component/v1');
  assert.equal(component.service,service);
  for (const flag of ['published','allOriginalChildrenClosed','localDecryptVerified','independentDecryptVerified','temporaryCredentialRetired']) assert.equal(component[flag],true);
  assert.equal(component.negativeParentQualified,false);
  assert.equal(component.productionAdmission,false);
  const retrieval = manifest.retrieval[service];
  assert.equal(component.sourceImageId,retrieval.sourceImageId);
  for (const [kind, expected] of Object.entries({cipher:retrieval.ciphertext, compressedArchive:retrieval.gzip, rawArchive:retrieval.rawTar})) {
    const actual = component[kind];
    assert.equal(path.resolve(actual.file),path.resolve(expected.file));
    assert.equal(actual.sha256,expected.sha256); assert.equal(actual.bytes,expected.bytes);
    const observed = stableBackendBaseFile(actual.file);
    assert.equal(observed.sha256,expected.sha256); assert.equal(observed.bytes,expected.bytes);
    verified.push({file:actual.file,bytes:observed.bytes,sha256:observed.sha256});
  }
  for (const row of Object.values(component.closedPhaseReferences)) checked(row);
  for (const row of Object.values(component.materialReferences)) checked(row);
  checked(component.rawArchiveReceipt);
  assert.equal(component.archiveGraph.index,retrieval.archiveGraph.index);
  assert.equal(component.archiveGraph.platform,retrieval.archiveGraph.platform);
  assert.equal(component.archiveGraph.config,retrieval.archiveGraph.config);
  assert.deepEqual(component.archiveGraph.rootfsDiffIds,retrieval.archiveGraph.rootfsDiffIds);
}
checked(manifest.frontendLocal); checked(manifest.frontendIndependent);
const result = {format:'sabalan-413-consumed-source-a-acceptance/v1', issue:412,
  sourceCommit:'1ca8ecbba091767d992decaa9515b3bf51a7637e', acceptanceComplete:true,
  manifest:{file,sha256:sha(fs.readFileSync(file))}, components:manifest.components,
  retrieval:manifest.retrieval, verified, cryptoRepeated:false, frontendRebuilt:false,
  inquiryRebuilt:false, historicalPendingSuperseded:true, productionAdmission:false};
fs.writeFileSync(path.join(import.meta.dirname,'SOURCE-A-CONSUMED.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({accepted:true,verifiedFiles:verified.length,cryptoRepeated:false}));
