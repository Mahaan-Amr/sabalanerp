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
  source=once(source,"local_command(binding,pins,initial)","local_command(binding,pins,initial,capture)");
  return once(source,"'children':list(self.children),'strictCompleteValidationSucceeded':True",
    "'operation':operation,'completeCapture':complete_capture,'cleanupStartedAt':cleanup_started,'children':list(self.children),'strictCompleteValidationSucceeded':True");
}
/** Explicit successor for a retained original coordinator issuer. The fresh
 * transfer passphrase comes only from its anonymous v2 owner frame, never from
 * a configuration/receipt. Existing crypto, key custody and cleanup stay intact. */
export function renderOriginalCompleteOwnerWithRetainedIssuer(source){
 source=renderOriginalCompleteOwner(source);
 source=once(source,'_FINAL_VALIDATED_INPUT=None','_FINAL_VALIDATED_INPUT=None\n_MASTER_TRANSPORT_PASSPHRASE=None');
 source=once(source,' def execute_complete_flow(self,binding,backup_password):',' def execute_complete_flow(self,binding,backup_password):\n  global _MASTER_TRANSPORT_PASSPHRASE');
 source=once(source,"  secret=bytearray(secrets.token_urlsafe(48).encode('ascii'))",
  "  assert isinstance(_MASTER_TRANSPORT_PASSPHRASE,str) and __import__('re').fullmatch(r'[A-Za-z0-9_-]{64}',_MASTER_TRANSPORT_PASSPHRASE)\n  secret=bytearray(_MASTER_TRANSPORT_PASSPHRASE.encode('ascii'));_MASTER_TRANSPORT_PASSPHRASE=None");
 source=once(source,'def read_master_private_credential(operation):','def read_master_private_credential(operation):\n global _MASTER_TRANSPORT_PASSPHRASE\n assert _MASTER_TRANSPORT_PASSPHRASE is None');
 source=once(source,"set(frame)=={'format','operation','credential'}","set(frame)=={'format','operation','credential','transportPassphrase'}");
 source=once(source,"frame['format']=='sabalan-r9-master-private-credential/v1'","frame['format']=='sabalan-r9-master-private-credential/v2'");
 source=once(source,"  credential=frame['credential']","  transport=frame['transportPassphrase'];assert isinstance(transport,str) and re.fullmatch(r'[A-Za-z0-9_-]{64}',transport)\n  credential=frame['credential']");
 source=once(source,'  frame.clear()\n  return credential','  _MASTER_TRANSPORT_PASSPHRASE=transport\n  frame.clear()\n  return credential');
 return once(source,'args=parser.parse_args();validate_bound_inputs(BOUND_SOURCE_INPUTS)',"args=parser.parse_args();assert args.master_private_credential_stdin=='yes';validate_bound_inputs(BOUND_SOURCE_INPUTS)");
}
/** Material-stage owner has NO historical runtime plan. Only the later fixed
 * constructor may insert newly observed source-owned data in this one seam. */
