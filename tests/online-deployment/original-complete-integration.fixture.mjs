// MODELED domain/native facts only. Real finite pipe/file tests consume these
// bytes, but never earn genuine FULL, source authority or production admission.
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {completeCallbackRequest} from '../../scripts/lib/original-complete-callback.mjs';
import {completeOwnedBytes as ref} from '../../scripts/lib/original-complete-join.mjs';
import {fixture as inquiryFixture} from './restored-inquiry-carrier-observation.fixture.mjs';
import {assertRestoredInquiryCarrierObservation} from '../../scripts/lib/restored-qa/inquiry-carrier-observation.mjs';
const require=createRequire(import.meta.url),{kernel,live}=require('./original-complete-model.fixture.cjs');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
export const raw=value=>Buffer.from(JSON.stringify(value)+'\n');
export async function completeFixture(overrides={}){
 const k=await kernel(),{source:proof,binding:expected}=live(k,0,overrides),p=proof.protectedDirectoryComponents,j=p.liveFinalJoin;
 const frames=Buffer.from(j.workerStdoutRawBase64,'base64').toString().trimEnd().split('\n').map(JSON.parse);
 const database=proof.restoredDatabase,identity={session:frames[0].session,operation:'b'.repeat(32),sourceCommit:proof.sourceCommit,database};
 const descriptor=completeCallbackRequest(identity,proof.checkpointMetadata.manifest),baseline=JSON.parse(Buffer.from(j.baselineOriginalRawBase64,'base64'));
 const n=proof.originalNativeClosures[1],closure={closed:{...n,format:'sabalan-original-independent-private-runtime/v1',event:'CLOSED',mode:'http'},productionAdmission:false};
 const inquiry=inquiryFixture(),health={format:'sabalan-original-complete-application-health/v1',database,productionAdmission:false,
  applications:Object.fromEntries(Object.entries(proof.applicationHealth).map(([role,value])=>{
   const response=Buffer.from('observed-model-'+role);value.responseSha256=sha(response);delete value.captureId;
   return[role,{image:value.image,sourceCommit:value.sourceCommit,status:200,responseRawBase64:response.toString('base64'),responseSha256:sha(response)}];}))};
 const healthRaw=raw(health),frontend={role:'frontend',originalPid:444,code:0,signal:null,stdoutEof:true,stderrEof:true,killed:false,observationFault:null,sha256:sha(healthRaw)};
 const probe={database,authenticated:true,businessVerified:true,filesVerified:true,originals:[frontend,{role:'inquiry',evidence:inquiry.evidence}],productionAdmission:false};
 const life={baseline,closure,probe,inquiryClosure:assertRestoredInquiryCarrierObservation(inquiry.evidence,inquiry.expected),
  final:{database,sql:{visible:true,sessions:0,prepared:0},filesVerified:true,productionAdmission:false},cleanupPending:true,independentPointHealthy:false,productionAdmission:false};
 const baselineValue=JSON.parse(Buffer.from(p.baselineRawBase64,'base64'));
 const app={format:'sabalan-live-restored-application-artifacts/v1',database,sourceDatabase:baselineValue.restoredQaLineage.sourceDatabase,
  restoredQaLineage:baselineValue.restoredQaLineage,completeManifestValueRawBase64:j.completeManifestValueRawBase64,workingManifestValueRawBase64:j.workingManifestValueRawBase64,
  originalNativeHistoryRawBase64:Buffer.from(frames[0].proof.rawHistoryJson).toString('base64'),baselineRawBase64:p.baselineRawBase64,lifecycle:life,usersObservation:{originalUsersAndCredentialsUnchanged:true,originalRelationshipsAndPermissionsUnchanged:true,database},cleanupPending:true,independentPointHealthy:false,productionAdmission:false};
 const appRaw=raw(app),applicationFile='/private/modeled-application.json';
 frames[2].result.privateQa={value:{coherentQualification:{format:'sabalan-live-restored-application-reference/v1',file:applicationFile,sha256:sha(appRaw),bytes:appRaw.length},terminalObservation:{format:'sabalan-original-complete-terminal-observation/v1',database,sql:{visible:true,sessions:0,prepared:0},originalInquiryConservationRechecked:true}}};
 const workerRaw=Buffer.concat(frames.map(raw)),worker=JSON.parse(Buffer.from(j.workerOriginalRawBase64,'base64'));
 worker.stdoutRawBase64=workerRaw.toString('base64');worker.stdoutSha256=sha(workerRaw);
 const report={phase:'COMPLETE',pass:true,continuousWalQualified:false,recoveryMode:'PROTECTED_MAINTENANCE_COMPLETE',baseline,backendClosure:closure,
  images:Object.fromEntries(Object.entries(proof.applicationHealth).map(([role,h])=>[role,{sourceCommit:h.sourceCommit}])),
  applicationHealth:Object.fromEntries(Object.entries(proof.applicationHealth).map(([role,h])=>[role,{image:h.image,declaredSourceCommit:h.sourceCommit,status:200,responseSha256:h.responseSha256}]))};
 const record={format:'sabalan-live-existing-compose-independent-record/v1',productionAdmission:false,proofDatabase:database,restoredDatabase:database,
  images:expected.deploymentTargetImages,ownedOutputs:{report:ref(raw(report))},fileHashes:{}};
 const seed={independentRecord:record,proofSource:proof,expected};
 const capture={format:'sabalan-original-complete-capture/v1',request:descriptor.request,requestBytes:ref(descriptor.raw),manifestBytes:ref(descriptor.manifestRaw),
  ack:{format:'sabalan-original-complete-callback-ack/v1',...identity,requestSha256:descriptor.sha256,callbackDrained:true,productionAdmission:false},
  workerStdout:ref(workerRaw),workerOriginal:ref(raw(worker)),applicationArtifact:ref(appRaw),applicationFile,seed:ref(raw(seed)),
  probe,healthObservation:ref(healthRaw),inquiryExpected:inquiry.expected,workerClosedAt:'2026-10-20T00:00:59Z',capturedAt:'2026-10-20T00:01:00Z',workerClosedBeforeCapture:true,cleanupStarted:false,productionAdmission:false};
 const captureRaw=raw(capture),oldResult=JSON.parse(Buffer.from(j.ownerResultRawBase64,'base64'));
 const result={...oldResult,operation:identity.operation,outerOriginalClosurePending:true,completeCapture:{file:'/private/complete-capture.json',sha256:sha(captureRaw)},cleanupStartedAt:'2026-10-20T00:02:00Z'};
 const ownerRaw=raw(result),reference={file:'/private/owner-result.json',sha256:sha(ownerRaw),strictCompleteValidationSucceeded:true,outerOriginalClosurePending:true,productionAdmission:false};
 const stdout=Buffer.concat([raw({format:'sabalan-r9-master-private-credential-ready/v1',operation:identity.operation,credentialsRead:false,productionAdmission:false}),raw(reference)]);
 const owner={row:{...JSON.parse(Buffer.from(j.ownerOriginalRawBase64,'base64')),format:'sabalan-original-complete-owner-closure/v1',stdoutSha256:sha(stdout),stdoutBytes:stdout.length,
  closedAt:'2026-10-20T00:03:00Z'},resultReference:reference,stdoutRawBase64:stdout.toString('base64'),stderrRawBase64:''};
 return{k,proof,expected,identity,descriptor,frames,app,appRaw,seed,capture,captureRaw,result,ownerRaw,owner,healthRaw,frontend,inquiry,completedAt:'2026-10-20T00:04:00Z'};
}
