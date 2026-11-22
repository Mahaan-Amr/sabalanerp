import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const source=fs.readFileSync('scripts/lib/original-following-update-workflow.mjs','utf8');
const hex='a'.repeat(64),http='b'.repeat(64),jobs='c'.repeat(64),inquiryId='d'.repeat(64);
const nextCycle={deploymentId:'attempt001',releaseId:'release002',targetCommit:'e'.repeat(40),prebuiltReleasePlan:{file:'/private/plan.json',sha256:hex}};
function fixture({reuse=false,fail=null,badPlan=false,badIds=false,rollback=false}={}){
 const calls=[],progress=[],session={original:true};
 const cycle={releaseId:'release002',previousReleaseId:'release001',httpRuntimeIds:[badIds?'bad':http],jobsRuntimeIds:[jobs],buildIds:{erp:'erp-build',inquiry:'inquiry-build'},
  inquiry:{kind:reuse?'REUSE_ORIGINAL':'PREPARE_NEW',buildId:'inquiry-build',runtimeId:reuse?inquiryId:null,releaseId:reuse?'release001':'release002',image:'sha256:'+hex,manifestSha256:hex}};
 const publicationPlan={registry:{assets:'x'.repeat(85000)},expectedPublicationSha256:hex,releaseId:badPlan?'other-release':'release002',previousReleaseId:'release001',rollback:false};
 const send=async(actual,{command,input})=>{
  assert.equal(actual,session);calls.push({command,input});if(command===fail)throw Error('REAL_CONTROL_REFUSED');
  return{command,status:'COMPLETED',releaseAcceptanceGranted:false,
   ...(command==='CREATE_CHECKPOINT'?{checkpointCommitted:true}:{}),
   ...(command==='QUALIFY_NEXT'?{originalOnlineQualificationBound:true}:{}),
   ...(command==='READ_CYCLE_PLAN'?{cyclePlan:cycle}:{}),
   ...(command==='PREPARE_INQUIRY'?{runtimeId:inquiryId}:{}),
   ...(command==='PREPARE_RETAINED_ROLLBACK'?{rollbackPlan:{releaseId:'release001',jobsRuntimeIds:['f'.repeat(64)]}}:{}),
   ...(command==='BUILD_PUBLICATION_REGISTRY'?{publicationPlan:input.input.releaseId==='release001'?{...publicationPlan,releaseId:'release001',previousReleaseId:'release002',rollback:true}:publicationPlan}:{})};
 };
 const body=source.replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
 const run=vm.runInNewContext(body+'\nrunOriginalFollowingPromotion;',{assert,path,assertOriginalFollowingClient:value=>assert.equal(value,session),sendOriginalProtectedClientControl:send,Object,Set});
 return{calls,progress,run:()=>run(session,{nextCycle:structuredClone(nextCycle),onProgress:event=>progress.push(event),completeWith:rollback?'CURRENT_DATA_ROLLBACK':'PROMOTION'})};
}
test('promotion derives runtime and publication inputs from actual replies in phase order',async()=>{
 const f=fixture();const result=await f.run(),commands=f.calls.map(row=>row.command);
 assert.equal(result.clientDetached,false);assert.equal(result.productionAdmission,false);
 assert.deepEqual(commands,['ACQUIRE_NEXT','CREATE_CHECKPOINT','QUALIFY_NEXT','PREPARE_EXPANSION','RUN_EXPANSION','REGISTER','READ_CYCLE_PLAN','PROVISION_CARRIERS','START_RUNTIME','WAIT_READY','PREPARE_INQUIRY','START_INQUIRY','APPEND_EDGE_ENDPOINTS','RUN_PRODUCTION_GATES','BUILD_PUBLICATION_REGISTRY','TRANSITION','PUBLISH','START_RUNTIME','WAIT_READY','FINISH_CYCLE']);
 assert.equal(f.calls.find(row=>row.command==='TRANSITION').input.nextPhase,'ONLINE_PUBLISHING');
 assert.equal(f.calls.find(row=>row.command==='PUBLISH').input.input.registry.assets.length,85000);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].input)),{input:nextCycle});
 assert.equal(f.calls.find(row=>row.command==='START_INQUIRY').input.input.runtimeId,inquiryId);
 assert.ok(f.progress.every(row=>Object.keys(row).sort().join(',')==='command,completed'));
});
test('unchanged Inquiry retains its actual original actor without restart commands',async()=>{
 const f=fixture({reuse:true});await f.run();assert.ok(!f.calls.some(row=>['PREPARE_INQUIRY','START_INQUIRY','STOP_INQUIRY'].includes(row.command)));
});
test('known refusal stops orchestration without fabricated finish, rollback or database restore',async()=>{
 const f=fixture({fail:'RUN_PRODUCTION_GATES'});await assert.rejects(f.run(),/REAL_CONTROL_REFUSED/);
 assert.equal(f.calls.at(-1).command,'RUN_PRODUCTION_GATES');assert.ok(!f.calls.some(row=>row.command==='PUBLISH'||row.command==='FINISH_CYCLE'));
});
test('wrong publication target and malformed runtime IDs refuse before publication',async()=>{
 for(const options of [{badPlan:true},{badIds:true}]){const f=fixture(options);await assert.rejects(f.run());assert.ok(!f.calls.some(row=>row.command==='PUBLISH'));}
});
test('current-data rollback drains new jobs, prepares only fresh old jobs and republishes the actual old plan',async()=>{
 const f=fixture({rollback:true,reuse:true}),result=await f.run();
 assert.equal(result.applicationUpdateSucceeded,false);assert.equal(result.currentDataRollbackCompleted,true);assert.equal(result.servingReleaseId,'release001');
 const commands=f.calls.map(row=>row.command),prepare=commands.indexOf('PREPARE_RETAINED_ROLLBACK');
 assert.deepEqual(commands.slice(prepare-5,prepare),['PREPARE_DRAIN','WAIT_PREPARED','SHUTDOWN','WAIT_CLOSED','TRANSITION']);
 assert.equal(f.calls[prepare].input.input.releaseId,'release001');
 const publications=f.calls.filter(row=>row.command==='PUBLISH');assert.equal(publications.length,2);assert.equal(publications[1].input.input.rollback,true);
 const starts=f.calls.filter(row=>row.command==='START_RUNTIME');assert.equal(starts.at(-1).input.input.runtimeId,'f'.repeat(64));assert.equal(starts.at(-1).input.input.releaseId,'release001');
 assert.equal(commands.filter(command=>command==='PROVISION_CARRIERS').length,1);
 assert.ok(!commands.some(command=>/RESTORE|STOP_INQUIRY/.test(command)));assert.equal(commands.at(-1),'FINISH_CYCLE');
});