export function renderOriginalCompleteUnboundOwner(source){
 source=renderOriginalCompleteOwnerWithRetainedIssuer(source);
 const bindings=[...source.matchAll(/^BOUND_SOURCE_INPUTS=([^\r\n]+)$/gm)];assert.equal(bindings.length,1,'COMPLETE_OWNER_LITERAL_BINDING_SEAM_CHANGED');
 assert.ok(bindings[0][1].startsWith('{'),'COMPLETE_REVIEWED_OWNER_LITERAL_REQUIRED');
 return source.replace(bindings[0][0],'BOUND_SOURCE_INPUTS=None');
}
export function renderOriginalCompleteWorker(source){
  assert.equal(sha(source),'dd1ae285435a41a0a75c1e0ee35447d9629109d2547c1e4f180d64fe9878ff55','COMPLETE_REVIEWED_WORKER_SOURCE_REQUIRED');
  source=once(source,'return Object.freeze({async readInitial(){assert.equal(session,undefined);',
    'return Object.freeze({originalSession(){assert.match(session,/^[a-f0-9]{64}$/);return session;},\n  async readInitial(){assert.equal(session,undefined);');
  source=once(source," assert.equal(typeof runtime.withRestoredQaPrivateControlQualification,'function');assert.equal(typeof qaWork,'function');let privateWork;",
    " assert.equal(typeof runtime.withRestoredQaPrivateControlQualification,'function');assert.ok(qaWork&&qaWork.sourceOwned&&typeof qaWork.prepare==='function'&&typeof qaWork.exchange==='function');let privateWork;");
  source=once(source,'qaWork=await binding.loadPinnedQaWork();','qaWork=await binding.loadPinnedQaWork({secret,session:channel.originalSession(),runtime});');
  source=once(source,' await performInteractiveStrictComplete(runtime,input,secret,channel,qaWork);',' let primary;try{await performInteractiveStrictComplete(runtime,input,secret,channel,qaWork);}catch(error){primary=error;throw error;}finally{try{await qaWork.close();}catch(closure){if(primary)throw new AggregateError([primary,closure],"ORIGINAL_COMPLETE_WORK_AND_CLOSURE_NEGATIVE");throw closure;}}');
  return once(source,'  privateWork=await runtime.withRestoredQaPrivateControlQualification(proof,input.intendedOwner,input.targetCommit,input.migrationFiles,qaWork);',
    "  const {qualifyOriginalCompleteCallback}=qaWork;assert.equal(typeof qualifyOriginalCompleteCallback,'function');\n  privateWork=await qualifyOriginalCompleteCallback({proof,intendedOwner:input.intendedOwner,files:input.migrationFiles,sourceOwned:{...qaWork.sourceOwned,hrSession:channel.originalSession()},prepare:qaWork.prepare,exchange:qaWork.exchange,onHeld:qaWork.onHeld});");
}
export function renderOriginalCompleteController(source){
  assert.equal(sha(source),'813d251a21413e057c0b33d74f23a3058c2a17aa5e0f1979eee07c5f3061dc02','COMPLETE_REVIEWED_CONTROLLER_SOURCE_REQUIRED');
  source=once(source,"import {spawn} from 'node:child_process';","import {runOriginalCompleteController} from './original-complete-controller.mjs';");
  const start=source.indexOf(' const child=spawn('),end=source.indexOf('\n}\n/** Data formatting only:',start);
  assert.ok(start>0&&end>start);
  return source.slice(0,start)+` try{return await runOriginalCompleteController({
   ...b.complete,authenticate:async()=>{await b.complete.bindOriginalInitial(secretFrame,{session});},session,command:{executable:b.executable,argv:b.argv,environment:b.environment},
   issueOriginalHistoricalCertificate:async(request,live)=>{
    const token=Object.freeze({});const s={active:true,consumed:false,request,authority:b.authorityForOriginalCallback(request),live};requests.set(token,s);
    try{return await issueOriginalRestoredQaHrCertificate(token);}finally{s.active=false;requests.delete(token);}
   }
 },initial);}finally{initial.fill(0);for(const raw of secret)raw.fill(0);}`+source.slice(end);
}

/** Compatible successor of the actually selected closed-financial controller.
 * Its private closed-ticket registry, full verifier/signing/persistence postlude
 * survive byte-for-byte except for the opaque SAME-worker closure assertion. */
export function renderOriginalCompleteClosedController(source){
 assert.equal(sha(source),'98c139b6986127abf39f2bd0fa5f943ff5d6adc7555653a2f1e6d136da53c44f','COMPLETE_REVIEWED_CLOSED_CONTROLLER_REQUIRED');
 source=once(source,"import {spawn} from 'node:child_process';","import {runOriginalCompleteController} from './original-complete-controller.mjs';\nimport {assertRetainedCompleteWorkerClosed} from './original-complete-counterpart.mjs';");
 const start=source.indexOf(' const child=spawn('),postludeStart=source.indexOf('  const result=formatOriginalHrResult(row,closure);closedOriginal(child,row);',start),end=source.indexOf('\n }finally{initial.fill(0);for(const raw of secret)raw.fill(0);}',postludeStart);
 assert.ok(start>0&&postludeStart>start&&end>postludeStart);
 let postlude=source.slice(postludeStart,end);postlude=once(postlude,'const result=formatOriginalHrResult(row,closure);','const result=joinedResult;');
 assert.equal(postlude.split('closedOriginal(child,row)').length-1,3);postlude=postlude.replaceAll('closedOriginal(child,row)','assertRetainedCompleteWorkerClosed(workerCompletion,row,raw)');
 return source.slice(0,start)+` try{return await runOriginalCompleteController({
   ...b.complete,authenticate:async()=>{await b.complete.bindOriginalInitial(secretFrame,{session});},session,
   command:{executable:b.executable,argv:b.argv,environment:b.environment},
   issueOriginalHistoricalCertificate:async(request,live)=>{
    const token=Object.freeze({});const s={active:true,consumed:false,request,authority:b.authorityForOriginalCallback(request),live};requests.set(token,s);
    try{return await issueOriginalRestoredQaHrCertificate(token);}finally{s.active=false;requests.delete(token);}
   },
   observeOriginalRaw:b.observeOriginalRaw,persistOriginalChildClosure:b.persistOriginalChildClosure,
   formatOriginalResult:formatOriginalHrResult,
   finalizeOriginalFinancial:async({workerCompletion,row,raw,closure,joinedResult})=>{
${postlude}
   },
 },initial);`+source.slice(end);
}
