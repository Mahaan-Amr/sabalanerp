/** Pure, exact source integration for the already reviewed original recipes.
 * Packaging supplies fresh source-owned graph literals afterward; this module
 * neither executes recipes nor supplies runtime identities or credentials. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=source=>createHash('sha256').update(source).digest('hex');
const once=(source,before,after)=>{assert.equal(source.split(before).length-1,1,'COMPLETE_SOURCE_SEAM_CHANGED');return source.replace(before,after);};
export function renderOriginalCompleteOwner(source){
  assert.equal(sha(source),'f569bec3a36efa5caec5c69c84e4d21e00aae5eb4eae5b713b617e4821a008a2','COMPLETE_REVIEWED_OWNER_SOURCE_REQUIRED');
  source=once(source,"    # Failed FULL never enters retirement; all incident evidence stays held.",
    `    # Capture is already durable after the actual worker closed, before any cleanup.
    complete_capture=value['completeCapture'];capture_file=pathlib.Path(complete_capture['file'])
    assert capture_file.is_absolute() and capture_file.resolve(strict=True)==capture_file and capture_file.is_relative_to(self.directory)
    capture=read(complete_capture)
    assert capture['format']=='sabalan-original-complete-capture/v1' and capture['workerClosedBeforeCapture'] is True and capture['cleanupStarted'] is False and capture['productionAdmission'] is False
    assert capture['request']['operation']==operation and capture['request']['sourceCommit']==qualification['binding']['sourceCommit']
    import datetime
    cleanup_started=datetime.datetime.now(datetime.timezone.utc).isoformat()
    assert datetime.datetime.fromisoformat(capture['capturedAt'].replace('Z','+00:00'))<=datetime.datetime.fromisoformat(cleanup_started)
    # Failed FULL never enters retirement; all incident evidence stays held.`);
  return once(source,"'children':list(self.children),'strictCompleteValidationSucceeded':True",
    "'operation':operation,'completeCapture':complete_capture,'cleanupStartedAt':cleanup_started,'children':list(self.children),'strictCompleteValidationSucceeded':True");
}
export function renderOriginalCompleteWorker(source){
  assert.equal(sha(source),'dd1ae285435a41a0a75c1e0ee35447d9629109d2547c1e4f180d64fe9878ff55','COMPLETE_REVIEWED_WORKER_SOURCE_REQUIRED');
  source=once(source,'return Object.freeze({async readInitial(){assert.equal(session,undefined);',
    'return Object.freeze({originalSession(){assert.match(session,/^[a-f0-9]{64}$/);return session;},\n  async readInitial(){assert.equal(session,undefined);');
  source=once(source," assert.equal(typeof runtime.withRestoredQaPrivateControlQualification,'function');assert.equal(typeof qaWork,'function');let privateWork;",
    " assert.equal(typeof runtime.withRestoredQaPrivateControlQualification,'function');assert.ok(qaWork&&qaWork.sourceOwned&&typeof qaWork.prepare==='function'&&typeof qaWork.exchange==='function');let privateWork;");
  return once(source,'  privateWork=await runtime.withRestoredQaPrivateControlQualification(proof,input.intendedOwner,input.targetCommit,input.migrationFiles,qaWork);',
    "  const {qualifyOriginalCompleteCallback}=await import('./restored-qa/complete-callback.mjs');\n  privateWork=await qualifyOriginalCompleteCallback({proof,intendedOwner:input.intendedOwner,files:input.migrationFiles,sourceOwned:{...qaWork.sourceOwned,hrSession:channel.originalSession()},prepare:qaWork.prepare,exchange:qaWork.exchange,onHeld:qaWork.onHeld});");
}
export function renderOriginalCompleteController(source){
  assert.equal(sha(source),'813d251a21413e057c0b33d74f23a3058c2a17aa5e0f1979eee07c5f3061dc02','COMPLETE_REVIEWED_CONTROLLER_SOURCE_REQUIRED');
  source=once(source,"import {spawn} from 'node:child_process';","import {runOriginalCompleteController} from './original-complete-controller.mjs';");
  const start=source.indexOf(' const child=spawn('),end=source.indexOf('\n}\n/** Data formatting only:',start);
  assert.ok(start>0&&end>start);
  return source.slice(0,start)+` try{return await runOriginalCompleteController({
   ...b.complete,authenticate:()=>b.authenticate(),session,command:{executable:b.executable,argv:b.argv,environment:b.environment},
   issueOriginalHistoricalCertificate:async(request,live)=>{
    const token=Object.freeze({});const s={active:true,consumed:false,request,authority:b.authorityForOriginalCallback(request),live};requests.set(token,s);
    try{return await issueOriginalRestoredQaHrCertificate(token);}finally{s.active=false;requests.delete(token);}
   }
 },initial);}finally{initial.fill(0);for(const raw of secret)raw.fill(0);}`+source.slice(end);
}
