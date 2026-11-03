import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyNormalMigrationBinding} from './normal-migration-projection.mjs';

function binding(){const commit='a'.repeat(40),sourceHash='b'.repeat(64),image='sha256:'+'c'.repeat(64);
 return {commit,tree:'d'.repeat(40),sourceHash,image,status:'',targetCommit:commit,expectedSourceHash:sourceHash,observedImage:image,labelCommit:commit,labelSourceHash:sourceHash};}
test('ordinary build projection binds clean source to inspected immutable image without admission',()=>{
 const value=verifyNormalMigrationBinding(binding());assert.equal(value.releaseAdmission,false);
});
test('missing or changed source, image, label and dirty checkout fail closed',()=>{
 for(const key of ['commit','tree','sourceHash','image','targetCommit','expectedSourceHash','observedImage','labelCommit','labelSourceHash']){
  const value=binding();value[key]=undefined;assert.throws(()=>verifyNormalMigrationBinding(value),key);
 }
 for(const [key,value] of [['status',' M source'],['targetCommit','e'.repeat(40)],['expectedSourceHash','f'.repeat(64)],['observedImage','sha256:'+'f'.repeat(64)],['labelCommit','e'.repeat(40)],['labelSourceHash','f'.repeat(64)]]){
  const candidate=binding();candidate[key]=value;assert.throws(()=>verifyNormalMigrationBinding(candidate),key);
 }
});
