/** Distinct same-process COMPLETE authority. Input pins select reviewed source;
 * neither those pins nor persisted output JSON are completion authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readOriginalCompleteOwner} from './original-existing-compose-owner.mjs';
import {joinOriginalCompleteArtifacts} from './original-complete-join.mjs';
import {originalOnlineEvidenceReader} from './original-online-evidence-reader.mjs';
import {readOriginalRoleQualificationCompletion} from './application-native-role-coordinator.mjs';
import {constructOriginalCompleteRuntime,readOriginalConstructedCompletePlan} from './original-complete-runtime-constructor.mjs';
import {readSourceOwnedCompleteBinding} from './original-complete-source-binding.mjs';
import {readOriginalRoleRestoredIssuer} from './application-native-role-coordinator.mjs';
import {createOriginalCompleteResourcePorts} from './original-complete-resource-ports.mjs';
import {collectOriginalCompleteIssuerOwner} from './original-complete-issuer-owner.mjs';
import {readOriginalProtectedQualificationRequest} from './original-protected-online-ssh.mjs';
import {projectOriginalOnlineManifest} from './original-online-manifest-projection.mjs';
import {observeOriginalCompleteRetiredFile} from './original-complete-retired-files.mjs';

const completed=new WeakMap();
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const identity=st=>['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(key=>String(st[key])).join(':');
const PYTHON=path.resolve('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe');
export function isOriginalExistingComposeComplete(token){return !!token&&typeof token==='object'&&completed.has(token);}
export function readOriginalExistingComposeComplete(token){
  const value=completed.get(token);assert.ok(value,'ORIGINAL_EXISTING_COMPOSE_COMPLETE_REQUIRED');
  value.revalidate();return structuredClone(value.record);
}
/** This fence requires the SAME genuine Root and completed original FULL owner.
 * Persisted retirement JSON by itself cannot enter this registry. */
export function readOriginalCompleteRetirementFor(token,nativeOwner,localCompletion){
 const held=completed.get(token);assert.ok(held&&held.nativeOwner===nativeOwner&&held.retirement,'ORIGINAL_SAME_ROOT_COMPLETE_RETIREMENT_REQUIRED');held.revalidate();
 if(localCompletion!==undefined)assert.equal(held.localCompletion,localCompletion,'ORIGINAL_SAME_ROOT_COMPLETE_LOCAL_REQUIRED');
 for(const file of held.retirement.windowsAbsent)observeOriginalCompleteRetiredFile(file,held.retirement.windowsParents[file]);
 return structuredClone(held.retirement);
}

/** Contextual envelope join for a later authorized protected request. Keeps the
 * SAME completion token and every native/checkpoint byte. A JSON receipt or a
 * different image/database/qualification point cannot enter this path. Calling
 * it does not start a deployment, acquire a request or publish an acceptance. */
export function joinOriginalCompleteProtectedContext(token,protectedRequest,binding){
 const held=completed.get(token);assert.ok(held,'ORIGINAL_EXISTING_COMPOSE_COMPLETE_REQUIRED');held.revalidate();
 const request=readOriginalProtectedQualificationRequest(protectedRequest);assert.equal(request.format,'sabalan-original-protected-qualification-request/v1');
 if(held.protectedRequest)assert.equal(held.protectedRequest,protectedRequest,'ORIGINAL_COMPLETE_PROTECTED_REQUEST_CHANGED');
 const current=held.expected;assert.equal(binding.releaseId,request.releaseId);assert.equal(binding.sourceCommit,request.targetCommit);
 assert.deepEqual(binding.deploymentTargetDatabase,request.database);assert.deepEqual(request.database,current.qualificationCheckpoint.metadata.sourceDatabase);
 assert.equal(binding.checkpointArchiveChecksum,request.checkpoint.checksum);
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 assert.equal(binding.checkpointSha256,sha(Buffer.from(JSON.stringify(canonical(request.checkpoint)))));
 const contextual=new Set(['releaseId','manifestSha256','checkpointSha256','checkpointArchiveChecksum','productionExecutionBindings']);
 const unchanged=v=>Object.fromEntries(Object.entries(v).filter(([k])=>!contextual.has(k)));
 assert.deepEqual(unchanged(binding),unchanged(current),'ORIGINAL_COMPLETE_QUALIFIED_CONTENT_CHANGED');
 assert.deepEqual(binding.productionExecutionBindings,request.productionExecutionBindings);
 const execution=originalOnlineEvidenceReader().validateProductionExecutionBindings(request.productionExecutionBindings,{releaseId:request.releaseId,imageGraphs:current.imageGraphs,deploymentTargetImages:current.deploymentTargetImages,sourceHost:{machineUuidSha256:request.checkpoint.sourceMachineUuidSha256,kernelBootIdSha256:request.checkpoint.sourceKernelBootIdSha256}});
 assert.equal(binding.manifestSha256,projectOriginalOnlineManifest({request,runtimeBundleSha256:current.runtimeBundleSha256,executionImage:execution.backend}).sha256,'ORIGINAL_COMPLETE_PROTECTED_MANIFEST_CHANGED');
 const proof=structuredClone(held.proof);for(const key of contextual){if(Object.hasOwn(binding,key))proof[key]=structuredClone(binding[key]);else delete proof[key];}
 originalOnlineEvidenceReader().assertOnlineQualificationProof('coherent-independent-restore',proof,binding);held.revalidate();readOriginalProtectedQualificationRequest(protectedRequest);held.protectedRequest=protectedRequest;
 return Object.freeze({record:structuredClone(held.record),proof,expected:structuredClone(binding)});
}
function pinnedReader(){
  const checks=[];
  return {read(reference,maximum=8*1024**2){
    const file=reference.file;assert.equal(path.resolve(file),file);assert.equal(fs.realpathSync(file),file);
    assert.match(reference.sha256,/^[a-f0-9]{64}$/);
    const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try{
      const held=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
      assert.ok(held.isFile()&&held.nlink===1n&&held.size>0n&&held.size<=BigInt(maximum));
      for(const key of ['ino','mode','nlink','size','mtimeNs','ctimeNs'])assert.equal(held[key],named[key]);
      if(process.platform!=='win32')assert.equal(held.dev,named.dev);
      const raw=fs.readFileSync(fd);assert.equal(raw.length,Number(held.size));assert.equal(sha(raw),reference.sha256);
      assert.equal(identity(held),identity(fs.fstatSync(fd,{bigint:true})));assert.equal(identity(named),identity(fs.lstatSync(file,{bigint:true})));
      checks.push(()=>{assert.equal(fs.realpathSync(file),file);assert.equal(identity(fs.lstatSync(file,{bigint:true})),identity(named));assert.equal(sha(fs.readFileSync(file)),reference.sha256);});
      return raw;
    }finally{fs.closeSync(fd);}
  },revalidate(){for(const check of checks)check();}};
}
function confined(root,file){
  assert.equal(fs.realpathSync(root),root);const relative=path.relative(root,file);
  assert.ok(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'COMPLETE_OUTPUT_OUTSIDE_OWNED_AUDIT');
}

