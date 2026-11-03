import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import {
  dryRunLegacyContractProductGraphMigration,
  migrateLegacyContractProductGraph,
} from '../services/contractProductGraphMigration';
import { RECOVERY_COORDINATION_DIR } from '../services/recoveryRuntime';

const apply = process.argv.includes('--apply');
const deploymentMode = process.argv.includes('--deployment-checkpoint');
const databaseUrl = String(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '').trim();
let actorId = String(process.env.MIGRATION_ACTOR_ID || '').trim();
let backupReference = String(process.env.CONTRACT_GRAPH_BACKUP_REFERENCE || '').trim();

if (deploymentMode) {
  const deploymentId = String(process.env.DEPLOYMENT_ID || '').trim();
  if (!deploymentId) throw new Error('DEPLOYMENT_ID is required in deployment-checkpoint mode');
  const checkpoint = JSON.parse(fs.readFileSync(
    path.join(RECOVERY_COORDINATION_DIR, 'deployment-checkpoint.json'),
    'utf8',
  )) as Record<string, unknown>;
  if (checkpoint.deploymentId !== deploymentId || checkpoint.localVerified !== true ||
    checkpoint.remoteVerified !== true || typeof checkpoint.checksum !== 'string') {
    throw new Error('Verified deployment checkpoint is required for contract graph migration');
  }
  actorId = `system-deployment:${deploymentId}`;
  backupReference = `deployment-checkpoint:${deploymentId}:${checkpoint.checksum}`;
}

if (!databaseUrl) throw new Error('MIGRATION_DATABASE_URL is required');
if (apply && !actorId) throw new Error('MIGRATION_ACTOR_ID is required in apply mode');
if (apply && !backupReference) throw new Error('CONTRACT_GRAPH_BACKUP_REFERENCE is required in apply mode');

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const main = async () => {
  const dryRun = await dryRunLegacyContractProductGraphMigration(prisma);
  const summary = {
    mode: apply ? 'APPLY' : 'READ_ONLY',
    scanned: dryRun.scanned,
    migratable: dryRun.migratable,
    ambiguous: dryRun.ambiguous,
    financialDifferences: dryRun.financialDifferences,
    brokenRelationships: dryRun.brokenRelationships,
    missingRatesOrSnapshots: dryRun.missingRatesOrSnapshots,
  };
  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (dryRun.ambiguous > 0 || dryRun.financialDifferences > 0 ||
    dryRun.brokenRelationships > 0 || dryRun.missingRatesOrSnapshots > 0) {
    throw new Error('Migration blocked because the read-only preflight found unresolved evidence conflicts');
  }

  let migrated = 0;
  let alreadyCanonical = 0;
  for (const contract of dryRun.contracts) {
    if (contract.status !== 'migratable') continue;
    const result = await migrateLegacyContractProductGraph(prisma, {
      contractId: String(contract.contractId),
      actorId,
      backupReference,
    });
    if (!result.ok) throw new Error(`Contract ${String(contract.contractNumber)} became ambiguous during migration`);
    if (result.alreadyCanonical) alreadyCanonical += 1;
    else migrated += 1;
  }
  console.log(JSON.stringify({ ...summary, migrated, alreadyCanonical }, null, 2));
};

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
