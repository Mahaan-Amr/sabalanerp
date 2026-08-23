import { Prisma, PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import { reconcileAcceptedOfferFollowUp } from '../services/hrAcceptedOfferFollowUp';
import { isCompensationPayrollVerified } from '../services/hrCompensationWorkflow';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const argValue = (prefix: string) => process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
const reportPath = argValue('--report=');
const manifestPath = argValue('--manifest=');

const main = async () => {
  const applications = await prisma.hrJobApplication.findMany({
    where: {
      acceptedOfferAt: { not: null }, archivedAt: null,
      collateralRequirements: { some: { status: 'ACTIVE' } },
    },
    select: { id: true, collateralClearance: true, createdBy: true,
      compensationSnapshots: { orderBy: { version: 'desc' }, take: 1, select: {
        obsoleteAt: true, candidateAcceptedAt: true, payrollReviewStatus: true, payrollVerifiedAt: true,
        hrApprovedAt: true, financeApprovedAt: true,
      } } },
    orderBy: { id: 'asc' },
  });
  const candidates = [] as Array<{ applicationId: string; actorUserId: string; currentClearance: string; missingItem: boolean; missingDuty: boolean }>;
  for (const application of applications) {
    const latestOffer = application.compensationSnapshots[0];
    if (!latestOffer?.candidateAcceptedAt || latestOffer.obsoleteAt || !isCompensationPayrollVerified(latestOffer)) continue;
    const item = await prisma.hrCollateralItem.findFirst({
      where: { applicationId: application.id, supersededBy: null }, select: { id: true, status: true, version: true },
    });
    const expectedAction = item?.status === 'MISSING' ? 'HIRING_COLLATERAL_RECORD_RECEIPT' : 'HIRING_COLLATERAL_VERIFY_RECEIPT';
    const duty = item ? await prisma.crossWorkspaceDuty.findFirst({
      where: { sourceType: 'HR_HIRING_FINANCE', sourceId: item.id, sourceVersion: item.version,
        sourceActionCode: expectedAction, status: 'OPEN' }, select: { id: true },
    }) : null;
    const missingDuty = Boolean(item && ['MISSING', 'RECEIVED'].includes(item.status) && !duty);
    if (!item || missingDuty) candidates.push({
      applicationId: application.id, currentClearance: application.collateralClearance,
      actorUserId: application.createdBy, missingItem: !item, missingDuty,
    });
  }
  const report = { schemaVersion: 1, scanned: applications.length, eligible: candidates.length, candidates };
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', ...report }, null, 2)}\n`);
  if (!apply) {
    if (reportPath) fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    return;
  }
  if (!manifestPath) throw new Error('APPLY_REQUIRES_REVIEWED_MANIFEST');
  const reviewed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (JSON.stringify(reviewed) !== JSON.stringify(report)) throw new Error('RECONCILIATION_MANIFEST_DRIFT');
  for (const candidate of candidates) {
    await prisma.$transaction((tx) => reconcileAcceptedOfferFollowUp(tx, {
      applicationId: candidate.applicationId, actorUserId: candidate.actorUserId,
      actorKind: 'SYSTEM',
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
