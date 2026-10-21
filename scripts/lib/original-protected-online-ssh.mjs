/** Fixed native OpenSSH transport owned by the same Windows qualification master.
 * Only frames read from this original SSH child can mint a protected request.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readOriginalQualificationPackage} from '../../deploy/scripts/online-qualification-origin-issuer.mjs';
import {originalOnlineEvidenceReader} from './original-online-evidence-reader.mjs';
import {ORIGINAL_ONLINE_PRODUCTION_GATE_NAMES} from '../../deploy/scripts/online-production-gates.mjs';

const PROFILE='D:/sabalanerp-online-qa/fixed-production-openssh-profile-20261020.json';
const PROFILE_SHA='71c591618aff78625652a341d3798bc231e9617f0c626c55c12c9a93a453e298';
const PREFIX='SABALAN_ORIGINAL_QUALIFICATION_REQUEST ';
const sessions=new WeakMap(),requests=new WeakMap(),walSources=new WeakMap(),terminalSources=new WeakMap(),pointSources=new WeakMap(),metadataSources=new WeakMap();
const onlineRequests=new WeakMap();
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const exact=(value,names)=>assert.deepEqual(Object.keys(value).sort(),[...names].sort());
const bindingKeys=['instanceId','servicePid','serviceBirth','serviceBootIdSha256','configurationSha256','launcherPid','launcherBirth','clientNonce'];
function validateClientBinding(value,format){
 exact(value,['format',...bindingKeys,...(format==='sabalan-original-client-detached/v1'?['mode','barrier','launcherCustody']:[])]);assert.equal(value.format,format);
 for(const key of ['instanceId','serviceBootIdSha256','configurationSha256','clientNonce'])assert.match(value[key],/^[a-f0-9]{64}$/);
 for(const key of ['servicePid','launcherPid'])assert.ok(Number.isSafeInteger(value[key])&&value[key]>1);
 for(const key of ['serviceBirth','launcherBirth'])assert.match(value[key],/^[0-9]+$/);
 return value;
}
function validateClientBarrier(state,value){
 exact(value,['format','mode','deploymentId','releaseId','phase','activeKey','targetCommit','publicationSha256','generation','gateReportSha256','requiredGateNames','checkpointSha256','terminalWal','originalController','originalLauncher','liveOriginals','closedOriginals','closedObservers','terminalObservation','releaseAdmissionGranted']);
 assert.equal(value.format,'sabalan-original-client-terminal-barrier/v1');assert.equal(value.mode,state.finishing);assert.equal(value.phase,'COMPLETED');assert.equal(value.activeKey,null);assert.equal(value.releaseAdmissionGranted,false);
 for(const key of ['publicationSha256','gateReportSha256','checkpointSha256'])assert.match(value[key],/^[a-f0-9]{64}$/);assert.match(value.targetCommit,/^[a-f0-9]{40}$/);assert.ok(Number.isSafeInteger(value.generation)&&value.generation>=0);
 assert.equal(JSON.stringify(value.requiredGateNames),JSON.stringify(ORIGINAL_ONLINE_PRODUCTION_GATE_NAMES));
 assert.ok(Array.isArray(value.liveOriginals)&&value.liveOriginals.length>0&&Array.isArray(value.closedOriginals)&&Array.isArray(value.closedObservers));
 exact(value.originalController,['pid','birth']);assert.ok(Number.isSafeInteger(value.originalController.pid)&&value.originalController.pid>1);assert.match(value.originalController.birth,/^[0-9]+$/);
 exact(value.originalLauncher,['pid','stat']);assert.equal(value.originalLauncher.pid,state.bound.launcherPid);assert.equal(value.originalLauncher.stat,state.bound.launcherBirth);
 const request=value.mode==='BOOTSTRAP'?requests.get(state.request)?.body:onlineRequests.get(state.onlineRequest)?.body;assert.ok(request,'ORIGINAL_CLIENT_TERMINAL_REQUEST_REQUIRED');
 for(const key of ['deploymentId','releaseId','targetCommit'])assert.equal(value[key],request[key]);
 assert.equal(value.generation,value.mode==='BOOTSTRAP'?1:request.generation);
 assert.equal(value.checkpointSha256,sha(Buffer.from(JSON.stringify(sort(request.checkpoint)))));
 for(const row of value.closedOriginals){exact(row,['runtimeId','originalPid','code','signal']);assert.match(row.runtimeId,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(row.originalPid)&&row.originalPid>1);assert.equal(row.code,0);assert.equal(row.signal,null);}
 for(const row of value.closedObservers){exact(row,['pid','code','signal']);assert.ok(Number.isSafeInteger(row.pid)&&row.pid>1);assert.equal(row.code,0);assert.equal(row.signal,null);}
 const livePids=new Set();
 for(const row of value.liveOriginals){
  assert.ok(['http','jobs','inquiry','edge','frontend'].includes(row.kind));assert.match(row.containerId,/^[a-f0-9]{64}$/);
  if(row.kind==='frontend'){exact(row,['kind','buildId','containerId','image','startedAt']);assert.equal(typeof row.buildId,'string');assert.ok(row.buildId.length>0);assert.match(row.image,/^sha256:[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(row.startedAt)));}
  else{exact(row,['kind','runtimeId','releaseId','originalPid','originalBirth','containerId']);assert.ok(Number.isSafeInteger(row.originalPid)&&row.originalPid>1&&!livePids.has(row.originalPid));livePids.add(row.originalPid);assert.match(row.originalBirth,/^[0-9]+$/);if(row.kind!=='edge'){assert.match(row.runtimeId,/^[a-f0-9]{64}$/);assert.match(row.releaseId,/^[A-Za-z0-9_-]{8,128}$/);}}
 }
 for(const kind of ['http','inquiry','frontend'])assert.ok(value.liveOriginals.some(row=>row.kind===kind));
 assert.equal(value.liveOriginals.filter(row=>row.kind==='edge').length,1);
 const jobs=value.liveOriginals.filter(row=>row.kind==='jobs');assert.equal(jobs.length,1);assert.equal(jobs[0].releaseId,value.releaseId);
 exact(value.terminalObservation,['format','maintenanceAbsent','readOnly','endpoints']);assert.equal(value.terminalObservation.format,'sabalan-original-client-terminal-observation/v1');assert.equal(value.terminalObservation.maintenanceAbsent,true);assert.equal(value.terminalObservation.readOnly,true);
 assert.ok(Array.isArray(value.terminalObservation.endpoints));assert.equal(value.terminalObservation.endpoints.length,4);
 assert.equal(JSON.stringify(value.terminalObservation.endpoints.map(row=>row.name).sort()),JSON.stringify(['backend','frontend','inquiry','nginx']));
 for(const row of value.terminalObservation.endpoints){exact(row,['name','status','bodySha256']);assert.match(row.bodySha256,/^[a-f0-9]{64}$/);assert.ok(row.status===200||['frontend','inquiry'].includes(row.name)&&[301,302,303,307,308].includes(row.status));}
 if(value.mode==='BOOTSTRAP')assert.equal(value.terminalWal,null);
 else{exact(value.terminalWal,['auditSha256','certificateSha256','publicationSha256']);for(const digest of Object.values(value.terminalWal))assert.match(digest,/^[a-f0-9]{64}$/);assert.equal(value.terminalWal.publicationSha256,value.publicationSha256);assert.ok(state.terminal&&terminalSources.get(state.terminal)?.replied);}
 return value;
}
function trackClientCallback(state,callback,token,failure){
 assert.ok(!state.finishing,'ORIGINAL_CLIENT_CALLBACK_AFTER_FINISH');
 const task=Promise.resolve().then(()=>callback(token));state.tasks.add(task);
 task.then(()=>state.tasks.delete(task),()=>{state.tasks.delete(task);state.held=failure;});
}
function assertClientRepliesClosed(state,mode){
 assert.ok(!state.held&&!state.closed&&state.bound&&!state.stream&&state.buffer.length===0&&state.tasks.size===0&&!state.control,'ORIGINAL_CLIENT_WORK_PENDING');
 if(mode==='BOOTSTRAP')assert.ok((state.submitted||state.following)&&!state.following,'ORIGINAL_CLIENT_QUALIFICATION_NOT_SUBMITTED');
 else assert.ok(state.following&&state.onlineRequest&&onlineRequests.get(state.onlineRequest)?.replied&&state.terminal&&terminalSources.get(state.terminal)?.replied,'ORIGINAL_CLIENT_FOLLOWING_NOT_COMPLETED');
 for(const row of [state.pendingWal,state.pendingPoint,state.metadata])assert.ok(!row||row.replied,'ORIGINAL_CLIENT_REPLY_PENDING');
 if(state.terminal)assert.ok(terminalSources.get(state.terminal)?.replied,'ORIGINAL_CLIENT_TERMINAL_PENDING');
 if(state.onlineRequest)assert.ok(onlineRequests.get(state.onlineRequest)?.replied,'ORIGINAL_CLIENT_ONLINE_REPLY_PENDING');
}
function validateRequestProductionExecution(body){
 if(!Object.hasOwn(body,'productionExecutionBindings'))return;
 const bindings=body.productionExecutionBindings,roles=['backend','frontend','inquiry'];
 exact(bindings,roles);
 originalOnlineEvidenceReader().validateProductionExecutionBindings(bindings,{releaseId:body.releaseId,
  imageGraphs:Object.fromEntries(roles.map(role=>[role,bindings[role].graph])),
  deploymentTargetImages:Object.fromEntries(roles.map(role=>[role,bindings[role].graph.config])),
  sourceHost:{machineUuidSha256:body.checkpoint.sourceMachineUuidSha256,kernelBootIdSha256:body.checkpoint.sourceKernelBootIdSha256}});
}
function fixedFile(file,expected,maximum,expectedLinks=1n){
 assert.equal(path.resolve(file),path.resolve(fs.realpathSync(file)));
 const before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===expectedLinks&&before.size>0n&&before.size<=BigInt(maximum));
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
 try{
  const opened=fs.fstatSync(fd,{bigint:true});assert.ok(opened.isFile()&&opened.nlink===expectedLinks);
  for(const key of ['ino','size','mtimeNs','uid','gid','mode','nlink',...(process.platform==='win32'?[]:['dev','ctimeNs'])])assert.equal(opened[key],before[key]);
  const raw=fs.readFileSync(fd);assert.equal(sha(raw),expected);assert.equal(BigInt(raw.length),before.size);
  const after=fs.lstatSync(file,{bigint:true}),held=fs.fstatSync(fd,{bigint:true});
  for(const key of ['dev','ino','size','mtimeNs','ctimeNs','uid','gid','mode','nlink']){assert.equal(after[key],before[key]);assert.equal(held[key],opened[key]);}
  assert.equal(path.resolve(file),path.resolve(fs.realpathSync(file)));return raw;
 }finally{fs.closeSync(fd);}
}
export function readOriginalProtectedQualificationRequest(token){
 const record=requests.get(token);assert.ok(record&&!record.session.held&&!record.session.closed,'ORIGINAL_PROTECTED_REQUEST_REQUIRED');return structuredClone(record.body);
}
export function readOriginalOnlineQualificationRequest(token){const record=onlineRequests.get(token);assert.ok(record&&!record.session.held&&!record.session.closed&&!record.replied,'ORIGINAL_ONLINE_REQUEST_REQUIRED');return structuredClone(record.body);}
export function verifyOriginalOnlineQualificationRequest(body){
 exact(body,['format','sequence','deploymentId','releaseId','targetCommit','generation','database','checkpoint','roots','ephemeralRoots','liveCoverage',...(Object.hasOwn(body,'productionExecutionBindings')?['productionExecutionBindings']:[])]);
 assert.equal(body.format,'sabalan-original-online-qualification-request/v1');assert.equal(body.sequence,1);
 for(const field of ['deploymentId','releaseId'])assert.match(body[field],/^[A-Za-z0-9_-]{8,128}$/);assert.match(body.targetCommit,/^[a-f0-9]{40}$/);
 assert.ok(Number.isSafeInteger(body.generation)&&body.generation>=2);
 exact(body.database,['name','systemIdentifier','oid']);assert.match(body.database.name,/^[A-Za-z0-9_]{1,63}$/);
 for(const field of ['systemIdentifier','oid'])assert.match(body.database[field],/^[1-9][0-9]*$/);
 const point=body.checkpoint;assert.equal(point.captureMethod,'ONLINE_COHERENT_WAL');assert.equal(point.deploymentId,body.deploymentId);assert.equal(point.releaseId,body.releaseId);assert.equal(point.targetCommit,body.targetCommit);
 assert.deepEqual(point.sourceDatabase,body.database);assert.equal(point.continuousWalQualified,false);assert.equal(point.continuousWalCoveragePhase,'LIVE_ORIGINAL_OWNER');
 for(const field of ['localVerified','remoteVerified','restoreVerified','independentRestoreVerified','manifestReadable'])assert.equal(point[field],true);
 const live=body.liveCoverage;assert.equal(live.format,'sabalan-original-live-wal-coverage/v1');assert.equal(live.phase,'LIVE_ORIGINAL_OWNER');assert.equal(live.finalIntervalCompletion,false);
 assert.equal(live.captureId,point.repositoryDirectory.captureId);assert.deepEqual(live.sourceDatabase,body.database);
 assert.equal(body.roots.length,9);assert.equal(new Set(body.roots.map(row=>row.live)).size,9);assert.equal(new Set(body.roots.map(row=>row.store)).size,9);
 for(const row of body.roots){exact(row,['live','store','liveDevice','liveInode','storeDevice','storeInode','baselineSha256']);for(const key of ['live','store'])assert.ok(row[key].startsWith('/app/')&&path.posix.normalize(row[key])===row[key]);for(const key of ['liveDevice','liveInode','storeDevice','storeInode'])assert.match(row[key],/^[1-9][0-9]*$/);assert.match(row.baselineSha256,/^[a-f0-9]{64}$/);}
 assert.deepEqual([...body.ephemeralRoots].sort(),['/app/storage/reports','/app/storage/sales-reports','/app/storage/bi-reports'].sort());validateRequestProductionExecution(body);return body;
}
/** Pure frame validation is not an ownership minting API. */
export function verifyProtectedQualificationRequest(body){
 exact(body,['format','sequence','deploymentId','releaseId','targetCommit','database','checkpoint','roots','ephemeralRoots','adoptionSha256',...(Object.hasOwn(body,'productionExecutionBindings')?['productionExecutionBindings']:[])]);
 assert.equal(body.format,'sabalan-original-protected-qualification-request/v1');assert.equal(body.sequence,1);
 assert.match(body.deploymentId,/^[A-Za-z0-9_-]{8,128}$/);assert.match(body.releaseId,/^[A-Za-z0-9_-]{8,128}$/);assert.match(body.targetCommit,/^[a-f0-9]{40}$/);
 exact(body.database,['name','systemIdentifier','oid']);assert.match(body.database.name,/^[A-Za-z0-9_]{1,63}$/);
 for(const name of ['systemIdentifier','oid'])assert.match(body.database[name],/^[1-9][0-9]*$/);
 assert.equal(body.checkpoint.deploymentId,body.deploymentId);assert.equal(body.checkpoint.releaseId,body.releaseId);
 assert.equal(body.checkpoint.captureMethod,'PROTECTED_MAINTENANCE_COMPLETE');
 assert.equal(body.checkpoint.id,body.deploymentId);assert.equal(body.checkpoint.targetCommit,body.targetCommit);
 assert.deepEqual(body.checkpoint.sourceDatabase,body.database);
 assert.ok(Number.isSafeInteger(body.checkpoint.size)&&body.checkpoint.size>0);
 assert.ok(typeof body.checkpoint.createdAt==='string'&&Number.isFinite(Date.parse(body.checkpoint.createdAt)));
 for(const key of ['sourceMachineUuidSha256','sourceKernelBootIdSha256'])assert.match(body.checkpoint[key],/^[a-f0-9]{64}$/);
 assert.equal(body.checkpoint.compatibility?.local?.compatible,true);assert.equal(body.checkpoint.compatibility?.remote?.compatible,true);
 for(const name of ['localVerified','remoteVerified','restoreVerified','manifestReadable'])assert.equal(body.checkpoint[name],true);
 assert.match(body.checkpoint.checksum,/^[a-f0-9]{64}$/);assert.match(body.adoptionSha256,/^[a-f0-9]{64}$/);
 assert.equal(body.roots.length,9);assert.equal(new Set(body.roots.map(row=>row.live)).size,9);assert.equal(new Set(body.roots.map(row=>row.store)).size,9);
 for(const row of body.roots){exact(row,['live','store','liveDevice','liveInode','storeDevice','storeInode','baselineSha256']);
  for(const key of ['live','store'])assert.ok(row[key].startsWith('/app/')&&path.posix.normalize(row[key])===row[key]);
  for(const key of ['liveDevice','liveInode','storeDevice','storeInode'])assert.match(row[key],/^[1-9][0-9]*$/);assert.match(row.baselineSha256,/^[a-f0-9]{64}$/);
 }
 assert.deepEqual([...body.ephemeralRoots].sort(),['/app/storage/reports','/app/storage/sales-reports','/app/storage/bi-reports'].sort());
 validateRequestProductionExecution(body);return body;
}
export function verifyOriginalWalWindowRequest(r){
 exact(r,['format','sequence','challenge','deploymentId','releaseId','windowSha256','sourceIdentity','objects']);
 assert.equal(r.format,'sabalan-original-wal-window-verification-request/v1');assert.ok(Number.isSafeInteger(r.sequence)&&r.sequence>0);
 for(const key of ['challenge','windowSha256'])assert.match(r[key],/^[a-f0-9]{64}$/);
 for(const key of ['deploymentId','releaseId'])assert.match(r[key],/^[A-Za-z0-9_-]{8,128}$/);
 exact(r.sourceIdentity,['systemIdentifier','timeline']);assert.match(r.sourceIdentity.systemIdentifier,/^[1-9][0-9]*$/);
 assert.ok(Number.isSafeInteger(r.sourceIdentity.timeline)&&r.sourceIdentity.timeline>0&&r.sourceIdentity.timeline<=0xffffffff);
 assert.ok(Array.isArray(r.objects)&&r.objects.length>0&&r.objects.length<=16);let total=0;const names=new Set();
 for(const o of r.objects){exact(o,['name','bytes','sha256']);assert.match(o.name,/^[A-Za-z0-9_.-]{1,160}$/);assert.ok(!['.','..'].includes(o.name)&&!names.has(o.name));names.add(o.name);
  assert.ok(Number.isSafeInteger(o.bytes)&&o.bytes>0&&o.bytes<=64*1024*1024);total+=o.bytes;assert.match(o.sha256,/^[a-f0-9]{64}$/);}
 assert.ok(total<=256*1024*1024);return r;
}
export function verifyOriginalTerminalWalRequest(request){
 exact(request,['format','challenge','sequence','runtimeId','terminalRawBase64','terminalResultSha256','canonicalMetadataSha256','pointIndexSha256']);
 assert.equal(request.format,'sabalan-original-terminal-wal-publication-request/v1');assert.ok(Number.isSafeInteger(request.sequence)&&request.sequence>0);
 for(const key of ['challenge','runtimeId','terminalResultSha256','canonicalMetadataSha256','pointIndexSha256'])assert.match(request[key],/^[a-f0-9]{64}$/);
 const raw=Buffer.from(request.terminalRawBase64,'base64');assert.equal(raw.toString('base64'),request.terminalRawBase64);assert.ok(raw.length>0&&raw.length<=4*1024*1024);assert.equal(sha(raw),request.terminalResultSha256);
 const terminal=JSON.parse(raw);assert.equal(terminal.format,'sabalan-original-terminal-wal-coverage/v1');assert.equal(terminal.phase,'COMPLETE');
 assert.equal(terminal.ownedChildrenDomain,'continuous-wal-producer');assert.equal(terminal.allOriginalChildrenClosed,true);assert.equal(terminal.replicationAuthenticationRestored,true);assert.equal(terminal.finalIntervalCompletion,true);
 assert.match(terminal.captureId,/^[a-f0-9]{64}$/);assert.match(terminal.publicationSha256,/^[a-f0-9]{64}$/);assert.match(terminal.terminalEpochSha256,/^[a-f0-9]{64}$/);
 assert.ok(Array.isArray(terminal.windows)&&terminal.windows.length>0&&terminal.windows.length<=4096);const seen=new Set();
 for(const row of terminal.windows){for(const key of ['requestSha256','windowSha256','certificateSha256'])assert.match(row[key],/^[a-f0-9]{64}$/);assert.ok(!seen.has(row.requestSha256));seen.add(row.requestSha256);}
 return request;
}
export function readOriginalProtectedTerminalWalSource(token){
 const row=terminalSources.get(token);assert.ok(row&&!row.session.held&&!row.session.closed&&!row.replied,'ORIGINAL_TERMINAL_WAL_SOURCE_REQUIRED');
 return structuredClone({request:row.request,sourceOriginalPid:row.session.child.pid});
}
export function verifyOriginalPhysicalPointTransfer(header){
 exact(header,['request','producerRawBase64','plaintextManifestRawBase64','sealedManifestRawBase64','sourceHost','postgresUser']);const r=header.request;
 exact(header.sourceHost,['machineUuidSha256','kernelBootIdSha256']);for(const value of Object.values(header.sourceHost))assert.match(value,/^[a-f0-9]{64}$/);assert.match(header.postgresUser,/^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
 exact(r,['format','sequence','challenge','runtimeId','captureId']);assert.equal(r.format,'sabalan-original-physical-point-transfer-request/v1');assert.ok(Number.isSafeInteger(r.sequence)&&r.sequence>0);
 for(const key of ['challenge','runtimeId','captureId'])assert.match(r[key],/^[a-f0-9]{64}$/);
 const ownedOutputs={};for(const key of ['producer','plaintextManifest','sealedManifest']){const raw=Buffer.from(header[key+'RawBase64'],'base64');assert.equal(raw.toString('base64'),header[key+'RawBase64']);assert.ok(raw.length>0&&raw.length<=8*1024*1024);ownedOutputs[key]={rawBase64:header[key+'RawBase64'],bytes:raw.length,sha256:sha(raw)};}
 const producer=JSON.parse(Buffer.from(ownedOutputs.producer.rawBase64,'base64')),sealed=JSON.parse(Buffer.from(ownedOutputs.sealedManifest.rawBase64,'base64')),manifest=JSON.parse(Buffer.from(ownedOutputs.plaintextManifest.rawBase64,'base64'));
 assert.equal(producer.format,'sabalan-original-online-checkpoint-producer-result/v1');assert.equal(producer.captureId,r.captureId);assert.equal(manifest.operation,r.captureId);assert.equal(sealed.operation,r.captureId);assert.equal(producer.manifestSha256,ownedOutputs.plaintextManifest.sha256);
 assert.equal(sealed.format,'sabalan-online-checkpoint-components-sealed/v1');assert.equal(sealed.phase,'SEALED_LOCAL');assert.equal(sealed.manifestSha256,ownedOutputs.plaintextManifest.sha256);
 const native=JSON.parse(Buffer.from(producer.captureClosure.nativeRawBase64,'base64'));assert.equal(native.phase,'QUIESCENT');assert.equal(native.nativeStatus,0);assert.equal(native.nativeReaped,true);assert.equal(native.databaseQuiet,true);
 assert.equal(sha(Buffer.from(native.guardian.bootId.trim().toLowerCase())),header.sourceHost.kernelBootIdSha256);
 assert.ok(Array.isArray(sealed.objects)&&sealed.objects.length>=15&&sealed.objects.length<=8192);const names=new Set(),files=[];let total=0;
 for(const object of sealed.objects){assert.match(object.name,/^[A-Za-z0-9_.-]{1,160}$/);assert.ok(!['.','..'].includes(object.name)&&!names.has(object.name));names.add(object.name);
  assert.ok(typeof object.cipherFile==='string'&&object.cipherFile.startsWith('/')&&path.posix.normalize(object.cipherFile)===object.cipherFile);assert.ok(Number.isSafeInteger(object.cipherBytes)&&object.cipherBytes>0&&object.cipherBytes<=4*1024**3);assert.match(object.cipherSha256,/^[a-f0-9]{64}$/);total+=object.cipherBytes;assert.ok(total<=16*1024**3);
  files.push({name:object.name,sourcePath:object.cipherFile,bytes:object.cipherBytes,sha256:object.cipherSha256});}
 return {request:r,sourceHost:header.sourceHost,postgresUser:header.postgresUser,objects:files,ownedOutputs,sealedManifestSha256:ownedOutputs.sealedManifest.sha256,plaintextManifestSha256:ownedOutputs.plaintextManifest.sha256,cipherInventorySha256:sha(Buffer.from(JSON.stringify(sort(files.map(({name,bytes,sha256})=>({name,bytes,sha256}))))))};
}
export function readOriginalProtectedPhysicalPointSource(token){
 const row=pointSources.get(token);assert.ok(row&&!row.session.held&&!row.session.closed&&row.complete,'ORIGINAL_PHYSICAL_POINT_SOURCE_REQUIRED');
 for(const file of row.files){const before=fs.lstatSync(file.file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size===BigInt(file.bytes));const handle=fs.openSync(file.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const opened=fs.fstatSync(handle,{bigint:true});assert.ok(opened.isFile()&&opened.nlink===1n);for(const key of ['ino','size','mtimeNs','ctimeNs','birthtimeNs'])assert.equal(opened[key],before[key]);if(process.platform!=='win32')assert.equal(opened.dev,before.dev);
   const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(262144);let count;while((count=fs.readSync(handle,buffer))>0)hash.update(buffer.subarray(0,count));assert.equal(hash.digest('hex'),file.sha256);const after=fs.lstatSync(file.file,{bigint:true}),fdAfter=fs.fstatSync(handle,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs','birthtimeNs','nlink','mode']){assert.equal(after[key],before[key]);assert.equal(fdAfter[key],opened[key]);}
  }finally{fs.closeSync(handle);}}
 return structuredClone({request:row.request,sourceHost:row.sourceHost,postgresUser:row.postgresUser,sealedManifestSha256:row.sealedManifestSha256,plaintextManifestSha256:row.plaintextManifestSha256,cipherInventorySha256:row.cipherInventorySha256,ownedOutputs:row.ownedOutputs,files:row.files,sourceOriginalPid:row.session.child.pid,sourceRuntimeId:row.request.runtimeId});
}
export function readOriginalProtectedPointWindowAcknowledgements(token){const row=pointSources.get(token);assert.ok(row&&!row.session.held&&!row.session.closed);return row.session.windowAcknowledgements.filter(item=>item.runtimeId===row.request.runtimeId).map(item=>item.token);}
export async function retainOriginalProtectedWalWindowAcknowledgement(sourceWindow,token){
 const source=walSources.get(sourceWindow);assert.ok(source&&!source.session.held&&!source.session.closed);
 const {readOriginalIndependentWalWindowAcknowledgement}=await import('./independent-wal-window-ssh.mjs');
 const row=readOriginalIndependentWalWindowAcknowledgement(token);assert.equal(row.requestSha256,source.requestSha256);
 assert.equal(row.sourceOriginalPid,source.session.child.pid);assert.equal(row.sourceRuntimeId,source.sourceRuntimeId);
 assert.ok(!source.session.windowAcknowledgements.some(item=>item.token===token));source.session.windowAcknowledgements.push({token,runtimeId:source.sourceRuntimeId});
}
export async function sendOriginalProtectedPhysicalPointVerification(sessionToken,sourceToken,{physicalCertificate,repositoryCertificate,reportRawBase64}){
 const session=sessions.get(sessionToken),source=pointSources.get(sourceToken);assert.ok(session&&source?.session===session&&!source.replied&&!session.held&&!session.closed,'ORIGINAL_PHYSICAL_POINT_REPLY_REQUIRED');
 const {readOriginalPhysicalCheckpointVerification,readOriginalPhysicalRepositoryPromotion}=await import('../../deploy/scripts/online-qualification-origin-issuer.mjs');
 const physical=readOriginalPhysicalCheckpointVerification(physicalCertificate),repository=readOriginalPhysicalRepositoryPromotion(repositoryCertificate);
 for(const key of ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256'])assert.equal(physical.decision[key],source[key]);
 assert.equal(repository.decision.physicalCompletionSha256,physical.decision.originalCompletionSha256);assert.equal(repository.decision.repository.captureId,source.request.captureId);
 assert.equal(sha(Buffer.from(reportRawBase64,'base64')),physical.decision.reportSha256);source.replied=true;
 const response={format:'sabalan-original-physical-point-verification-response/v1',challenge:source.request.challenge,runtimeId:source.request.runtimeId,physicalCertificate:physical,repositoryPromotionCertificate:repository,reportRawBase64};
 await new Promise((resolve,reject)=>session.child.stdin.write(JSON.stringify(response)+'\n',error=>error?reject(error):resolve()));
}
export function readOriginalProtectedCheckpointMetadataSource(token){const row=metadataSources.get(token);assert.ok(row&&!row.session.held&&!row.session.closed&&!row.replied,'ORIGINAL_CHECKPOINT_METADATA_SOURCE_REQUIRED');return structuredClone(row.request);}
export async function sendOriginalProtectedCheckpointMetadataCertificate(sessionToken,sourceToken,certificateToken){
 const state=sessions.get(sessionToken),source=metadataSources.get(sourceToken);assert.ok(state&&source?.session===state&&!source.replied&&!state.held&&!state.closed,'ORIGINAL_CHECKPOINT_METADATA_REPLY_REQUIRED');
 const {readOriginalPhysicalCheckpointPublication}=await import('../../deploy/scripts/online-qualification-origin-issuer.mjs');const certificate=readOriginalPhysicalCheckpointPublication(certificateToken);
 assert.equal(certificate.decision.canonicalMetadataSha256,source.request.canonicalMetadataSha256);source.replied=true;
 await new Promise((resolve,reject)=>state.child.stdin.write(JSON.stringify(certificate)+'\n',error=>error?reject(error):resolve()));
}
export async function sendOriginalProtectedTerminalWalCertificate(sessionToken,sourceToken,certificateToken){
 const state=sessions.get(sessionToken),source=terminalSources.get(sourceToken);assert.ok(state&&source?.session===state&&!state.held&&!state.closed&&!source.replied,'ORIGINAL_TERMINAL_REPLY_REQUIRED');
 const {readOriginalTerminalWalCoverageCertificate}=await import('../../deploy/scripts/online-qualification-origin-issuer.mjs');const certificate=readOriginalTerminalWalCoverageCertificate(certificateToken);
 assert.equal(certificate.decision.terminalResultSha256,source.request.terminalResultSha256);assert.equal(certificate.decision.challenge,source.request.challenge);
 source.replied=true;await new Promise((resolve,reject)=>state.child.stdin.write(JSON.stringify(certificate)+'\n',error=>error?reject(error):resolve()));
}
export function readOriginalProtectedWalWindowSource(token){
 const row=walSources.get(token);assert.ok(row&&!row.session.held&&!row.session.closed&&!row.replied&&row.complete,'ORIGINAL_WAL_SOURCE_REQUIRED');
 for(const file of row.files){const fd=fs.openSync(file.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{
  const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.size===BigInt(file.bytes));const h=createHash('sha256'),buffer=Buffer.alloc(262144);let count;
  while((count=fs.readSync(fd,buffer))>0)h.update(buffer.subarray(0,count));assert.equal(h.digest('hex'),file.sha256);
  const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file.file,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(after[k],before[k]);
  for(const k of ['ino','size','mtimeNs','ctimeNs'])assert.equal(named[k],before[k]);if(process.platform!=='win32')assert.equal(named.dev,before.dev);
 }finally{fs.closeSync(fd);}}
 return structuredClone({request:row.request,requestSha256:row.requestSha256,sourceOriginalPid:row.session.child.pid,sourceRuntimeId:row.sourceRuntimeId,files:row.files,ownedOutputs:row.ownedOutputs});
}
export async function sendOriginalProtectedWalWindowCertificate(sessionToken,sourceToken,certificateToken){
 const session=sessions.get(sessionToken),source=walSources.get(sourceToken);
 assert.ok(session&&source?.session===session&&!source.replied&&!session.held&&!session.closed&&source.complete,'ORIGINAL_WAL_REPLY_CHANNEL_REQUIRED');
 const {readOriginalWalWindowCertificate}=await import('../../deploy/scripts/online-qualification-origin-issuer.mjs');
 const certificate=readOriginalWalWindowCertificate(certificateToken);
 assert.equal(certificate.decision.requestSha256,source.requestSha256);assert.equal(certificate.decision.challenge,source.request.challenge);
 source.replied=true;await new Promise((resolve,reject)=>session.child.stdin.write(JSON.stringify(certificate)+'\n',error=>error?reject(error):resolve()));
}
/** Starts ONLY the pinned original protected launcher. Calling this performs a
 * real protected install; preparation/import of this module performs no I/O. */
export function startOriginalProtectedOnlineInstall({launchPlan,serviceReference,onWalWindowRequest,onTerminalWalRequest,onPhysicalPointRequest,onCheckpointMetadataRequest,onOnlineQualificationRequest}){
 assert.equal(process.platform,'win32');
 const profile=JSON.parse(fixedFile(PROFILE,PROFILE_SHA,16384));
 assert.equal(profile.format,'sabalan-fixed-production-original-ssh/v1');assert.equal(profile.host,'94.182.85.254');assert.equal(profile.user,'root');assert.equal(profile.port,22);assert.equal(profile.repositoryRoot,'/opt/sabalanerp');
 assert.equal(path.resolve(profile.privateKeyPath),path.resolve('C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519'));assert.equal(path.resolve(profile.knownHostsPath),path.resolve('C:/Users/mahan/.ssh/known_hosts'));
 fixedFile(profile.sshExecutable,profile.sshExecutableSha256,8*1024*1024,2n);
 fixedFile(profile.privateKeyPath,profile.privateKeySha256,16384);
 const known=fixedFile(profile.knownHostsPath,profile.knownHostsSha256,1024*1024).toString();
 assert.ok(known.split(/\r?\n/).some(line=>{const fields=line.trim().split(/\s+/);return fields[1]==='ssh-ed25519'&&sha(Buffer.from(fields[2]??'','base64'))===profile.hostKeySha256;}));
 exact(launchPlan,['launcherPath','launcherSha256','configurationPath','configurationSha256']);
 assert.match(launchPlan.launcherPath,/^\/opt\/sabalanerp\/\.deploy-state\/online-host-pack-[a-f0-9]{32}\/deploy\/scripts\/online-release-launcher\.py$/);
 assert.match(launchPlan.configurationPath,/^\/opt\/sabalanerp\/\.deploy-state\/online-control-[a-f0-9]{32}\/launcher-config\.json$/);
 for(const key of ['launcherSha256','configurationSha256'])assert.match(launchPlan[key],/^[a-f0-9]{64}$/);
 if(serviceReference!==undefined){exact(serviceReference,['instanceId','servicePid','serviceBirth','configurationSha256']);assert.match(serviceReference.instanceId,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(serviceReference.servicePid)&&serviceReference.servicePid>1);assert.match(serviceReference.serviceBirth,/^[0-9]+$/);assert.equal(serviceReference.configurationSha256,launchPlan.configurationSha256);}
 const bootstrap=`import base64,hashlib,json,os,pathlib,stat
p=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(launchPlan)).toString('base64')}'))
assert os.getuid()==0
def immutable(file,expected,private=True):
 f=pathlib.Path(file);assert f.resolve()==f
 d=os.open(f,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(d);assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&(0o077 if private else 0o022) and 0<s.st_size<=8388608
  raw=b''
  while len(raw)<=s.st_size:
   part=os.read(d,min(262144,s.st_size+1-len(raw)))
   if not part:break
   raw+=part
  keys=['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_uid','st_gid','st_mode','st_nlink'];pin=lambda value:tuple(getattr(value,k) for k in keys)
  assert len(raw)==s.st_size and hashlib.sha256(raw).hexdigest()==expected and pin(s)==pin(os.fstat(d))==pin(os.lstat(f));return raw
 finally:os.close(d)
immutable(p['launcherPath'],p['launcherSha256'])
config=json.loads(immutable(p['configurationPath'],p['configurationSha256']))
root=pathlib.Path(p['launcherPath']).parents[2];receipt=json.loads(immutable(root/'host-pack-receipt.json',config['hostPackReceiptSha256'],False))
service=root/'deploy/scripts/online-owner-service.py';ref=receipt['outputs']['deploy/scripts/online-owner-service.py'];raw=immutable(service,ref['sha256'],False);assert len(raw)==ref['bytes']
reference=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(serviceReference??null)).toString('base64')}'))
args=['/usr/bin/python3','-I','-B',str(service),'--client' if reference else '--install-client',p['launcherPath'],p['launcherSha256'],p['configurationPath'],p['configurationSha256']]
args+=[] if reference is None else [json.dumps(reference,separators=(',',':'))]
os.execv('/usr/bin/python3',args)
`;
 const command="/usr/bin/python3 -I -B -c \"import base64;exec(compile(base64.b64decode('"+Buffer.from(bootstrap).toString('base64')+"'),'<fixed-original-online-launch>','exec'))\"";
 const child=spawn(profile.sshExecutable,['-T','-p','22','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','HostKeyAlgorithms=ssh-ed25519','-o','UserKnownHostsFile='+profile.knownHostsPath,'-i',profile.privateKeyPath,'root@94.182.85.254',command],
  {shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,SSH_AUTH_SOCK:''}});
 let resolveRequest;const request=new Promise(resolve=>{resolveRequest=resolve;});
 const state={child,held:null,closed:false,buffer:Buffer.alloc(0),bytes:0,request:null,submitted:false,walSequence:0,stream:null,pendingWal:null,onlineRequest:null,windowAcknowledgements:[],tasks:new Set(),following:serviceReference!==undefined,bound:null,finishing:null,detached:null,control:null,controlSequence:0};
 let resolveBound;state.binding=new Promise(resolve=>{resolveBound=resolve;});
 state.closure=new Promise(resolve=>{state.resolveClosure=resolve;});
 state.keeper=setInterval(()=>{},1000);
 child.stdout.on('data',chunk=>{try{
  state.buffer=Buffer.concat([state.buffer,chunk]);
  while(state.buffer.length){
   if(state.stream&&state.stream.index<state.stream.request.objects.length){
    const stream=state.stream,o=stream.request.objects[stream.index];
    if(stream.fd===null){stream.fd=fs.openSync(path.join(stream.root,o.name),'wx',0o600);stream.hash=createHash('sha256');stream.remaining=o.bytes;}
    const count=Math.min(stream.remaining,state.buffer.length),part=state.buffer.subarray(0,count);let offset=0;
    while(offset<count)offset+=fs.writeSync(stream.fd,part,offset,count-offset);
    stream.hash.update(part);stream.remaining-=count;state.buffer=state.buffer.subarray(count);
    if(!stream.remaining){fs.fsyncSync(stream.fd);assert.equal(stream.hash.digest('hex'),o.sha256);fs.closeSync(stream.fd);stream.fd=null;
     stream.files.push({...o,file:path.join(stream.root,o.name)});stream.index++;}
    continue;
   }
   const index=state.buffer.indexOf(10);if(index<0){assert.ok(state.buffer.length<=8*1024*1024);break;}
   const line=state.buffer.subarray(0,index).toString();state.buffer=state.buffer.subarray(index+1);state.bytes+=index+1;assert.ok(state.bytes<=16*1024*1024);
   if(line.startsWith('SABALAN_ORIGINAL_CLIENT_BOUND ')){
    assert.ok(!state.bound&&!state.request&&!state.stream&&!state.finishing);const value=validateClientBinding(JSON.parse(line.slice('SABALAN_ORIGINAL_CLIENT_BOUND '.length)),'sabalan-original-client-bound/v1');assert.equal(value.configurationSha256,launchPlan.configurationSha256);
    if(serviceReference)for(const key of Object.keys(serviceReference))assert.equal(value[key],serviceReference[key]);state.bound=Object.freeze(value);resolveBound(structuredClone(value));continue;
   }
   if(line.startsWith('SABALAN_ORIGINAL_CLIENT_DETACHED ')){
    assert.ok(state.finishing&&!state.detached&&state.tasks.size===0&&!state.stream&&!state.control);const value=validateClientBinding(JSON.parse(line.slice('SABALAN_ORIGINAL_CLIENT_DETACHED '.length)),'sabalan-original-client-detached/v1');
    for(const key of bindingKeys)assert.equal(value[key],state.bound[key]);assert.equal(value.mode,state.finishing);validateClientBarrier(state,value.barrier);
    exact(value.launcherCustody,['deployOriginalCode','pendingMasterReplies','checkpointProducerAbsent','continuousOwnerAbsent','checkpointContextAbsent','launcherPid','launcherBirth','configurationSha256']);
    for(const key of ['deployOriginalCode','pendingMasterReplies'])assert.equal(value.launcherCustody[key],0);
    for(const key of ['checkpointProducerAbsent','continuousOwnerAbsent','checkpointContextAbsent'])assert.equal(value.launcherCustody[key],true);
    for(const key of ['launcherPid','launcherBirth','configurationSha256'])assert.equal(value.launcherCustody[key],state.bound[key]);state.detached=Object.freeze(value);continue;
   }
   assert.ok(state.bound&&!state.detached,'ORIGINAL_CLIENT_BINDING_REQUIRED');
   if(line.startsWith('SABALAN_ORIGINAL_CLIENT_CONTROL_COMPLETED ')){
    const value=JSON.parse(line.slice('SABALAN_ORIGINAL_CLIENT_CONTROL_COMPLETED '.length));exact(value,['sequence','command','result']);assert.ok(state.control);assert.equal(value.sequence,state.control.sequence);assert.equal(value.command,state.control.command);assert.equal(value.result.status,'COMPLETED');assert.equal(value.result.command,value.command);const control=state.control;state.control=null;control.resolve(structuredClone(value.result));continue;
   }
   if(state.stream){
    const stream=state.stream,prefix=stream.kind==='physical-point'?'SABALAN_ORIGINAL_PHYSICAL_POINT_END ':'SABALAN_ORIGINAL_WAL_WINDOW_END ';assert.ok(line.startsWith(prefix));const end=JSON.parse(line.slice(prefix.length));
    assert.equal(end.challenge,stream.request.challenge);assert.equal(end.requestSha256,stream.requestSha256);
    stream.complete=true;const token=Object.freeze({});state.stream=null;
    if(stream.kind==='physical-point'){pointSources.set(token,stream);state.pendingPoint=stream;assert.equal(typeof onPhysicalPointRequest,'function');trackClientCallback(state,onPhysicalPointRequest,token,'ORIGINAL_PHYSICAL_POINT_UNPROVEN');}
    else{walSources.set(token,stream);state.pendingWal=stream;assert.equal(typeof onWalWindowRequest,'function');trackClientCallback(state,onWalWindowRequest,token,'ORIGINAL_WAL_VERIFICATION_UNPROVEN');}
   }else if(line.startsWith('SABALAN_ORIGINAL_PHYSICAL_POINT_REQUEST ')){
    assert.ok((state.submitted||state.following)&&(!state.pendingPoint||state.pendingPoint.replied));const point=verifyOriginalPhysicalPointTransfer(JSON.parse(line.slice('SABALAN_ORIGINAL_PHYSICAL_POINT_REQUEST '.length)));
    const root='D:/sabalanerp-online-qa/original-point-source-'+randomBytes(16).toString('hex');const available=fs.statfsSync('D:/sabalanerp-online-qa',{bigint:true});assert.ok(available.bavail*available.bsize>=BigInt(point.objects.reduce((sum,row)=>sum+row.bytes,0))+1024n**3n);fs.mkdirSync(root,{mode:0o700});
    state.stream={...point,request:{...point.request,objects:point.objects},session:state,kind:'physical-point',requestSha256:sha(Buffer.from(JSON.stringify(sort(point.request)))),root,index:0,fd:null,files:[],complete:false};
   }else if(line.startsWith('SABALAN_ORIGINAL_CHECKPOINT_METADATA_REQUEST ')){
    assert.ok(state.pendingPoint?.replied&&(!state.metadata||state.metadata.replied));const request=JSON.parse(line.slice('SABALAN_ORIGINAL_CHECKPOINT_METADATA_REQUEST '.length));
    exact(request,['format','runtimeId','canonicalMetadataRawBase64','canonicalMetadataSha256']);assert.equal(request.format,'sabalan-original-checkpoint-metadata-request/v1');assert.equal(request.runtimeId,state.pendingPoint.request.runtimeId);
    const raw=Buffer.from(request.canonicalMetadataRawBase64,'base64');assert.ok(raw.length>0&&raw.length<=8*1024*1024);assert.equal(raw.toString('base64'),request.canonicalMetadataRawBase64);assert.equal(sha(raw),request.canonicalMetadataSha256);
    const metadata=JSON.parse(raw);assert.equal(metadata.captureMethod,'ONLINE_COHERENT_WAL');assert.equal(metadata.repositoryDirectory.captureId,state.pendingPoint.request.captureId);
    for(const field of ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256'])assert.equal(metadata.physicalPoint[field],state.pendingPoint[field]);
    const token=Object.freeze({}),row={session:state,request,replied:false};metadataSources.set(token,row);state.metadata=row;
    assert.equal(typeof onCheckpointMetadataRequest,'function');trackClientCallback(state,onCheckpointMetadataRequest,token,'ORIGINAL_CHECKPOINT_METADATA_UNPROVEN');
   }else if(line.startsWith('SABALAN_ORIGINAL_TERMINAL_WAL_REQUEST ')){
    assert.ok((state.submitted||state.following)&&(!state.terminal||terminalSources.get(state.terminal)?.replied)&&(!state.pendingWal||state.pendingWal.replied));
    const body=verifyOriginalTerminalWalRequest(JSON.parse(line.slice('SABALAN_ORIGINAL_TERMINAL_WAL_REQUEST '.length))),token=Object.freeze({});
    terminalSources.set(token,{session:state,request:body,replied:false});state.terminal=token;
    assert.equal(typeof onTerminalWalRequest,'function');trackClientCallback(state,onTerminalWalRequest,token,'ORIGINAL_TERMINAL_WAL_PUBLICATION_UNPROVEN');
   }else if(line.startsWith('SABALAN_ORIGINAL_WAL_WINDOW_REQUEST ')){
    assert.ok((state.submitted||state.following)&&(!state.pendingWal||state.pendingWal.replied));const header=JSON.parse(line.slice(36));exact(header,['request','sourceRuntimeId','sealRawBase64','closureRawBase64']);assert.match(header.sourceRuntimeId,/^[a-f0-9]{64}$/);const r=verifyOriginalWalWindowRequest(header.request);
    const outputs={};for(const name of ['seal','closure']){const value=header[name+'RawBase64'];assert.equal(typeof value,'string');const raw=Buffer.from(value,'base64');assert.ok(raw.length>0&&raw.length<=1024*1024);assert.equal(raw.toString('base64'),value);outputs[name]={rawBase64:value,bytes:raw.length,sha256:sha(raw)};}
    const seal=JSON.parse(Buffer.from(outputs.seal.rawBase64,'base64'));assert.equal(outputs.seal.sha256,r.windowSha256);assert.equal(seal.captureSha256,outputs.closure.sha256);
    assert.deepEqual(seal.objects.map(o=>({name:o.name,bytes:o.encryptedBytes,sha256:o.encryptedSha256})),r.objects);
    assert.equal(r.sequence,++state.walSequence);const root='D:/sabalanerp-online-qa/original-wal-source-'+randomBytes(16).toString('hex');fs.mkdirSync(root,{mode:0o700});
    state.stream={session:state,request:r,sourceRuntimeId:header.sourceRuntimeId,requestSha256:sha(Buffer.from(JSON.stringify(sort(r)))),root,index:0,fd:null,files:[],ownedOutputs:outputs,complete:false,replied:false};
   }else{
    if(line.startsWith('SABALAN_ORIGINAL_ONLINE_QUALIFICATION_REQUEST ')){
     assert.ok((state.submitted||state.following)&&state.pendingPoint?.replied&&state.metadata?.replied&&(!state.onlineRequest||onlineRequests.get(state.onlineRequest).replied),'ORIGINAL_ONLINE_POINT_NOT_CLOSED');
     const body=verifyOriginalOnlineQualificationRequest(JSON.parse(line.slice('SABALAN_ORIGINAL_ONLINE_QUALIFICATION_REQUEST '.length)));
     assert.equal(body.checkpoint.repositoryDirectory.captureId,state.pendingPoint.request.captureId);
     assert.equal(sha(Buffer.from(JSON.stringify(sort(body.checkpoint)))),state.metadata.request.canonicalMetadataSha256);
     const token=Object.freeze({});onlineRequests.set(token,{session:state,body,replied:false});state.onlineRequest=token;
     assert.equal(typeof onOnlineQualificationRequest,'function');trackClientCallback(state,onOnlineQualificationRequest,token,'ORIGINAL_ONLINE_QUALIFICATION_UNPROVEN');continue;
    }
    assert.ok(line.startsWith(PREFIX)&&state.request===null,'ORIGINAL_PROTECTED_UNEXPECTED_OUTPUT');
    const body=verifyProtectedQualificationRequest(JSON.parse(line.slice(PREFIX.length))),token=Object.freeze({});
    requests.set(token,{session:state,body});state.request=token;resolveRequest(token);
   }
  }
 }catch{state.held='ORIGINAL_PROTECTED_PROTOCOL_UNPROVEN';}});
 let errorBytes=0;child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes>1024*1024)state.held='ORIGINAL_PROTECTED_STDERR_BOUND';});
 child.once('error',()=>{state.held='ORIGINAL_PROTECTED_SSH_UNKNOWN';});
 child.once('close',(code,signal)=>{state.closed=true;state.exit={code,signal};if(!state.detached||code!==0||signal!==null||state.buffer.length||state.stream||state.tasks.size||!child.stdout.readableEnded||!child.stderr.readableEnded)state.held='ORIGINAL_PROTECTED_CHANNEL_CLOSED_NOT_NATIVE_CLOSURE';state.resolveClosure();});
 const token=Object.freeze({});sessions.set(token,state);
 return Object.freeze({session:token,binding:state.binding,qualificationRequest:request,status:()=>({originalPid:child.pid,sshClosed:state.closed,held:state.held,qualificationSubmitted:state.submitted,productionAdmission:false})});
}
const clientControls=new Set(['ACQUIRE_NEXT','DRAIN_CURRENT_JOBS','READ_CYCLE_PLAN','RETIRE_EXPIRED_BUILDS','CREATE_CHECKPOINT','QUALIFY_NEXT','PREPARE_EXPANSION','RUN_EXPANSION','REGISTER','REGISTER_RETAINED','PROVISION_CARRIERS','START_EDGE','APPEND_EDGE_ENDPOINTS','STOP_EDGE','START_RUNTIME','WAIT_READY','PREPARE_DRAIN','WAIT_PREPARED','SHUTDOWN','WAIT_CLOSED','TRANSITION','PUBLISH','RUN_PRODUCTION_GATES','FINISH_CYCLE','PREPARE_INQUIRY','START_INQUIRY','STOP_INQUIRY']);
export async function sendOriginalProtectedClientControl(token,{command,input}){
 const state=sessions.get(token);assert.ok(state&&!state.held&&!state.closed&&!state.finishing&&!state.control,'ORIGINAL_CLIENT_CONTROL_UNAVAILABLE');await state.binding;
 assert.ok(!state.held&&!state.closed&&!state.finishing&&!state.control,'ORIGINAL_CLIENT_CONTROL_UNAVAILABLE');
 assert.ok(clientControls.has(command)&&input&&typeof input==='object'&&!Array.isArray(input));assert.ok(!Object.hasOwn(input,'sequence')&&!Object.hasOwn(input,'command'));
 const sequence=++state.controlSequence;let resolve;const completed=new Promise(done=>{resolve=done;});state.control={sequence,command,resolve};
 const raw=Buffer.from(JSON.stringify({format:'sabalan-original-client-control/v1',sequence,command,input})+'\n');assert.ok(raw.length<=8*1024*1024);
 await new Promise((done,reject)=>state.child.stdin.write(raw,error=>error?reject(error):done()));return completed;
}
export async function waitOriginalProtectedClientCallbacks(token){
 const state=sessions.get(token);assert.ok(state&&!state.held&&!state.closed,'ORIGINAL_CLIENT_CALLBACK_OWNER_REQUIRED');
 while(state.tasks.size){await Promise.allSettled([...state.tasks]);assert.ok(!state.held,'ORIGINAL_CLIENT_CALLBACK_FAILED');}
}
/** Only the actual original channel can supply a barrier and native closure.
 * A receipt is an observation; it never recreates a session capability. */
