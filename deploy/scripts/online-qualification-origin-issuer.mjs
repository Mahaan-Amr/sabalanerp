/** Trusted Windows qualification issuer. Only original, same-process completion
 * tokens can reach its fixed ACL-protected key. Saved reports are not tokens. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {readOriginalRoleQualificationCompletion} from '../../scripts/lib/application-native-role-coordinator.mjs';
import {readOriginalIndependentRestoreSshCompletion} from '../../scripts/lib/independent-full-restore-ssh.mjs';
const assert=(value,code)=>{if(!value)throw Error(code);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const bytes=value=>Buffer.from(JSON.stringify(canonical(value))),sha=value=>createHash('sha256').update(value).digest('hex');
const pin=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.nlink].map(String).join(':');
const KEY=path.join(os.homedir(),'.ssh','CodexOnlineQualification','private.pem');
const observers=[];
const originalPackages=new WeakMap();
export function readOriginalQualificationPackage(token){
 const value=originalPackages.get(token);assert(value,'QUALIFICATION_ORIGINAL_PACKAGE_REQUIRED');return structuredClone(value);
}
async function assertProtectedKeyAcl(){
 assert(process.platform==='win32','QUALIFICATION_WINDOWS_ORIGINAL_ISSUER_REQUIRED');
 const script=`$ErrorActionPreference='Stop';$p=$env:SABALAN_QUALIFICATION_KEY;$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$allowed=@($me,'S-1-5-18','S-1-5-32-544');foreach($f in @(([System.IO.Path]::GetDirectoryName($p)),$p)){ $a=Get-Acl -LiteralPath $f;if(-not $a.AreAccessRulesProtected){throw 'QUALIFICATION_KEY_INHERITANCE'};foreach($r in $a.Access){$sid=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;if($r.AccessControlType -eq 'Allow' -and $allowed -notcontains $sid){throw 'QUALIFICATION_KEY_PRINCIPAL'}};$owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value;if($allowed -notcontains $owner){throw 'QUALIFICATION_KEY_OWNER'}};[Console]::Write('PROTECTED')`;
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{shell:false,stdio:['ignore','pipe','pipe'],windowsHide:true,env:{...process.env,SABALAN_QUALIFICATION_KEY:KEY}});
 const state={child,closed:false,count:0,out:[]};observers.push(state);
 child.stdout.on('data',data=>{state.count+=data.length;if(state.count<=8192)state.out.push(data);});child.stderr.on('data',data=>{state.count+=data.length;});
 const result=await new Promise(resolve=>{child.once('error',()=>{state.unknown=true;});child.once('close',(code,signal)=>{state.closed=true;resolve({code,signal});});});
 assert(result.code===0&&result.signal===null&&state.count<=8192&&Buffer.concat(state.out).toString()==='PROTECTED','QUALIFICATION_FIXED_KEY_ACL_UNPROVEN');
}
function hashes(value){
 if(Array.isArray(value))return value.map(row=>row.sha256);
 return Object.values(value??{}).map(row=>typeof row==='string'?row:row?.sha256);
}
/** No signing API accepts raw closure JSON or an arbitrary private-key path. */
export async function issueOriginalQualificationOrigin({localCompletion,independentCompletion,assemblyCompletion}){
 const local=readOriginalRoleQualificationCompletion(localCompletion);
 const {readOriginalOnlineEvidenceAssembly}=await import('../../scripts/lib/original-online-evidence-assembler.mjs');
 const assembly=readOriginalOnlineEvidenceAssembly(assemblyCompletion);
 const physical=typeof assembly.originalOnlineRequestSha256==='string';
 const independent=physical?(await import('../../scripts/lib/independent-full-restore-ssh.mjs')).readOriginalIndependentPhysicalRestoreSshCompletion(independentCompletion):readOriginalIndependentRestoreSshCompletion(independentCompletion);
 const completionHash=value=>sha(bytes(value));
 assert(assembly.originalLocalCompletionSha256===completionHash(local)&&assembly.originalIndependentCompletionSha256===completionHash(independent),
  'QUALIFICATION_ASSEMBLY_ORIGINAL_OWNERS_CHANGED');
 const {evidenceDirectory,manifestSha256,acceptanceSha256}=assembly;
 assert(local.originalControllers.every(row=>row.code===0&&row.signal===null)&&independent.originalControllers.every(row=>row.code===0&&row.signal===null),'QUALIFICATION_ORIGINAL_CONTROLLERS_NOT_CLOSED');
 const {originalOnlineEvidenceReader}=await import('../../scripts/lib/original-online-evidence-reader.mjs');
 const kernel=originalOnlineEvidenceReader();
 const accepted=kernel.readOnlineReleaseEvidence(evidenceDirectory,{manifestSha256,acceptanceSha256});accepted.revalidate();
 const qualifiedPoint=accepted.acceptance.qualification.qualificationCheckpoint;
 assert(!qualifiedPoint||accepted.acceptance.qualification.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE','QUALIFICATION_CHECKPOINT_MODE_CHANGED');
 if(physical){
  assert(accepted.acceptance.qualification.recoveryMode==='ONLINE_COHERENT_WAL'&&!qualifiedPoint
   &&independent.cipherInventorySha256===accepted.acceptance.qualification.checkpointArchiveChecksum
   &&JSON.stringify(canonical(independent.sourceDatabase))===JSON.stringify(canonical(accepted.acceptance.qualification.deploymentTargetDatabase)),
    'QUALIFICATION_ORIGINAL_PHYSICAL_POINT_CHANGED');
  const receipt=JSON.parse(fs.readFileSync(path.join(evidenceDirectory,accepted.acceptance.reports['coherent-independent-restore'].file),'utf8'));
  assert(receipt.proofs.length===1,'QUALIFICATION_ORIGINAL_PHYSICAL_PROOF_REQUIRED');
  const proof=JSON.parse(fs.readFileSync(path.join(evidenceDirectory,receipt.proofs[0].file),'utf8'));
  for(const name of ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256'])assert(proof.checkpointMetadata?.physicalPoint?.[name]===independent[name],'QUALIFICATION_ORIGINAL_PHYSICAL_GRAPH_CHANGED');
 }else assert(independent.checkpoint.metadataSha256===(qualifiedPoint?.metadataSha256??accepted.acceptance.checkpointSha256)
  &&independent.checkpoint.checksum===(qualifiedPoint?.metadata.checksum??accepted.acceptance.qualification.checkpointArchiveChecksum)
  &&independent.checkpoint.releaseId===(qualifiedPoint?.metadata.releaseId??accepted.manifest.releaseId),'QUALIFICATION_ORIGINAL_CHECKPOINT_CHANGED');
 assert(JSON.stringify(canonical(independent.images))===JSON.stringify(canonical(accepted.acceptance.qualification.deploymentTargetImages)),'QUALIFICATION_ORIGINAL_IMAGES_CHANGED');
 const execution=assembly.originalProductionExecution;
 assert(execution&&sha(Buffer.from(JSON.stringify(canonical(execution))))===assembly.originalProductionExecutionSha256,
  'QUALIFICATION_ORIGINAL_EXECUTION_SELECTION_CHANGED');
 assert(execution.releaseId===accepted.manifest.releaseId
  &&JSON.stringify(canonical(execution.bindings??null))===JSON.stringify(canonical(accepted.acceptance.qualification.productionExecutionBindings??null)),
  'QUALIFICATION_ORIGINAL_EXECUTION_BINDINGS_CHANGED');
 const executionImages=kernel.validateProductionExecutionBindings(execution.bindings??undefined,{releaseId:execution.releaseId,
  imageGraphs:independent.imageGraphs,deploymentTargetImages:independent.images,sourceHost:execution.sourceHost});
 assert(JSON.stringify(canonical(executionImages))===JSON.stringify(canonical(execution.executionImages))
  &&accepted.manifest.image===executionImages.backend,'QUALIFICATION_ORIGINAL_EXECUTION_IMAGE_CHANGED');
 const originals=[...local.nativeClosures,...independent.nativeClosures];
 for(const closure of accepted.nativeClosures)assert(originals.some(row=>row.runtimeId===closure.runtimeId&&row.nativeSha256===closure.nativeSha256
  &&row.workSha256===closure.workSha256&&row.activeClaimSha256===closure.activeClaimSha256),'QUALIFICATION_ORIGINAL_NATIVE_BYTES_NOT_OWNED');
 // Proof receipts must themselves be original controller outputs. Merely placing
 // summaries beside owned native bytes cannot acquire issuer authority.
 const outputHashes=new Set([...hashes(local.fileHashes),...hashes(independent.fileHashes),...hashes(assembly.files)]);
 for(const [file,descriptor]of Object.entries(assembly.files)){
  const raw=fs.readFileSync(path.join(evidenceDirectory,file));assert(raw.length===descriptor.bytes&&sha(raw)===descriptor.sha256
   &&raw.toString('base64')===descriptor.rawBase64,'QUALIFICATION_ORIGINAL_ASSEMBLY_CHANGED');
 }
 for(const descriptor of Object.values(accepted.acceptance.reports)){
  assert(outputHashes.has(descriptor.sha256),'QUALIFICATION_REPORT_NOT_ORIGINAL_OUTPUT');
  const report=JSON.parse(fs.readFileSync(path.join(evidenceDirectory,descriptor.file),'utf8'));
  for(const proof of report.proofs??[])assert(outputHashes.has(proof.sha256),'QUALIFICATION_PROOF_NOT_ORIGINAL_OUTPUT');
 }
 await assertProtectedKeyAcl();
 const before=fs.lstatSync(KEY,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=4096n&&fs.realpathSync(KEY)===KEY,'QUALIFICATION_FIXED_KEY_UNPROVEN');
 const rawKey=fs.readFileSync(KEY),key=createPrivateKey(rawKey);assert(key.asymmetricKeyType==='ed25519','QUALIFICATION_ED25519_REQUIRED');
 const decision={format:'sabalan-original-online-qualification/v1',releaseId:accepted.manifest.releaseId,manifestSha256,acceptanceSha256,
  checkpointSha256:accepted.acceptance.checkpointSha256,evidenceInventorySha256:sha(bytes(accepted.evidenceInventory)),nativeClosuresSha256:sha(bytes(accepted.nativeClosures)),
  origins:[['local-original',local],['independent-original',independent]].map(([kind,value])=>({kind,controllerSourceSha256:value.controllerSourceSha256,historySha256:value.historySha256,completionSha256:sha(bytes(value))})),issuedAt:new Date().toISOString()};
 assert(pin(before)===pin(fs.lstatSync(KEY,{bigint:true})),'QUALIFICATION_KEY_CHANGED');accepted.revalidate();
 const envelope={format:'sabalan-signed-online-qualification-origin/v1',decision,signature:sign(null,Buffer.concat([Buffer.from('sabalan-original-online-qualification/v1\n'),bytes(decision)]),key).toString('base64')};
 kernel.verifyOnlineQualificationOrigin(bytes(envelope),createPublicKey(key).export({format:'pem',type:'spki'}),accepted);
 const output=path.join(evidenceDirectory,'qualification-provenance.json'),fd=fs.openSync(output,'wx',0o400);
 try{fs.writeFileSync(fd,Buffer.concat([bytes(envelope),Buffer.from('\n')]));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 assert(observers.every(row=>row.closed&&!row.unknown),'QUALIFICATION_ORIGINAL_ACL_OBSERVER_UNKNOWN');
 const members=[...accepted.evidenceInventory,{file:'qualification-provenance.json',sha256:sha(fs.readFileSync(output))}];
 const files=Object.fromEntries(members.map(member=>{
  assert(/^[a-z0-9][a-z0-9_.-]{0,95}$/.test(member.file),'QUALIFICATION_PACKAGE_MEMBER_INVALID');
  const raw=fs.readFileSync(path.join(evidenceDirectory,member.file));assert(sha(raw)===member.sha256,'QUALIFICATION_PACKAGE_CHANGED');
  return[member.file,{bytes:raw.length,sha256:sha(raw),rawBase64:raw.toString('base64')}];
 }));
 accepted.revalidate();
 const packageToken=Object.freeze({});originalPackages.set(packageToken,Object.freeze({format:'sabalan-original-qualification-package/v1',
  releaseId:decision.releaseId,manifestSha256,acceptanceSha256,checkpointSha256:decision.checkpointSha256,files}));
 return Object.freeze({package:packageToken,file:output,sha256:sha(fs.readFileSync(output)),publicKey:createPublicKey(key).export({format:'pem',type:'spki'}),productionAdmission:false});
}

/** The independent replay owns an immutable physical point before production
 * metadata exists. This certificate grants no release or continuous-WAL claim. */
const originalPhysicalVerifications=new WeakMap();
export function readOriginalPhysicalCheckpointVerification(token){const value=originalPhysicalVerifications.get(token);assert(value,'ORIGINAL_PHYSICAL_VERIFICATION_REQUIRED');return structuredClone(value);}
export async function issueOriginalPhysicalCheckpointVerification({independentCompletion}){
 const {readOriginalIndependentPhysicalRestoreSshCompletion}=await import('../../scripts/lib/independent-full-restore-ssh.mjs');
 const original=readOriginalIndependentPhysicalRestoreSshCompletion(independentCompletion);
 assert(original.originalControllers.length>0&&original.originalControllers.every(row=>row.code===0&&row.signal===null),'PHYSICAL_ORIGINAL_REPLAY_NOT_CLOSED');
 for(const field of ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256'])assert(/^[a-f0-9]{64}$/.test(original[field]),'PHYSICAL_ORIGINAL_POINT_REQUIRED');
 const owned=original.ownedOutputs?.report;
 assert(owned&&Buffer.from(owned.rawBase64,'base64').length===owned.bytes&&sha(Buffer.from(owned.rawBase64,'base64'))===owned.sha256,'PHYSICAL_ORIGINAL_REPORT_REQUIRED');
 const report=JSON.parse(Buffer.from(owned.rawBase64,'base64'));
 assert(report.format==='sabalan-original-independent-online-physical-restore/v1'&&report.sealedManifestSha256===original.sealedManifestSha256
  &&report.plaintextManifestSha256===original.plaintextManifestSha256&&report.cipherInventorySha256===original.cipherInventorySha256
  &&sha(bytes(report.sourceDatabase))===sha(bytes(original.sourceDatabase))&&sha(bytes(report.restorePoint))===sha(bytes(original.restorePoint))
  &&report.continuousWalQualified===false,'PHYSICAL_ORIGINAL_REPORT_BINDING');
 await assertProtectedKeyAcl();
 const before=fs.lstatSync(KEY,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=4096n&&fs.realpathSync(KEY)===KEY,'QUALIFICATION_FIXED_KEY_UNPROVEN');
 const key=createPrivateKey(fs.readFileSync(KEY));assert(key.asymmetricKeyType==='ed25519','QUALIFICATION_ED25519_REQUIRED');
 const now=Date.now(),decision={format:'sabalan-original-physical-checkpoint-verification/v1',
  sealedManifestSha256:original.sealedManifestSha256,plaintextManifestSha256:original.plaintextManifestSha256,cipherInventorySha256:original.cipherInventorySha256,
  sourceDatabase:original.sourceDatabase,restorePoint:original.restorePoint,reportSha256:owned.sha256,
  originalCompletionSha256:sha(bytes(original)),nativeClosuresSha256:sha(bytes(original.nativeClosures)),
  continuousWalQualified:false,productionAdmission:false,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};
 assert(pin(before)===pin(fs.lstatSync(KEY,{bigint:true}))&&observers.every(row=>row.closed&&!row.unknown),'PHYSICAL_ORIGINAL_ISSUER_UNPROVEN');
 const envelope={format:'sabalan-signed-physical-checkpoint-verification/v1',decision,
  signature:sign(null,Buffer.concat([Buffer.from('sabalan-original-physical-checkpoint-verification/v1\n'),bytes(decision)]),key).toString('base64')};
 const token=Object.freeze({});originalPhysicalVerifications.set(token,envelope);return token;
}

const originalWalCertificates=new WeakMap();
export function readOriginalWalWindowCertificate(token){const value=originalWalCertificates.get(token);assert(value,'ORIGINAL_WAL_CERTIFICATE_REQUIRED');return structuredClone(value);}
export async function issueOriginalWalWindowVerification({sourceWindow,independentCompletion}){
 const {readOriginalProtectedWalWindowSource}=await import('../../scripts/lib/original-protected-online-ssh.mjs');
 const {isOriginalLocalOnlineWalWindowSource,readOriginalLocalOnlineWalWindowSource}=await import('../../scripts/lib/original-local-online-checkpoint.mjs');
 const {readOriginalIndependentWalWindowVerification}=await import('../../scripts/lib/independent-wal-window-ssh.mjs');
 const source=isOriginalLocalOnlineWalWindowSource(sourceWindow)?await readOriginalLocalOnlineWalWindowSource(sourceWindow):readOriginalProtectedWalWindowSource(sourceWindow),original=readOriginalIndependentWalWindowVerification(independentCompletion),r=source.request;
 assert(original.requestSha256===source.requestSha256&&original.challenge===r.challenge&&original.windowSha256===r.windowSha256
  &&sha(bytes(original.sourceIdentity))===sha(bytes(r.sourceIdentity))&&sha(bytes(original.objects))===sha(bytes(r.objects))
  &&original.originalControllers.length>0&&original.originalControllers.every(row=>row.code===0&&row.signal===null),'ORIGINAL_WAL_INDEPENDENT_READBACK_REQUIRED');
 await assertProtectedKeyAcl();const before=fs.lstatSync(KEY,{bigint:true});
 assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=4096n&&fs.realpathSync(KEY)===KEY,'QUALIFICATION_FIXED_KEY_UNPROVEN');
 const key=createPrivateKey(fs.readFileSync(KEY));assert(key.asymmetricKeyType==='ed25519','QUALIFICATION_ED25519_REQUIRED');
 const now=Date.now(),decision={format:'sabalan-original-wal-window-verification/v1',requestSha256:source.requestSha256,challenge:r.challenge,
  independentTokenSha256:sha(bytes(original)),windowSha256:r.windowSha256,sourceIdentity:r.sourceIdentity,objects:r.objects,
  issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};
 assert(pin(before)===pin(fs.lstatSync(KEY,{bigint:true}))&&observers.every(row=>row.closed&&!row.unknown),'ORIGINAL_WAL_ISSUER_UNPROVEN');
 readOriginalProtectedWalWindowSource(sourceWindow);
 const envelope={format:'sabalan-signed-original-wal-window-verification/v1',decision,
  signature:sign(null,Buffer.concat([Buffer.from('sabalan-original-wal-window-verification/v1\n'),bytes(decision)]),key).toString('base64')};
 const token=Object.freeze({});originalWalCertificates.set(token,envelope);return token;
}

const originalPhysicalPublications=new WeakMap();
const originalRepositoryPromotions=new WeakMap();
export function readOriginalPhysicalRepositoryPromotion(token){const value=originalRepositoryPromotions.get(token);assert(value,'ORIGINAL_PHYSICAL_REPOSITORY_PROMOTION_REQUIRED');return structuredClone(value);}
export async function issueOriginalPhysicalRepositoryPromotion({physicalCompletion,repositoryPromotion}){
 const {readOriginalIndependentPhysicalRestoreSshCompletion,readOriginalIndependentPhysicalRepositoryPromotion}=await import('../../scripts/lib/independent-full-restore-ssh.mjs');
 const {assertOriginalCheckpointRepository}=await import('./online-checkpoint-finalization.mjs');
 const physical=readOriginalIndependentPhysicalRestoreSshCompletion(physicalCompletion),promotion=readOriginalIndependentPhysicalRepositoryPromotion(repositoryPromotion);
 const physicalCompletionSha256=sha(bytes(physical));
 assert(promotion.physicalCompletionSha256===physicalCompletionSha256&&promotion.originalControllers.length>0
  &&promotion.originalControllers.every(row=>row.code===0&&row.signal===null),'ORIGINAL_PHYSICAL_REPOSITORY_READBACK_REQUIRED');
 const repository=assertOriginalCheckpointRepository(promotion.repositoryDescriptor,physical,promotion.repositoryDescriptor.captureId);
 await assertProtectedKeyAcl();const before=fs.lstatSync(KEY,{bigint:true});
 assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=4096n&&fs.realpathSync(KEY)===KEY,'QUALIFICATION_FIXED_KEY_UNPROVEN');
 const key=createPrivateKey(fs.readFileSync(KEY));assert(key.asymmetricKeyType==='ed25519','QUALIFICATION_ED25519_REQUIRED');
 const now=Date.now(),decision={format:'sabalan-original-physical-repository-promotion/v1',physicalCompletionSha256,
  originalPromotionSha256:sha(bytes(promotion)),repository,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};
 assert(pin(before)===pin(fs.lstatSync(KEY,{bigint:true}))&&observers.every(row=>row.closed&&!row.unknown),'ORIGINAL_PHYSICAL_PROMOTION_ISSUER_UNPROVEN');
 const envelope={format:'sabalan-signed-physical-repository-promotion/v1',decision,
  signature:sign(null,Buffer.concat([Buffer.from('sabalan-original-physical-repository-promotion/v1\n'),bytes(decision)]),key).toString('base64')};
 const token=Object.freeze({});originalRepositoryPromotions.set(token,envelope);return token;
}
export function readOriginalPhysicalCheckpointPublication(token){const value=originalPhysicalPublications.get(token);assert(value,'ORIGINAL_PHYSICAL_PUBLICATION_REQUIRED');return structuredClone(value);}
export async function issueOriginalPhysicalCheckpointPublication({physicalCompletion,repositoryPromotion,metadataCompletion}){
 const {readOriginalIndependentPhysicalRestoreSshCompletion,readOriginalIndependentPhysicalRepositoryPromotion,readOriginalIndependentPhysicalMetadataPublication}=await import('../../scripts/lib/independent-full-restore-ssh.mjs');
 const physical=readOriginalIndependentPhysicalRestoreSshCompletion(physicalCompletion),promotion=readOriginalIndependentPhysicalRepositoryPromotion(repositoryPromotion),metadata=readOriginalIndependentPhysicalMetadataPublication(metadataCompletion);
 assert(metadata.physicalCompletionSha256===sha(bytes(physical))&&metadata.sealedManifestSha256===physical.sealedManifestSha256
  &&metadata.cipherInventorySha256===physical.cipherInventorySha256&&metadata.originalControllers.length>0
  &&metadata.originalControllers.every(row=>row.code===0&&row.signal===null),'ORIGINAL_PHYSICAL_METADATA_READBACK_REQUIRED');
 assert(promotion.physicalCompletionSha256===metadata.physicalCompletionSha256
  &&sha(bytes(promotion.repositoryDescriptor))===sha(bytes(metadata.repositoryDescriptor)),'ORIGINAL_PHYSICAL_REPOSITORY_METADATA_CHANGED');
 for(const field of ['canonicalMetadataSha256','remoteMetadataSha256'])assert(/^[a-f0-9]{64}$/.test(metadata[field]),'ORIGINAL_PHYSICAL_METADATA_HASH_REQUIRED');
 await assertProtectedKeyAcl();const before=fs.lstatSync(KEY,{bigint:true});
 assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=4096n&&fs.realpathSync(KEY)===KEY,'QUALIFICATION_FIXED_KEY_UNPROVEN');
 const key=createPrivateKey(fs.readFileSync(KEY));assert(key.asymmetricKeyType==='ed25519','QUALIFICATION_ED25519_REQUIRED');
 const now=Date.now(),decision={format:'sabalan-original-physical-checkpoint-publication/v1',canonicalMetadataSha256:metadata.canonicalMetadataSha256,
  sealedManifestSha256:physical.sealedManifestSha256,cipherInventorySha256:physical.cipherInventorySha256,physicalCompletionSha256:metadata.physicalCompletionSha256,
  repository:promotion.repositoryDescriptor,remoteMetadataFile:metadata.remoteMetadataFile,remoteMetadataSha256:metadata.remoteMetadataSha256,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};
 assert(pin(before)===pin(fs.lstatSync(KEY,{bigint:true}))&&observers.every(row=>row.closed&&!row.unknown),'ORIGINAL_PHYSICAL_METADATA_ISSUER_UNPROVEN');
 const envelope={format:'sabalan-signed-physical-checkpoint-publication/v1',decision,
  signature:sign(null,Buffer.concat([Buffer.from('sabalan-original-physical-checkpoint-publication/v1\n'),bytes(decision)]),key).toString('base64')};
 const token=Object.freeze({});originalPhysicalPublications.set(token,envelope);return token;
}

const originalTerminalCertificates=new WeakMap();
export function readOriginalTerminalWalCoverageCertificate(token){const row=originalTerminalCertificates.get(token);assert(row,'ORIGINAL_TERMINAL_WAL_CERTIFICATE_REQUIRED');return structuredClone(row.envelope);}
export function readOriginalTerminalWalCoverageSource(token){const row=originalTerminalCertificates.get(token);assert(row,'ORIGINAL_TERMINAL_WAL_CERTIFICATE_REQUIRED');return structuredClone(row.source);}
export async function issueOriginalTerminalWalCoverage({sourceTerminal,windowAcknowledgements,metadataCompletion}){
 const {readOriginalProtectedTerminalWalSource}=await import('../../scripts/lib/original-protected-online-ssh.mjs');
 const {readOriginalIndependentWalWindowAcknowledgement}=await import('../../scripts/lib/independent-wal-window-ssh.mjs');
 const {readOriginalIndependentPhysicalMetadataPublication}=await import('../../scripts/lib/independent-full-restore-ssh.mjs');
 const source=readOriginalProtectedTerminalWalSource(sourceTerminal),request=source.request,metadata=readOriginalIndependentPhysicalMetadataPublication(metadataCompletion);
 assert(request.canonicalMetadataSha256===metadata.canonicalMetadataSha256&&request.pointIndexSha256===metadata.pointIndexSha256,'ORIGINAL_TERMINAL_POINT_CHANGED');
 const raw=Buffer.from(request.terminalRawBase64,'base64'),terminal=JSON.parse(raw);assert(sha(raw)===request.terminalResultSha256,'ORIGINAL_TERMINAL_RAW_CHANGED');
 const stored=JSON.parse(Buffer.from(metadata.ownedOutputs.metadata.rawBase64,'base64')),canonicalMetadata=stored.canonicalMetadata;
 assert(terminal.captureId===canonicalMetadata.repositoryDirectory.captureId,'ORIGINAL_TERMINAL_CAPTURE_CHANGED');
 const sourceDatabase={name:terminal.source.databaseName,oid:terminal.source.databaseOid,systemIdentifier:terminal.source.systemIdentifier};
 assert(sha(bytes(sourceDatabase))===sha(bytes(canonicalMetadata.sourceDatabase)),'ORIGINAL_TERMINAL_DATABASE_CHANGED');
 assert(Array.isArray(windowAcknowledgements)&&windowAcknowledgements.length===terminal.windows.length,'ORIGINAL_TERMINAL_WINDOW_UNION_REQUIRED');
 const acknowledgements=new Map();for(const token of windowAcknowledgements){const row=readOriginalIndependentWalWindowAcknowledgement(token,{metadataCompletion});
  assert(!acknowledgements.has(row.requestSha256),'ORIGINAL_TERMINAL_DUPLICATE_WINDOW');acknowledgements.set(row.requestSha256,row);}
 const windows=terminal.windows.map(window=>{const row=acknowledgements.get(window.requestSha256);assert(row&&row.request.windowSha256===window.windowSha256&&row.certificate.sha256===window.certificateSha256,'ORIGINAL_TERMINAL_CERTIFIED_WINDOW_REQUIRED');
  assert(/^[a-f0-9]{64}$/.test(row.repositoryDependencySha256),'ORIGINAL_TERMINAL_DEPENDENCY_REQUIRED');return {requestSha256:window.requestSha256,dependencySha256:row.repositoryDependencySha256};});
 await assertProtectedKeyAcl();const before=fs.lstatSync(KEY,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=4096n&&fs.realpathSync(KEY)===KEY,'QUALIFICATION_FIXED_KEY_UNPROVEN');
 const key=createPrivateKey(fs.readFileSync(KEY));assert(key.asymmetricKeyType==='ed25519','QUALIFICATION_ED25519_REQUIRED');
 const now=Date.now(),decision={format:'sabalan-original-online-terminal-coverage/v1',challenge:request.challenge,captureId:terminal.captureId,
  pointIndexSha256:request.pointIndexSha256,canonicalMetadataSha256:request.canonicalMetadataSha256,terminalResultSha256:request.terminalResultSha256,
  sourceDatabase,terminalEpochSha256:terminal.terminalEpochSha256,publicationSha256:terminal.publicationSha256,windows,
  issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};
 readOriginalProtectedTerminalWalSource(sourceTerminal);
 assert(pin(before)===pin(fs.lstatSync(KEY,{bigint:true}))&&observers.every(row=>row.closed&&!row.unknown),'ORIGINAL_TERMINAL_ISSUER_UNPROVEN');
 const envelope={format:'sabalan-signed-online-terminal-coverage/v1',decision,signature:sign(null,Buffer.concat([Buffer.from('sabalan-original-online-terminal-coverage/v1\n'),bytes(decision)]),key).toString('base64')};
 const token=Object.freeze({});originalTerminalCertificates.set(token,{envelope,source:{rawBase64:request.terminalRawBase64,bytes:raw.length,sha256:request.terminalResultSha256}});return token;
}
