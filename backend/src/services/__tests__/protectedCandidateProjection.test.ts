import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {validateCandidateProjection} from '../protectedCandidateProjection';

const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const binding={deploymentId:'fixture-deployment',releaseId:'fixture-release',targetCommit:'a'.repeat(40),controlImage:'sha256:'+'b'.repeat(64)};
const files=new Map([['20261102120000_example',Buffer.from('fixture SQL')]]);
function fixture(){
 const entries=[{name:'20261102120000_example',sha256:sha(files.values().next().value!)}];
 return {format:'sabalan-prebuilt-migration-projection/v1',deploymentId:binding.deploymentId,releaseId:binding.releaseId,applicationCommit:binding.targetCommit,applicationTree:'c'.repeat(40),
  applicationSourceHash:'d'.repeat(64),backendImage:binding.controlImage,planSha256:'e'.repeat(64),hostLock:{device:'1',inode:'2'},releaseAdmission:false,
  inventory:{format:'sabalan-git-migration-inventory/v1',commit:binding.targetCommit,entries,sha256:sha(JSON.stringify(entries)),releaseAdmission:false}};
}
test('projection matches full bytes and operation identity without granting admission',()=>{
 const value=validateCandidateProjection(fixture(),binding,files);
 assert.equal(value.releaseAdmission,false);assert.equal(value.sourceImageBinding,'HOST_REPORTED_NOT_INDEPENDENT');
 const normal=fixture();normal.format='sabalan-build-migration-projection/v1';
 assert.equal(validateCandidateProjection(normal,binding,files).releaseAdmission,false);
});
test('swapped owner, image, file bytes and inventory reject',()=>{
 assert.throws(()=>validateCandidateProjection(fixture(),{...binding,releaseId:'other-release'},files),/PROJECTION_UNPROVEN/);
 assert.throws(()=>validateCandidateProjection(fixture(),{...binding,controlImage:'sha256:'+'f'.repeat(64)},files),/PROJECTION_UNPROVEN/);
 assert.throws(()=>validateCandidateProjection(fixture(),binding,new Map([['20261102120000_example',Buffer.from('modified')]])),/PROJECTION_UNPROVEN/);
 const changed=fixture();changed.inventory.entries[0].sha256='0'.repeat(64);
 assert.throws(()=>validateCandidateProjection(changed,binding,files),/PROJECTION_UNPROVEN/);
});
