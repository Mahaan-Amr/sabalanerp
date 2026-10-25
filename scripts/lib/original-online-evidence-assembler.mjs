/** Fixed derivation of private qualification evidence. Saved receipt objects
 * are never authority inputs; only the three original in-process owners may
 * reach the private completion table below. This does not activate a release. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {originalOnlineEvidenceReader} from './original-online-evidence-reader.mjs';
import {readOriginalRoleQualificationCompletion} from './application-native-role-coordinator.mjs';
import {readOriginalIndependentRestoreSshCompletion,readOriginalIndependentPhysicalRestoreSshCompletion} from './independent-full-restore-ssh.mjs';
import {readOriginalProtectedQualificationRequest,readOriginalOnlineQualificationRequest} from './original-protected-online-ssh.mjs';
import {assertOriginalPrivateEvidenceDirectory} from './original-private-evidence-directory.mjs';
import {readIndependentCheckpointTransport} from './independent-checkpoint-transport.mjs';

const completed=new WeakMap();
const scopes=['compatible-migrations','coherent-independent-restore','browser-24-hours','single-worker-and-completion','current-domain'];
const roles=['backend','frontend','inquiry'];
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const bytes=value=>Buffer.from(JSON.stringify(canonical(value))+'\n');
const metadataSha=value=>sha(Buffer.from(JSON.stringify(canonical(value))));
const owned=raw=>({rawBase64:raw.toString('base64'),bytes:raw.length,sha256:sha(raw)});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const decode=value=>{assert.equal(typeof value,'string');const raw=Buffer.from(value,'base64');assert.equal(raw.toString('base64'),value);return raw;};
const json=value=>JSON.parse(decode(value));
const same=(a,b)=>assert.deepEqual(a,b);

function ownedJson(record,name,maximum=8*1024**2){
 const descriptor=record.ownedOutputs?.[name];assert.ok(descriptor,'ORIGINAL_ASSEMBLY_OUTPUT_MISSING_'+name);
 const raw=decode(descriptor.rawBase64);assert.ok(raw.length>0&&raw.length<=maximum);same(raw.length,descriptor.bytes);same(sha(raw),descriptor.sha256);
 assert.ok(Object.values(record.fileHashes).includes(descriptor.sha256),'ORIGINAL_ASSEMBLY_OUTPUT_HASH_NOT_OWNED');
 return {raw,value:JSON.parse(raw),descriptor};
}
function naturalClosure(value,owner){
 const native=json(value.nativeRawBase64),work=json(value.workRawBase64),claim=json(value.workClaimRawBase64);
 const row=owner.nativeClosures.find(row=>row.runtimeId===native.onlineScope?.scope?.runtimeId);
 assert.ok(row,'ORIGINAL_ASSEMBLY_NATIVE_NOT_OWNED');
 same(row.nativeSha256,sha(decode(value.nativeRawBase64)));same(row.workSha256,sha(decode(value.workRawBase64)));
 same(row.activeClaimSha256,native.activeClaimSha256);same(value.originalPopenPid,native.guardian.pid);
 same(value.originalReturncode,0);same(native.nativeStatus,0);same(native.stoppedBySignal,false);same(native.phase,'QUIESCENT');same(work.phase,'QUIESCENT');
 same(value.claimNative,claim.native);assert.ok(value.freshSql?.visible===true,'ORIGINAL_ASSEMBLY_FRESH_SQL_MISSING');
 return {...value,runtimeId:native.onlineScope.scope.runtimeId,activeClaimSha256:native.activeClaimSha256};
}
function actor(closure){const scope=json(closure.nativeRawBase64).onlineScope.scope;
 return {runtimeId:scope.runtimeId,releaseId:scope.releaseId,sourceCommit:scope.sourceCommit,image:scope.image,runtimeBundleSha256:scope.manifestSha256,purpose:scope.purpose};}
function database(closure){const native=json(closure.nativeRawBase64);return {name:native.initialDatabase.name,oid:String(native.initialDatabase.oid),systemIdentifier:native.clusterIdentifier};}

/** Pure content binding only; this result is never an original-owner token. */
export function deriveOriginalExecutionSelection(request,independent){
 const sourceHost={machineUuidSha256:request.checkpoint.sourceMachineUuidSha256,kernelBootIdSha256:request.checkpoint.sourceKernelBootIdSha256};
 const bindings=request.productionExecutionBindings;
 const executionImages=originalOnlineEvidenceReader().validateProductionExecutionBindings(bindings,{releaseId:request.releaseId,
  imageGraphs:independent.imageGraphs,deploymentTargetImages:independent.images,sourceHost});
 return {releaseId:request.releaseId,sourceHost,bindings:bindings?structuredClone(bindings):null,executionImages};
}

