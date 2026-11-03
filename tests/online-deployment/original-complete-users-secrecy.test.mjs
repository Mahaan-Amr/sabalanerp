import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';
const require=createRequire(import.meta.url),{assertOriginalUserCensus}=require('../../scripts/lib/restored-qa/complete-users.cjs');
test('negative credential census emits only a safe static error',()=>{
 const before={users:[{password:'SENTINEL-ORIGINAL-HASH',email:'PRIVATE-EMAIL',permissions:['PRIVATE-PERMISSION']}]};
 assertOriginalUserCensus(structuredClone(before),before);
 let caught;try{assertOriginalUserCensus({users:[{password:'SENTINEL-CHANGED-HASH'}]},before);}catch(error){caught=error;}
 assert.ok(caught);const output=String(caught.stack)+'\n'+JSON.stringify(caught);assert.match(output,/ORIGINAL_COMPLETE_USER_CENSUS_CHANGED/);assert.doesNotMatch(output,/SENTINEL|PRIVATE-EMAIL|PRIVATE-PERMISSION/);
});
