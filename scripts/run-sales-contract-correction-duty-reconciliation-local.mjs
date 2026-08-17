import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, [
  'backend/node_modules/tsx/dist/cli.mjs',
  'backend/src/scripts/report-sales-contract-correction-duty-reconciliation.ts',
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL
      || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10&application_name=sabalanerp-sales-correction-duty-reconciliation-local',
  },
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
