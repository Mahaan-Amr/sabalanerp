/** Five read-only ports owned by the SAME native lease and current C3 cohort.
 * No report, worker payload, command selector or private key is accepted. */
import assert from 'node:assert/strict';
import {assertOriginalCandidateRollbackOwner} from './original-candidate-rollback-owner.mjs';
const originalPorts=new WeakSet();
export function assertOriginalCompleteResourcePorts(value){assert.ok(originalPorts.has(value),'ORIGINAL_COMPLETE_RESOURCE_PORTS_REQUIRED');}

export function createOriginalCompleteResourcePorts({nativeOwner,operation,observerSha256,expectedManifest}) {
 assertOriginalCandidateRollbackOwner(nativeOwner);
 assert.match(operation,/^[a-f0-9]{32}$/);assert.match(observerSha256,/^[a-f0-9]{64}$/);
 const current=async()=>{assertOriginalCandidateRollbackOwner(nativeOwner);await nativeOwner.assertCompleteCurrent();assertOriginalCandidateRollbackOwner(nativeOwner);};
 const read=async request=>{await current();const value=await nativeOwner.readCompleteResource(request);await current();return value;};
 const ports=Object.freeze({assertCurrent:current,async observeMemoryAdmission(){await current();const result=nativeOwner.observeMemoryWorkAdmission();await current();return result;},
  async readSeedContext(){nativeOwner.assertMemoryWorkAdmission();await current();const value=await nativeOwner.readCompleteSeedContext(operation);await current();return value;},
  readFixedTrust:()=>read({mode:'trust'}),
  observePrivateMaterial:()=>read({mode:'material',operation,observerSha256}),
  preparePrivateLayout:async()=>{nativeOwner.assertMemoryWorkAdmission();await current();const value=await nativeOwner.publishCompleteLayout(operation,expectedManifest);await current();return value;},
  async assertHttpActive(expected){const value=await read({mode:'http-active',operation,expected});assert.equal(value.verified,true);assert.equal(value.phase,'ACTIVE');},
  async assertHttpPreparedAndFenced(expected){const value=await read({mode:'http-fenced',operation,expected});assert.equal(value.verified,true);assert.equal(value.phase,'PREPARED_AND_FENCED');},
 });
 originalPorts.add(ports);return ports;
}
