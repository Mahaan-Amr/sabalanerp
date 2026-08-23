import { PrismaClient } from '@prisma/client';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditHrOnboardingTaskRetirement } from '../services/hrOnboardingTaskRetirementAudit';

const prisma = new PrismaClient();
const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
const outputPath = outputArgument?.slice('--output='.length);

const run = async () => {
  const applications = await prisma.hrJobApplication.findMany({
    where: {
      OR: [
        { convertedAt: { not: null } },
        { onboardingTasks: { some: {} } },
      ],
    },
    select: {
      convertedAt: true,
      contractClearance: true,
      payrollParticipation: { select: { id: true } },
      insuranceEnrollment: { select: { status: true } },
      onboardingTasks: {
        select: {
          title: true,
          status: true,
          ownerAuthority: true,
          activationBlocker: true,
        },
      },
    },
  });
  const report = {
    generatedAt: new Date().toISOString(),
    ...auditHrOnboardingTaskRetirement(applications.map((application) => ({
      converted: Boolean(application.convertedAt),
      contractClearance: application.contractClearance,
      payrollConfigured: Boolean(application.payrollParticipation),
      insuranceStatus: application.insuranceEnrollment?.status || null,
      tasks: application.onboardingTasks.map((task) => ({
        title: task.title,
        status: task.status,
        ownerAuthority: task.ownerAuthority,
        activationBlocker: task.activationBlocker,
      })),
    }))),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, { encoding: 'utf8', mode: 0o600 });
  }
  process.stdout.write(serialized);
  if (!report.ok) process.exitCode = 2;
};

run()
  .catch((error) => {
    console.error(JSON.stringify({
      mode: 'READ_ONLY',
      ok: false,
      error: error instanceof Error ? error.message : 'ممیزی آماده‌سازی شروع همکاری ناموفق بود.',
    }));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
