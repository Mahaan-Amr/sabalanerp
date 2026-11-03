import { PrismaClient } from '@prisma/client';
import { reconcileSalesContractCorrectionDuties } from '../services/salesContractCorrectionDuty';

const main = async () => {
  const prisma = new PrismaClient();
  try {
    const report = await reconcileSalesContractCorrectionDuties(prisma);
    process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), ...report })}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      generatedAt: new Date().toISOString(),
      ok: false,
      code: 'SALES_CONTRACT_CORRECTION_DUTY_RECONCILIATION_FAILED',
      message: error instanceof Error ? error.message : String(error),
    })}\n`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

void main();
