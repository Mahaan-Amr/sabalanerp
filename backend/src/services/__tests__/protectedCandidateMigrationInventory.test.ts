import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {candidateNeedsPreflight,compileExactCandidatePending,deriveCandidateResumeIndex,exactCandidatePlanSha256,exactCandidateMigrationNames,assertNoPendingHasPreflightRoute} from '../protectedCandidateMigrationInventory';

const migrations=join(process.cwd(),'backend','prisma','migrations');
const files=()=>exactCandidateMigrationNames.map(name=>({name,bytes:readFileSync(join(migrations,name,'migration.sql'))}));

test('the candidate guard covers initial and interrupted suffixes without claiming unrelated work',()=>{
 assert.equal(candidateNeedsPreflight(exactCandidateMigrationNames,exactCandidateMigrationNames),true);
 assert.equal(candidateNeedsPreflight(exactCandidateMigrationNames.slice(9),exactCandidateMigrationNames),true);
 // Ambiguous incomplete sources remain blocked until manifest identity is
 // independently bound; this currently also blocks a legacy-only plan.
 assert.equal(candidateNeedsPreflight([exactCandidateMigrationNames[0]],[exactCandidateMigrationNames[0]]),true);
 assert.equal(candidateNeedsPreflight([exactCandidateMigrationNames[0]],exactCandidateMigrationNames),true);
 assert.equal(candidateNeedsPreflight([],exactCandidateMigrationNames),true);
 assert.equal(candidateNeedsPreflight(['not-a-candidate-migration'],exactCandidateMigrationNames),true);
 assert.equal(candidateNeedsPreflight([],[]),false);
 assert.throws(()=>assertNoPendingHasPreflightRoute([],[]),/SOURCE_IDENTITY_UNPROVEN/);
 assert.doesNotThrow(()=>assertNoPendingHasPreflightRoute([],exactCandidateMigrationNames));
});

test('the ordered candidate is byte-pinned and the customer barrier remains one DO statement',()=>{
 const plan=compileExactCandidatePending(files());
 assert.equal(plan.length,14);
 const barrier=plan.find(item=>item.name==='20261019010000_customer_semantic_barrier');
 assert.ok(barrier);assert.equal(barrier.statements.length,1);
 assert.match(barrier.statements[0],/DO \$install_customer_barrier\$/);
 assert.ok(plan.every(item=>item.statements.length>0));
});

test('resume derives only a contiguous owned receipt chain ending at the current catalog',()=>{
 const plan=compileExactCandidatePending(files());
 const checkpoints=['a','b','c','d'].map(x=>x.repeat(64)),checkpoint='e'.repeat(64);
 const rows=plan.slice(0,3).map((item,i)=>({name:item.name,checksum:item.sha256,finished:true,rolledBack:false,
  receipt:{format:'sabalan-owned-candidate-migration/v2',planSha256:exactCandidatePlanSha256,sqlSha256:item.sha256,checkpointSha256:checkpoint,beforeScopedProjectionSha256:checkpoints[i],afterScopedProjectionSha256:checkpoints[i+1]}}));
 assert.equal(deriveCandidateResumeIndex([],checkpoints[0],checkpoint),0);assert.equal(deriveCandidateResumeIndex(rows,checkpoints[3],checkpoint),3);
 assert.throws(()=>deriveCandidateResumeIndex([rows[0],rows[2]],checkpoints[3],checkpoint),/CANDIDATE_RESUME_RECEIPT_UNPROVEN/);
 assert.throws(()=>deriveCandidateResumeIndex([rows[0],rows[0]],checkpoints[1],checkpoint),/CANDIDATE_RESUME_RECEIPT_UNPROVEN/);
 assert.throws(()=>deriveCandidateResumeIndex(rows,'f'.repeat(64),checkpoint),/CANDIDATE_RESUME_CATALOG_CHANGED/);
 assert.throws(()=>deriveCandidateResumeIndex(rows,checkpoints[3],'f'.repeat(64)),/CANDIDATE_RESUME_RECEIPT_UNPROVEN/);
 const broken=[rows[0],{...rows[1],receipt:{...rows[1].receipt,beforeScopedProjectionSha256:'f'.repeat(64)}},rows[2]];
 assert.throws(()=>deriveCandidateResumeIndex(broken,checkpoints[3],checkpoint),/CANDIDATE_RESUME_RECEIPT_UNPROVEN/);
 assert.throws(()=>deriveCandidateResumeIndex([{...rows[0],receipt:{...rows[0].receipt,planSha256:'f'.repeat(64)}}],checkpoints[1],checkpoint),/CANDIDATE_RESUME_RECEIPT_UNPROVEN/);
 assert.throws(()=>deriveCandidateResumeIndex([{...rows[0],rolledBack:true}],checkpoints[1],checkpoint),/CANDIDATE_RESUME_RECEIPT_UNPROVEN/);
});

test('altered, missing, reordered or extra migration bytes fail before compilation returns',()=>{
 const baseline=files();
 assert.throws(()=>compileExactCandidatePending(baseline.slice(1)),/CANDIDATE_PENDING_SET_UNPROVEN/);
 assert.throws(()=>compileExactCandidatePending([...baseline,baseline[0]]),/CANDIDATE_PENDING_SET_UNPROVEN/);
 const swapped=[...baseline];[swapped[0],swapped[1]]=[swapped[1],swapped[0]];
 assert.throws(()=>compileExactCandidatePending(swapped),/CANDIDATE_PENDING_IDENTITY_UNPROVEN/);
 const changed=baseline.map((file,i)=>i===5?{...file,bytes:Buffer.concat([file.bytes,Buffer.from('\n')])}:file);
 assert.throws(()=>compileExactCandidatePending(changed),/CANDIDATE_PENDING_IDENTITY_UNPROVEN/);
});
