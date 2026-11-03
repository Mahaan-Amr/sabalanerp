/** Joined actual master/Root methods, real private lease/Worker/Git/return children.
 * Application resources are modeled private files; no Docker or native admission. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createLocalPreparationFixture} from './original-local-preparation.fixture.mjs';
import {acquireSerialHostLease,retainOriginalSerialHostLease} from '../../scripts/lib/serial-physical/host-lease.mjs';
const mode=process.argv[2],fixture=await createLocalPreparationFixture(mode==='known'?'no-suspension':mode),owner=fixture.owner;
process.send({fixtureCandidateSelection:fixture.selection});
const lease=await acquireSerialHostLease(path.join(fixture.directory,'fixture-only.lock'));
fixture.leaseHolder.lease=lease;fixture.leaseHolder.obligation=retainOriginalSerialHostLease(lease);
const source=fs.readFileSync(new URL('../../scripts/lib/original-online-qualification-master.mjs',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('export async function runOriginalOnlineQualificationMaster('),source.indexOf('\nfunction sort(')).replace(/^export /,'');
const helpers=source.slice(source.indexOf('const originalMasterPreparationNegatives='),source.indexOf('const originalMasterKnownNegatives=')).replaceAll('export const','const').replaceAll('export function','function');
const keepers=new Set(),listeners=new Map(),reference={file:'fixture',sha256:'a'.repeat(64)};
let fixtureHeld=false,privateLeaseClosed=false,fixtureRemoved=false;
async function removeOwnedFixture(){if(!fixtureRemoved){await fixture.remove();fixtureRemoved=true;}}
const proc={platform:process.platform,on(name,listener){listeners.set(name,listener);process.on(name,listener);},off(name,listener){listeners.delete(name);process.off(name,listener);},get exitCode(){return process.exitCode;},set exitCode(value){process.exitCode=value;}};
const context={assert,Buffer,Set,Promise,structuredClone,Object,process:proc,
 assertOriginalCandidateRollbackOwner:value=>assert.equal(value,owner),
 readOriginalLocalPreparationFailure(error,value){assert.equal(value,owner);const row=fixture.failureMap.get(error);if(!row)return null;row.revalidate();return structuredClone(row.facts);},
 setInterval(fn,ms){const handle=setInterval(fn,ms);keepers.add(handle);return handle;},clearInterval(handle){keepers.delete(handle);clearInterval(handle);},
 keys:(value,names)=>assert.deepEqual(Object.keys(value).sort(),[...names].sort()),
 readSourceOwnedCompleteBinding:()=>({value:{format:'sabalan-original-complete-source-binding/v2',configuration:reference},revalidate(){}}),
 readOriginalCompleteConstructorPackage:()=>({revalidate(){}}),pinnedConfiguration:()=>({}),inspectOriginalLocalOnlineCheckpointInputs(){},
 runOriginalRetainedBrowserQualificationRounds:async()=>fixture.retained,
 readOriginalRetainedBrowserQualificationCompletion:value=>{assert.equal(value,fixture.retained);return{reportSha256:'b'.repeat(64)};},
 readOriginalKnownFailedLocalClosure:()=>null,readOriginalKnownImageRepositoryFailure:()=>null,
 writeOriginalMasterFailureDiagnostic(){},
};
const api=vm.compileFunction(helpers+'return {runOriginalOnlineQualificationMaster:'+declaration+',isOriginalMasterKnownPreparationNegative,readOriginalMasterKnownPreparationNegative};',Object.keys(context))(...Object.values(context));
fixture.masterApiHolder.current={...api,isOriginalMasterKnownRetainedNegative:()=>false,isOriginalMasterKnownImageNegative:()=>false};
const input=mode==='queue-arrival'?{get readableLength(){return process.stdin.readableLength;},[Symbol.asyncIterator](){return process.stdin.iterator({destroyOnReturn:false});}}:process.stdin;
if(mode==='queue-arrival'){
 const finalize=owner.finishOriginalLocalPreparationFailure;
 owner.finishOriginalLocalPreparationFailure=async(...args)=>{const result=await finalize(...args);process.stdout.write(JSON.stringify({fixtureFinalizedWaitingForLateRequest:true})+'\n');process.stdin.read(0);while(process.stdin.readableLength===0)await new Promise(resolve=>setTimeout(resolve,10));return result;};
}
async function teardownHeld(){
 if(!fixtureHeld)return;
 for(const handle of keepers)clearInterval(handle);keepers.clear();for(const[name,listener]of listeners)process.off(name,listener);listeners.clear();process.stdin.destroy();
 fixture.leaseHolder.obligation.close();await lease.release();privateLeaseClosed=true;await removeOwnedFixture();process.exitCode=77;process.stdout.write(JSON.stringify({fixtureOnlyTeardown:true,normalRootRelease:false})+'\n');process.disconnect();
}
process.on('message',message=>{if(message?.fixtureOnlyRelease==='owned-unit-chain')void teardownHeld();});
try{
fixture.runtime.beforeMaster();
const completion=owner.continueWithOriginalMaster({candidateReplacementReceipt:fixture.selection,deferLocal:true,retainedBrowserPlanFile:'fixture',retainedBrowserPlanSha256:'a'.repeat(64),initialInputBindings:{nativeOwnerElfReceipt:reference,completeConstructorConfiguration:reference},input,output:{write(raw){process.stdout.write(raw);if(JSON.parse(raw).event==='ORIGINAL_MASTER_REQUEST_FAILED_RETAINED'){fixtureHeld=true;process.stdout.write(JSON.stringify({fixtureHeld:true,keepers:keepers.size,listeners:listeners.size})+'\n');}}}});
const result=await completion;
if(!result){fixtureHeld=true;process.stdout.write(JSON.stringify({fixtureHeld:true,phase:fixture.runtime.inspect().phase})+'\n');await new Promise(()=>{});}
const closed=await owner.closeReadOnlyOrRestored();privateLeaseClosed=true;
assert.equal(closed.leaseClosed,true);assert.equal(fixture.runtime.inspect().released,true);assert.equal(keepers.size,0);assert.equal(listeners.size,0);assert.equal(process.stdin.destroyed,true);assert.equal(process.exitCode,1);assert.throws(()=>lease.assertHeld());
process.stdout.write(JSON.stringify({fixtureNormalNegative:true,closed,trace:fixture.trace,samplerActuallyDrained:fixture.sampler.inspect().closed,privateLeaseClosed,qualificationAccepted:false,nativeRuntimeCreated:false})+'\n');
await removeOwnedFixture();process.disconnect();

}finally{if(!privateLeaseClosed){fixture.leaseHolder.obligation.close();await lease.release();privateLeaseClosed=true;}await removeOwnedFixture();}
