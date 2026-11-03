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
  await binding.authenticate();
  const workerInput=originalCompleteWorkerInput(initial,binding.session);
  /** @type {{counterpart?:ReturnType<typeof createOriginalCompleteWindowsCounterpart>,exchange?:{closed():Promise<void>},observation?:object}} */
  const state={};
  try{
    const worker=await retainOriginalCompleteWorker({command:binding.command,session:binding.session,initial:workerInput,
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
    const reference=original.row.result.privateQa.value.coherentQualification;
    const applicationRaw=await binding.captureOriginalApplication(reference);
    const seed=await binding.buildOriginalSeed(applicationRaw);binding.revalidate();
    const completeCapture=captureOriginalCompleteBeforeCleanup({counterpart:state.counterpart,workerCompletion:worker,applicationRaw,applicationFile:reference.file,seed,
      evidenceDirectory:binding.evidenceDirectory,evidenceCustody:binding.evidenceCustody,
      workerSourceSha256:binding.workerSourceSha256,controllerSourceSha256:binding.controllerSourceSha256});
    const closure=await binding.persistOriginalChildClosure(original.row,original.raw);
    binding.revalidate();
    return {...original.row.result,completeCapture,originalRestoreControllerClosure:{...original.row,closure}};
  }catch(error){
    // A failed/unknown probe still owes its actual reader and actor closure.
    // There is no timeout, PID adoption, synthetic ACK or cleanup shortcut.
    if(state.exchange)await state.exchange.closed();
    throw error;
  }finally{workerInput.fill(0);}
}
