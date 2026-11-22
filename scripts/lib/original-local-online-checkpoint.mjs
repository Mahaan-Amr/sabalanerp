import {assertLocalDevSuspensionCurrent} from './local-dev-frontend-suspension.mjs';
/** One original Windows owner for the fixed native-host point qualification.
 * Parsed frames and files never mint completion outside this process table. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {assertOriginalPrivateBrowserRoundController,readOriginalLocalOnlineCapturePlan} from './application-native-role-coordinator.mjs';
import {assertOriginalLocalCheckpointCryptoExecutor,readOriginalLocalCheckpointCryptoCompletion} from './original-local-checkpoint-crypto.mjs';
import {collectNativeProcessOwnerElfArtifacts} from './native-process-owner-elf-artifacts.mjs';
import {originalBackendBaseCommands} from './production-backend-base-process.mjs';
import {backendBaseLocalGuards} from './production-backend-base-local-guard.mjs';
import {verifyOriginalPhysicalPointTransfer,verifyOriginalWalWindowRequest} from './original-protected-online-ssh.mjs';

const completed=new WeakMap(),completedOwners=new WeakMap(),points=new WeakMap(),windows=new WeakMap(),owners=new Set();
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const qualificationFile='D:/sabalanerp-online-qa/cpython-host-sysroot-998cce91d3d85250d54c330e42bd96df/qualification-r5.json';
const qualificationSha='234265c34dfb5514f2cc8357f4c770d91576e6da387997eec91854f800feb918';
const publicKeyFile='C:/Users/mahan/.ssh/CodexOnlineQualification/public.pem';
const publicKeySha='e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48';
const sourceNames=['local-dev-frontend-suspension.py','local-online-checkpoint-entry.py','local-online-checkpoint-driver.py','local-online-checkpoint-owner.py','online-local-host-runtime.py',
 'online-checkpoint-producer.py','continuous-online-wal-owner.py','capture-postgres-base.py','receive-postgres-wal.py','online-runtime-owner.py',
 'capture-coherent-components.py','online-checkpoint-coverage.py','recovery-versioned-files.py','online-checkpoint-inventory.py','coherent-versioned-file-cuts.py',
 'capture-coordination-history.py','native-versioned-file-sealer.py','recovery-file-generations.py','recovery-database-freeze.py','online-backend-boundary.py','online-inquiry-boundary.py','online-runtime-scope.py'];
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const bytes=value=>Buffer.from(JSON.stringify(canonical(value)));
const descriptor=raw=>({rawBase64:raw.toString('base64'),bytes:raw.length,sha256:sha(raw)});
const pin=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.birthtimeNs,s.mode,s.nlink].map(String).join(':');
function content(file,maximum=16*1024**2,allowEmpty=false){
 assert.equal(path.resolve(fs.realpathSync(file)),path.resolve(file));const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&(allowEmpty?before.size>=0n:before.size>0n)&&before.size<=BigInt(maximum));
  for(const key of ['ino','size','mtimeNs','ctimeNs','birthtimeNs'])assert.equal(before[key],named[key]);if(process.platform!=='win32')assert.equal(before.dev,named.dev);
  const raw=fs.readFileSync(fd);assert.equal(pin(before),pin(fs.fstatSync(fd,{bigint:true})));assert.equal(pin(named),pin(fs.lstatSync(file,{bigint:true})));return raw;
 }finally{fs.closeSync(fd);}
}
function ownedJson(value){const raw=Buffer.from(value.rawBase64,'base64');assert.equal(raw.toString('base64'),value.rawBase64);assert.equal(raw.length,value.bytes);assert.equal(sha(raw),value.sha256);return {raw,value:JSON.parse(raw)};}
function sourceState(row){assert.ok(row&&!row.owner.held,'ORIGINAL_LOCAL_ONLINE_SOURCE_REQUIRED');assert.ok(!row.owner.closed||row.owner.code===0,'ORIGINAL_LOCAL_ONLINE_SOURCE_CLOSED_UNKNOWN');return row;}
export function isOriginalLocalOnlinePhysicalPointSource(token){return points.has(token);}
export function isOriginalLocalOnlineWalWindowSource(token){return windows.has(token);}
export function readOriginalLocalOnlinePointWindowAcknowledgements(token){const row=sourceState(points.get(token));return [...row.owner.windowAcknowledgements];}
export async function readOriginalLocalOnlinePhysicalPointSource(token){const row=sourceState(points.get(token));await readOriginalLocalCheckpointCryptoCompletion(row.crypto);return structuredClone(row.value);}
export async function readOriginalLocalOnlineWalWindowSource(token){const row=sourceState(windows.get(token));await readOriginalLocalCheckpointCryptoCompletion(row.crypto);return structuredClone(row.value);}
export function readOriginalLocalOnlineCheckpointCompletion(token){const row=completed.get(token);assert.ok(row,'ORIGINAL_LOCAL_ONLINE_COMPLETION_REQUIRED');return structuredClone(row);}
export function readOriginalLocalOnlineIndependentCompletion(token){const row=completedOwners.get(token);assert.ok(row?.independent,'ORIGINAL_LOCAL_ONLINE_COMPLETION_REQUIRED');return row.independent;}
function runtimeInputs(q){
 const runtimeRoot=path.dirname(qualificationFile),extractionRaw=content(path.join(runtimeRoot,'receipt.json'));
 assert.equal(q.extractionReceiptSha256,'474dae1c2f13cbe81a8d3d28a8dcaae721d37bd7244790e99bff99dd37438487');assert.equal(sha(extractionRaw),q.extractionReceiptSha256);
 const extraction=JSON.parse(extractionRaw),sysroot=path.join(runtimeRoot,'sysroot'),runtimePins=new Map();
 assert.ok(extraction.inventory&&Object.keys(extraction.inventory.files).length>0);
 for(const [relative,wanted]of Object.entries(extraction.inventory.files)){
  assert.ok(relative.startsWith('/')&&!relative.split('/').includes('..'));const file=path.join(sysroot,relative.slice(1)),actual=content(file,64*1024**2,true);
  assert.equal(actual.length,wanted.bytes);assert.equal(sha(actual),wanted.sha256);runtimePins.set(file,wanted.sha256);
 }
 for(const key of ['loader','python']){assert.ok(typeof q.runtime[key]==='string'&&q.runtime[key].startsWith('/mnt/host/'));const relative=q.runtime[key].replace(/^\/mnt\/host\/([a-z])\//,(_,drive)=>drive.toUpperCase()+':/');
  assert.ok(runtimePins.has(relative.replaceAll('\\','/'))||[...runtimePins.keys()].some(file=>path.resolve(file)===path.resolve(relative)),'QUALIFIED_RUNTIME_EXECUTABLE_MISSING');}
 return {runtimeRevalidate(){assert.equal(sha(content(qualificationFile)),qualificationSha);assert.equal(sha(content(path.join(runtimeRoot,'receipt.json'))),q.extractionReceiptSha256);
  for(const [file,digest]of runtimePins)assert.equal(sha(content(file,64*1024**2,true)),digest);}};
}
/** Content inspection only, before the expensive local qualification starts. */
export function inspectOriginalLocalOnlineCheckpointInputs({nativeOwnerElfReceipt}){
 const sourcePins={};for(const relative of [...sourceNames.map(name=>'deploy/scripts/'+name),'tests/online-deployment/local-online-checkpoint-controller.worker.cjs','scripts/lib/local-dev-frontend-suspension.mjs','scripts/run-local-dev-frontend-suspension.mjs'])sourcePins[relative]=sha(content(path.join(repo,relative)));
 const elf=collectNativeProcessOwnerElfArtifacts({receiptFile:nativeOwnerElfReceipt,captureSource:relative=>content(path.join(repo,relative))});
 const qRaw=content(qualificationFile);assert.equal(sha(qRaw),qualificationSha);runtimeInputs(JSON.parse(qRaw));assert.equal(sha(content(publicKeyFile,4096)),publicKeySha);elf.revalidate();
 return {format:'sabalan-local-online-checkpoint-content-inspection/v1',sourcePins,nativeOwner:elf.proof,qualificationSha256:qualificationSha,productionAdmission:false};
}

