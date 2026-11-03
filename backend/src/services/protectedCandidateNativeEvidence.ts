import {createHash} from 'node:crypto';
import {deriveCandidateResumeIndex,exactCandidateMigrationDigests,exactCandidateMigrationNames,exactCandidatePlanSha256} from './protectedCandidateMigrationInventory';

type NativeRow={id:string;migration_name:string;checksum:string;started_at:string;finished_at:string|null;rolled_back_at:string|null;logs:string|null;applied_steps_count:number};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const fail=():never=>{throw new Error('CANDIDATE_NATIVE_EVIDENCE_UNPROVEN');};
function history(raw:string):NativeRow[]{
 if(typeof raw!=='string'||Buffer.byteLength(raw)>16*1024*1024)fail();
 const values=JSON.parse(raw);
 if(!Array.isArray(values)||values.length>8192)fail();
 const ids=new Set<string>();
 for(const value of values){
  if(!value||Object.keys(value).sort().join(',')!==['applied_steps_count','checksum','finished_at','id','logs','migration_name','rolled_back_at','started_at'].sort().join(',')||
   typeof value.id!=='string'||!value.id||value.id.length>256||ids.has(value.id)||typeof value.migration_name!=='string'||value.migration_name.length>256||
   !/^[a-f0-9]{64}$/.test(value.checksum)||typeof value.started_at!=='string'||!Number.isFinite(Date.parse(value.started_at))||
   (value.finished_at!==null&&(typeof value.finished_at!=='string'||!Number.isFinite(Date.parse(value.finished_at))))||
   (value.rolled_back_at!==null&&(typeof value.rolled_back_at!=='string'||!Number.isFinite(Date.parse(value.rolled_back_at))))||
   (value.logs!==null&&(typeof value.logs!=='string'||Buffer.byteLength(value.logs)>65536))||!Number.isSafeInteger(value.applied_steps_count)||value.applied_steps_count<0)fail();
  if(value.rolled_back_at===null&&(value.finished_at===null||value.applied_steps_count<1))fail();
  ids.add(value.id);
 }
 return values;
}

/**
 * Data-only comparison of original native history bytes and 14 receipts.
 * This cannot mint a catalog, owner, checkpoint, restore or release authority;
 * the original issuer must bind these bytes to actual native observations.
 */
export function verifyCandidateNativeHistory(beforeRaw:string,afterRaw:string,priorRaw:string,currentCatalogSha256:string,checkpointSha256:string){
 const before=history(beforeRaw),after=history(afterRaw);
 if(beforeRaw!==priorRaw)fail();
 const originalIds=new Set(before.map(row=>row.id));
 const retained=after.filter(row=>originalIds.has(row.id));
 if(JSON.stringify(retained)!==JSON.stringify(before))fail();
 const added=after.filter(row=>!originalIds.has(row.id));
 if(added.length!==exactCandidateMigrationNames.length||after.length!==before.length+added.length)fail();
 if(before.some(row=>row.rolled_back_at===null&&Object.prototype.hasOwnProperty.call(exactCandidateMigrationDigests,row.migration_name)))fail();
 const ordered=exactCandidateMigrationNames.map(name=>{
  const matches=added.filter(row=>row.migration_name===name);
  if(matches.length!==1)fail();const row=matches[0];
  if(row.rolled_back_at!==null||row.finished_at===null||row.applied_steps_count!==1||row.logs===null||Date.parse(row.finished_at)<Date.parse(row.started_at))fail();
   let receipt:any;try{receipt=JSON.parse(row.logs!);}catch{fail();}
  return {name:row.migration_name,checksum:row.checksum,finished:true,rolledBack:false,receipt};
 });
 if(deriveCandidateResumeIndex(ordered,currentCatalogSha256,checkpointSha256)!==exactCandidateMigrationNames.length)fail();
 return Object.freeze({format:'sabalan-candidate-native-history-comparison/v1',planSha256:exactCandidatePlanSha256,
  beforeSha256:hash(beforeRaw),afterSha256:hash(afterRaw),priorSha256:hash(priorRaw),added:added.length,
  nativeObservation:'UNBOUND' as const,catalogQualification:'UNPROVEN' as const,productionAdmission:false as const});
}
