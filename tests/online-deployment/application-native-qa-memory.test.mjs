import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {candidateQaMemoryBytes as candidate,historicalCandidateQaMemoryBytes as historical,retainedQaMemoryBytes as retained,nativeActorFloorBytes,validateQaSwapConfiguration,qaUnchangedResourceLimits,validateQaMemoryConfiguration as config,validateQaHostMemoryObservation as host,validateQaMemoryTransitionReceipt as receipt} from '../../scripts/lib/application-native-qa-memory.mjs';
import {parseCandidateReplacementArguments as parse} from '../../scripts/replace-qualified-application-native-candidate-local.mjs';
const now=Date.now(),obs=bytes=>({availableBytes:bytes,observedAt:new Date(now).toISOString(),platform:'win32'});
test('only explicit candidate1280 to1536 transitions; retained and unspecified deltas refuse',()=>{
 assert.equal(config('backend-candidate',historical,candidate,'v2'),candidate);assert.equal(config('backend-retained',retained,retained,'v2'),retained);assert.equal(config('backend-candidate',candidate,candidate),candidate);
 for(const run of [()=>config('backend-candidate',retained,candidate),()=>config('backend-retained',retained,candidate,true),()=>config('backend-candidate',retained,candidate+1,true),()=>config('backend-candidate',candidate,candidate,true)])assert.throws(run);
 assert.equal(nativeActorFloorBytes,384*1024**2);
});
test('real host observation reserves full512MiB increment over1.5GiB floor; no cachecredit',()=>{
 assert.equal(host(obs(2048*1024**2),true,now).availableBytes,2048*1024**2);assert.throws(()=>host(obs(2048*1024**2-1),true,now));assert.throws(()=>host({...obs(3*1024**3),observedAt:new Date(now-5001).toISOString()},true,now));assert.throws(()=>host({...obs(3*1024**3),platform:'linux'},true,now));assert.throws(()=>host({...obs(3*1024**3),cacheCredit:100},true,now));
});
const argv=['--inspect','--image-receipt','a','--material-receipt','b','--preflight','c','--previous-replacement-receipt','D:/reports/qa/application-native-candidate-'+('a'.repeat(32))+'.json','--previous-replacement-sha256','b'.repeat(64),'--isolate-authority-cohort','--candidate-qa-memory-1536'];
test('resource transition parser requires explicit predecessor and freshcohort',()=>{
 assert.equal(parse(argv).candidateQaMemoryTransition,'v2');assert.throws(()=>parse(argv.filter(x=>x!=='--isolate-authority-cohort')));assert.throws(()=>parse([...argv.slice(0,7),'--isolate-authority-cohort','--candidate-qa-memory-1536']));assert.equal(parse(argv.slice(0,-1)).candidateQaMemoryTransition,undefined);
});
function limits(){return Object.fromEntries(['backend-candidate','backend-retained'].map(s=>[s,{MemorySwap:1536*1024**2,MemoryReservation:0,NanoCpus:1000000000,CpuQuota:0,CpuPeriod:0,PidsLimit:null,OomKillDisable:null}]));}
function value(){return{originalLimitsUnchanged:false,authorityCohort:{format:'sabalan-native-authority-cohort/v1'},productionAdmission:false,previous:{'backend-candidate':{id:'oldc'},'backend-retained':{id:'oldr'}},actual:{'backend-candidate':{id:'newc',memoryBytes:candidate,memorySwapBytes:1536*1024**2},'backend-retained':{id:'newr',memoryBytes:retained,memorySwapBytes:1536*1024**2}},candidateQaMemoryTransition:{format:'sabalan-explicit-local-qa-candidate-memory-transition/v2',before:{'backend-candidate':historical,'backend-retained':retained},after:{'backend-candidate':candidate,'backend-retained':retained},nativeActorFloorBytes:384*1024**2,cacheCreditUsed:false,runtimeLimitsBefore:limits(),runtimeLimitsAfter:limits(),beforeUp:obs(2048*1024**2),afterUp:obs(1536*1024**2)}};}
test('truthful receipt requires freshslotIDs and actualreadback; cannotclaimunchangedlimits',()=>{
 receipt(value());for(const change of [v=>v.originalLimitsUnchanged=true,v=>v.actual['backend-candidate'].memoryBytes=retained,v=>v.actual['backend-candidate'].id='oldc',v=>v.candidateQaMemoryTransition.after['backend-retained']=candidate,v=>delete v.candidateQaMemoryTransition.beforeUp]){const v=value();change(v);assert.throws(()=>receipt(v));}
 receipt({originalLimitsUnchanged:true});
});
test('Compose budget candidate1536 and explicitretained768; guardskeep384floor',()=>{
 const source=fs.readFileSync(new URL('../../docker-compose.online-acceptance.yml',import.meta.url),'utf8');assert.match(source,/mem_limit: 1536m/);assert.match(source,/backend-retained:\n    mem_limit: 768m/);
 const controller=fs.readFileSync(new URL('./application-native-candidate-controller.fixture.py',import.meta.url),'utf8');assert.match(controller,/'full-catalog': 384 \* MIB/);assert.match(controller,/== 1536 \* MIB/);assert.ok(controller.indexOf("self.capacity('full-catalog')")<controller.indexOf("check(self.sql('SELECT system_identifier"));
});

