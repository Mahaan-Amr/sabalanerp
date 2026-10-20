/** Fixed native OpenSSH transport owned by the same Windows qualification master.
 * Only frames read from this original SSH child can mint a protected request.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {readOriginalQualificationPackage} from '../../deploy/scripts/online-qualification-origin-issuer.mjs';

const PROFILE='D:/sabalanerp-online-qa/fixed-production-openssh-profile-20261020.json';
const PROFILE_SHA='71c591618aff78625652a341d3798bc231e9617f0c626c55c12c9a93a453e298';
const PREFIX='SABALAN_ORIGINAL_QUALIFICATION_REQUEST ';
const sessions=new WeakMap(),requests=new WeakMap(),walSources=new WeakMap(),terminalSources=new WeakMap(),pointSources=new WeakMap(),metadataSources=new WeakMap();
const onlineRequests=new WeakMap();
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const exact=(value,names)=>assert.deepEqual(Object.keys(value).sort(),[...names].sort());
function fixedFile(file,expected,maximum){
 assert.equal(path.resolve(file),path.resolve(fs.realpathSync(file)));
 const before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(maximum));
 const raw=fs.readFileSync(file);assert.equal(sha(raw),expected);
 const after=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key]);
 return raw;
}
export function readOriginalProtectedQualificationRequest(token){
 const record=requests.get(token);assert.ok(record&&!record.session.held&&!record.session.closed,'ORIGINAL_PROTECTED_REQUEST_REQUIRED');return structuredClone(record.body);
}
export function readOriginalOnlineQualificationRequest(token){const record=onlineRequests.get(token);assert.ok(record&&!record.session.held&&!record.session.closed&&!record.replied,'ORIGINAL_ONLINE_REQUEST_REQUIRED');return structuredClone(record.body);}
export function verifyOriginalOnlineQualificationRequest(body){
 exact(body,['format','sequence','deploymentId','releaseId','targetCommit','generation','database','checkpoint','roots','ephemeralRoots','liveCoverage']);
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
 assert.deepEqual([...body.ephemeralRoots].sort(),['/app/storage/reports','/app/storage/sales-reports','/app/storage/bi-reports'].sort());return body;
}
/** Pure frame validation is not an ownership minting API. */
export function verifyProtectedQualificationRequest(body){
 exact(body,['format','sequence','deploymentId','releaseId','targetCommit','database','checkpoint','roots','ephemeralRoots','adoptionSha256']);
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
 return body;
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
export function startOriginalProtectedOnlineInstall({launchPlan,onWalWindowRequest,onTerminalWalRequest,onPhysicalPointRequest,onCheckpointMetadataRequest,onOnlineQualificationRequest}){
 assert.equal(process.platform,'win32');
 const profile=JSON.parse(fixedFile(PROFILE,PROFILE_SHA,16384));
 assert.equal(profile.format,'sabalan-fixed-production-original-ssh/v1');assert.equal(profile.host,'94.182.85.254');assert.equal(profile.user,'root');assert.equal(profile.port,22);assert.equal(profile.repositoryRoot,'/opt/sabalanerp');
 assert.equal(profile.privateKeyPath,'C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519');assert.equal(profile.knownHostsPath,'C:/Users/mahan/.ssh/known_hosts');
 fixedFile(profile.sshExecutable,profile.sshExecutableSha256,8*1024*1024);
 fixedFile(profile.privateKeyPath,profile.privateKeySha256,16384);
 const known=fixedFile(profile.knownHostsPath,profile.knownHostsSha256,1024*1024).toString();
 assert.ok(known.split(/\r?\n/).some(line=>{const fields=line.trim().split(/\s+/);return fields[1]==='ssh-ed25519'&&sha(Buffer.from(fields[2]??'','base64'))===profile.hostKeySha256;}));
 exact(launchPlan,['launcherPath','launcherSha256','configurationPath','configurationSha256']);
 assert.match(launchPlan.launcherPath,/^\/opt\/sabalanerp\/\.deploy-state\/online-host-pack-[a-f0-9]{32}\/deploy\/scripts\/online-release-launcher\.py$/);
 assert.match(launchPlan.configurationPath,/^\/opt\/sabalanerp\/\.deploy-state\/online-control-[a-f0-9]{32}\/launcher-config\.json$/);
 for(const key of ['launcherSha256','configurationSha256'])assert.match(launchPlan[key],/^[a-f0-9]{64}$/);
 const bootstrap=`import base64,hashlib,json,os,pathlib,stat\np=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(launchPlan)).toString('base64')}'))\nassert os.getuid()==0\nfor name in ['launcher','configuration']:\n f=pathlib.Path(p[name+'Path']);assert f.resolve()==f\n d=os.open(f,os.O_RDONLY|os.O_NOFOLLOW);s=os.fstat(d);raw=os.read(d,8388609);assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o077 and len(raw)==s.st_size<=8388608 and hashlib.sha256(raw).hexdigest()==p[name+'Sha256'] and tuple(getattr(s,k) for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_uid','st_mode','st_nlink'])==tuple(getattr(os.fstat(d),k) for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_uid','st_mode','st_nlink'])==tuple(getattr(os.lstat(f),k) for k in ['st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_uid','st_mode','st_nlink']);os.close(d)\nos.execv('/usr/bin/python3',['/usr/bin/python3','-I','-B',p['launcherPath'],p['configurationPath']])\n`;
 const command="/usr/bin/python3 -I -B -c \"import base64;exec(compile(base64.b64decode('"+Buffer.from(bootstrap).toString('base64')+"'),'<fixed-original-online-launch>','exec'))\"";
 const child=spawn(profile.sshExecutable,['-T','-p','22','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','ForwardAgent=no','-o','ClearAllForwardings=yes','-o','HostKeyAlgorithms=ssh-ed25519','-o','UserKnownHostsFile='+profile.knownHostsPath,'-i',profile.privateKeyPath,'root@94.182.85.254',command],
  {shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,SSH_AUTH_SOCK:''}});
 let resolveRequest;const request=new Promise(resolve=>{resolveRequest=resolve;});
 const state={child,held:null,closed:false,buffer:Buffer.alloc(0),bytes:0,request:null,submitted:false,walSequence:0,stream:null,pendingWal:null,onlineRequest:null,windowAcknowledgements:[]};
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
   if(state.stream){
    const stream=state.stream,prefix=stream.kind==='physical-point'?'SABALAN_ORIGINAL_PHYSICAL_POINT_END ':'SABALAN_ORIGINAL_WAL_WINDOW_END ';assert.ok(line.startsWith(prefix));const end=JSON.parse(line.slice(prefix.length));
    assert.equal(end.challenge,stream.request.challenge);assert.equal(end.requestSha256,stream.requestSha256);
    stream.complete=true;const token=Object.freeze({});state.stream=null;
    if(stream.kind==='physical-point'){pointSources.set(token,stream);state.pendingPoint=stream;assert.equal(typeof onPhysicalPointRequest,'function');Promise.resolve(onPhysicalPointRequest(token)).catch(()=>{state.held='ORIGINAL_PHYSICAL_POINT_UNPROVEN';});}
    else{walSources.set(token,stream);state.pendingWal=stream;assert.equal(typeof onWalWindowRequest,'function');Promise.resolve(onWalWindowRequest(token)).catch(()=>{state.held='ORIGINAL_WAL_VERIFICATION_UNPROVEN';});}
   }else if(line.startsWith('SABALAN_ORIGINAL_PHYSICAL_POINT_REQUEST ')){
    assert.ok(state.submitted&&(!state.pendingPoint||state.pendingPoint.replied));const point=verifyOriginalPhysicalPointTransfer(JSON.parse(line.slice('SABALAN_ORIGINAL_PHYSICAL_POINT_REQUEST '.length)));
    const root='D:/sabalanerp-online-qa/original-point-source-'+randomBytes(16).toString('hex');const available=fs.statfsSync('D:/sabalanerp-online-qa',{bigint:true});assert.ok(available.bavail*available.bsize>=BigInt(point.objects.reduce((sum,row)=>sum+row.bytes,0))+1024n**3n);fs.mkdirSync(root,{mode:0o700});
    state.stream={...point,request:{...point.request,objects:point.objects},session:state,kind:'physical-point',requestSha256:sha(Buffer.from(JSON.stringify(sort(point.request)))),root,index:0,fd:null,files:[],complete:false};
   }else if(line.startsWith('SABALAN_ORIGINAL_CHECKPOINT_METADATA_REQUEST ')){
    assert.ok(state.pendingPoint?.replied&&(!state.metadata||state.metadata.replied));const request=JSON.parse(line.slice('SABALAN_ORIGINAL_CHECKPOINT_METADATA_REQUEST '.length));
    exact(request,['format','runtimeId','canonicalMetadataRawBase64','canonicalMetadataSha256']);assert.equal(request.format,'sabalan-original-checkpoint-metadata-request/v1');assert.equal(request.runtimeId,state.pendingPoint.request.runtimeId);
    const raw=Buffer.from(request.canonicalMetadataRawBase64,'base64');assert.ok(raw.length>0&&raw.length<=8*1024*1024);assert.equal(raw.toString('base64'),request.canonicalMetadataRawBase64);assert.equal(sha(raw),request.canonicalMetadataSha256);
    const metadata=JSON.parse(raw);assert.equal(metadata.captureMethod,'ONLINE_COHERENT_WAL');assert.equal(metadata.repositoryDirectory.captureId,state.pendingPoint.request.captureId);
    for(const field of ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256'])assert.equal(metadata.physicalPoint[field],state.pendingPoint[field]);
    const token=Object.freeze({}),row={session:state,request,replied:false};metadataSources.set(token,row);state.metadata=row;
    assert.equal(typeof onCheckpointMetadataRequest,'function');Promise.resolve(onCheckpointMetadataRequest(token)).catch(()=>{state.held='ORIGINAL_CHECKPOINT_METADATA_UNPROVEN';});
   }else if(line.startsWith('SABALAN_ORIGINAL_TERMINAL_WAL_REQUEST ')){
    assert.ok(state.submitted&&(!state.terminal||terminalSources.get(state.terminal)?.replied)&&(!state.pendingWal||state.pendingWal.replied));
    const body=verifyOriginalTerminalWalRequest(JSON.parse(line.slice('SABALAN_ORIGINAL_TERMINAL_WAL_REQUEST '.length))),token=Object.freeze({});
    terminalSources.set(token,{session:state,request:body,replied:false});state.terminal=token;
    assert.equal(typeof onTerminalWalRequest,'function');Promise.resolve(onTerminalWalRequest(token)).catch(()=>{state.held='ORIGINAL_TERMINAL_WAL_PUBLICATION_UNPROVEN';});
   }else if(line.startsWith('SABALAN_ORIGINAL_WAL_WINDOW_REQUEST ')){
    assert.ok(state.submitted&&(!state.pendingWal||state.pendingWal.replied));const header=JSON.parse(line.slice(36));exact(header,['request','sourceRuntimeId','sealRawBase64','closureRawBase64']);assert.match(header.sourceRuntimeId,/^[a-f0-9]{64}$/);const r=verifyOriginalWalWindowRequest(header.request);
    const outputs={};for(const name of ['seal','closure']){const value=header[name+'RawBase64'];assert.equal(typeof value,'string');const raw=Buffer.from(value,'base64');assert.ok(raw.length>0&&raw.length<=1024*1024);assert.equal(raw.toString('base64'),value);outputs[name]={rawBase64:value,bytes:raw.length,sha256:sha(raw)};}
    const seal=JSON.parse(Buffer.from(outputs.seal.rawBase64,'base64'));assert.equal(outputs.seal.sha256,r.windowSha256);assert.equal(seal.captureSha256,outputs.closure.sha256);
    assert.deepEqual(seal.objects.map(o=>({name:o.name,bytes:o.encryptedBytes,sha256:o.encryptedSha256})),r.objects);
    assert.equal(r.sequence,++state.walSequence);const root='D:/sabalanerp-online-qa/original-wal-source-'+randomBytes(16).toString('hex');fs.mkdirSync(root,{mode:0o700});
    state.stream={session:state,request:r,sourceRuntimeId:header.sourceRuntimeId,requestSha256:sha(Buffer.from(JSON.stringify(sort(r)))),root,index:0,fd:null,files:[],ownedOutputs:outputs,complete:false,replied:false};
   }else{
    if(line.startsWith('SABALAN_ORIGINAL_ONLINE_QUALIFICATION_REQUEST ')){
     assert.ok(state.submitted&&state.pendingPoint?.replied&&state.metadata?.replied&&(!state.onlineRequest||onlineRequests.get(state.onlineRequest).replied),'ORIGINAL_ONLINE_POINT_NOT_CLOSED');
     const body=verifyOriginalOnlineQualificationRequest(JSON.parse(line.slice('SABALAN_ORIGINAL_ONLINE_QUALIFICATION_REQUEST '.length)));
     assert.equal(body.checkpoint.repositoryDirectory.captureId,state.pendingPoint.request.captureId);
     assert.equal(sha(Buffer.from(JSON.stringify(sort(body.checkpoint)))),state.metadata.request.canonicalMetadataSha256);
     const token=Object.freeze({});onlineRequests.set(token,{session:state,body,replied:false});state.onlineRequest=token;
     assert.equal(typeof onOnlineQualificationRequest,'function');Promise.resolve(onOnlineQualificationRequest(token)).catch(error=>{state.held=error;});continue;
    }
    assert.ok(line.startsWith(PREFIX)&&state.request===null,'ORIGINAL_PROTECTED_UNEXPECTED_OUTPUT');
    const body=verifyProtectedQualificationRequest(JSON.parse(line.slice(PREFIX.length))),token=Object.freeze({});
    requests.set(token,{session:state,body});state.request=token;resolveRequest(token);
   }
  }
 }catch{state.held='ORIGINAL_PROTECTED_PROTOCOL_UNPROVEN';}});
 let errorBytes=0;child.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes>1024*1024)state.held='ORIGINAL_PROTECTED_STDERR_BOUND';});
 child.once('error',()=>{state.held='ORIGINAL_PROTECTED_SSH_UNKNOWN';});
 child.once('close',(code,signal)=>{state.closed=true;state.exit={code,signal};state.held='ORIGINAL_PROTECTED_CHANNEL_CLOSED_NOT_NATIVE_CLOSURE';});
 const token=Object.freeze({});sessions.set(token,state);
 return Object.freeze({session:token,qualificationRequest:request,status:()=>({originalPid:child.pid,sshClosed:state.closed,held:state.held,qualificationSubmitted:state.submitted,productionAdmission:false})});
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
