import path from 'node:path';
import {readProtectedMigrationSources,validateProtectedMigrationHistory} from '../services/protectedMigrationHistory';
import { assertProtectedBridgeMigrationAuthority, compileProtectedBridgeMigration, applyProtectedBridgeMigration,
  protectedBridgeMigrationNames,protectedBoundary } from '../services/protectedBridgeMigrations';
import {compileExactCandidatePending,exactCandidateMigrationNames} from '../services/protectedCandidateMigrationInventory';
import {readCandidateTransactionObservation,readProtectedTransactionHistory} from '../services/protectedCandidateTransactionObservation';
import {readCandidateProjection} from '../services/protectedCandidateProjection';
import {compileProtectedBootstrapSource} from '../services/protectedBootstrapMigrations';

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const required = (key: string) => {
  const value = process.env[key];
  if (!value || value.length > 256) fail('PROTECTED_MIGRATION_OWNER_REQUIRED');
  return value!;
};

async function main() {
  if (process.argv.length !== 2) fail('PROTECTED_MIGRATION_ARGUMENTS_UNSUPPORTED');
  const owner = Object.freeze({ deploymentId: required('DEPLOYMENT_ID'), releaseId: required('DEPLOYMENT_RELEASE_ID'),
    leaseToken: required('DEPLOYMENT_LEASE_TOKEN') });
  const {prisma,disconnectDatabase}=await import('../lib/prisma');
  try {
  await assertProtectedBridgeMigrationAuthority(prisma, owner);
  const directory = path.resolve(__dirname, '../../prisma/migrations');
  const files = readProtectedMigrationSources(directory);
  const history = await prisma.$queryRaw<Array<{ name: string; checksum: string; finished: Date | null; rolledBack: Date | null }>>`
    SELECT migration_name AS name,checksum,finished_at AS finished,rolled_back_at AS "rolledBack" FROM public._prisma_migrations`;
  const applied = validateProtectedMigrationHistory(history,files);
  // Compile EVERY pending file before the first DDL. An unreviewed later file
  // cannot cause a partially completed bridge followed by an unsafe fallback.
  const pending = [...files].filter(([name]) => !applied.has(name)).sort(([a], [b]) => a.localeCompare(b));
  // Classification examines complete source before pending/no-pending routing;
  // exact source identity and the protected projection are separate gates.
  const candidateSource=exactCandidateMigrationNames.every(name=>files.has(name));
  if(candidateSource)compileExactCandidatePending(exactCandidateMigrationNames.map(name=>({name,bytes:files.get(name)!})));
  else compileProtectedBootstrapSource(directory);
  let legacySourceVerified=false;
  {
    // Source projection is validated against the locked deployment row and
    // every migration byte in the immutable image; names alone never qualify.
    await prisma.$transaction(async tx=>{
      const boundary=protectedBoundary(owner);boundary();
      const [lock]=await tx.$queryRaw<Array<{owned:boolean}>>`SELECT pg_try_advisory_xact_lock(741936426::bigint) AS owned`;
      if(!lock?.owned)fail('PROTECTED_BRIDGE_ALREADY_RUNNING');
      const observation=candidateSource?await readCandidateTransactionObservation(tx,owner,files):await readProtectedTransactionHistory(tx,owner,files);
      const projection=readCandidateProjection({deploymentId:owner.deploymentId,releaseId:owner.releaseId,targetCommit:observation.targetCommit,controlImage:required('DEPLOYMENT_CONTROL_IMAGE')},files);
      if(projection.sourceImageBinding!=='HOST_REPORTED_NOT_INDEPENDENT')fail('PROTECTED_SOURCE_BINDING_UNPROVEN');
      const again=candidateSource?await readCandidateTransactionObservation(tx,owner,files):await readProtectedTransactionHistory(tx,owner,files);
      if(again.targetCommit!==observation.targetCommit||again.checkpointChecksum!==observation.checkpointChecksum||JSON.stringify(again)!==JSON.stringify(observation))fail('CANDIDATE_CONTEXT_CHANGED');
      if(!candidateSource)compileProtectedBootstrapSource(directory);
      boundary();
    },{maxWait:1000,timeout:15000});
    await assertProtectedBridgeMigrationAuthority(prisma,owner);
    if(candidateSource){
      compileExactCandidatePending(exactCandidateMigrationNames.map(name=>({name,bytes:files.get(name)!})));
      // A prefix alone cannot establish a reviewed schema projection or an
      // atomic migration/receipt implementation. Keep every DDL path closed.
      fail('CANDIDATE_EXECUTOR_CATALOG_UNQUALIFIED');
    }
    // Only the separately frozen complete 425+2 legacy source is accepted;
    // missing candidate files cannot be treated as an arbitrary legacy plan.
    legacySourceVerified=true;
  }
  for (const [name, bytes] of pending) compileProtectedBridgeMigration(name, bytes);
  // A retry must validate prior bridge receipts before applying a later step.
  // Native history without an owned receipt requires inspection, even when no
  // SQL is pending. Never silently bless an unrelated executor's history.
  for (const name of protectedBridgeMigrationNames.filter(name => applied.has(name))) {
    await applyProtectedBridgeMigration(prisma, owner, name, files.get(name)!);
  }
  for (const [name, bytes] of pending) {
    const result = await applyProtectedBridgeMigration(prisma, owner, name, bytes);
    console.log(JSON.stringify({ migration: name, ...result }));
  }
  await assertProtectedBridgeMigrationAuthority(prisma, owner);
  console.log(JSON.stringify({ protectedMigrationsCompleted: true, pendingCount: pending.length,...(legacySourceVerified?{sourceClassification:'LEGACY_SOURCE_VERIFIED_IMAGE_HOST_REPORTED'}:{}) }));
  } finally {await disconnectDatabase();}
}

if (require.main===module) main().catch((error: any) => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'PROTECTED_MIGRATION_FAILED' }));
  process.exitCode = 1;
});
