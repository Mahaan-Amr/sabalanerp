/** Actual SAME-Popen Inquiry adapter; no report/inspection can supply its owner.
 * The fixed material implementation owns staging, RO publication and spawn. */
import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
export function createOriginalCompleteInquiryReader({operation,material,selection,imageFiles,helpers,assertOriginalCurrent}){
 assert.match(operation,/^[a-f0-9]{32}$/);let phase='NEW',session,binding,closure,borrowed=false,retirement,negativeClosure,restoredSqliteSha256;
 const current=async()=>{await assertOriginalCurrent();if(session&&phase!=='FINISHED')session.assertLive();};
 const decode=value=>{const raw=Buffer.from(value.rawBase64,'base64');assert.equal(raw.toString('base64'),value.rawBase64);assert.equal(raw.length,value.bytes);assert.equal(sha(raw),value.sha256);return raw;};
 return Object.freeze({
  async prepare(request){assert.equal(phase,'NEW','ORIGINAL_INQUIRY_OPERATION_USED');phase='PREPARING';await current();assert.equal(request.descriptor.request?.operation??JSON.parse(request.descriptor.raw).operation,operation);assert.ok(request.inquiryStage,'ORIGINAL_INQUIRY_PRIVATE_STAGE_REQUIRED');
   const stage=await material.readOriginalInquiryStage(request.inquiryStage),components=request.manifest.components.filter(v=>v.path==='inquiry/inquiry.db');assert.equal(components.length,1);assert.deepEqual(stage.descriptor.source,{size:components[0].size,sha256:components[0].sha256});assert.equal(stage.descriptor.operation,operation);assert.deepEqual(stage.descriptor.transformation.source,stage.descriptor.source);assert.deepEqual(stage.descriptor.transformation.target,stage.descriptor.target);assert.equal(stage.descriptor.transformation.sanitized,false);assert.deepEqual(stage.descriptor.transformation.businessBefore,stage.descriptor.transformation.businessAfter);assert.equal(sha(stage.raw),stage.descriptor.target.sha256);assert.equal(stage.raw.length,stage.descriptor.target.size);
   let prepared;try{prepared=await material.stageOriginalInquiry({raw:stage.raw,selection,imageFiles,helpers,database:request.database});}finally{stage.raw.fill(0);}
   await current();await material.publishOriginalInquiryGrant(prepared.grant);await current();session=await material.startOriginalInquirySession(prepared);await session.started();phase='RUNNING';binding=await session.send('BINDING');assert.equal(binding.inputSqlite.sha256,stage.descriptor.target.sha256);restoredSqliteSha256=stage.descriptor.target.sha256;await current();
  },
  async reader(work){assert.equal(phase,'RUNNING');assert.equal(borrowed,false);await current();await session.send('BORROW');borrowed=true;try{return await work();}finally{await session.send('RELEASE');borrowed=false;}},
  async observeReady(){assert.equal(phase,'RUNNING');assert.equal(borrowed,true);const deadline=Date.now()+120000;for(;;){await current();const value=await session.send('READY');if(value.ready){assert.equal(value.originalPopenPid,(await session.started()).originalPopenPid);assert.equal(value.sqlite.sha256,binding.inputSqlite.sha256);assert.equal(value.scopeSha256,binding.scope.sha256);assert.equal(value.loginResponse.status,200);decode(value.loginResponse);return value;}assert.equal(value.ready,false);assert.ok(Date.now()<deadline,'ORIGINAL_INQUIRY_NEXT_NOT_READY');await new Promise(r=>setTimeout(r,100));}},
  async stop(){assert.equal(borrowed,false);if(!session)return;if(phase==='CLOSED')return closure;assert.equal(phase,'RUNNING');closure=await session.send('STOP');assert.equal(closure.wrapperStatus,128);assert.equal(closure.nativeStatus,143);assert.equal(closure.naturalExitZero,false);phase='CLOSED';return closure;},
  async awaitRetainedClosure(){if(!session)return;if(phase==='CLOSED'){session.assertLive();assert.equal(closure.wrapperStatus,128);return closure;}if(phase==='FINISHED')return negativeClosure??closure;negativeClosure=await session.endOriginalInput();assert.equal(negativeClosure.stdoutEof&&negativeClosure.stderrEof,true);phase='FINISHED';throw Error('ORIGINAL_INQUIRY_NEGATIVE_CLOSED');},
  async closedRecords(){assert.equal(phase,'CLOSED');return session.send('RECORDS');},
  async retire(){assert.equal(phase,'CLOSED');await session.send('RETIRE');phase='RETIRED';},
  async retirementRecord(){assert.equal(phase,'RETIRED');retirement=await session.send('RETIREMENT');decode(retirement);await session.send('FINISH');closure=await session.finish();phase='FINISHED';return retirement;},
  observationBinding(){assert.ok(binding&&restoredSqliteSha256,'ORIGINAL_INQUIRY_BINDING_NOT_OBSERVED');return{...structuredClone(binding),restoredSqliteSha256};},
  async closeNegativeOriginal(){if(!session)return;if(phase==='CLOSED'){const records=await session.send('RECORDS');await material.persistOriginalInquiryNegative(records);}
   if(phase!=='FINISHED'){negativeClosure=await session.endOriginalInput();assert.equal(negativeClosure.stdoutEof&&negativeClosure.stderrEof,true);phase='FINISHED';}return negativeClosure;
  },
 });
}