/** Fixed Windows owner entry: no CLI argv, executable, module, verifier or key
 * selector. The configuration and all source pins are frozen before credentials.
 * It must describe a newly rendered unused owner, not a historical used plan.
 * Runtime implementation of that reviewed owner remains responsible for the
 * existing Compose/resource lease, original transfer and physical reader ports. */
export async function runOriginalExistingComposeComplete({configurationFile,configurationSha256,localCompletion,nativeOwner,acquireCredential,onClosed=async()=>{},signal}){
  assert.equal(process.platform,'win32','ORIGINAL_COMPLETE_WINDOWS_REQUIRED');
  const local=readOriginalRoleQualificationCompletion(localCompletion);
  assert.ok(local.originalControllers.length>0&&local.originalControllers.every(row=>row.code===0&&row.signal===null));
  const source=readSourceOwnedCompleteBinding();
  assert.deepEqual(source.value.configuration,{file:configurationFile,sha256:configurationSha256},'COMPLETE_SOURCE_OWNED_CONFIGURATION_REQUIRED');
  let constructed;const reader=pinnedReader();let configuration={file:configurationFile,sha256:configurationSha256};
  if(source.value.format==='sabalan-original-complete-source-binding/v2'){const token=await constructOriginalCompleteRuntime({configurationReference:configuration,nativeOwner,localCompletion});constructed=readOriginalConstructedCompletePlan(token,nativeOwner,localCompletion);configuration=constructed.configurationReference;}
  const config=JSON.parse(reader.read(configuration).toString('utf8'));
  assert.equal(config.format,constructed?'sabalan-original-existing-compose-complete-input/v2':'sabalan-original-existing-compose-complete-input/v1');
  assert.equal(config.productionAdmission,false);assert.equal(config.project,'sabalanerp-local');
  if(constructed)assert.deepEqual(config,constructed.configuration,'COMPLETE_CONSTRUCTED_CONFIGURATION_CHANGED');else for(const key of ['sources','python','operation','targetCommit','auditDirectory'])assert.deepEqual(config[key],source.value[key],'COMPLETE_SOURCE_BINDING_CHANGED');
  assert.equal(Object.hasOwn(config,'session'),false,'COMPLETE_HR_SESSION_MUST_BE_ORIGINAL');
  assert.match(config.operation,/^[a-f0-9]{32}$/);assert.match(config.targetCommit,/^[a-f0-9]{40}$/);
  assert.deepEqual(Object.keys(config.sources).sort(),['callback','controller','owner','worker']);
  for(const ref of Object.values(config.sources))reader.read(ref,2*1024**2);
  assert.equal(config.python.file,PYTHON);reader.read(config.python,32*1024**2);
  assert.equal(path.resolve(config.auditDirectory),config.auditDirectory);if(constructed)constructed.revalidate();else assert.equal(fs.existsSync(config.auditDirectory),false,'COMPLETE_USED_AUDIT_REFUSED');
  // Acquire no key and perform no mutation here. The one source-bound owner
  // creates its exclusive audit directory only inside its own lease.
  const beforeCredential=async()=>{nativeOwner.assertMemoryWorkAdmission();source.revalidate();reader.revalidate();if(constructed){constructed.revalidate();await constructed.assertCurrent();}await nativeOwner.assertCompleteCurrent();};
  assert.ok(config.originalIssuer,'COMPLETE_FIXED_ORIGINAL_ISSUER_BINDING_REQUIRED');
  assert.deepEqual(Object.keys(config.originalIssuer).sort(),constructed?['expectedManifest','observerSha256','port']:['expectedManifestSha256','observerSha256','port']);
  const resources=createOriginalCompleteResourcePorts({nativeOwner,operation:config.operation,observerSha256:config.originalIssuer.observerSha256,expectedManifest:config.originalIssuer.expectedManifest});
  const ownerToken=await collectOriginalCompleteIssuerOwner({operation:config.operation,signal,beforeCredential,acquireCredential,
    onClosed:async(row,transportClosure)=>{await nativeOwner.persistCompleteOwnerClosure(config.operation,row,transportClosure);await onClosed(row);},
    retainedIssuer:readOriginalRoleRestoredIssuer(localCompletion),resources,expectedManifestSha256:config.originalIssuer.expectedManifestSha256,expectedManifest:config.originalIssuer.expectedManifest,issuerPort:config.originalIssuer.port,...(constructed?{readerPort:config.readerPort}:{}),
    command:{executable:PYTHON,argv:constructed?['-I','-B','-c',"import sys,pathlib,hashlib;file=sys.argv[1];raw=pathlib.Path(file).read_bytes();assert hashlib.sha256(raw).hexdigest()==sys.argv[2];sys.argv=[file]+sys.argv[3:];exec(compile(raw,file,'exec'),{'__name__':'__main__','__file__':file})",config.sources.owner.file,config.sources.owner.sha256,'--execute-reviewed','yes','--master-private-credential-stdin','yes']:['-I','-B',config.sources.owner.file,'--execute-reviewed','yes','--master-private-credential-stdin','yes'],
      environment:Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','PATH','APPDATA','LOCALAPPDATA'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]))}});
  source.revalidate();reader.revalidate();
  const owner=readOriginalCompleteOwner(ownerToken);confined(config.auditDirectory,owner.resultReference.file);
  const ownerRaw=reader.read(owner.resultReference),result=JSON.parse(ownerRaw.toString('utf8'));
  assert.equal(result.operation,config.operation);confined(config.auditDirectory,result.completeCapture.file);
  const captureRaw=reader.read(result.completeCapture),capture=JSON.parse(captureRaw.toString('utf8'));
  assert.equal(capture.request.operation,config.operation);assert.equal(capture.request.sourceCommit,config.targetCommit);
  const joined=joinOriginalCompleteArtifacts({owner,ownerRaw,captureRaw,completedAt:new Date().toISOString()});
  assert.equal(joined.record.controllerSourceSha256,config.sources.controller.sha256);
  const worker=JSON.parse(Buffer.from(capture.workerOriginal.rawBase64,'base64').toString('utf8'));
  assert.equal(worker.workerSourceSha256,config.sources.worker.sha256);
  originalOnlineEvidenceReader().assertOnlineQualificationProof('coherent-independent-restore',joined.proof,joined.expected);
  reader.revalidate();
  let retirement=null;
  if(constructed){
   const file=path.join(config.auditDirectory,'windows-inputs-retired.json'),reference={file,sha256:sha(fs.readFileSync(file))},value=JSON.parse(reader.read(reference));
   assert.deepEqual(value,{format:'sabalan-owned-windows-transfer-inputs-retired/v1',operation:config.operation,sourceArchiveAbsent:true,downloadedCipherAbsent:true,productionAdmission:false});
   const windowsAbsent=[path.resolve(constructed.parts.archive.file),path.join(config.auditDirectory,'cipherDownload.stdout.raw')],windowsParents=Object.fromEntries(windowsAbsent.map(item=>[item,observeOriginalCompleteRetiredFile(item)]));
   retirement={format:'sabalan-same-root-complete-retirement/v1',operation:config.operation,rootOperation:nativeOwner.operation,originalOwnerPid:owner.row.originalPid,originalOwnerClosed:true,localJobRetired:true,backupTransferRetired:true,windowsAbsent,windowsParents,windowsReceipt:reference,backupAbsent:['/root/sabalan-recovery-private/transfer-material-'+config.operation,'/root/sabalan-recovery-private/transfer-'+config.operation],coherentQualificationSha256:joined.record.ownedOutputs.coherentQualification.sha256,productionAdmission:false};
  }
  const token=Object.freeze({});completed.set(token,{nativeOwner,localCompletion,retirement,record:joined.record,proof:joined.proof,expected:joined.expected,revalidate:()=>{
    source.revalidate();reader.revalidate();originalOnlineEvidenceReader().assertOnlineQualificationProof('coherent-independent-restore',joined.proof,joined.expected);
  }});return token;
}
