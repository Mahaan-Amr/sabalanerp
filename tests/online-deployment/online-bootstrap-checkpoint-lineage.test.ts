import assert from 'node:assert/strict';
import test from 'node:test';
import {checkpointMetadataTransport} from '../../backend/src/services/deploymentCheckpointMetadataIdentity';
import {assertProtectedBootstrapCheckpointLineage} from '../../backend/src/services/onlineBootstrapCheckpointLineage';
import {completeProtectedPrivateQualificationPrerequisite} from '../../backend/src/services/deploymentGates';
const database={name:'production',oid:'42',systemIdentifier:'123'};
const point=(id:string,createdAt:string)=>({id,releaseId:id,captureMethod:'PROTECTED_MAINTENANCE_COMPLETE',sourceDatabase:database,
 createdAt,checksum:'a'.repeat(64),size:123,localVerified:true,remoteVerified:true,restoreVerified:true,manifestReadable:true,
 compatibility:{local:{compatible:true},remote:{compatible:true}},sourceMachineUuidSha256:'b'.repeat(64),sourceKernelBootIdSha256:'c'.repeat(64)});
const qualification=point('rehearsal','2026-10-19T00:00:00.000Z'),activation=point('activation','2026-10-20T00:00:00.000Z');
const acceptance={checkpointSha256:checkpointMetadataTransport(activation).canonicalMetadataSha256,qualification:{recoveryMode:'PROTECTED_MAINTENANCE_COMPLETE',
 deploymentTargetDatabase:database,qualificationCheckpoint:{metadataSha256:checkpointMetadataTransport(qualification).canonicalMetadataSha256,metadata:qualification}}};
test('protected first install distinguishes exact independently restored qualification and later fresh activation points',()=>{
 const result=assertProtectedBootstrapCheckpointLineage(acceptance,activation);
 assert.notEqual(result.qualificationCheckpointSha256,result.activationCheckpointSha256);assert.equal(result.continuousWalQualified,false);
 for(const alter of [(v:any)=>v.qualification.recoveryMode='ONLINE_COHERENT_WAL',(v:any)=>v.qualification.qualificationCheckpoint.metadata.sourceDatabase.name='foreign',
  (v:any)=>v.qualification.qualificationCheckpoint.metadata.sourceMachineUuidSha256='d'.repeat(64),
  (v:any)=>v.qualification.qualificationCheckpoint.metadata.createdAt='2026-10-21T00:00:00.000Z']){
  const invalid=structuredClone(acceptance);alter(invalid);
  if(invalid.qualification.qualificationCheckpoint.metadata!==qualification)invalid.qualification.qualificationCheckpoint.metadataSha256=checkpointMetadataTransport(invalid.qualification.qualificationCheckpoint.metadata).canonicalMetadataSha256;
  assert.throws(()=>assertProtectedBootstrapCheckpointLineage(invalid,activation));
 }
 assert.throws(()=>assertProtectedBootstrapCheckpointLineage(acceptance,{...activation,remoteVerified:false}));
});
test('private prerequisite gates never claim production traffic gates and bind the earlier point',()=>{
 const row={format:'sabalan-protected-private-qualification-prerequisite/v1',releaseId:'new_release',manifestSha256:'f'.repeat(64),
  qualificationCheckpointSha256:acceptance.qualification.qualificationCheckpoint.metadataSha256,publicTrafficQualified:false,
  qualificationReports:Object.fromEntries(['compatible-migrations','coherent-independent-restore','browser-24-hours','single-worker-and-completion','current-domain'].map((scope,index)=>[scope,String(index).repeat(64)]))};
 const expected={releaseId:row.releaseId,manifestSha256:row.manifestSha256,qualificationCheckpointSha256:row.qualificationCheckpointSha256,qualificationReports:row.qualificationReports};
 assert.equal(completeProtectedPrivateQualificationPrerequisite(row,expected),true);
 for(const invalid of [{...row,publicTrafficQualified:true},{...row,qualificationCheckpointSha256:acceptance.checkpointSha256},
  {...row,qualificationReports:{}},{...row,qualificationReports:{...row.qualificationReports,'current-domain':'a'.repeat(64)}},{...row,phase:'GATES_PASSED'}])assert.equal(completeProtectedPrivateQualificationPrerequisite(invalid,expected),false);
});
