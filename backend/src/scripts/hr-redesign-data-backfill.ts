import { PrismaClient } from '@prisma/client';
import { runHrRedesignBackfill } from '../services/hrRedesignDataContracts';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const shakilaArgument = process.argv.find((argument) => argument.startsWith('--shakila-user-id='));
const shakilaUserId = shakilaArgument?.slice('--shakila-user-id='.length) || process.env.HR_SHAKILA_USER_ID;

runHrRedesignBackfill(prisma, { apply, shakilaUserId })
  .then((report) => {
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2));
    if (report.totals.blockingFailures > 0) process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
