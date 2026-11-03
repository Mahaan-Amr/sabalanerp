import { PrismaClient } from '@prisma/client';
import { migrateOpenSharedDecisionDuties } from '../services/sharedDutyMigration';

const database = new PrismaClient();
const apply = process.argv.includes('--apply');

const assertProtectedMutationBoundary = async () => {
  if (!apply) return null;
  const deploymentId = String(process.env.DEPLOYMENT_ID || '').trim();
  const releaseId = String(process.env.DEPLOYMENT_RELEASE_ID || '').trim();
  const leaseToken = String(process.env.DEPLOYMENT_LEASE_TOKEN || '').trim();
  if (!deploymentId || !releaseId || !leaseToken) throw new Error('DEPLOYMENT_MUTATION_BOUNDARY_REQUIRED');
  const operation = await database.deploymentOperation.findUnique({ where: { id: deploymentId } });
  if (!operation || operation.activeKey !== 'production' || operation.releaseId !== releaseId
    || operation.leaseToken !== leaseToken || operation.leaseExpiresAt <= new Date()
    || operation.phase !== 'MUTATION_STARTED' || !operation.checkpointJson) {
    throw new Error('DEPLOYMENT_MUTATION_BOUNDARY_NOT_PROVEN');
  }
  return operation;
};

assertProtectedMutationBoundary()
  .then((operation) => migrateOpenSharedDecisionDuties(database, {
    apply, createdBefore: operation?.startedAt,
  }))
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => database.$disconnect());
