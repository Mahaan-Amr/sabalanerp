// Explicit model facts, never operational receipts or genuine completion tokens.
import fs from 'node:fs';import path from 'node:path';
import {componentFixture,owned,sha} from './independent-components-evidence.fixture.mjs';
import {compileSerialExistingPostgresPlan} from '../../scripts/lib/serial-physical/serial-owner.mjs';
import {validateOriginalIndependentApplicationClosures} from '../../scripts/lib/independent-full-restore-ssh.mjs';
export {owned};
export function physicalFixture(directory){
 const v=componentFixture(),captureId=v.source.captureId,operation='a'.repeat(32),db={database:'source_db',databaseOid:'123',systemIdentifier:'222'};
 const source={...v.source,request:{captureId},sourceOriginalPid:99};
 const point={name:'model_cut',lsn:'0/120',requiredWalEndLsn:'0/200'};
 const captureClosure={originalDockerPid:101,originalDockerStatus:0,freshNamespaceSessions:0,preparedTransactions:0,
  nativeRawBase64:owned({phase:'QUIESCENT',nativeStatus:0,nativeReaped:true,databaseQuiet:true,stoppedBySignal:false}).rawBase64};
 const wal={phase:'COMPLETE',nativeReaped:true,databaseQuiet:true,nativeStatus:0};
 const cuts=Array.from({length:9},(_,i)=>({name:'root'+i,storeRoot:'/store/root'+i,sha256:'3'.repeat(64)}));
 const captured={captureId,database:db,restorePoint:point,sqliteSnapshot:{sha256:'4'.repeat(64)},coordinationHistory:{sha256:'5'.repeat(64)},versionedCuts:cuts};
 const coverage={restorePointLsn:point.lsn,startLsn:'0/100',endLsn:'0/300',timeline:1,nativeClosureQualified:false,independentRestoreQualified:false,
  database:{databaseName:db.database,databaseOid:db.databaseOid,systemIdentifier:db.systemIdentifier},captureClosure,
  physicalBaseProof:{archiveSha256:'b'.repeat(64),archiveBytes:100}};
 const manifest=JSON.parse(Buffer.from(source.ownedOutputs.plaintextManifest.rawBase64,'base64'));
 const sealed=JSON.parse(Buffer.from(source.ownedOutputs.sealedManifest.rawBase64,'base64'));
 const facts={'coherent-cut':owned(captured),'coverage-manifest':owned(coverage),'wal-capture':owned(wal)};
 for(const [role,d]of Object.entries(facts)){const i=manifest.sources.findIndex(row=>row.role===role);Object.assign(manifest.sources[i],{bytes:d.bytes,sha256:d.sha256});Object.assign(sealed.objects[i],manifest.sources[i],{cipherBytes:d.bytes+1024});}
 manifest.sourceCaptureSha256=facts['coherent-cut'].sha256;manifest.coverageSha256=facts['coverage-manifest'].sha256;
 source.ownedOutputs={plaintextManifest:owned(manifest),sealedManifest:owned(sealed)};
 source.sealedManifestSha256=source.ownedOutputs.sealedManifest.sha256;source.plaintextManifestSha256=source.ownedOutputs.plaintextManifest.sha256;
 source.cipherInventorySha256='6'.repeat(64);
 const producer={format:'sabalan-original-online-checkpoint-producer-result/v1',captureId,manifestSha256:source.plaintextManifestSha256,phase:'POINT_COMPONENTS_MATERIALIZED',
  originalPointChildren:['physical-base','coherent-capture','initial-wal'].map((role,i)=>({role,originalPid:100+i,returncode:0,signal:null,stdoutSha256:'7'.repeat(64),stderrSha256:'8'.repeat(64)})),
  captureClosure,walClosure:wal,independentRestoreVerified:false,remoteVerified:false,healthyRecoveryPoint:false,productionAdmission:false};source.ownedOutputs.producer=owned(producer);
 v.decrypted.components=sealed.objects.map(({name,role,bytes,sha256,cipherBytes,cipherSha256})=>({name,role,bytes,sha256,cipherBytes,cipherSha256}));
 Object.assign(v.decrypted,{sealedSha256:source.sealedManifestSha256,manifestSha256:source.plaintextManifestSha256});
 const decrypt=owned(v.decrypted),rsa={...v.report,sealedManifestSha256:source.sealedManifestSha256,plaintextManifestSha256:source.plaintextManifestSha256,
  decryptionRawBase64:decrypt.rawBase64,decryptionSha256:decrypt.sha256,materialFacts:facts,physicalBaseFacts:{backup_manifest:'9'.repeat(64),'global/pg_control':'0'.repeat(64)},
  ownedOutputs:{decryption:decrypt},originalControllers:[{pid:500,code:0,signal:null}]};
 const layout={format:'sabalan-original-independent-online-layout/v1',operation,captureId,physicalReplayQualified:false,productionAdmission:false,
  sourceDatabase:db,restorePoint:point,coverage,sqlite:{sha256:captured.sqliteSnapshot.sha256,bytes:100},physicalBase:{backupManifestSha256:rsa.physicalBaseFacts.backup_manifest,files:3},
  coordinationHistory:{sha256:captured.coordinationHistory.sha256,archivalOnly:true,runtimeAdmission:false},
  restoredFileCuts:cuts.map(cut=>({name:cut.name,sourceStoreRoot:cut.storeRoot,actual:{format:'sabalan-versioned-file-restore/v1',sealSha256:cut.sha256,files:[]}}))};
 const controlDataRaw='Database system identifier: 222\nmax_connections setting: 100\nmax_worker_processes setting: 8\nmax_wal_senders setting: 10\nmax_prepared_xacts setting: 0\nmax_locks_per_xact setting: 64\n';
 const originalService={image:'postgres:15-alpine',environment:{PGDATA:'/var/lib/postgresql/data'},volumes:[{type:'volume',source:'postgres_data',target:'/var/lib/postgresql/data'}]};
 const plan=compileSerialExistingPostgresPlan({operation,originalService,originalImage:'sha256:'+'a'.repeat(64),originalSystemIdentifier:'111',physicalInput:{layout,controlDataRaw,postgresUser:'postgres'}});
 const incarnation={format:'sabalan-original-serial-restored-incarnation/v1',operation,project:'sabalanerp-local',service:'postgres',systemIdentifier:'111',containerId:'a'.repeat(64),image:plan.originalImage,startedAt:'2026-10-25T10:00:02Z',epoch:2,productionAdmission:false};
 const images={backend:'sha256:'+'1'.repeat(64),frontend:'sha256:'+'2'.repeat(64),inquiry:'sha256:'+'3'.repeat(64)};
 function closure(i){const scope={scope:{runtimeId:String(i+1).repeat(64),image:images[i===2?'inquiry':'backend'],database:db}};
  const claim={scopeSha256:owned(scope).sha256,native:{scopeSha256:'b'.repeat(64),claimSha256:'c'.repeat(64)}};
  const native={phase:'QUIESCENT',nativeReaped:true,databaseQuiet:true,sqliteNativeClosed:true,nativeStatus:i===2?143:0,stoppedBySignal:i===2,
   guardian:{pid:800+i},activeClaimSha256:'c'.repeat(64),onlineScope:{sha256:'b'.repeat(64),scope:scope.scope}};
  return {originalPopenPid:800+i,originalReturncode:i===2?128:0,naturalExitZero:i!==2,workScopeRawBase64:owned(scope).rawBase64,workClaimRawBase64:owned(claim).rawBase64,
   workRawBase64:owned({phase:'QUIESCENT',claimSha256:owned(claim).sha256}).rawBase64,nativeRawBase64:owned(native).rawBase64};}
 const report={format:'sabalan-original-same-compose-online-physical-restore/v1',pass:true,phase:'COMPLETE',recoveryMode:'ONLINE_COHERENT_WAL',continuousWalQualified:false,
  productionAdmission:false,physicalReplayQualified:true,physicalAndThreeApplicationsQualified:true,
  sourceHost:source.sourceHost,replayHost:{machineUuidSha256:'1'.repeat(64),kernelBootIdSha256:'2'.repeat(64)},rsaHost:rsa.rsaHost,
  ...Object.fromEntries(['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256'].map(k=>[k,source[k]])),layout,
  restorePoint:plan.canonicalReplay.restorePoint,replay:{inRecovery:false,lastReplayLsn:'0/180',systemIdentifier:'222',sourceDatabaseOid:'123'},decryption:v.decrypted,
  sourceDatabase:{name:db.database,oid:db.databaseOid,systemIdentifier:db.systemIdentifier},baseline:closure(0),backendClosure:{closed:closure(1)},inquiryClosure:{closure:closure(2)},
  images:Object.fromEntries(Object.keys(images).map(role=>[role,{sourceCommit:'a'.repeat(40)}])),applicationHealth:Object.fromEntries(Object.entries(images).map(([role,image])=>[role,{image,declaredSourceCommit:'a'.repeat(40),status:200,responseSha256:'d'.repeat(64)}]))};
 const app={replayHost:report.replayHost,ownedOutputs:{report:owned(report),layout:owned(layout),captured:facts['coherent-cut'],coverage:facts['coverage-manifest'],walClosure:facts['wal-capture']},
  images,sourceImages:images,imageGraphs:{},imageArchiveReceipts:{},imageCipherSources:{},proofDatabase:{},restoredDatabase:{},controllerSourceSha256:'e'.repeat(64),
  nativeClosures:validateOriginalIndependentApplicationClosures(report),originalControllers:[{pid:700,code:0,signal:null,stdoutEof:true,stderrEof:true}]};
 const originalControllers=[['VERIFY_BACKUP','backup verified'],['VERIFY_WAL','wal verified'],['PHYSICAL_CONTROLDATA',controlDataRaw]].map(([phase,text],i)=>{
  const file=path.join(directory,'stdout-'+i);fs.writeFileSync(file,text);return{phase,originalPid:600+i,code:0,signal:null,stdoutEof:true,stderrEof:true,observationFault:false,stdoutFile:file,stdoutBytes:Buffer.byteLength(text),stdoutSha256:sha(Buffer.from(text))};});
 const serial={operation,originalClusterRestored:true,restoredIncarnation:incarnation,originalControllers,replay:report.replay,applicationResult:app};
 const transfer={sourceOriginalPid:source.sourceOriginalPid,initialWindowBindings:[Object.fromEntries(['requestSha256','dependencySha256','certificateSha256','bindingSha256'].map(key=>[key,'a'.repeat(64)]))],expected:{onlinePhysicalPoint:{captureId,root:'/rsa/point',sealedFile:'/rsa/sealed',manifestFile:'/rsa/manifest',cipherPaths:{}}}};
 return {source,transfer,rsa,serial,plan,incarnation,report,app,startedAt:'2026-10-25T10:00:00Z',completedAt:'2026-10-25T10:00:03Z'};
}
