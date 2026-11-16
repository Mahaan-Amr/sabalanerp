import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createTemporaryConcurrencyDatabase } from '../src/services/__tests__/shipmentStatementConcurrency/database';

async function main() {
  const source = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
  if (!source) throw new Error('ACCOUNTING_LEDGER_TEST_DATABASE_URL is required');
  const temporary = await createTemporaryConcurrencyDatabase({
    repositoryRoot: path.resolve(process.cwd(), '..'), sourceDatabaseUrl: source, migrateEmptySchema: true,
  });
  try {
    const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', '--test', 'src/services/__tests__/accountingCustomerCommandStatusHttp.integration.test.ts'], {
      cwd: process.cwd(), env: { ...process.env, DATABASE_URL: temporary.databaseUrl }, stdio: 'inherit', timeout: 300_000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    await temporary.cleanup();
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
