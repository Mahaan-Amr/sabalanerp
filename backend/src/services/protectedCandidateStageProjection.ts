import {candidateStageWitness} from './protectedCandidateStageWitness';
import {exactCandidateMigrationDigests,exactCandidateMigrationNames} from './protectedCandidateMigrationInventory';

type Kind='tables'|'functions';
type HashMap=Record<string,string>;
/** Derives scoped expected hashes from the earliest measured before state and
 * the last witnessed after state at the requested prefix. Receipt hashes cover
 * only the listed semantic fields, not ownership, data, all SQL dependencies,
 * PostgreSQL execution authority or full catalog qualification. */
export function candidateStageProjection(prefix:number){
 if(!Number.isInteger(prefix)||prefix<0||prefix>exactCandidateMigrationNames.length)return {state:'UNKNOWN' as const};
 if(candidateStageWitness.stages.length!==exactCandidateMigrationNames.length)return {state:'UNKNOWN' as const};
 const result:{tables:HashMap;functions:HashMap}={tables:{},functions:{}};
 const chronological:{tables:HashMap;functions:HashMap}={tables:{},functions:{}};
 for(let i=0;i<candidateStageWitness.stages.length;i++){
  const step=candidateStageWitness.stages[i];
  if(step.name!==exactCandidateMigrationNames[i]||step.sqlSha256!==exactCandidateMigrationDigests[step.name])return {state:'UNKNOWN' as const};
  for(const kind of ['tables','functions'] as const){
   const before=step.before[kind] as Readonly<HashMap>,after=step.after[kind] as Readonly<HashMap>;
   const names=Object.keys(before);
   if(JSON.stringify(names.slice().sort())!==JSON.stringify(Object.keys(after).sort()))return {state:'UNKNOWN' as const};
   for(const name of names){
    if(!/^[a-f0-9]{64}$/.test(before[name])||!/^[a-f0-9]{64}$/.test(after[name]))return {state:'UNKNOWN' as const};
    if(chronological[kind][name]!==undefined&&chronological[kind][name]!==before[name])return {state:'UNKNOWN' as const};
    // A future stage's first observed before state cannot establish that
    // object's value at this earlier prefix; admit it only at that stage.
    if(i<=prefix&&result[kind][name]===undefined)result[kind][name]=before[name];
    if(i<prefix)result[kind][name]=after[name];
    chronological[kind][name]=after[name];
   }
  }
 }
 return Object.freeze({state:'SCOPED_EXPECTATION' as const,prefix,receiptSha256:candidateStageWitness.receiptSha256,
  serverVersion:candidateStageWitness.settings.server_version_num,tables:Object.freeze(result.tables),functions:Object.freeze(result.functions),
  requiredAdditionalDimensions:Object.freeze(['pinned-ddl-source-map','relation-security-and-control-role','customer-barrier-public-revoke','sales-dispatch-invoice-sequence','purchasing-documents-serial-sequence-binding'] as const),
  requiredSeparateGates:Object.freeze(['protectedBoundary-and-assertLease','full-native-history-and-receipt-prefix','host-compose-database-role-binding','migration-data-barriers-and-release-acceptance'] as const)});
}
