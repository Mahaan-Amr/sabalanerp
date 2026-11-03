import assert from 'node:assert/strict';
import {test} from 'node:test';
import {exactCandidateMigrationDigests,exactCandidateMigrationNames,exactCandidatePlanSha256} from '../protectedCandidateMigrationInventory';
import {verifyCandidateNativeHistory} from '../protectedCandidateNativeEvidence';

const date='2026-11-03T00:00:00.000Z',checkpoint='a'.repeat(64),catalogs=Array.from({length:15},(_,i)=>i.toString(16).repeat(64));
const old={id:'old-id',migration_name:'old-migration',checksum:'b'.repeat(64),started_at:date,finished_at:date,rolled_back_at:null,logs:null,applied_steps_count:1};
const make=()=>exactCandidateMigrationNames.map((name,i)=>({id:`new-${i}`,migration_name:name,checksum:exactCandidateMigrationDigests[name],started_at:date,finished_at:date,rolled_back_at:null,applied_steps_count:1,
 logs:JSON.stringify({format:'sabalan-owned-candidate-migration/v2',planSha256:exactCandidatePlanSha256,sqlSha256:exactCandidateMigrationDigests[name],checkpointSha256:checkpoint,beforeScopedProjectionSha256:catalogs[i],afterScopedProjectionSha256:catalogs[i+1]})}));

test('native history comparison preserves old rows and accepts only the complete receipt chain without authority',()=>{
 const before=JSON.stringify([old]),after=JSON.stringify([old,...make()]);
 const result=verifyCandidateNativeHistory(before,after,before,catalogs[14],checkpoint);
 assert.equal(result.added,14);assert.equal(result.nativeObservation,'UNBOUND');assert.equal(result.catalogQualification,'UNPROVEN');assert.equal(result.productionAdmission,false);
});
test('native history comparison rejects changed prior bytes, missing rows and forged lineage',()=>{
 const before=JSON.stringify([old]),rows=make();
 assert.throws(()=>verifyCandidateNativeHistory(before,JSON.stringify([{...old,checksum:'f'.repeat(64)},...rows]),before,catalogs[14],checkpoint));
 assert.throws(()=>verifyCandidateNativeHistory(before,JSON.stringify([old,...rows.slice(1)]),before,catalogs[14],checkpoint));
 const altered=make();const receipt=JSON.parse(altered[5].logs);receipt.beforeScopedProjectionSha256='f'.repeat(64);altered[5].logs=JSON.stringify(receipt);
 assert.throws(()=>verifyCandidateNativeHistory(before,JSON.stringify([old,...altered]),before,catalogs[14],checkpoint));
 assert.throws(()=>verifyCandidateNativeHistory(before,JSON.stringify([old,...rows]),'[]',catalogs[14],checkpoint));
});
test('native history rejects a migration whose finish precedes its start',()=>{
 const rows=make();rows[0].started_at='2026-11-03T00:00:00.002Z';
 assert.throws(()=>verifyCandidateNativeHistory(JSON.stringify([old]),JSON.stringify([old,...rows]),JSON.stringify([old]),catalogs[14],checkpoint));
});
