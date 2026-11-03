import { disconnectDatabase, prisma } from '../lib/prisma';
import { initializeSystemRecovery } from '../services/systemRecoveryLifecycle';
import { readRestoreJournal } from '../services/systemRecoveryEngine';

const main = async () => {
  const before = await readRestoreJournal();
  if (!before || before.phase !== 'DATABASE_PROMOTED') {
    throw Object.assign(new Error('A promoted automatic rollback journal was not found.'), { code: 'DEPLOYMENT_ROLLBACK_JOURNAL_MISSING' });
  }
  await initializeSystemRecovery(prisma);
  const after = await readRestoreJournal();
  if (after) throw Object.assign(new Error('Rollback finalization did not clear the recovery journal.'), { code: 'DEPLOYMENT_ROLLBACK_FINALIZE_FAILED' });
  console.log(JSON.stringify({ ok: true, operationId: before.operationId }));
};

main()
  .catch((error: any) => {
    console.error(JSON.stringify({ ok: false, code: error?.code || 'DEPLOYMENT_ROLLBACK_FINALIZE_FAILED', message: error?.message }));
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