export async function createOriginalLocalOnlineCheckpoint({capturePlan,coordinator,cryptoExecutor,independentOptions,nativeOwnerElfReceipt}){
 assert.equal(process.platform,'win32');assertOriginalPrivateBrowserRoundController(coordinator);assertOriginalLocalCheckpointCryptoExecutor(cryptoExecutor);
 assert.ok(independentOptions?.expected&&typeof nativeOwnerElfReceipt==='string','ORIGINAL_LOCAL_ONLINE_FIXED_INPUTS_REQUIRED');
 let currentIndependentOptions=independentOptions;
 const plan=readOriginalLocalOnlineCapturePlan(capturePlan),sourcePins={};
 const captureSource=relative=>{const raw=content(path.join(repo,relative));sourcePins[relative]=sha(raw);return raw;};
 for(const name of sourceNames)captureSource('deploy/scripts/'+name);captureSource('tests/online-deployment/local-online-checkpoint-controller.worker.cjs');
 const elf=collectNativeProcessOwnerElfArtifacts({receiptFile:nativeOwnerElfReceipt,captureSource:relative=>content(path.join(repo,relative))});
 const qRaw=content(qualificationFile);assert.equal(sha(qRaw),qualificationSha);const q=JSON.parse(qRaw);
 const {runtimeRevalidate}=runtimeInputs(q);
 const publicRaw=content(publicKeyFile,4096);assert.equal(sha(publicRaw),publicKeySha);
 assertLocalDevSuspensionCurrent(plan.localDevSuspension);for(const relative of ['scripts/lib/local-dev-frontend-suspension.mjs','scripts/run-local-dev-frontend-suspension.mjs'])captureSource(relative);
 const commands=originalBackendBaseCommands(),guard=backendBaseLocalGuards(commands,{localDevSuspension:plan.localDevSuspension});
 assert.deepEqual(await guard.protectedIdentities(),plan.originalServiceIdentities);
 const windowsProbe=await commands.run('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; ([string](Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID).Trim().ToLowerInvariant()"],{maximum:4096});commands.assertSuccessful(windowsProbe);
 const uuid=windowsProbe.stdout.trim().toLowerCase();assert.match(uuid,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);assert.ok(!/^[0-]*$/.test(uuid)&&!/^[f-]*$/.test(uuid));
 const sourceHostIdentity={scheme:'WINDOWS_HARDWARE_UUID_WITH_LINUX_GUARDIAN_BOOT',machineUuidSha256:sha(Buffer.from(uuid)),
  originalWindowsProbe:{pid:windowsProbe.originalPid,code:windowsProbe.code,signal:windowsProbe.signal,stdoutSha256:sha(Buffer.from(windowsProbe.stdout))}};
 const operation=randomBytes(16).toString('hex'),sourceRoot='/mnt/host/'+repo[0].toLowerCase()+'/'+repo.slice(3).replaceAll('\\','/');
 const entry=sourceRoot+'/deploy/scripts/local-online-checkpoint-entry.py';
 const bootstrap="import hashlib,runpy,sys;p=sys.argv[1];assert hashlib.sha256(open(p,'rb').read()).hexdigest()==sys.argv[2];sys.argv=[p];runpy.run_path(p,run_name='__main__')";
 const child=spawn('C:/Windows/System32/wsl.exe',['-d','docker-desktop','--exec',q.runtime.loader,'--library-path',q.runtime.libraryPath,q.runtime.python,'-I','-B','-c',bootstrap,entry,sourcePins['deploy/scripts/local-online-checkpoint-entry.py']],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 const state={child,closed:false,code:null,held:null,buffer:Buffer.alloc(0),pending:new Map(),sequence:0,rpc:new Set(),crypto:[],point:null,independent:null,guardian:null,windowAcknowledgements:[]};owners.add(state);
 const keeper=setInterval(()=>{},1000);let readyResolve,readyReject,closedResolve;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}),closed=new Promise(resolve=>{closedResolve=resolve;});
 const fail=error=>{state.held=error;readyReject(error);for(const wait of state.pending.values())wait.reject(error);state.pending.clear();};
 const send=value=>new Promise((resolve,reject)=>child.stdin.write(JSON.stringify(value)+'\n',error=>error?reject(error):resolve()));
 const checked=()=>{assertLocalDevSuspensionCurrent(plan.localDevSuspension);assert.equal(state.held,null);assert.ok(!state.closed);for(const [relative,digest]of Object.entries(sourcePins))assert.equal(sha(content(path.join(repo,relative))),digest);elf.revalidate();};
 let rpcTail=Promise.resolve();
 async function rpc(frame){
  checked();assert.match(frame.rpcId,/^[a-f0-9]{32}$/);assert.ok(!state.rpc.has(frame.rpcId));state.rpc.add(frame.rpcId);let result;
  if(frame.command==='SEAL_POINT'||frame.command==='SEAL_WAL'){
   const token=frame.command==='SEAL_POINT'?await cryptoExecutor.seal(frame.input):await cryptoExecutor.sealWal(frame.input);
   const facts=await readOriginalLocalCheckpointCryptoCompletion(token),raw=content(facts.receiptFile,64*1024**2);assert.equal(sha(raw),facts.receiptSha256);
   state.crypto.push({token,facts,kind:frame.command});result={...descriptor(raw),runtimeReceipt:facts.runtimeReceipt};
  }else if(frame.command==='VERIFY_WAL'){
   const input=frame.input;assert.equal(input.sourceRuntimeId,plan.grant.scope.runtimeId);const request=verifyOriginalWalWindowRequest(input.request),sealRaw=Buffer.from(input.sealRawBase64,'base64'),captureRaw=Buffer.from(input.captureRawBase64,'base64');
   const sealed=state.crypto.filter(row=>row.kind==='SEAL_WAL'&&row.facts.receiptSha256===sha(sealRaw));assert.equal(sealed.length,1);
   const facts=await readOriginalLocalCheckpointCryptoCompletion(sealed[0].token),seal=JSON.parse(sealRaw);assert.equal(seal.captureSha256,sha(captureRaw));
   assert.deepEqual(request.objects,seal.objects.map(row=>({name:row.name,bytes:row.encryptedBytes,sha256:row.encryptedSha256})));
   const files=request.objects.map(row=>{const matches=facts.hostObjects.filter(host=>host.cipherSha256===row.sha256&&host.cipherBytes===row.bytes);assert.equal(matches.length,1);return {name:row.name,file:matches[0].cipherFile,bytes:row.bytes,sha256:row.sha256};});
   const token=Object.freeze({});windows.set(token,{owner:state,crypto:sealed[0].token,value:{request,requestSha256:sha(bytes(request)),sourceOriginalPid:child.pid,sourceRuntimeId:plan.grant.scope.runtimeId,files,ownedOutputs:{seal:descriptor(sealRaw),closure:descriptor(captureRaw)}}});
   const api=await import('./independent-wal-window-ssh.mjs'),issuer=await import('../../deploy/scripts/online-qualification-origin-issuer.mjs');
   const guardian=state.guardianReady?await state.guardianReady:state.guardian;
   const completion=await api.runOriginalIndependentWalWindowVerification({...currentIndependentOptions,sourceWindow:token,independentGuardian:guardian});
   const certificate=await issuer.issueOriginalWalWindowVerification({sourceWindow:token,independentCompletion:completion}),envelope=issuer.readOriginalWalWindowCertificate(certificate);
   await api.acknowledgeOriginalIndependentWalWindowVerification(completion,envelope);state.windowAcknowledgements.push(completion);result=descriptor(bytes(envelope));
  }else throw Error('ORIGINAL_LOCAL_ONLINE_FIXED_RPC_REQUIRED');
  checked();await send({format:'sabalan-original-local-online-rpc-result/v1',rpcId:frame.rpcId,result});
 }
 child.stdout.on('data',chunk=>{try{state.buffer=Buffer.concat([state.buffer,chunk]);assert.ok(state.buffer.length<=64*1024**2);let at;
  while((at=state.buffer.indexOf(10))>=0){const frame=JSON.parse(state.buffer.subarray(0,at));state.buffer=state.buffer.subarray(at+1);assert.equal(frame.operation,operation);
   if(frame.event==='READY'){assert.deepEqual(frame.database,plan.database);for(const key of ['containerId','image','startedAt'])assert.equal(frame.backend[key],plan.backend[key]);
    assert.equal(frame.sourceHost.machineUuidSha256,sourceHostIdentity.machineUuidSha256);assert.match(frame.sourceHost.kernelBootIdSha256,/^[a-f0-9]{64}$/);state.ready=frame;readyResolve(frame);}
   else if(frame.event==='RPC'){rpcTail=rpcTail.then(()=>rpc(frame));rpcTail.catch(fail);}
   else if(frame.event==='COMMAND_COMPLETED'){const pending=state.pending.get(frame.sequence);assert.ok(pending&&pending.command===frame.command);state.pending.delete(frame.sequence);pending.resolve(frame.result);}
   else if(frame.event==='CLOSED'){state.closedResult=frame.result;}
   else throw Error('ORIGINAL_LOCAL_ONLINE_NATIVE_UNKNOWN');
  }
 }catch(error){fail(error);}});
 let stderrBytes=0;child.stderr.on('data',raw=>{stderrBytes+=raw.length;if(stderrBytes>65536)fail(Error('ORIGINAL_LOCAL_ONLINE_STDERR_BOUND'));});
 child.once('error',fail);child.stdin.on('error',fail);child.once('close',(code,signal)=>{state.closed=true;state.code=code;state.signal=signal;closedResolve({code,signal});if(!state.closing||code!==0||signal!==null||state.buffer.length)fail(Error('ORIGINAL_LOCAL_ONLINE_CLOSED_UNKNOWN'));});
 await send({format:'sabalan-original-local-online-checkpoint-entry/v1',operation,capturePlanData:plan,sourceRoot,sourcePins,
  runtimeQualification:{descriptor:{format:'sabalan-qualified-local-host-runtime/v1',root:'/var/lib/sabalan-online-host-6ab08f0c8a214a633d9b582b8fffe5d1',qualificationSha256:qualificationSha},qualificationSha256:qualificationSha},sourceHostIdentity,
  artifacts:[{name:'native-process-owner',rawBase64:elf.files['native-process-owner'].toString('base64'),sha256:elf.proof.elfSha256},{name:'qualification-public-key.pem',rawBase64:publicRaw.toString('base64'),sha256:publicKeySha}]});
 await ready;
 function call(command){checked();const sequence=++state.sequence;return new Promise((resolve,reject)=>{state.pending.set(sequence,{command,resolve,reject});void send({format:'sabalan-original-local-online-command/v1',sequence,command}).catch(fail);});}
 return Object.freeze({
  async point(){assert.equal(state.point,null);const value=await call('POINT');
   assert.deepEqual(value.sourceHost,state.ready.sourceHost);
   const producer=ownedJson(value.ownedOutputs.producer),manifest=ownedJson(value.ownedOutputs.plaintextManifest),sealed=ownedJson(value.ownedOutputs.sealedManifest);
   assert.deepEqual(value.producer,producer.value);
   const sealedRows=state.crypto.filter(row=>row.kind==='SEAL_POINT'&&row.facts.receiptSha256===sha(sealed.raw));assert.equal(sealedRows.length,1);const crypto=await readOriginalLocalCheckpointCryptoCompletion(sealedRows[0].token);
   const request={format:'sabalan-original-physical-point-transfer-request/v1',sequence:1,challenge:randomBytes(32).toString('hex'),runtimeId:plan.grant.scope.runtimeId,captureId:producer.value.captureId};
   const header={request,producerRawBase64:producer.raw.toString('base64'),plaintextManifestRawBase64:manifest.raw.toString('base64'),sealedManifestRawBase64:sealed.raw.toString('base64'),sourceHost:value.sourceHost,postgresUser:value.postgresUser};
   const verified=verifyOriginalPhysicalPointTransfer(header);const files=verified.objects.map(row=>{const hosts=crypto.hostObjects.filter(host=>host.cipherSha256===row.sha256&&host.cipherBytes===row.bytes);assert.equal(hosts.length,1);return {name:row.name,sourcePath:row.sourcePath,file:hosts[0].cipherFile,bytes:row.bytes,sha256:row.sha256};});
   const source=Object.freeze({});points.set(source,{owner:state,crypto:sealedRows[0].token,value:{...verified,sourceOriginalPid:child.pid,sourceRuntimeId:plan.grant.scope.runtimeId,files}});state.point={source,value};
   let guardianResolve;state.guardianReady=new Promise(resolve=>{guardianResolve=resolve;});
   const api=await import('./independent-full-restore-ssh.mjs'),transfer=await api.runOriginalIndependentPhysicalPointTransfer({sourcePoint:source,options:independentOptions});
   currentIndependentOptions={...independentOptions,expected:api.readOriginalIndependentPhysicalPointTransfer(transfer).expected};
   state.independent=await api.runOriginalIndependentPhysicalRestoreOverSsh({...currentIndependentOptions,pointTransfer:transfer,onOriginalGuardianReady:guardian=>{state.guardian=guardian;guardianResolve(guardian);}});
   return {format:'sabalan-original-local-online-point-qualification/v1',continuousWalQualified:false,finalIntervalCompletion:false,
    point:structuredClone(value),independent:api.readOriginalIndependentPhysicalRestoreSshCompletion(state.independent)};
  },
  async tick(){return call('TICK');},
  async finishPointOnlyQualification(){assert.ok(state.point&&state.independent);state.closing=true;const result=await call('FINISH_POINT_ONLY');child.stdin.end();
   await closed;await rpcTail;assert.equal(state.held,null);assert.deepEqual({code:state.code,signal:state.signal},{code:0,signal:null});assert.deepEqual(state.closedResult,result);
   assert.equal(result.pointOnly?.format,'sabalan-original-local-point-only-qualification-closed/v1');
   assert.equal(result.pointOnly.phase,'ABORTED');assert.equal(result.pointOnly.captureId,state.point.value.producer.captureId);
   for(const key of ['replicationAuthenticationRestored','allOriginalChildrenClosed'])assert.equal(result.pointOnly[key],true);
   for(const key of ['continuousWalQualified','finalIntervalCompletion','productionAdmission'])assert.equal(result.pointOnly[key],false);
   assert.equal(result.owner?.format,'sabalan-original-local-checkpoint-owner-closed/v1');assert.equal(result.owner.phase,'ABORTED');
   assert.equal(result.owner.allOriginalChildrenClosed,true);assert.equal(result.owner.productionAdmission,false);assert.ok(Number.isSafeInteger(result.owner.originalControllerPid)&&result.owner.originalControllerPid>0);
   runtimeRevalidate();for(const [relative,digest]of Object.entries(sourcePins))assert.equal(sha(content(path.join(repo,relative))),digest);elf.revalidate();
   assert.deepEqual(await guard.protectedIdentities(),plan.originalServiceIdentities);const commandClosure=await commands.close();
   const token=Object.freeze({});completed.set(token,{format:'sabalan-original-local-online-point-completion/v1',operation,productionAdmission:false,continuousWalQualified:false,finalIntervalCompletion:false,
    originalControllers:[{originalPid:child.pid,code:0,signal:null}],point:state.point.value,result,originalNamespaceClosure:state.closedResult,commandClosure,sourcePins,sourceHostIdentity,
    independent:(await import('./independent-full-restore-ssh.mjs')).readOriginalIndependentPhysicalRestoreSshCompletion(state.independent)});
   completedOwners.set(token,state);
   clearInterval(keeper);owners.delete(state);return token;
  }
 });
}
