import { PrismaClient } from '@prisma/client';

/** Read-only preflight and post-cleanup witness for the existing local database. */
export async function auditAccountingProductionShape(database: PrismaClient) {
  const [ordinary, cases, committed, incomplete] = await Promise.all([
    database.salesContract.count({ where: { partnerCaseId: null } }),
    database.partnerSaleCase.count(),
    database.partnerSaleCase.count({ where: { state: 'COMMITTED' } }),
    database.partnerSaleCase.findMany({
      where: { state: 'COMMITTED' },
      select: { id: true, headRevision: true, committedRevision: true,
        internalRecordId: true, customerContractId: true, commitmentEventId: true,
        head: { select: { revision: true, internalProjection: true, customerProjection: true } },
        commitmentRevision: { select: { revision: true } },
        internalRecord: { select: { id: true } },
        customerContract: { select: { id: true } },
      },
    }),
  ]);
  const missingWitnesses = incomplete.filter(row =>
    !row.head || row.head.revision !== row.headRevision ||
    !row.commitmentRevision || row.commitmentRevision.revision !== row.committedRevision ||
    !row.internalRecord || row.internalRecord.id !== row.internalRecordId ||
    !row.customerContract || row.customerContract.id !== row.customerContractId ||
    !row.commitmentEventId || !row.head.internalProjection || !row.head.customerProjection,
  ).map(row => row.id);
  return { ordinary, cases, committed, missingWitnesses };
}

if (process.argv[1]?.endsWith('accountingProductionShapeAudit.ts')) {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('The existing sabalanerp-local PostgreSQL URL is required');
  }
  url.searchParams.set('connection_limit', '2');
  url.searchParams.set('pool_timeout', '10');
  const database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  auditAccountingProductionShape(database).then(result => {
    console.log(JSON.stringify(result));
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  }).finally(() => database.$disconnect());
}
