import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';

// Local workflow smoke test. The source has a different migration ledger from production;
// the protected release rehearsal owns production-ledger and retained-release proof.
async function run() {
  const repositoryRoot = path.resolve(process.cwd(), '..');
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  if (!sourceDatabaseUrl || new URL(sourceDatabaseUrl).pathname !== '/sabalanerp')
    throw new Error('Use the existing sabalanerp-local source database.');
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot, sourceDatabaseUrl });
  const db = database.client();
  try {
    const selected = [
      '20261021120000_attendance_effective_rest_windows',
      '20261025120000_preserve_exact_fulfillment_quantities',
      '20261028090000_sales_dispatch_invoices',
      '20261028093000_sales_invoice_evidence_constraints',
      '20261028100000_sales_invoice_correction_evidence',
      '20261107000100_restart_dispatch_waybill_sequence_at_zero',
      '20261107120000_legacy_waybill_reconstructions',
    ];
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    for (const migration of selected)
      assert(applied.some(row => row.migration_name === migration), `Candidate clone lacks ${migration}`);

    for (const testFile of ['salesDispatchInvoice.integration.test.ts', 'attendanceRest.integration.test.ts']) {
      execFileSync(process.execPath, [require.resolve('tsx/cli'), '--test', `src/services/__tests__/${testFile}`], {
        cwd: path.join(repositoryRoot, 'backend'),
        env: { ...process.env, DATABASE_URL: database.databaseUrl,
          SABALAN_CANDIDATE_QA_DATABASE_NAME: database.databaseName },
        stdio: 'inherit', timeout: 120_000,
      });
    }
    console.log(`Protected Sales/Dispatch and Attendance local candidate smoke: PASS (${database.databaseName})`);
  } finally {
    await db.$disconnect();
    // Child Prisma engines can release their PostgreSQL sessions just after exit.
    // Keep the helper's session/prepared-transaction guard and allow that release.
    let cleanupError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await database.cleanup(); cleanupError = null; break; }
      catch (error) { cleanupError = error; await new Promise(resolve => setTimeout(resolve, 5000)); }
    }
    if (cleanupError) throw cleanupError;
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
