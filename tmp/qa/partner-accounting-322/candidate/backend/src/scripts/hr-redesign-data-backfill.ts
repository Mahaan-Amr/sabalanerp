import { PrismaClient } from '@prisma/client';
import { runHrRedesignBackfill } from '../services/hrRedesignDataContracts';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

runHrRedesignBackfill(prisma, { apply })
  .then((report) => {
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2));
    if (report.totals.blockingFailures > 0) process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
