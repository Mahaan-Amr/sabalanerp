// MODELED protocol data only; no native acceptance or live capability.
import {createHash} from 'node:crypto';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
export const reference=value=>{const raw=Buffer.from(JSON.stringify(value)+'\n');return{rawBase64:raw.toString('base64'),bytes:raw.length,sha256:sha(raw)};};
export function fixture(){
 const scope={sha256:'1'.repeat(64),scope:{runtimeId:'2'.repeat(64),image:'sha256:'+'3'.repeat(64),manifestSha256:'4'.repeat(64),gate:{device:'1',inode:'2',ownerUid:0}}};
 const originalDatabase={path:'/data/inquiry.db',sha256:'5'.repeat(64),device:'1',inode:'3',sidecars:[]};
 const inputSqlite={path:'/private/inquiry-restored-'+'6'.repeat(32)+'/restored.db',sha256:'7'.repeat(64),device:'1',inode:'4',sidecars:[]};
 const guardian={pid:42,startTicks:'100',bootId:'unit-only',pidNamespace:'pid:[9]'};
 const initial={format:'sabalan-inquiry-native/v2',phase:'ACTIVE',guardian,onlineScope:scope,onlineLocks:{unitOnly:true},lock:{device:'1',inode:'5'},commandSha256:'8'.repeat(64),sqlite:{file:inputSqlite.path,device:inputSqlite.device,inode:inputSqlite.inode}};
 const activeNative=reference(initial),requestedStop=reference({format:'sabalan-private-inquiry-requested-stop/v1',guardian,activeClaimSha256:activeNative.sha256,signal:'SIGTERM',expectedNativeStatus:143,naturalExitZeroExpected:false});
 const finalNative=reference({...initial,phase:'QUIESCENT',nativeReaped:true,sqliteNativeClosed:true,stoppedBySignal:true,nativeStatus:143,activeClaimSha256:activeNative.sha256});
 const workScope=reference({format:'sabalan-runtime-namespace/v1',scope:{runtimeId:scope.scope.runtimeId,image:scope.scope.image,registrySha256:scope.scope.manifestSha256,generation:1,gate:scope.scope.gate}});
 const workClaim=reference({format:'sabalan-runtime-claim/v2',scopeSha256:workScope.sha256,native:{scopeSha256:scope.sha256,claimSha256:activeNative.sha256}});
 const work=reference({format:'sabalan-runtime-boundary/v1',phase:'QUIESCENT',claimSha256:workClaim.sha256});
 const retirement=reference({format:'sabalan-restored-inquiry-retired/v1',retired:true,originalDatabase,inputSqlite,closure:{retiredByRequestedSigterm:true,nativeStatus:143,naturalExitZero:false,originalPopenPid:guardian.pid,wrapperStatus:128,nativeSha256:finalNative.sha256,workClosed:true},nativeQualified:false,productionAdmission:false});
 return {evidence:{activeNative,finalNative,requestedStop,retirement,work,workClaim,workScope},expected:{scope,originalDatabase,inputSqlite,restoredSqliteSha256:inputSqlite.sha256}};
}
