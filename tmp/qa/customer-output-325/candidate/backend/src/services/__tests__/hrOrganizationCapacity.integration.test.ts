import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids: { position?: string; unit?: string; job?: string; request?: string; change?: string; reserved?: string } = {};

async function main() {
try {
  const unit = await prisma.hrOrganizationalUnit.create({
    data: { code: `QA-UNIT-${suffix}`, name: 'QA lifecycle unit', type: 'DEPARTMENT', createdBy: 'qa-organization-capacity' },
  });
  ids.unit = unit.id;
  const job = await prisma.hrJob.create({
    data: { code: `QA-JOB-${suffix}`, title: 'QA lifecycle job', createdBy: 'qa-organization-capacity' },
  });
  ids.job = job.id;
  const position = await prisma.hrPosition.create({
    data: { code: `QA-POS-${suffix}`, title: 'QA lifecycle position', capacity: 2, organizationalUnitId: unit.id, jobId: job.id, createdBy: 'qa-organization-capacity' },
  });
  ids.position = position.id;

  const request = await prisma.hrRecruitmentRequest.create({
    data: { stableKey: `QA-REQ-${suffix}`, positionId: position.id, status: 'APPROVED', approvedHeadcount: 2, convertedHires: 1, effectiveFrom: new Date(), createdByUserId: 'qa-organization-capacity' },
  });
  ids.request = request.id;
  assert.equal(request.approvedHeadcount - request.convertedHires, 1);

  const change = await prisma.hrPositionCapacityChange.create({
    data: { stableKey: `QA-CAP-${suffix}`, positionId: position.id, version: 1, previousCapacity: 2, newCapacity: 3, effectiveAt: new Date(), reason: 'QA increase', changedByUserId: 'qa-organization-capacity' },
  });
  ids.change = change.id;

  await assert.rejects(
    prisma.hrRecruitmentRequest.create({
      data: { stableKey: `QA-INVALID-${suffix}`, positionId: position.id, approvedHeadcount: 1, convertedHires: 2, effectiveFrom: new Date(), createdByUserId: 'qa-organization-capacity' },
    }),
  );
  await assert.rejects(prisma.hrPosition.delete({ where: { id: position.id } }));

  await prisma.hrRecruitmentRequest.delete({ where: { id: request.id } });
  ids.request = undefined;
  await prisma.hrPositionCapacityChange.delete({ where: { id: change.id } });
  ids.change = undefined;
  await prisma.hrPosition.delete({ where: { id: position.id } });
  ids.position = undefined;

  const reserved = await prisma.hrFoundationReservedCode.create({
    data: { entityType: 'POSITION', code: position.code, deletedEntityId: position.id, deletedByUserId: 'qa-organization-capacity', reason: 'QA permanent deletion reservation' },
  });
  ids.reserved = reserved.id;
  await assert.rejects(prisma.hrFoundationReservedCode.create({
    data: { entityType: 'POSITION', code: position.code, deletedEntityId: `duplicate-${position.id}`, deletedByUserId: 'qa-organization-capacity', reason: 'QA duplicate' },
  }));

  console.log('HR organization capacity database integration tests passed.');
} finally {
  if (ids.request) await prisma.hrRecruitmentRequest.deleteMany({ where: { id: ids.request } });
  if (ids.change) await prisma.hrPositionCapacityChange.deleteMany({ where: { id: ids.change } });
  if (ids.position) await prisma.hrPosition.deleteMany({ where: { id: ids.position } });
  if (ids.reserved) await prisma.hrFoundationReservedCode.deleteMany({ where: { id: ids.reserved } });
  if (ids.job) await prisma.hrJob.deleteMany({ where: { id: ids.job } });
  if (ids.unit) await prisma.hrOrganizationalUnit.deleteMany({ where: { id: ids.unit } });
  await prisma.$disconnect();
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
