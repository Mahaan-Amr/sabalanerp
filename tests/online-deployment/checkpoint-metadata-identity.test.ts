import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkpointMetadataTransport,readCanonicalCheckpointMetadata} from '../../backend/src/services/deploymentCheckpointMetadataIdentity';

test('remote omissions preserve the exact original database metadata identity',()=>{
 const metadata={id:'unit-point',releaseId:'unit-release',archivePath:'/private/current.sabrec',localPath:'/private/current.sabrec',
  checksum:'a'.repeat(64),manifest:{files:['پرونده.pdf']}};
 const local={...checkpointMetadataTransport(metadata),metadataPath:'/private/current.sabrec.json'};
 const remote=JSON.parse(JSON.stringify({...local,archivePath:undefined,localPath:undefined,metadataPath:undefined}));
 assert.deepEqual(readCanonicalCheckpointMetadata(remote),readCanonicalCheckpointMetadata(local));
 assert.deepEqual(readCanonicalCheckpointMetadata(remote).metadata,metadata);
 assert.equal('localPath'in remote,false);assert.equal('localPath'in remote.canonicalMetadata,true);
 assert.equal(createHash('sha256').update(JSON.stringify(remote)).digest('hex')===readCanonicalCheckpointMetadata(remote).sha256,false);
});
test('transport fields cannot rewrite business identity, canonical bytes or add a semantic assertion',()=>{
 const source=checkpointMetadataTransport({id:'unit-point',releaseId:'unit-release',checksum:'a'.repeat(64),sourceDatabase:{name:'unit',oid:'1',systemIdentifier:'2'}});
 for(const mutate of [(row:any)=>{row.releaseId='other';},(row:any)=>{row.canonicalMetadata.checksum='b'.repeat(64);},
  (row:any)=>{row.newPass=true;},(row:any)=>{delete row.sourceDatabase;},(row:any)=>{delete row.canonicalMetadata;}]){
  const changed=structuredClone(source);mutate(changed);assert.throws(()=>readCanonicalCheckpointMetadata(changed));
 }
 assert.throws(()=>readCanonicalCheckpointMetadata({id:'legacy-point'}));
});