function derivePhysicalComponents(independent,report,request){
 const manifest=ownedJson(independent,'plaintextManifest',32*1024**2).value;
 const capture=ownedJson(independent,'captured',32*1024**2).value;
 same(manifest.operation,report.layout.captureId);same(capture.captureId,manifest.operation);
 same(report.layout.restoredFileCuts.length,9);
 const components={};
 const groups={postgres:['physical-base','wal-segment','wal-capture'],sqlite:['inquiry-sqlite'],coordination:['coordination'],files:['versioned-file-cut','versioned-file-object','versioned-file-lineage']};
 for(const [name,group]of Object.entries(groups)){
  const source=manifest.sources.filter(row=>group.includes(row.role));assert.ok(source.length>0);
  for(const row of source){const restored=report.decryption.components.filter(value=>value.name===row.name);same(restored.length,1);
   for(const key of ['role','bytes','sha256'])same(restored[0][key],row[key]);}
  // A deterministic group inventory hash, not an invented physical file hash.
  const inventory=source.map(({name,role,bytes,sha256})=>({name,role,bytes,sha256})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  const total=inventory.reduce((sum,row)=>sum+row.bytes,0);assert.ok(Number.isSafeInteger(total)&&total>0);
  const digest=metadataSha(inventory);components[name]={captureId:manifest.operation,bytes:total,sha256:digest,restoredSha256:digest,inventory};
 }
 return {physicalRestoreRawBase64:independent.ownedOutputs.report.rawBase64,liveWalCoverage:structuredClone(request.liveCoverage),components,
  independentlyVerifiedFileCuts:structuredClone(report.layout.restoredFileCuts)};
}

/** Data-only directory mapping. Callers cannot mint assembly or origin tokens
 * with it. COMPLETE files remain COMPLETE directory components, never v3 cuts. */
export function deriveProtectedDirectoryComponents({checkpointMetadataSha256,metadata,canonicalRestoreRaw,baselineRaw,requestRoots}){
 same(metadataSha(metadata),checkpointMetadataSha256);same(metadata.captureMethod,'PROTECTED_MAINTENANCE_COMPLETE');
 const restore=JSON.parse(canonicalRestoreRaw),baseline=JSON.parse(baselineRaw);
 same(restore.ok,true);same(baseline.format,'sabalan-application-restored-file-baseline/v1');same(baseline.captureSource,'canonical-complete-package');
 same(baseline.capturedManifest.sha256,sha(canonicalRestoreRaw));same(baseline.sources.length,9);same(requestRoots.length,9);
 same(metadata.manifest.format,'sabalan-recovery');same(metadata.manifest.packageType,'COMPLETE');
 const retained=['storage/contracts','storage/hr-hiring','storage/accounting-contracts','storage/dispatch-documents','storage/support-tickets','storage/performance-exports','uploads/images','uploads/security-shift-log','uploads/security-vehicle-pairs'];
 const rootBindings=baseline.sources.map(source=>{
  const matches=retained.filter(relative=>source.liveRoot.endsWith('/'+relative));same(matches.length,1);
  const relative=matches[0],sourceLiveRoot='/app/'+relative;
  same(requestRoots.filter(root=>root.live===sourceLiveRoot).length,1);
  const payloadPrefix='files/'+relative.replace(/^storage\//,'');
  const expected=metadata.manifest.components.filter(row=>row.path.startsWith(payloadPrefix+'/')).map(row=>({key:row.path.slice(payloadPrefix.length+1),bytes:row.size,sha256:row.sha256})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  same(source.files,expected);assert.ok(Array.isArray(source.directories)&&source.directories.length<=10000);
  same(new Set(source.directories).size,source.directories.length);
  for(const key of source.directories)assert.ok(typeof key==='string'&&key.split('/').every(part=>part&&part!=='.'&&part!=='..')&&!/[\\\0]/.test(key));
  return {name:source.name,sourceLiveRoot,payloadPrefix,restoredLiveRoot:source.liveRoot};
 });
 same(new Set(rootBindings.map(row=>row.sourceLiveRoot)).size,9);same(new Set(rootBindings.map(row=>row.name)).size,9);
 return {format:'sabalan-original-protected-directory-restore/v1',checkpointSha256:checkpointMetadataSha256,canonicalRestoreOutputRawBase64:canonicalRestoreRaw.toString('base64'),baselineRawBase64:baselineRaw.toString('base64'),baselineSha256:sha(baselineRaw),rootBindings};
}

/** A diagnostic list, not an acceptance decision. Deliberately preserve each
 * missing producer fact instead of converting a diagnostic PASS into coverage. */
export function originalOnlineProducerGaps(main,browser){
 const gaps=[];
 if(!Array.isArray(main.writerCoverage?.remaining)||main.writerCoverage.remaining.length)gaps.push('current-domain:writerCoverage.remaining');
 if(!Array.isArray(main.writerCoverage?.startupOnly)||main.writerCoverage.startupOnly.length)gaps.push('current-domain:writerCoverage.startupOnly');
 const domains=['accounting','contracts','dispatch','hr','inquiry','personnel-performance','security','support','uploads'];
 if(!Array.isArray(main.domainCases)||JSON.stringify(main.domainCases.map(row=>row.domain).sort())!==JSON.stringify(domains))gaps.push('current-domain:actual-nine-domain-receipts');
 if(!browser)gaps.push('browser-24-hours:original-browser-output');
 if(!Array.isArray(browser?.retainedBuilds)||!['erp','inquiry'].every(app=>browser.retainedBuilds.some(row=>row.application===app)))gaps.push('browser-24-hours:both-actual-retained-builds');
 if(!browser?.routingRegistryRawBase64||!browser?.routingRegistrySha256)gaps.push('browser-24-hours:original-routing-registry');
 return Object.freeze(gaps);
}

export function readOriginalOnlineEvidenceAssembly(token){
 const result=completed.get(token);assert.ok(result,'ORIGINAL_ONLINE_ASSEMBLY_TOKEN_REQUIRED');return structuredClone(result);
}

/** Assemble protected bootstrap generation one only. ONLINE following cycles
 * require the physical WAL/SQLite/v3-cut owner and cannot use this factory. */
export function assembleOriginalProtectedOnlineEvidence({localCompletion,independentCompletion,protectedRequest,evidenceDirectory,evidenceCustody,protectedFinancial}){
 const local=readOriginalRoleQualificationCompletion(localCompletion),independent=readOriginalIndependentRestoreSshCompletion(independentCompletion),request=readOriginalProtectedQualificationRequest(protectedRequest);
 same(request.format,'sabalan-original-protected-qualification-request/v1');same(independent.recoveryMode,'PROTECTED_MAINTENANCE_COMPLETE');
 return assembleOriginalEvidence({local,independent,request,evidenceDirectory,physical:false,evidenceCustody,protectedFinancial,revalidateRequest:()=>readOriginalProtectedQualificationRequest(protectedRequest)});
}

/** Following ONLINE cycles require the actual physical owner and live original
 * request. COMPLETE backup receipts cannot enter this separate factory. */
export function assembleOriginalOnlineEvidence({localCompletion,independentCompletion,onlineRequest,evidenceDirectory,evidenceCustody}){
 const local=readOriginalRoleQualificationCompletion(localCompletion),independent=readOriginalIndependentPhysicalRestoreSshCompletion(independentCompletion),request=readOriginalOnlineQualificationRequest(onlineRequest);
 same(request.format,'sabalan-original-online-qualification-request/v1');same(independent.recoveryMode,'ONLINE_COHERENT_WAL');
 assert.ok(Number.isSafeInteger(request.generation)&&request.generation>=2);
 return assembleOriginalEvidence({local,independent,request,evidenceDirectory,physical:true,evidenceCustody,revalidateRequest:()=>readOriginalOnlineQualificationRequest(onlineRequest)});
}


/** Separate signed financial artifacts. These references carry no ownership;
 * the actual fixed-key canonical reader below validates every signed byte. */
function protectedFinancialFiles(selection){
 assert.ok(selection&&Object.keys(selection).sort().join(',')==='binding,sourceFile,sourceSha256');
 assert.ok(path.isAbsolute(selection.sourceFile)&&path.resolve(selection.sourceFile)===selection.sourceFile&&/^[a-f0-9]{64}$/.test(selection.sourceSha256));
 const directory=path.dirname(selection.sourceFile);assert.equal(fs.realpathSync(directory),directory);
 const pins=[];const read=(file,maximum,expectedHash,empty=false)=>{
  assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const before=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.size>=(empty?0n:1n)&&before.size<=BigInt(maximum));
   if(process.platform!=='win32')assert.ok((before.mode&0o777n)===0o400n&&before.uid===BigInt(process.getuid()));
   const identity=st=>['dev','ino','size','mtimeNs','ctimeNs','uid','mode','nlink'].map(k=>String(st[k])).join(':');
   for(const key of ['ino','size','mtimeNs','ctimeNs','uid','mode','nlink'])same(before[key],named[key]);if(process.platform!=='win32')same(before.dev,named.dev);
   const raw=fs.readFileSync(fd);same(raw.length,Number(before.size));same(sha(raw),expectedHash);same(identity(before),identity(fs.fstatSync(fd,{bigint:true})));same(identity(named),identity(fs.lstatSync(file,{bigint:true})));
   pins.push(()=>{const current=fs.lstatSync(file,{bigint:true});same(identity(current),identity(named));same(sha(fs.readFileSync(file)),expectedHash);});return raw;
  }finally{fs.closeSync(fd);}
 };
 const sourceRaw=read(selection.sourceFile,8*1024**2,selection.sourceSha256),source=JSON.parse(sourceRaw),names=['workerStdout','workerStderr','workerOriginal','outerActive','outerFinal','privateProof','sourceCheckpoint','currentMaterial','currentCompiled','currentImage','currentInspect','certificate'];
 same(source.format,'sabalan-protected-financial-qualification/v1');same(source.qualificationComplete,true);same(source.productionAdmission,false);same(Object.keys(source.evidence).sort(),[...names].sort());
 const files={};for(const name of names){const d=source.evidence[name],maximum=name==='certificate'?65536:(name==='currentCompiled'?32:name==='workerStdout'?40:16)*1024**2;
  same(Object.keys(d).sort(),['bytes','file','sha256']);same(d.file,'protected-financial-'+name.toLowerCase()+'.json');assert.ok(Number.isSafeInteger(d.bytes)&&d.bytes>=0&&d.bytes<=maximum);
  const raw=read(path.join(directory,d.file),maximum,d.sha256,name==='workerStderr');same(raw.length,d.bytes);files[d.file]=raw;
 }
 return {source,sourceRaw,binding:structuredClone(selection.binding),files,revalidate(){for(const check of pins)check();}};
}

function assembleOriginalEvidence({local,independent,request,evidenceDirectory,physical,evidenceCustody,protectedFinancial,revalidateRequest}){
 const financial=protectedFinancial?protectedFinancialFiles(protectedFinancial):null;assert.ok(!physical||!financial,'FINITE_FINANCIAL_REQUIRES_PROTECTED_COMPLETE');
 const originalProductionExecution=deriveOriginalExecutionSelection(request,independent);
 assert.ok(local.originalControllers.every(row=>row.code===0&&row.signal===null)&&independent.originalControllers.every(row=>row.code===0&&row.signal===null));
 const main=ownedJson(local,'original-main-result.json').value;
 same(main.format,'sabalan-application-native/v1');same(main.passResult,true);same(main.productionAdmission,false);
 // The routing owner returns browser bytes through ORIGINAL main stdout.
 // CHROME_CLOSED contains process/pipe closure only, never browser assertions.
 const browser=main.pairedRouting?.browser;
 if(browser)same(browser.format,'sabalan-actual-native-browser/v1');
 const gaps=originalOnlineProducerGaps(main,browser);
 if(gaps.length){const error=Error('ORIGINAL_ONLINE_PRODUCER_FACTS_INCOMPLETE');error.gaps=gaps;throw error;}
 const originalReport=ownedJson(independent,'report',physical?32*1024**2:8*1024**2),report=originalReport.value,baseline=ownedJson(independent,'restoredBaseline'),sql=ownedJson(independent,'namespaceSqlObservation').value;
 const transport=physical?{raw:bytes({...request.checkpoint,canonicalMetadata:request.checkpoint,canonicalMetadataSha256:metadataSha(request.checkpoint)})}:ownedJson(independent,'checkpointTransport');
 if(physical)transport.descriptor=owned(transport.raw);
 const checkpoint=readIndependentCheckpointTransport(transport.raw);
 if(!physical){same(checkpoint.metadata,independent.checkpointMetadata);same(checkpoint.sha256,independent.checkpoint.metadataSha256);}
 else{same(checkpoint.metadata.sourceDatabase,independent.sourceDatabase);same(request.database,independent.sourceDatabase);same(report.layout.captureId,request.liveCoverage.captureId);}
 same(report.phase,'COMPLETE');same(report.pass,true);same(report.continuousWalQualified,false);same(report.recoveryMode,physical?'ONLINE_COHERENT_WAL':'PROTECTED_MAINTENANCE_COMPLETE');
 const pair=main.genuinePrivateQualificationPair;same(pair.originalPairClosed,true);
 const sourceClosures=main.originalNativeClosures.map(row=>naturalClosure(row,local));
 const httpClosures=pair.originalHttpClosures.map(row=>naturalClosure(row,local));
 const jobsClosures=pair.originalJobsClosures.map(row=>naturalClosure(row,local));
 const candidate=httpClosures.filter(row=>actor(row).image===independent.sourceImages.backend&&actor(row).sourceCommit===request.targetCommit);same(candidate.length,1);
 const candidateActor=actor(candidate[0]),sourceDatabase=database(sourceClosures[0]),pairDatabase=database(httpClosures[0]);
 sourceClosures.forEach(row=>same(database(row),sourceDatabase));[...httpClosures,...jobsClosures].forEach(row=>same(database(row),pairDatabase));
 same(sql.visible,true);same(sql.database,independent.proofDatabase);same(sql.sessions,0);same(sql.prepared,0);
 const independentClosures=[report.baseline,report.backendClosure.closed].map(value=>{
  const claim=json(value.workClaimRawBase64),scope=json(value.workScopeRawBase64),namespace=scope.scope.postgresApplicationName;
  const observed=sql.namespaces.filter(row=>row.namespace===namespace);same(observed.length,1);same(observed[0].sessions,0);
  return naturalClosure({...value,claimNative:claim.native,freshSql:{visible:sql.visible,systemIdentifier:sql.database.systemIdentifier,databaseOid:sql.database.oid,namespace,namespaceSessions:observed[0].sessions,prepared:sql.prepared}},independent);
 });
 const manifest={format:'sabalan-online-release-manifest/v1',releaseId:request.releaseId,sourceCommit:request.targetCommit,image:originalProductionExecution.executionImages.backend,runtimeBundleSha256:candidateActor.runtimeBundleSha256,generation:physical?request.generation:1,
  database:{name:request.database.name,systemIdentifier:request.database.systemIdentifier},roots:request.roots,ephemeralRoots:request.ephemeralRoots};
 const manifestRaw=bytes(manifest),manifestSha256=sha(manifestRaw);
 const proofDatabases={'compatible-migrations':sourceDatabase,'coherent-independent-restore':independent.proofDatabase,'browser-24-hours':sourceDatabase,'single-worker-and-completion':pairDatabase,'current-domain':pairDatabase};
 const cohorts={'compatible-migrations':sourceClosures,'coherent-independent-restore':independentClosures,'browser-24-hours':sourceClosures,'single-worker-and-completion':[...httpClosures,...jobsClosures],'current-domain':httpClosures};
 const componentSourceCommits=Object.fromEntries(roles.map(role=>[role,report.images[role].sourceCommit]));same(componentSourceCommits.backend,request.targetCommit);
 const archiveReceiptFiles={},imageArchiveReceipts={};
 for(const role of roles){const original=ownedJson(independent,'imageArchiveReceipt-'+role),file=role+'-image-archive-receipt.json';
  same(original.descriptor.sha256,independent.imageArchiveReceipts[role].sha256);same(original.raw.length,independent.imageArchiveReceipts[role].bytes);
  for(const key of ['index','platform','config','rootfsDiffIds','archiveSha256','archiveBytes'])same(original.value[key],independent.imageGraphs[role][key]);
  archiveReceiptFiles[file]=original.raw;imageArchiveReceipts[role]={file,bytes:original.raw.length,sha256:original.descriptor.sha256};}
 const qualification={schemaSha256:main.schemaSha256,sourceDatabase,proofDatabases,recoveryMode:physical?'ONLINE_COHERENT_WAL':'PROTECTED_MAINTENANCE_COMPLETE',deploymentTargetDatabase:request.database,captureId:physical?report.layout.captureId:main.sameReleaseCoherentRestore.captureId,
  images:independent.sourceImages,checkpointArchiveChecksum:request.checkpoint.checksum,componentSourceCommits,runtimeCohorts:Object.fromEntries(scopes.map(scope=>[scope,cohorts[scope].map(actor)])),deploymentTargetImages:independent.images,imageGraphs:independent.imageGraphs,imageArchiveReceipts,
  ...(request.productionExecutionBindings?{productionExecutionBindings:structuredClone(request.productionExecutionBindings)}:{}),
  ...(financial?{protectedFinancial:financial.binding}:{}),
  ...(!physical?{qualificationCheckpoint:{metadataSha256:checkpoint.sha256,metadata:checkpoint.metadata}}:{})};
 const binding={...qualification,manifestSha256,checkpointSha256:metadataSha(request.checkpoint),releaseId:request.releaseId,sourceCommit:request.targetCommit,runtimeBundleSha256:candidateActor.runtimeBundleSha256};
 const common=scope=>({...binding,productionAdmission:true,passResult:true,proofDatabase:proofDatabases[scope],originalNativeClosures:cohorts[scope],executionKind:['compatible-migrations','browser-24-hours'].includes(scope)?'DIAGNOSTIC_SUPPORT':'INSTALLED_RUNTIME'});
 const bridge=json(pair.bridgeProofRawBase64),commands=bridge.durable.commands;
 const singleWorker={unknownOwners:[...httpClosures,...jobsClosures].filter(row=>json(row.workRawBase64).phase!=='QUIESCENT').length,unresolvedCommands:commands.filter(row=>row.status!=='SETTLED').length,nativeJobsObserved:jobsClosures.length>=2,httpTargetCount:httpClosures.length,rowFenceVerified:pair.hostClosed.fence.phase==='CLOSED',targetRuntimeIds:httpClosures.map(row=>row.runtimeId)};
 const protectedDirectoryComponents=physical?undefined:deriveProtectedDirectoryComponents({checkpointMetadataSha256:checkpoint.sha256,metadata:checkpoint.metadata,canonicalRestoreRaw:ownedJson(independent,'canonicalRestoreOutput').raw,baselineRaw:baseline.raw,requestRoots:request.roots});
 const appHealth=Object.fromEntries(roles.map(role=>{const health=report.applicationHealth[role];same(health.image,independent.images[role]);same(health.declaredSourceCommit,componentSourceCommits[role]);return [role,{...health,sourceCommit:health.declaredSourceCommit,...(physical?{captureId:qualification.captureId}:{checkpointMetadataSha256:checkpoint.sha256})}];}));
 const proofs={
  'compatible-migrations':financial?financial.source:{...main,...common('compatible-migrations'),priorMigrationHistorySha256:main.originalHistory.sha256},
  'coherent-independent-restore':{format:'sabalan-native-application-coherent-integration/v1',...common('coherent-independent-restore'),restoredDatabase:independent.restoredDatabase,independentHostQualified:(physical?report.recoveryMachineUuidSha256:report.recoveryHost.machineUuidSha256)!==checkpoint.metadata.sourceMachineUuidSha256,continuousWalQualified:false,immutableDifferentImagesQualified:new Set(roles.map(role=>independent.images[role])).size===3,inquiryRuntimeQualified:report.inquiryClosure.closure.originalReturncode===128&&json(report.inquiryClosure.closure.nativeRawBase64).nativeStatus===143,
   checkpoint:{...checkpoint.metadata,...(!physical?{lastDrill:report.healthyDrill}:{})},checkpointMetadata:checkpoint.metadata,checkpointTransportRawBase64:transport.descriptor.rawBase64,restoredFileRoots:baseline.value.sources.length,...(!physical?{protectedDirectoryComponents}:derivePhysicalComponents(independent,report,request)),applicationHealth:appHealth,
   inquiryNativeClosure:structuredClone(report.inquiryClosure)},
  'browser-24-hours':{...browser,...common('browser-24-hours'),installedRouting:pair.installedRouting},
  'single-worker-and-completion':{format:main.format,...common('single-worker-and-completion'),singleWorker,bridgeProofRawBase64:pair.bridgeProofRawBase64,bridgeAfterDrain:pair.bridgeAfterDrain,workerOwnershipIntervals:pair.workerOwnershipIntervals},
  'current-domain':{format:main.format,...common('current-domain'),domainCases:main.domainCases,writerCoverage:main.writerCoverage}
 };
 // The fixed compiled parser below is the final authority, including migration
 // compatibility, all native/SQL ownership, expiry coverage and nine domains.
 const kernel=originalOnlineEvidenceReader();
 const files={'manifest.json':manifestRaw,...archiveReceiptFiles,...(financial?financial.files:{})};const reports={};
 for(const scope of scopes){const file=scope+'-source.json',raw=financial&&scope==='compatible-migrations'?financial.sourceRaw:bytes(proofs[scope]);files[file]=raw;
  const reportFile=scope+'.json';files[reportFile]=bytes({format:'sabalan-online-qualification/v1',scope,manifestSha256,releaseId:manifest.releaseId,sourceCommit:manifest.sourceCommit,image:manifest.image,productionAdmission:true,proofs:[{file,bytes:raw.length,sha256:sha(raw)}]});reports[scope]={file:reportFile,bytes:files[reportFile].length,sha256:sha(files[reportFile])};}
 files['release-gates.json']=bytes({format:physical?'sabalan-online-private-qualification-prerequisite/v1':'sabalan-protected-private-qualification-prerequisite/v1',releaseId:manifest.releaseId,manifestSha256,...(physical?{checkpointSha256:binding.checkpointSha256,captureId:qualification.captureId}:{qualificationCheckpointSha256:checkpoint.sha256}),publicTrafficQualified:false,qualificationReports:Object.fromEntries(scopes.map(scope=>[scope,reports[scope].sha256]))});
 reports['release-gates']={file:'release-gates.json',bytes:files['release-gates.json'].length,sha256:sha(files['release-gates.json'])};
 files['acceptance.json']=bytes({format:'sabalan-online-release-acceptance/v2',manifestSha256,deploymentId:request.deploymentId,checkpointSha256:binding.checkpointSha256,qualification,reports});
 // Whole metadata must fit the canonical parser's existing admission budget.
 // Refuse explicitly before any output is written; never truncate inventory,
 // drop attachments or relabel a partial point to fit a metadata limit.
 for(const [file,raw]of Object.entries(files))assert.ok(raw.length<=(financial?.files[file]?(file==='protected-financial-currentcompiled.json'?32:file==='protected-financial-workerstdout.json'?40:file==='protected-financial-certificate.json'?65536/1024**2:16)*1024**2:['manifest.json','acceptance.json'].includes(file)?128*1024:8*1024**2),
  'ORIGINAL_ONLINE_EVIDENCE_METADATA_CAPACITY_REFUSED_'+file);
 financial?.revalidate();assertOriginalPrivateEvidenceDirectory(evidenceCustody,evidenceDirectory);same(fs.readdirSync(evidenceDirectory),[]);
 // Retain any failed parser/readback directory; no cleanup or receipt adoption.
 for(const [file,raw] of Object.entries(files)){const fd=fs.openSync(path.join(evidenceDirectory,file),'wx',0o400);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 const acceptanceSha256=sha(files['acceptance.json']),accepted=kernel.readOnlineReleaseEvidence(evidenceDirectory,{manifestSha256,acceptanceSha256});accepted.revalidate();
 for(const closure of accepted.nativeClosures)assert.ok([...local.nativeClosures,...independent.nativeClosures].some(row=>row.runtimeId===closure.runtimeId&&row.nativeSha256===closure.nativeSha256&&row.workSha256===closure.workSha256&&row.activeClaimSha256===closure.activeClaimSha256),'ORIGINAL_ASSEMBLY_NATIVE_UNION_CHANGED');
 financial?.revalidate();assertOriginalPrivateEvidenceDirectory(evidenceCustody,evidenceDirectory);revalidateRequest();
 const token=Object.freeze({});completed.set(token,freeze({format:'sabalan-original-online-evidence-assembly/v1',evidenceDirectory,manifestSha256,acceptanceSha256,files:Object.fromEntries(Object.entries(files).map(([file,raw])=>[file,owned(raw)])),
  originalProductionExecution,originalProductionExecutionSha256:metadataSha(originalProductionExecution),
  canonicalParser:{bundleSha256:kernel.bundleSha256,sourceHashes:kernel.sourceHashes},
  originalLocalCompletionSha256:metadataSha(local),originalIndependentCompletionSha256:metadataSha(independent),...(physical?{originalOnlineRequestSha256:metadataSha(request)}:{originalProtectedRequestSha256:metadataSha(request)}),productionAdmission:false}));return token;
}
