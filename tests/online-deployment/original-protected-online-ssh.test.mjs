import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyProtectedQualificationRequest,readOriginalProtectedQualificationRequest,sendOriginalProtectedQualificationPackage,verifyOriginalPhysicalPointTransfer,readOriginalProtectedPhysicalPointSource,verifyOriginalTerminalWalRequest,readOriginalProtectedTerminalWalSource,verifyOriginalOnlineQualificationRequest,readOriginalOnlineQualificationRequest} from '../../scripts/lib/original-protected-online-ssh.mjs';
const digest=raw=>createHash('sha256').update(raw).digest('hex'),raw=value=>Buffer.from(JSON.stringify(value));

function dataOnlyRequest(){return{format:'sabalan-original-protected-qualification-request/v1',sequence:1,
 deploymentId:'test_deployment',releaseId:'test_release',targetCommit:'a'.repeat(40),
 database:{name:'unit_database',oid:'1',systemIdentifier:'2'},checkpoint:{deploymentId:'test_deployment',releaseId:'test_release',captureMethod:'PROTECTED_MAINTENANCE_COMPLETE',
  id:'test_deployment',targetCommit:'a'.repeat(40),sourceDatabase:{name:'unit_database',oid:'1',systemIdentifier:'2'},size:123,createdAt:'2026-10-20T00:00:00Z',
  sourceMachineUuidSha256:'e'.repeat(64),sourceKernelBootIdSha256:'f'.repeat(64),compatibility:{local:{compatible:true},remote:{compatible:true}},
  localVerified:true,remoteVerified:true,restoreVerified:true,manifestReadable:true,checksum:'b'.repeat(64)},
 roots:Array.from({length:9},(_,i)=>({live:'/app/storage/test-'+i,store:'/app/recovery-coordination/test-'+i,
  liveDevice:'1',liveInode:String(i+1),storeDevice:'2',storeInode:String(i+1),baselineSha256:'c'.repeat(64)})),
 ephemeralRoots:['/app/storage/reports','/app/storage/sales-reports','/app/storage/bi-reports'],adoptionSha256:'d'.repeat(64)};}

test('ONLINE request preserves distinct physical point/live stage and cannot mint ownership',()=>{
 const old=dataOnlyRequest(),{adoptionSha256,...common}=old,body={...common,format:'sabalan-original-online-qualification-request/v1',generation:2,
  checkpoint:{...old.checkpoint,captureMethod:'ONLINE_COHERENT_WAL',independentRestoreVerified:true,continuousWalQualified:false,continuousWalCoveragePhase:'LIVE_ORIGINAL_OWNER',repositoryDirectory:{captureId:'1'.repeat(64)}},
  liveCoverage:{format:'sabalan-original-live-wal-coverage/v1',phase:'LIVE_ORIGINAL_OWNER',finalIntervalCompletion:false,captureId:'1'.repeat(64),sourceDatabase:old.database}};
 assert.deepEqual(verifyOriginalOnlineQualificationRequest(body),body);assert.throws(()=>readOriginalOnlineQualificationRequest(body),/ORIGINAL_ONLINE_REQUEST_REQUIRED/);
 for(const change of [{generation:1},{checkpoint:{...body.checkpoint,captureMethod:'PROTECTED_MAINTENANCE_COMPLETE'}},{liveCoverage:{...body.liveCoverage,captureId:'2'.repeat(64)}},{liveCoverage:{...body.liveCoverage,finalIntervalCompletion:true}}])assert.throws(()=>verifyOriginalOnlineQualificationRequest({...body,...change}));
});

