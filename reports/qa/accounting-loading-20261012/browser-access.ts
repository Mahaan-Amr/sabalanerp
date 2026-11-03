import fs from 'node:fs';
import { PrismaClient } from '../../../backend/node_modules/@prisma/client';

async function main() {
  const fixture = JSON.parse(fs.readFileSync('reports/qa/accounting-loading-20261012/browser-fixture.json', 'utf8'));
  if (fixture.status !== 'SEEDED' || !/^sabalanerp_concurrency_[a-f0-9]{16}$/.test(fixture.databaseName)) throw Error('Unowned test database');
  const database = new PrismaClient({ datasources: { db: { url:
    `postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/${fixture.databaseName}?schema=public&connection_limit=2&pool_timeout=10` } } });
  try {
    await database.workspacePermission.create({ data: { userId: 'historical-admin', workspace: 'accounting', permissionLevel: 'admin' } });
    for (const feature of ['accounting_dashboard_view', 'accounting_contracts_view']) {
      await database.featurePermission.create({ data: { userId: 'historical-admin', workspace: 'accounting', feature,
        permissionLevel: 'view', grantedBy: 'historical-admin' } });
    }
    console.log('Isolated browser fixture Accounting read permissions provisioned');
  } finally { await database.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
