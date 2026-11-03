/** Data-only consumer of #411's actual retained records. No process/receipt
 * becomes a live carrier capability or earns native admission here. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const same=assert.deepEqual;
const HEX=/^[a-f0-9]{64}$/;
function read(reference){
  same(Object.keys(reference).sort(),['bytes','rawBase64','sha256']);
  assert.ok(Number.isSafeInteger(reference.bytes)&&reference.bytes>0&&reference.bytes<=1024*1024);
  assert.match(reference.sha256,HEX);assert.equal(typeof reference.rawBase64,'string');
  assert.ok(reference.rawBase64.length<=Math.ceil(reference.bytes/3)*4);
  const raw=Buffer.from(reference.rawBase64,'base64');same(raw.toString('base64'),reference.rawBase64);
  same(raw.length,reference.bytes);same(sha(raw),reference.sha256);return JSON.parse(raw);
}
export function assertRestoredInquiryCarrierObservation(evidence,expected){
  same(Object.keys(evidence).sort(),['activeNative','finalNative','requestedStop','retirement','work','workClaim','workScope']);
  const records=Object.fromEntries(Object.entries(evidence).map(([name,ref])=>[name,read(ref)]));
  const {activeNative:initial,finalNative:final,requestedStop:request,retirement,work,workClaim,workScope}=records;
  same(initial.format,'sabalan-inquiry-native/v2');same(initial.phase,'ACTIVE');
  assert.ok(Number.isSafeInteger(initial.guardian.pid)&&initial.guardian.pid>1);
  same(initial.onlineScope,expected.scope);
  same(request,{format:'sabalan-private-inquiry-requested-stop/v1',guardian:initial.guardian,
    activeClaimSha256:evidence.activeNative.sha256,signal:'SIGTERM',expectedNativeStatus:143,naturalExitZeroExpected:false});
  same(final,{...initial,phase:'QUIESCENT',nativeReaped:true,sqliteNativeClosed:true,stoppedBySignal:true,
    nativeStatus:143,activeClaimSha256:evidence.activeNative.sha256});
  same(retirement.format,'sabalan-restored-inquiry-retired/v1');same(retirement.retired,true);
  same(Object.keys(retirement).sort(),['closure','format','inputSqlite','nativeQualified','originalDatabase','productionAdmission','retired']);
  same(retirement.nativeQualified,false);same(retirement.productionAdmission,false);
  same(retirement.originalDatabase,expected.originalDatabase);same(retirement.originalDatabase.path,'/data/inquiry.db');
  assert.match(retirement.originalDatabase.sha256,HEX);
  same(retirement.inputSqlite,expected.inputSqlite);same(retirement.inputSqlite.sha256,expected.restoredSqliteSha256);
  assert.match(expected.restoredSqliteSha256,HEX);same(retirement.inputSqlite.sidecars,[]);
  const sqlite=retirement.inputSqlite;
  assert.match(sqlite.path,/^\/.*\/inquiry-restored-[a-f0-9]{32}\/restored\.db$/);
  same(path.posix.normalize(sqlite.path),sqlite.path);
  same(initial.sqlite.file,sqlite.path);same(initial.sqlite.device,sqlite.device);same(initial.sqlite.inode,sqlite.inode);
  same(retirement.closure,{retiredByRequestedSigterm:true,nativeStatus:143,naturalExitZero:false,
    originalPopenPid:initial.guardian.pid,wrapperStatus:128,nativeSha256:evidence.finalNative.sha256,workClosed:true});
  same(work.format,'sabalan-runtime-boundary/v1');same(work.phase,'QUIESCENT');same(work.claimSha256,evidence.workClaim.sha256);
  same(workClaim.format,'sabalan-runtime-claim/v2');same(workClaim.scopeSha256,evidence.workScope.sha256);
  same(workClaim.native,{scopeSha256:expected.scope.sha256,claimSha256:evidence.activeNative.sha256});
  same(workScope.format,'sabalan-runtime-namespace/v1');
  for(const [field,value]of Object.entries({runtimeId:expected.scope.scope.runtimeId,image:expected.scope.scope.image,
    registrySha256:expected.scope.scope.manifestSha256,generation:1}))same(workScope.scope[field],value);
  const {device,inode,ownerUid}=expected.scope.scope.gate;same(workScope.scope.gate,{device,inode,ownerUid});
  return Object.freeze({role:'inquiry',originalPopenPid:initial.guardian.pid,wrapperStatus:128,nativeStatus:143,
    naturalExitZero:false,retirementSha256:evidence.retirement.sha256,nativeQualified:false,productionAdmission:false});
}
