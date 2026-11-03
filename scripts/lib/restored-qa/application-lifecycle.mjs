import assert from 'node:assert/strict';
import {assertRestoredInquiryCarrierObservation} from './inquiry-carrier-observation.mjs';

/** Data/lifecycle composition over original native and carrier ports. This
 * function issues no capability, signs nothing and makes no health admission.
 * Its callback caller must bind the ports to the same active engine scope. */
export async function runRestoredQaApplicationLifecycle({broker,database,controllerSha256,assertActive,exercise,recheck,inquiryExpected}){
  assertActive();
  let baseline,initialization,probe,closure,inquiryClosure,failure,failed=false;
  try{
    baseline=await broker.runBaseline(controllerSha256);assertActive();
    initialization=await broker.initialize();assertActive();
    await broker.startHttp(controllerSha256);assertActive();
    probe=await exercise(broker.httpEndpointWitness());assertActive();
    assert.deepEqual(Object.keys(probe).sort(),['authenticated','businessVerified','database','filesVerified','originals','productionAdmission']);
    assert.deepEqual(probe.database,database);
    for(const field of ['authenticated','businessVerified','filesVerified'])assert.equal(probe[field],true);
    assert.equal(probe.productionAdmission,false);
    assert.deepEqual(probe.originals.map(row=>row.role).sort(),['frontend','inquiry']);
    for(const row of probe.originals){
      if(row.role==='inquiry'){
        assert.deepEqual(Object.keys(row).sort(),['evidence','role']);
        inquiryClosure=assertRestoredInquiryCarrierObservation(row.evidence,inquiryExpected());continue;
      }
      assert.deepEqual(Object.keys(row).sort(),['code','killed','observationFault','originalPid','role','sha256','signal','stderrEof','stdoutEof']);
      assert.match(row.sha256,/^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(row.originalPid)&&row.originalPid>1);
      assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);
      assert.equal(row.killed,false);assert.equal(row.observationFault,null);
    }
  }catch(error){failed=true;failure=error;}
  finally{
    // A failing probe still owes orderly shutdown. A HELD broker keeps custody
    // until its actual descendants close; no timeout, signal or receipt adopts it.
    try{if(broker.inspect().phase==='HTTP_READY')closure=await broker.closeHttp();}
    catch(error){if(!failed){failed=true;failure=error;}}
    finally{try{await broker.awaitRetainedClosure();}catch(error){if(!failed){failed=true;failure=error;}}}
  }
  if(failed)throw failure;
  assert.equal(broker.inspect().phase,'CLOSED');assertActive();
  const final=await recheck();assertActive();assert.deepEqual(final.database,database);
  assert.deepEqual(final.sql,{visible:true,sessions:0,prepared:0});assert.equal(final.filesVerified,true);
  assert.equal(final.productionAdmission,false);
  return Object.freeze({baseline,initialization,probe,closure,inquiryClosure,final,cleanupPending:true,independentPointHealthy:false,productionAdmission:false});
}
