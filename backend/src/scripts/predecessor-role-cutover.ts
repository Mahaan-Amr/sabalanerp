import path from 'node:path';
import { verifyPredecessorRoleCutover } from '../services/protectedDatabaseRoleRecovery';

async function main() {
  const [stage, extra] = process.argv.slice(2);
  if (extra || (stage !== 'before-grants' && stage !== 'grants-staged')
    || process.env.BACKEND_RUNTIME_ROLE !== 'control' || !process.env.DATABASE_URL) {
    throw new Error('A control connection and one cutover verification stage are required.');
  }
  console.log(JSON.stringify(await verifyPredecessorRoleCutover({
    databaseUrl: process.env.DATABASE_URL,
    migrationsDirectory: path.resolve('prisma', 'migrations'),
    catalogFile: path.resolve('scripts', 'predecessor-role-catalog.json'),
    stage,
  })));
}

main().catch((error: unknown) => {
  const failure = error as { code?: string; message?: string };
  console.error(failure.code === 'PROTECTED_DATABASE_ROLE_RECOVERY_REJECTED'
    ? failure.message
    : 'PREDECESSOR_ROLE_CUTOVER_VERIFICATION_FAILED');
  process.exitCode = 1;
});