test('data-only validation never mints an original protected request',()=>{
 const request=verifyProtectedQualificationRequest(dataOnlyRequest());
 assert.throws(()=>readOriginalProtectedQualificationRequest(request),/ORIGINAL_PROTECTED_REQUEST_REQUIRED/);
 assert.throws(()=>readOriginalProtectedQualificationRequest({}),/ORIGINAL_PROTECTED_REQUEST_REQUIRED/);
});
test('different checkpoint domain, root aliases and extra commands refuse',()=>{
 for(const change of [row=>{row.checkpoint.captureMethod='ONLINE_COHERENT_WAL';},
  row=>{row.roots[0].live='/app/storage/../alias';},row=>{row.roots[1].store=row.roots[0].store;},
  row=>{row.checkpoint.releaseId='another_release';},row=>{row.command='sign-arbitrary';},row=>{row.checkpoint.sourceDatabase.oid='99';},
  row=>{delete row.checkpoint.sourceKernelBootIdSha256;},row=>{row.checkpoint.compatibility.remote.compatible=false;},row=>{row.ephemeralRoots[0]='/app/tmp/arbitrary';}]){
  const row=dataOnlyRequest();change(row);assert.throws(()=>verifyProtectedQualificationRequest(row));
 }
});
test('caller JSON cannot be sent as an original issued qualification package',async()=>{
 await assert.rejects(sendOriginalProtectedQualificationPackage({}, {}, {}),/QUALIFICATION_ORIGINAL_PACKAGE_REQUIRED/);
});
test('physical point parser binds canonical operation, native boot and actual cipher inventory but cannot mint a token',()=>{
 const captureId='1'.repeat(64),boot='11111111-2222-4333-8444-555555555555',manifestRaw=raw({operation:captureId});
 const producerRaw=raw({format:'sabalan-original-online-checkpoint-producer-result/v1',captureId,manifestSha256:digest(manifestRaw),captureClosure:{nativeRawBase64:raw({phase:'QUIESCENT',nativeStatus:0,nativeReaped:true,databaseQuiet:true,guardian:{bootId:boot}}).toString('base64')}});
 const sealedRaw=raw({format:'sabalan-online-checkpoint-components-sealed/v1',phase:'SEALED_LOCAL',operation:captureId,manifestSha256:digest(manifestRaw),objects:Array.from({length:15},(_,i)=>({name:'object_'+i,cipherFile:'/actual/sealed/object_'+i,cipherBytes:100,cipherSha256:'a'.repeat(64)}))});
 const header={request:{format:'sabalan-original-physical-point-transfer-request/v1',sequence:1,challenge:'2'.repeat(64),runtimeId:'3'.repeat(64),captureId},producerRawBase64:producerRaw.toString('base64'),plaintextManifestRawBase64:manifestRaw.toString('base64'),sealedManifestRawBase64:sealedRaw.toString('base64'),sourceHost:{machineUuidSha256:'4'.repeat(64),kernelBootIdSha256:digest(Buffer.from(boot))},postgresUser:'actual_owner'};
 const parsed=verifyOriginalPhysicalPointTransfer(header);assert.equal(parsed.objects.length,15);assert.throws(()=>readOriginalProtectedPhysicalPointSource(parsed));
 for(const change of [v=>v.sourceHost.kernelBootIdSha256='5'.repeat(64),v=>v.postgresUser='other;SQL',v=>v.request.captureId='6'.repeat(64)]){const value=structuredClone(header);change(value);assert.throws(()=>verifyOriginalPhysicalPointTransfer(value));}
});
test('terminal parser refuses partial producer closure and never mints original custody',()=>{
 const terminal={format:'sabalan-original-terminal-wal-coverage/v1',phase:'COMPLETE',ownedChildrenDomain:'continuous-wal-producer',allOriginalChildrenClosed:true,replicationAuthenticationRestored:true,finalIntervalCompletion:true,captureId:'1'.repeat(64),publicationSha256:'2'.repeat(64),terminalEpochSha256:'3'.repeat(64),windows:[{requestSha256:'4'.repeat(64),windowSha256:'5'.repeat(64),certificateSha256:'6'.repeat(64)}]};
 const bytes=raw(terminal),request={format:'sabalan-original-terminal-wal-publication-request/v1',sequence:1,challenge:'7'.repeat(64),runtimeId:'8'.repeat(64),terminalRawBase64:bytes.toString('base64'),terminalResultSha256:digest(bytes),canonicalMetadataSha256:'9'.repeat(64),pointIndexSha256:'a'.repeat(64)};
 assert.equal(verifyOriginalTerminalWalRequest(request),request);assert.throws(()=>readOriginalProtectedTerminalWalSource(request));
 const changed=structuredClone(request),bad=raw({...terminal,replicationAuthenticationRestored:false});changed.terminalRawBase64=bad.toString('base64');changed.terminalResultSha256=digest(bad);assert.throws(()=>verifyOriginalTerminalWalRequest(changed));
});
