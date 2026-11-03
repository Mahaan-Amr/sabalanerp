import fs from 'node:fs';
import path from 'node:path';
import { createPartnerLifecycleDatabase } from '../../../backend/src/services/__tests__/partnerCaseLifecycleDatabase';
import { seedHistoricalAccountingRead } from '../../../backend/src/services/__tests__/partnerAccountingHistoricalReadSeed';

async function main() {
  const root = process.cwd();
  const directory = path.join(root, 'reports/qa/accounting-loading-20261012');
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: root,
    sourceDatabaseUrl: process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL! });
  const database = temporary.client();
  const stop = path.join(directory, 'browser-fixture-cleanup.request');
  try {
    await seedHistoricalAccountingRead(database);
    fs.writeFileSync(path.join(directory, 'browser-fixture.json'), JSON.stringify({ databaseName: temporary.databaseName,
      runId: temporary.runId, status: 'SEEDED', createdAt: new Date().toISOString() }, null, 2));
    console.log(JSON.stringify({ status: 'SEEDED', databaseName: temporary.databaseName }));
    await new Promise<void>(resolve => {
      const timer = setInterval(() => { if (fs.existsSync(stop)) { clearInterval(timer); resolve(); } }, 1000);
    });
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
    if (fs.existsSync(stop)) fs.unlinkSync(stop);
    fs.writeFileSync(path.join(directory, 'browser-fixture.json'), JSON.stringify({ databaseName: temporary.databaseName,
      runId: temporary.runId, status: 'CLEANED', completedAt: new Date().toISOString() }, null, 2));
    console.log('Isolated browser database cleaned');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
