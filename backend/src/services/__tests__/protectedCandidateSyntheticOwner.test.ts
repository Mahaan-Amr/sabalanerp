import assert from 'node:assert/strict';
import test from 'node:test';
import {createSyntheticCandidateOwner} from './protectedCandidateSyntheticOwner';

test('fixture owner is allocated once before projection and keeps one identity',()=>{
 const owner=createSyntheticCandidateOwner(),other=createSyntheticCandidateOwner();
 assert.match(owner.deploymentId,/^test-candidate-[a-f0-9]{32}$/);
 assert.equal(owner.releaseId,'test-release-'+owner.deploymentId.slice('test-candidate-'.length));
 assert.equal(owner.checkpoint.deploymentId,owner.deploymentId);
 assert.equal(owner.checkpoint.releaseId,owner.releaseId);
 assert.notEqual(owner.deploymentId,other.deploymentId);
 assert.ok(Object.isFrozen(owner)&&Object.isFrozen(owner.checkpoint));
});
