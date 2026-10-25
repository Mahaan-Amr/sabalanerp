import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRestoredQaOriginalHttpCohort,assertRestoredQaWorkingMaterialForOriginalCohort,withRestoredQaOriginalHttpCohort,type RestoredQaOriginalHttpCohort} from '../restoredQaOriginalHttpCohort';
import type {RestoredQaWorkingMaterial} from '../restoredQaWorkingMaterial';
import type {RestoredQaPrivateNormal}from'../restoredQaMigrationBaseline';
const owner={deploymentId:'owned-qa-test-1',releaseId:'owned-qa-release-1'},material=Object.freeze({})as RestoredQaWorkingMaterial;
test('PID, endpoint, serialized ready data and object copies cannot adopt an original HTTP cohort',()=>{
 for(const value of [{},{url:'http://127.0.0.1:3000',originalPid:process.pid},{format:'sabalan-live-restored-qa-ordinary-http/v1',database:{name:'qa',oid:'1',systemIdentifier:'2'}},JSON.parse(JSON.stringify({active:true}))]){
  const fake=value as RestoredQaOriginalHttpCohort;assert.throws(()=>assertRestoredQaOriginalHttpCohort(fake,material,owner));assert.throws(()=>assertRestoredQaWorkingMaterialForOriginalCohort(material,owner,fake));
 }
});
test('no actual original can start without the live engine working-material capability',async()=>{
 let entered=false;await assert.rejects(withRestoredQaOriginalHttpCohort(material,owner,{}as RestoredQaPrivateNormal,async()=>{entered=true;}));assert.equal(entered,false);
});
