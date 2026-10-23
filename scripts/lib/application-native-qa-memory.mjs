import assert from 'node:assert/strict';
export const candidateQaMemoryBytes=1280*1024**2;
export const retainedQaMemoryBytes=768*1024**2;
export const nativeActorFloorBytes=384*1024**2;
export const windowsHostFloorBytes=1536*1024**2;
export const qaSwapBytes=1536*1024**2;
export function qaUnchangedResourceLimits(host){
 const keys=['MemorySwap','MemoryReservation','NanoCpus','CpuQuota','CpuPeriod','PidsLimit','OomKillDisable'];for(const key of keys)assert.ok(Object.hasOwn(host,key),'LOCAL_QA_RESOURCE_FIELD_MISSING');return Object.fromEntries(keys.map(key=>[key,host[key]]));
}
export function validateQaSwapConfiguration(oldBytes,wantedBytes){assert.equal(oldBytes,qaSwapBytes,'LOCAL_QA_OLD_SWAP_CHANGED');assert.equal(wantedBytes,qaSwapBytes,'LOCAL_QA_SWAP_MUST_REMAIN_1536');}
export function validateQaMemoryConfiguration(service,oldBytes,wantedBytes,transition=false){
 assert.ok(['backend-candidate','backend-retained'].includes(service));
 assert.equal(wantedBytes,service==='backend-candidate'?candidateQaMemoryBytes:retainedQaMemoryBytes,'EXACT_LOCAL_QA_MEMORY_POLICY_REQUIRED');
 assert.equal(oldBytes,transition&&service==='backend-candidate'?retainedQaMemoryBytes:wantedBytes,'EXPLICIT_LOCAL_QA_MEMORY_TRANSITION_REQUIRED');
 return wantedBytes;
}
export function validateQaHostMemoryObservation(value,transition=false,now=Date.now()){
 assert.deepEqual(Object.keys(value).sort(),['availableBytes','observedAt','platform']);assert.equal(value.platform,'win32');
 const age=now-Date.parse(value.observedAt);assert.ok(Number.isFinite(age)&&age>=0&&age<=5000,'LOCAL_QA_HOST_MEMORY_OBSERVATION_STALE');
 assert.ok(Number.isSafeInteger(value.availableBytes));assert.ok(value.availableBytes>=windowsHostFloorBytes+(transition?candidateQaMemoryBytes-retainedQaMemoryBytes:0),'LOCAL_QA_HOST_MEMORY_FLOOR_REFUSED');return value;
}
export function validateQaMemoryTransitionReceipt(value){
 const t=value.candidateQaMemoryTransition;assert.equal(value.originalLimitsUnchanged,!t);
 if(!t)return;
 assert.equal(value.authorityCohort?.format,'sabalan-native-authority-cohort/v1');assert.equal(value.productionAdmission,false);
 assert.deepEqual(t.before,{'backend-candidate':retainedQaMemoryBytes,'backend-retained':retainedQaMemoryBytes});
 assert.deepEqual(t.after,{'backend-candidate':candidateQaMemoryBytes,'backend-retained':retainedQaMemoryBytes});
 assert.deepEqual(Object.keys(t.runtimeLimitsBefore).sort(),['backend-candidate','backend-retained']);assert.deepEqual(t.runtimeLimitsAfter,t.runtimeLimitsBefore);for(const limits of Object.values(t.runtimeLimitsBefore)){assert.deepEqual(qaUnchangedResourceLimits(limits),limits);assert.equal(limits.MemorySwap,qaSwapBytes);}
 assert.equal(t.format,'sabalan-explicit-local-qa-candidate-memory-transition/v1');assert.equal(t.nativeActorFloorBytes,nativeActorFloorBytes);assert.equal(t.cacheCreditUsed,false);
 for(const s of ['backend-candidate','backend-retained']){assert.equal(value.actual[s].memoryBytes,t.after[s]);assert.equal(value.actual[s].memorySwapBytes,qaSwapBytes);assert.notEqual(value.actual[s].id,value.previous[s].id);}
 validateQaHostMemoryObservation(t.beforeUp,true,Date.parse(t.beforeUp.observedAt));validateQaHostMemoryObservation(t.afterUp,false,Date.parse(t.afterUp.observedAt));
}
