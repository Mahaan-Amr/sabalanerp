import assert from 'node:assert/strict';
import test from 'node:test';
import {validateRetainedBrowserPlan,readOriginalRetainedBrowserQualificationCompletion,assertRetainedControllerEof,validateRetainedBrowserCapacity} from '../../scripts/lib/original-retained-browser-qualification.mjs';
test('saved JSON cannot substitute an original retained-browser completion',()=>{
 for(const value of [{},{pass:true,allOriginalChildrenClosed:true},Object.freeze({})])assert.throws(()=>readOriginalRetainedBrowserQualificationCompletion(value),/ORIGINAL_RETAINED_BROWSER_COMPLETION_UNPROVEN/);
});
test('a final JSON frame never hides truncated trailing bytes or an unclosed stream',()=>{
 assertRetainedControllerEof({stdoutEof:true,stderrEof:true,trailingBytes:0});
 for(const wrong of [{stdoutEof:false,stderrEof:true,trailingBytes:0},{stdoutEof:true,stderrEof:false,trailingBytes:0},{stdoutEof:true,stderrEof:true,trailingBytes:1}])assert.throws(()=>assertRetainedControllerEof(wrong));
});
test('retained browser plan cannot supply arbitrary images, commands or controllers',()=>{
 const plan={format:'sabalan-original-retained-browser-plan/v1',preflightFile:'D:/sabalanerp-online-qa/fresh-preflight.json'};
 assert.deepEqual(validateRetainedBrowserPlan(plan),plan);
 const actualLegacy={...plan,legacyAugmentationReceipt:'D:/sabalanerp-online-qa/original-augmentation/image.json',legacyAugmentationSha256:'a'.repeat(64)};assert.deepEqual(validateRetainedBrowserPlan(actualLegacy),actualLegacy);assert.throws(()=>validateRetainedBrowserPlan({...actualLegacy,legacyAugmentationSha256:'caller-pass'}));
 for(const field of ['image','argv','controllerFile','existingReport','sourceCommit'])assert.throws(()=>validateRetainedBrowserPlan({...plan,[field]:'caller-selected'}));
});
test('measured working reserves refuse cap drift, OOM and insufficient VM memory',()=>{
 const M=1024*1024,valid={hostFree:1800*M,linuxMemAvailable:1700*M,cgroups:{'backend-candidate':{current:200*M,maximum:768*M,events:{oom:0,oom_kill:0}},'frontend-retained':{current:180*M,maximum:512*M,events:{oom:0,oom_kill:0}},'frontend-candidate':{current:180*M,maximum:512*M,events:{oom:0,oom_kill:0}}}};validateRetainedBrowserCapacity(valid);
 for(const mutate of [v=>v.linuxMemAvailable=1500*M,v=>v.cgroups['backend-candidate'].maximum=1024*M,v=>v.cgroups['frontend-retained'].current=300*M,v=>v.cgroups['frontend-candidate'].events.oom_kill=1]){const value=structuredClone(valid);mutate(value);assert.throws(()=>validateRetainedBrowserCapacity(value));}
});
