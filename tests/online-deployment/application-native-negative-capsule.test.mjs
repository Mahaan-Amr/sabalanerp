/** Synthetic validation only; no Docker, native lifecycle or admission is implied. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {negativeCapsuleFormat,negativeCapsuleAcceptanceFormat,negativeCapsuleSubpath,negativeCapsuleNonce,negativeCapsuleNames,validateNegativeCapsuleAcceptanceResult,negativeCapsuleAcceptanceBootstrap} from '../../scripts/lib/application-native-negative-capsule-acceptance.mjs';
import {isNegativeAcceptanceSubpath,validateNegativeAcceptanceDescriptor} from '../../scripts/lib/application-native-negative-acceptance.mjs';
import {validateNegativeQaHistory} from '../../scripts/lib/application-native-qa-memory.mjs';
const copy=v=>structuredClone(v);
function fixture(){
 const namespace={st_dev:'1',st_ino:'2'},full={readOnly:true,capsulesVerified:2,directoryIdentities:{},prisma:{inventorySha256:'a'.repeat(64)},inquiry:{inventorySha256:'b'.repeat(64)},lockIdentities:[{file:'a'},{file:'b'},{file:'c'}],inventoryChild:{originalPid:123,code:0,stdoutEof:true,stderrEof:true},databaseExecuted:false,nativeActorStarted:false,productionAdmission:false};
 const descriptor={format:negativeCapsuleFormat,acceptance:{format:negativeCapsuleAcceptanceFormat,subpath:negativeCapsuleSubpath,nonce:negativeCapsuleNonce,namespace,canonicalCapsules:full,physicalEmpty:false,actorEntries:[]}};
 const result={format:'sabalan-C29-current-two-readonly-capsule-acceptance/v1',mode:'verify',nonce:negativeCapsuleNonce,namespace:copy(namespace),physicalEmpty:false,actorEntries:[],readOnlyCapsules:copy(negativeCapsuleNames),canonicalCapsules:copy(full),qualificationSucceeded:false,productionAdmission:false};result.canonicalCapsules.inventoryChild.originalPid=456;
 return{descriptor,result};
}
test('new original inventory PID may differ while full readonly capsule bytes and locks remain equal',()=>{const {descriptor,result}=fixture();assert.equal(validateNegativeCapsuleAcceptanceResult(descriptor,result),result);});
for(const [name,mutate]of Object.entries({empty:v=>v.physicalEmpty=true,actor:v=>v.actorEntries=['new'],root:v=>v.namespace.st_ino='3',capsule:v=>v.canonicalCapsules.prisma.inventorySha256='c'.repeat(64),lock:v=>v.canonicalCapsules.lockIdentities.pop(),pid:v=>v.canonicalCapsules.inventoryChild.originalPid=0,booleanCode:v=>v.canonicalCapsules.inventoryChild.code=false,eof:v=>v.canonicalCapsules.inventoryChild.stderrEof=false,database:v=>v.canonicalCapsules.databaseExecuted=true,actorStarted:v=>v.canonicalCapsules.nativeActorStarted=true,admission:v=>v.productionAdmission=true,extra:v=>v.empty=true}))test('typed capsule readback refuses '+name,()=>{const {descriptor,result}=fixture();mutate(result);assert.throws(()=>validateNegativeCapsuleAcceptanceResult(descriptor,result));});
test('only one literal nested view extends the existing single-segment contract',()=>{
 for(const subpath of ['c16-recovery-'+'a'.repeat(32),negativeCapsuleSubpath]){assert.equal(isNegativeAcceptanceSubpath(subpath),true);validateNegativeAcceptanceDescriptor({namedVolume:'sabalanerp-local_online_runtime_acceptance',target:'/app/online-runtime-acceptance',subpath});}
 for(const value of [negativeCapsuleSubpath+'/',negativeCapsuleSubpath.replace('32c294','33c294'),'c16-recovery-'+'a'.repeat(32)+'/c16-recovery-'+'b'.repeat(32),'../'+negativeCapsuleSubpath])assert.equal(isNegativeAcceptanceSubpath(value),false);
});
test('current negative history has an exact handoff/history pair, with old C16 evidence preserved',()=>{
 const current={handoff:{sha256:'6543f4851d2076af49aaf20ee4238a2935cb615fa143e45bc7a0593ae3f12edd'},history:{sha256:'80e2d47c2f59f492df124109499393dbdc6b4c88efbfef954b048b0815dcfe67'}};
 validateNegativeQaHistory(current);const old={handoff:{sha256:'a'.repeat(64)},history:{sha256:'a1d336899e2f90c9a9324ee761a19f0d1ac5388bdaf5455c5cfadba07c91d18e'}};validateNegativeQaHistory(old);
 for(const p of [{handoff:current.handoff,history:old.history},{handoff:old.handoff,history:current.history}])assert.throws(()=>validateNegativeQaHistory(p));
});
test('actual Python bootstrap preserves binary stdin used by the canonical helper',()=>{
 const source=Buffer.from('import json,sys\np=json.loads(sys.stdin.buffer.read());print(json.dumps(p))\n'),hash=createHash('sha256').update(source).digest('hex');
 const child=spawnSync(process.env.PYTHON??'python',['-I','-B','-c',negativeCapsuleAcceptanceBootstrap(hash)],{input:JSON.stringify({source:source.toString('base64'),spec:{binaryStdin:true}}),encoding:'utf8',windowsHide:true});
 assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);assert.equal(child.stderr,'');assert.deepEqual(JSON.parse(child.stdout),{binaryStdin:true});
});
