import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { createHrHiringContractReviewDuty } from '../services/crossWorkspaceDutyAdapters/hrHiringFinanceDutyAdapter';
import { assertCandidatePersonnelIdentityConsistent, ensureCandidatePersonnelIdentityConsistent } from '../services/hrCandidatePersonnelIdentityConflict';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const valueFor = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const manifest = valueFor('--manifest');
const actorUserId = valueFor('--actor');
const digest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function report() {
  const contracts = await prisma.hrEmploymentContractDocument.findMany({
    where: { submittedAt: { not: null }, approvedAt: null, returnedAt: null, withdrawnAt: null },
    include: { application: { include: { candidate: { include: { linkedPersonnel: true } }, identityConflicts: { where: { status: 'OPEN' } } } } },
    orderBy: [{ applicationId: 'asc' }, { version: 'desc' }],
  });
  const latest = contracts.filter((contract, index, rows) => index === 0 || rows[index - 1].applicationId !== contract.applicationId);
  const rows = [] as Array<Record<string, unknown>>;
  for (const contract of latest) {
    const existing = await prisma.crossWorkspaceDuty.findFirst({ where: {
      sourceType: 'HR_HIRING_FINANCE', sourceId: contract.id, sourceActionCode: 'HIRING_CONTRACT_REVIEW',
    }, select: { id: true, status: true, sourceVersion: true } });
    const identityBlocked = contract.application.identityConflicts.length > 0
      || Boolean(contract.application.candidate.linkedPersonnel
        && `${contract.application.candidate.linkedPersonnel.firstName} ${contract.application.candidate.linkedPersonnel.lastName}`.trim()
          !== `${contract.application.candidate.firstName} ${contract.application.candidate.lastName}`.trim());
    rows.push({ applicationId: contract.applicationId, contractId: contract.id, version: contract.version,
      existingDutyId: existing?.id || null, existingDutyStatus: existing?.status || null,
      action: identityBlocked ? 'BLOCKED_BY_IDENTITY' : existing ? 'KEEP' : 'CREATE' });
  }
  const output = { version: 1, operation: 'RECONCILE_SIGNED_CONTRACT_REVIEW_DUTIES', rows };
  return { output, manifest: digest(output) };
}

async function main() {
  const reviewed = await report();
  console.log(JSON.stringify({ ...reviewed.output, manifest: reviewed.manifest }, null, 2));
  if (!apply) return;
  if (!actorUserId) throw new Error('ACTOR_REQUIRED');
  if (!manifest || manifest !== reviewed.manifest) throw new Error('REVIEWED_MANIFEST_REQUIRED');
  for (const row of reviewed.output.rows) {
    if (row.action !== 'CREATE') continue;
    const identityContract = await prisma.hrEmploymentContractDocument.findUniqueOrThrow({
      where: { id: String(row.contractId) }, include: { application: { include: { candidate: { include: { linkedPersonnel: true } } } } },
    });
    await ensureCandidatePersonnelIdentityConsistent(prisma, {
      applicationId: identityContract.applicationId,
      candidate: identityContract.application.candidate,
    });
    await prisma.$transaction(async (tx) => {
      const contract = await tx.hrEmploymentContractDocument.findUniqueOrThrow({
        where: { id: String(row.contractId) }, include: { application: { include: { candidate: { include: { linkedPersonnel: true } } } } },
      });
      await assertCandidatePersonnelIdentityConsistent(tx, { applicationId: contract.applicationId, candidate: contract.application.candidate });
      const duty = await createHrHiringContractReviewDuty(tx, { contractId: contract.id, actorUserId });
      await tx.hrHiringAudit.create({ data: {
        applicationId: contract.applicationId, actorUserId: null, actorKind: 'SYSTEM',
        eventType: 'SIGNED_CONTRACT_REVIEW_DUTY_RECONCILED',
        payloadJson: { contractId: contract.id, dutyId: duty.id, technicalActorUserId: actorUserId, source: 'MANIFEST_GATED_RECONCILIATION' },
      } });
    }, { isolationLevel: 'Serializable' });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