export async function finishOriginalProtectedClient(token,{mode}){
 const state=sessions.get(token);assert.ok(state&&!state.finishing,'ORIGINAL_CLIENT_FINISH_UNAVAILABLE');assert.ok(['BOOTSTRAP','FOLLOWING'].includes(mode));
 await state.binding;
 await waitOriginalProtectedClientCallbacks(token);
 assertClientRepliesClosed(state,mode);state.finishing=mode;
 await new Promise((resolve,reject)=>state.child.stdin.write(JSON.stringify({format:'sabalan-original-client-detach/v1',mode})+'\n',error=>error?reject(error):resolve()));
 await state.closure;assert.ok(!state.held&&state.detached&&state.closed,'ORIGINAL_CLIENT_DETACH_UNPROVEN');assert.deepEqual(state.exit,{code:0,signal:null});
 clearInterval(state.keeper);
 return structuredClone({format:'sabalan-original-client-closure/v1',detached:state.detached,originalSshPid:state.child.pid,exit:state.exit,stdoutEof:true,stderrEof:true,productionAdmission:false});
}
export async function sendOriginalOnlineQualificationPackage(sessionToken,requestToken,packageToken){
 const state=sessions.get(sessionToken),request=onlineRequests.get(requestToken),value=readOriginalQualificationPackage(packageToken);
 assert.ok(state&&request?.session===state&&!state.closed&&!state.held&&!request.replied&&state.onlineRequest===requestToken,'ORIGINAL_ONLINE_REPLY_CHANNEL_REQUIRED');
 assert.equal(value.releaseId,request.body.releaseId);assert.equal(value.checkpointSha256,sha(Buffer.from(JSON.stringify(sort(request.body.checkpoint)))));
 const reply={...value,format:'sabalan-original-online-qualification-response/v1',sequence:1,deploymentId:request.body.deploymentId,requestSha256:sha(Buffer.from(JSON.stringify(sort(request.body))))};
 await new Promise((resolve,reject)=>state.child.stdin.write(JSON.stringify(reply)+'\n',error=>error?reject(error):resolve()));request.replied=true;
}
export async function sendOriginalProtectedQualificationPackage(sessionToken,requestToken,packageToken){
 const state=sessions.get(sessionToken),request=requests.get(requestToken),value=readOriginalQualificationPackage(packageToken);
 assert.ok(state&&request?.session===state&&state.request===requestToken&&!state.held&&!state.closed&&!state.submitted,'ORIGINAL_PROTECTED_CHANNEL_REQUIRED');
 assert.equal(value.releaseId,request.body.releaseId);assert.equal(value.checkpointSha256,sha(Buffer.from(JSON.stringify(sort(request.body.checkpoint)))));
 assert.ok(Object.keys(value.files).length<=128);let bytes=0;
 for(const row of Object.values(value.files)){bytes+=row.bytes;assert.equal(sha(Buffer.from(row.rawBase64,'base64')),row.sha256);}assert.ok(bytes<=32*1024*1024);
 const raw=Buffer.from(JSON.stringify({...value,format:'sabalan-original-protected-qualification-response/v1',sequence:1,deploymentId:request.body.deploymentId})+'\n');
 state.submitted=true;await new Promise((resolve,reject)=>state.child.stdin.write(raw,error=>error?reject(error):resolve()));
}
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;}
