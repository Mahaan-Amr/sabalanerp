import assert from 'node:assert/strict';
export const historicalCandidateQaMemoryBytes=1280*1024**2;
export const candidateQaMemoryBytes=1536*1024**2;
export const expandedCandidateQaMemoryBytes=2048*1024**2;
export const retainedQaMemoryBytes=768*1024**2;
export const nativeActorFloorBytes=384*1024**2;
export const windowsHostFloorBytes=1536*1024**2;
export const qaSwapBytes=1536*1024**2;
export function qaUnchangedResourceLimits(host){
 const keys=['MemorySwap','MemoryReservation','NanoCpus','CpuQuota','CpuPeriod','PidsLimit','OomKillDisable'];for(const key of keys)assert.ok(Object.hasOwn(host,key),'LOCAL_QA_RESOURCE_FIELD_MISSING');return Object.fromEntries(keys.map(key=>[key,host[key]]));
}
export function validateQaSwapConfiguration(oldBytes,wantedBytes,service='backend-candidate',transition=false){assert.ok(['backend-candidate','backend-retained'].includes(service));assert.equal(oldBytes,service==='backend-candidate'&&transitionVersion(transition)==='preserve-v3'?expandedCandidateQaMemoryBytes:qaSwapBytes,'LOCAL_QA_OLD_SWAP_CHANGED');assert.equal(wantedBytes,service==='backend-candidate'&&['v3','preserve-v3'].includes(transitionVersion(transition))?expandedCandidateQaMemoryBytes:qaSwapBytes,'LOCAL_QA_EXACT_SWAP_REQUIRED');}
export function validateQaPreservedRuntimeLimits(service,before,after,transition=false){const old=qaUnchangedResourceLimits(before),next=qaUnchangedResourceLimits(after);validateQaSwapConfiguration(old.MemorySwap,next.MemorySwap,service,transition);if(service==='backend-candidate'&&transitionVersion(transition)==='v3')old.MemorySwap=expandedCandidateQaMemoryBytes;assert.deepEqual(next,old,'LOCAL_QA_UNRELATED_LIMIT_CHANGED');}
export function candidateQaBudget(receipt){validateQaMemoryTransitionReceipt(receipt);const expanded=receipt.candidateQaMemoryTransition?.format==='sabalan-explicit-local-qa-candidate-memory-transition/v3'||receipt.candidateQaMemoryProfile?.format==='sabalan-preserved-local-qa-candidate-memory-profile/v1';return{memoryBytes:expanded?expandedCandidateQaMemoryBytes:candidateQaMemoryBytes,swapBytes:expanded?expandedCandidateQaMemoryBytes:qaSwapBytes};}
function transitionVersion(value){assert.ok([false,true,'v1','v2','v3','preserve-v3'].includes(value),'UNKNOWN_LOCAL_QA_MEMORY_TRANSITION');return value===true?'v1':value;}
export function validateQaMemoryConfiguration(service,oldBytes,wantedBytes,transition=false){
 const version=transitionVersion(transition);assert.ok(['backend-candidate','backend-retained'].includes(service));
 const wanted=service==='backend-retained'?retainedQaMemoryBytes:version==='v1'?historicalCandidateQaMemoryBytes:['v3','preserve-v3'].includes(version)?expandedCandidateQaMemoryBytes:candidateQaMemoryBytes;
 const before=service==='backend-retained'?retainedQaMemoryBytes:version==='v1'?retainedQaMemoryBytes:version==='v2'?historicalCandidateQaMemoryBytes:version==='v3'?candidateQaMemoryBytes:wanted;
 assert.equal(wantedBytes,wanted,'EXACT_LOCAL_QA_MEMORY_POLICY_REQUIRED');
 assert.equal(oldBytes,before,'EXPLICIT_LOCAL_QA_MEMORY_TRANSITION_REQUIRED');return wantedBytes;
}
export function validateQaHostMemoryObservation(value,transition=false,now=Date.now()){
 const version=transitionVersion(transition);assert.deepEqual(Object.keys(value).sort(),['availableBytes','observedAt','platform']);assert.equal(value.platform,'win32');
 const age=now-Date.parse(value.observedAt);assert.ok(Number.isFinite(age)&&age>=0&&age<=5000,'LOCAL_QA_HOST_MEMORY_OBSERVATION_STALE');
 assert.ok(Number.isSafeInteger(value.availableBytes));assert.ok(value.availableBytes>=(version?2048*1024**2:windowsHostFloorBytes),'LOCAL_QA_HOST_MEMORY_FLOOR_REFUSED');return value;
}
export function validateQaMemoryTransitionReceipt(value){
 const t=value.candidateQaMemoryTransition;assert.equal(value.originalLimitsUnchanged,!t);
 if(!t){
  const p=value.candidateQaMemoryProfile;if(!p)return;
  assert.equal(p.format,'sabalan-preserved-local-qa-candidate-memory-profile/v1');assert.equal(value.productionAdmission,false);assert.equal(value.authorityCohort?.format,'sabalan-native-authority-cohort/v1');
  for(const ref of [p.predecessor,p.transition]){assert.deepEqual(Object.keys(ref).sort(),['file','sha256']);assert.match(ref.file,/^[A-Za-z]:[\\/]/);assert.match(ref.sha256,/^[a-f0-9]{64}$/);}
  const budgets={'backend-candidate':expandedCandidateQaMemoryBytes,'backend-retained':retainedQaMemoryBytes};assert.deepEqual(p.before,budgets);assert.deepEqual(p.after,budgets);
  for(const service of Object.keys(budgets)){assert.deepEqual(p.runtimeLimitsAfter[service],p.runtimeLimitsBefore[service]);assert.deepEqual(qaUnchangedResourceLimits(p.runtimeLimitsBefore[service]),p.runtimeLimitsBefore[service]);assert.equal(p.runtimeLimitsBefore[service].MemorySwap,service==='backend-candidate'?expandedCandidateQaMemoryBytes:qaSwapBytes);assert.equal(value.actual[service].memoryBytes,budgets[service]);assert.equal(value.actual[service].memorySwapBytes,p.runtimeLimitsAfter[service].MemorySwap);assert.notEqual(value.actual[service].id,value.previous[service].id);}
  assert.equal(p.nativeActorFloorBytes,nativeActorFloorBytes);assert.equal(p.cacheCreditUsed,false);for(const sample of [p.beforeUp,p.afterUp])validateQaHostMemoryObservation(sample,'preserve-v3',Date.parse(sample.observedAt));return;
 }
 assert.equal(value.candidateQaMemoryProfile,undefined,'LOCAL_QA_AMBIGUOUS_PROFILE');
 assert.equal(value.authorityCohort?.format,'sabalan-native-authority-cohort/v1');assert.equal(value.productionAdmission,false);
 assert.ok(['sabalan-explicit-local-qa-candidate-memory-transition/v1','sabalan-explicit-local-qa-candidate-memory-transition/v2','sabalan-explicit-local-qa-candidate-memory-transition/v3'].includes(t.format),'UNKNOWN_LOCAL_QA_MEMORY_TRANSITION_RECEIPT');
 const version=t.format.slice(-2);
 assert.deepEqual(t.before,{'backend-candidate':version==='v1'?retainedQaMemoryBytes:version==='v2'?historicalCandidateQaMemoryBytes:candidateQaMemoryBytes,'backend-retained':retainedQaMemoryBytes});
 assert.deepEqual(t.after,{'backend-candidate':version==='v1'?historicalCandidateQaMemoryBytes:version==='v2'?candidateQaMemoryBytes:expandedCandidateQaMemoryBytes,'backend-retained':retainedQaMemoryBytes});
 assert.deepEqual(Object.keys(t.runtimeLimitsBefore).sort(),['backend-candidate','backend-retained']);assert.deepEqual(Object.keys(t.runtimeLimitsAfter).sort(),['backend-candidate','backend-retained']);for(const service of ['backend-candidate','backend-retained'])validateQaPreservedRuntimeLimits(service,t.runtimeLimitsBefore[service],t.runtimeLimitsAfter[service],version);
 if(version==='v3'){assert.deepEqual(Object.keys(t.predecessor).sort(),['file','sha256']);assert.equal(typeof t.predecessor.file,'string');assert.match(t.predecessor.file,/^[A-Za-z]:[\\/]/);assert.match(t.predecessor.sha256,/^[a-f0-9]{64}$/);}
 assert.equal(t.nativeActorFloorBytes,nativeActorFloorBytes);assert.equal(t.cacheCreditUsed,false);
 for(const s of ['backend-candidate','backend-retained']){assert.equal(value.actual[s].memoryBytes,t.after[s]);assert.equal(value.actual[s].memorySwapBytes,version==='v3'&&s==='backend-candidate'?expandedCandidateQaMemoryBytes:qaSwapBytes);assert.notEqual(value.actual[s].id,value.previous[s].id);}
 validateQaHostMemoryObservation(t.beforeUp,true,Date.parse(t.beforeUp.observedAt));validateQaHostMemoryObservation(t.afterUp,version==='v3'?'v3':false,Date.parse(t.afterUp.observedAt));
}