test('swap1536 and CPU/pids resource facts remain exact, hostsample follows mandatoryDockerstatus',()=>{
 validateQaSwapConfiguration(1536*1024**2,1536*1024**2);assert.throws(()=>validateQaSwapConfiguration(1536*1024**2,2560*1024**2));const limits={MemorySwap:1536*1024**2,MemoryReservation:0,NanoCpus:1000000000,CpuQuota:0,CpuPeriod:0,PidsLimit:null,OomKillDisable:null};assert.deepEqual(qaUnchangedResourceLimits(limits),limits);assert.throws(()=>qaUnchangedResourceLimits({MemorySwap:1}));
 const source=fs.readFileSync(new URL('../../scripts/replace-qualified-application-native-candidate-local.mjs',import.meta.url),'utf8');assert.match(source,/status\(\);const beforeUpMemory=hostMemory/);assert.ok(!source.slice(source.indexOf('const beforeUpMemory'),source.indexOf('report.up=await')).includes('status()'));
 const compose=fs.readFileSync(new URL('../../docker-compose.online-acceptance.yml',import.meta.url),'utf8');assert.equal((compose.match(/memswap_limit: 1536m/g)||[]).length,2);
});

test('historical V1 768-to1280 receipt stays authentic and cannot be relabelled V2',()=>{
 const v=value();v.candidateQaMemoryTransition.format='sabalan-explicit-local-qa-candidate-memory-transition/v1';v.candidateQaMemoryTransition.before['backend-candidate']=retained;v.candidateQaMemoryTransition.after['backend-candidate']=historical;v.actual['backend-candidate'].memoryBytes=historical;receipt(v);
 v.candidateQaMemoryTransition.format='sabalan-explicit-local-qa-candidate-memory-transition/v2';assert.throws(()=>receipt(v));
});
test('both explicit versions retain actual2GiB-before and1.5GiB-after, no reduced delta floor',()=>{
 for(const version of ['v1','v2']){host(obs(2048*1024**2),version,now);assert.throws(()=>host(obs(2048*1024**2-1),version,now));}
 host(obs(1536*1024**2),false,now);assert.throws(()=>host(obs(1536*1024**2-1),false,now));
});
test('unknown cap, unsupportedtransition, nonQAservice, swapdrift and CPUdrift refuse',()=>{
 for(const cap of [768,1024,1280,1792,2048])assert.throws(()=>config('backend-candidate',historical,cap*1024**2,'v2'));
 assert.throws(()=>config('backend',historical,candidate,'v2'));assert.throws(()=>config('backend-candidate',historical,candidate,'v3'));assert.throws(()=>host(obs(3*1024**3),'v3',now));
 for(const mutate of [v=>v.candidateQaMemoryTransition.format='unknown',v=>v.candidateQaMemoryTransition.runtimeLimitsAfter['backend-candidate'].MemorySwap++,v=>v.candidateQaMemoryTransition.runtimeLimitsBefore['backend-candidate'].MemorySwap++,v=>v.candidateQaMemoryTransition.runtimeLimitsAfter['backend-retained'].NanoCpus++,v=>v.candidateQaMemoryTransition.before['backend-candidate']=retained]){const v=value();mutate(v);assert.throws(()=>receipt(v));}
});
test('old explicit flag remains V1, new V2 requires all original predecessor/cohort controls',()=>{
 assert.equal(parse([...argv.slice(0,-1),'--candidate-qa-memory-1280']).candidateQaMemoryTransition,'v1');
 assert.throws(()=>parse([...argv,'--candidate-qa-memory-1280']));assert.throws(()=>parse([...argv.slice(0,-1),'--candidate-qa-memory-1792']));
});
