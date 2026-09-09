import { prisma } from '../../lib/prisma';
import { executePerformanceErasureOperation } from '../personnelPerformanceErasureStore';

const operationId = process.env.PERFORMANCE_ERASURE_CRASH_OPERATION_ID;
if (!operationId) throw new Error('PERFORMANCE_ERASURE_CRASH_OPERATION_ID is required.');

const main = async () => {
  await executePerformanceErasureOperation(prisma, operationId, new Date('2026-09-09T00:00:00Z'), {
    eraseArtifacts: async () => process.exit(91),
  });
  throw new Error('Crash barrier was not reached.');
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
