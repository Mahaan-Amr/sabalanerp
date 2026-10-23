import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {candidateQaMemoryBytes as candidate,retainedQaMemoryBytes as retained,nativeActorFloorBytes,validateQaSwapConfiguration,qaUnchangedResourceLimits,validateQaMemoryConfiguration as config,validateQaHostMemoryObservation as host,validateQaMemoryTransitionReceipt as receipt} from '../../scripts/lib/application-native-qa-memory.mjs';
import {parseCandidateReplacementArguments as parse} from '../../scripts/replace-qualified-application-native-candidate-local.mjs';
const now=Date.now(),obs=bytes=>({availableBytes:bytes,observedAt:new Date(now).toISOString(),platform:'win32'});
test('only explicit candidate768 to1280 transitions; retained and unspecified deltas refuse',()=>{
 assert.equal(config('backend-candidate',retained,candidate,true),candidate);assert.equal(config('backend-retained',retained,retained,true),retained);assert.equal(config('backend-candidate',candidate,candidate),candidate);
 for(const run of [()=>config('backend-candidate',retained,candidate),()=>config('backend-retained',retained,candidate,true),()=>config('backend-candidate',retained,candidate+1,true),()=>config('backend-candidate',candidate,candidate,true)])assert.throws(run);
 assert.equal(nativeActorFloorBytes,384*1024**2);
});
test('real host observation reserves full512MiB increment over1.5GiB floor; no cachecredit',()=>{
 assert.equal(host(obs(2048*1024**2),true,now).availableBytes,2048*1024**2);assert.throws(()=>host(obs(2048*1024**2-1),true,now));assert.throws(()=>host({...obs(3*1024**3),observedAt:new Date(now-5001).toISOString()},true,now));assert.throws(()=>host({...obs(3*1024**3),platform:'linux'},true,now));assert.throws(()=>host({...obs(3*1024**3),cacheCredit:100},true,now));
});
const argv=['--inspect','--image-receipt','a','--material-receipt','b','--preflight','c','--previous-replacement-receipt','D:/reports/qa/application-native-candidate-'+('a'.repeat(32))+'.json','--previous-replacement-sha256','b'.repeat(64),'--isolate-authority-cohort','--candidate-qa-memory-1280'];
test('resource transition parser requires explicit predecessor and freshcohort',()=>{
 assert.equal(parse(argv).candidateQaMemoryTransition,true);assert.throws(()=>parse(argv.filter(x=>x!=='--isolate-authority-cohort')));assert.throws(()=>parse([...argv.slice(0,7),'--isolate-authority-cohort','--candidate-qa-memory-1280']));assert.equal(parse(argv.slice(0,-1)).candidateQaMemoryTransition,undefined);
});
function limits(){return Object.fromEntries(['backend-candidate','backend-retained'].map(s=>[s,{MemorySwap:1536*1024**2,MemoryReservation:0,NanoCpus:1000000000,CpuQuota:0,CpuPeriod:0,PidsLimit:null,OomKillDisable:null}]));}
function value(){return{originalLimitsUnchanged:false,authorityCohort:{format:'sabalan-native-authority-cohort/v1'},productionAdmission:false,previous:{'backend-candidate':{id:'oldc'},'backend-retained':{id:'oldr'}},actual:{'backend-candidate':{id:'newc',memoryBytes:candidate,memorySwapBytes:1536*1024**2},'backend-retained':{id:'newr',memoryBytes:retained,memorySwapBytes:1536*1024**2}},candidateQaMemoryTransition:{format:'sabalan-explicit-local-qa-candidate-memory-transition/v1',before:{'backend-candidate':retained,'backend-retained':retained},after:{'backend-candidate':candidate,'backend-retained':retained},nativeActorFloorBytes:384*1024**2,cacheCreditUsed:false,runtimeLimitsBefore:limits(),runtimeLimitsAfter:limits(),beforeUp:obs(2048*1024**2),afterUp:obs(1536*1024**2)}};}
test('truthful receipt requires freshslotIDs and actualreadback; cannotclaimunchangedlimits',()=>{
 receipt(value());for(const change of [v=>v.originalLimitsUnchanged=true,v=>v.actual['backend-candidate'].memoryBytes=retained,v=>v.actual['backend-candidate'].id='oldc',v=>v.candidateQaMemoryTransition.after['backend-retained']=candidate,v=>delete v.candidateQaMemoryTransition.beforeUp]){const v=value();change(v);assert.throws(()=>receipt(v));}
 receipt({originalLimitsUnchanged:true});
});
test('Compose budget candidate1280 and explicitretained768; guardskeep384floor',()=>{
 const source=fs.readFileSync(new URL('../../docker-compose.online-acceptance.yml',import.meta.url),'utf8');assert.match(source,/mem_limit: 1280m/);assert.match(source,/backend-retained:\n    mem_limit: 768m/);
 const controller=fs.readFileSync(new URL('./application-native-candidate-controller.fixture.py',import.meta.url),'utf8');assert.match(controller,/'full-catalog': 384 \* MIB/);assert.match(controller,/== 1280 \* MIB/);assert.ok(controller.indexOf("self.capacity('full-catalog')")<controller.indexOf("check(self.sql('SELECT system_identifier"));
});

test('swap1536 and CPU/pids resource facts remain exact, hostsample follows mandatoryDockerstatus',()=>{
 validateQaSwapConfiguration(1536*1024**2,1536*1024**2);assert.throws(()=>validateQaSwapConfiguration(1536*1024**2,2560*1024**2));const limits={MemorySwap:1536*1024**2,MemoryReservation:0,NanoCpus:1000000000,CpuQuota:0,CpuPeriod:0,PidsLimit:null,OomKillDisable:null};assert.deepEqual(qaUnchangedResourceLimits(limits),limits);assert.throws(()=>qaUnchangedResourceLimits({MemorySwap:1}));
 const source=fs.readFileSync(new URL('../../scripts/replace-qualified-application-native-candidate-local.mjs',import.meta.url),'utf8');assert.match(source,/status\(\);const beforeUpMemory=hostMemory/);assert.ok(!source.slice(source.indexOf('const beforeUpMemory'),source.indexOf('report.up=await')).includes('status()'));
 const compose=fs.readFileSync(new URL('../../docker-compose.online-acceptance.yml',import.meta.url),'utf8');assert.equal((compose.match(/memswap_limit: 1536m/g)||[]).length,2);
});
