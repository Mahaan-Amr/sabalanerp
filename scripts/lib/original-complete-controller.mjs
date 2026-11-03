/** Source-bound original controller entry. The immutable preparer supplies live
 * issuer/carrier/transport ports, never JSON callbacks, a signing key path or an
 * arbitrary loaded module. This composes the reviewed Windows HR protocol. */
import assert from 'node:assert/strict';
import {createOriginalCompleteWindowsCounterpart,retainOriginalCompleteWorker,captureOriginalCompleteBeforeCleanup,readRetainedCompleteWorker} from './original-complete-counterpart.mjs';

export function originalCompleteWorkerInput(initial,session){
  assert.ok(Buffer.isBuffer(initial)&&initial.length>0&&initial.length<=12*1024**2);
  assert.match(session,/^[a-f0-9]{64}$/);
  const frame=JSON.parse(initial.toString('utf8'));
  assert.deepEqual(Object.keys(frame).sort(),['applicationKeys','passphrase']);
  return Buffer.from(JSON.stringify({...frame,hrSession:session}));
}

export async function runOriginalCompleteController(binding,initial){
  let workerInput;
  /** @type {{counterpart?:ReturnType<typeof createOriginalCompleteWindowsCounterpart>,exchange?:{closed():Promise<void>},observation?:object}} */
  const state={};
  let readerClosure,failed=false,primaryFault;
  // Latch the actual closure attempt, including its rejection. Re-entering a
  // failed closure would overwrite/duplicate its exclusive original receipt.
  const closeReaders=()=>readerClosure??=Promise.resolve().then(async()=>{assert.equal(typeof binding.awaitOriginalReaderClosure,'function','COMPLETE_ORIGINAL_READER_CLOSURE_REQUIRED');const value=await binding.awaitOriginalReaderClosure();assert.equal(value?.allOriginalChildrenClosed,true);assert.equal(value.interrupted,false);assert.equal(value.failed,false);});
  try{
    workerInput=originalCompleteWorkerInput(initial,binding.session);
    await binding.authenticate();
    const worker=await retainOriginalCompleteWorker({command:binding.command,session:binding.session,initial:workerInput,observeOriginalRaw:binding.observeOriginalRaw,
      onRequest:async(request,live)=>{
        assert.ok(live());
        assert.equal(request.session,binding.session);assert.equal(request.intendedOwner.releaseId,binding.releaseId);
        const ports=await binding.originalObservationPorts(request,live);assert.ok(live());
        state.counterpart=createOriginalCompleteWindowsCounterpart({identity:{session:request.session,operation:binding.operation,
          sourceCommit:binding.targetCommit,database:request.targetDatabase},manifest:request.manifest,
          assertActive:()=>{assert.ok(live(),'COMPLETE_ORIGINAL_CALLBACK_CLOSED');binding.assertActive();},...ports});
        state.exchange=await binding.startFixedExchange(async value=>{state.observation=await state.counterpart.observe(value);return state.observation;});
        return binding.issueOriginalHistoricalCertificate(request,live);
      }});
    // Closing the three-frame channel does not imply closure of counterpart work.
    assert.ok(state.exchange&&state.counterpart);await state.exchange.closed();state.counterpart.assertClosed();binding.revalidate();
    const original=readRetainedCompleteWorker(worker);
    const closure=await binding.persistOriginalChildClosure(original.row,original.raw,{workerCompletion:worker});
    const joinedResult=binding.formatOriginalResult?binding.formatOriginalResult(original.row,closure):{...original.row.result,originalRestoreControllerClosure:{...original.row,closure}};
    const finalized=binding.finalizeOriginalFinancial?await binding.finalizeOriginalFinancial({workerCompletion:worker,row:original.row,raw:original.raw,closure,joinedResult}):joinedResult;
    const reference=original.row.result.privateQa.value.coherentQualification;
    const applicationRaw=await binding.captureOriginalApplication(reference,{workerCompletion:worker});
    const seed=await binding.buildOriginalSeed(applicationRaw,{workerCompletion:worker,counterpart:state.counterpart,finalized});binding.revalidate();
    await closeReaders();binding.revalidate();
    const completeCapture=captureOriginalCompleteBeforeCleanup({counterpart:state.counterpart,workerCompletion:worker,applicationRaw,applicationFile:reference.file,seed,
      evidenceDirectory:binding.evidenceDirectory,evidenceCustody:binding.evidenceCustody,
      workerSourceSha256:binding.workerSourceSha256,controllerSourceSha256:binding.controllerSourceSha256});
    binding.revalidate();
    return {...finalized,completeCapture};
  }catch(error){
    failed=true;primaryFault=error;
    // A failed/unknown probe still owes its actual reader and actor closure.
    // There is no timeout, PID adoption, synthetic ACK or cleanup shortcut.
    if(state.exchange)try{await state.exchange.closed();}catch(closureFault){if(closureFault!==error){primaryFault=new AggregateError([error,closureFault],'COMPLETE_EXCHANGE_CLOSURE_FAILED');throw primaryFault;}}
    throw error;
  }finally{try{await closeReaders();}catch(closureFault){if(failed&&closureFault!==primaryFault)throw new AggregateError([primaryFault,closureFault],'COMPLETE_ORIGINAL_READER_CLOSURE_FAILED');throw closureFault;}finally{workerInput?.fill(0);}}
}
