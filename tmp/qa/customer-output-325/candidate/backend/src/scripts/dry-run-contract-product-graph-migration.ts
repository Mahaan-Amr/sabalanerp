import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { dryRunLegacyContractProductGraphMigration } from '../services/contractProductGraphMigration';

const outputArg = process.argv.find(argument => argument.startsWith('--output='));
const output = outputArg?.slice('--output='.length) ||
  path.resolve(process.cwd(), 'reports', 'contract-product-graph-migration-dry-run.json');

const main = async () => {
  const prisma = new PrismaClient();
  try {
    const report = await dryRunLegacyContractProductGraphMigration(prisma);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ output, ...report, contracts: undefined }, null, 2));
    if (
      report.ambiguous > 0 ||
      report.financialDifferences > 0 ||
      report.brokenRelationships > 0 ||
      report.missingRatesOrSnapshots > 0
    ) {
      process.exitCode = 2;
    }
  } finally {
    await prisma.$disconnect();
  }
};

main().catch(error => {
  console.error('Contract product graph migration dry-run failed:', error);
  process.exitCode = 1;
});
