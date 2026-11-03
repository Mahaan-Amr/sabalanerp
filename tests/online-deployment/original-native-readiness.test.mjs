import test from 'node:test';import assert from 'node:assert/strict';
import {runOriginalNativeReadiness} from '../../scripts/lib/original-native-readiness.mjs';
for(const mode of ['success','baseline-failure','package-failure','closure-failure','unproved-closure','create-failure'])test('read-only readiness cannot promote '+mode,async()=>{
 const calls=[];const owner={async prepareOnly(){calls.push('baseline');if(mode==='baseline-failure')throw Error('BASELINE_REFUSED');return{modeled:true};},assertHeld(){calls.push('held');},async closeReadOnlyOrRestored(){calls.push('closure');if(mode==='closure-failure')throw Error('CLOSURE_REFUSED');return{leaseClosed:mode!=='unproved-closure'};}};
 const result=await runOriginalNativeReadiness({createOwner:async()=>{if(mode==='create-failure')throw Error('LEASE_REFUSED');return owner;},inspectInputs:()=>{calls.push('package');if(mode==='package-failure')throw Error('PACKAGE_REFUSED');return{modeled:true};}});
 assert.equal(result.pass,mode==='success');assert.equal(result.upStarted,false);assert.equal(result.masterStarted,false);
 if(mode!=='create-failure')assert.equal(calls.at(-1),'closure');if(['closure-failure','unproved-closure'].includes(mode)){assert.equal(result.prerequisitesPassed,true);assert.ok(result.failure);}
 if(mode==='baseline-failure')assert.ok(!calls.includes('package'));
});
