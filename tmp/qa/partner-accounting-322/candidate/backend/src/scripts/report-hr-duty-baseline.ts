import { PrismaClient } from '@prisma/client';
import { runHrDutyBaselineCommand } from '../services/hrDutyBaselineCommand';

const prisma = new PrismaClient();

runHrDutyBaselineCommand(prisma, { writeLine: (line) => console.log(line) })
  .then(({ exitCode }) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    process.exitCode = 2;
    console.error(JSON.stringify({
      ok: false,
      code: 'HR_DUTY_BASELINE_REPORT_FAILED',
      message: error instanceof Error ? error.message : 'Unknown baseline report failure',
    }));
  })
  .finally(() => prisma.$disconnect());
