import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const valueFor = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const applicationId = valueFor('--application') || 'cmsvg9p4f018qrxj4djbl7iv0';
const legacyPersonnelId = valueFor('--legacy-personnel') || 'cmrsu7sc1008b1404xmlljqkt';
const relationshipId = valueFor('--relationship') || 'cmt5l627600iode2m19pde5po';
const actorUserId = valueFor('--actor');
const suppliedManifest = valueFor('--manifest');
const apply = process.argv.includes('--apply');

const stable = (value: unknown) => JSON.stringify(value, Object.keys(value as object).sort());
const hash = (value: unknown) => crypto.createHash('sha256').update(stable(value)).digest('hex');

async function inspect() {
  const [application, legacyPersonnel, relationship] = await Promise.all([
    prisma.hrJobApplication.findUnique({ where: { id: applicationId }, include: {
      candidate: { include: { linkedPersonnel: true } },
      documents: { where: { status: { notIn: ['MISMATCH', 'UNREADABLE'] } }, select: { id: true }, orderBy: { createdAt: 'asc' } },
    } }),
    prisma.personnel.findUnique({ where: { id: legacyPersonnelId }, include: {
      hrEmploymentRelationships: { include: { assignments: true } },
    } }),
    prisma.hrEmploymentRelationship.findUnique({ where: { id: relationshipId } }),
  ]);
  if (!application || !legacyPersonnel || !relationship) throw new Error('REPAIR_TARGET_NOT_FOUND');
  const claim = application.candidate.profileJson as any;
  const report = {
    version: 1,
    operation: 'RECONCILE_CANDIDATE_PERSONNEL_IDENTITY',
    applicationId,
    candidateId: application.candidateId,
    legacyPersonnelId,
    relationshipId,
    expectedNationalCode: String(claim?.nationalCode || application.candidate.nationalCode || ''),
    expectedName: `${claim?.firstName || application.candidate.firstName} ${claim?.lastName || application.candidate.lastName}`.trim(),
    currentCandidateName: `${application.candidate.firstName} ${application.candidate.lastName}`.trim(),
    currentLinkedPersonnelId: application.candidate.linkedPersonnelId,
    currentRelationshipPersonnelId: relationship.personnelId,
    legacyPersonnelName: `${legacyPersonnel.firstName} ${legacyPersonnel.lastName}`.trim(),
    legacyRelationshipIds: legacyPersonnel.hrEmploymentRelationships.map((item) => item.id).sort(),
    authoritativeEvidenceIds: application.documents.map((item) => item.id).sort(),
    eligible: application.candidate.linkedPersonnelId === legacyPersonnelId
      && relationship.personnelId === legacyPersonnelId
      && relationship.hiringApplicationId === applicationId
      && Boolean(claim?.nationalCode || application.candidate.nationalCode),
  };
  return { application, legacyPersonnel, relationship, report, manifest: hash(report) };
}

async function main() {
  const inspected = await inspect();
  console.log(JSON.stringify({ ...inspected.report, manifest: inspected.manifest }, null, 2));
  if (!apply) return;
  if (!actorUserId) throw new Error('ACTOR_REQUIRED');
  if (!suppliedManifest || suppliedManifest !== inspected.manifest) throw new Error('REVIEWED_MANIFEST_REQUIRED');
  if (!inspected.report.eligible) throw new Error('REPAIR_NOT_ELIGIBLE');
  const result = await prisma.$transaction(async (tx) => {
    const currentApplication = await tx.hrJobApplication.findUniqueOrThrow({ where: { id: applicationId }, include: { candidate: true } });
    const currentLegacy = await tx.personnel.findUniqueOrThrow({ where: { id: legacyPersonnelId } });
    const currentRelationship = await tx.hrEmploymentRelationship.findUniqueOrThrow({ where: { id: relationshipId } });
    if (currentApplication.candidate.linkedPersonnelId !== legacyPersonnelId
      || currentRelationship.personnelId !== legacyPersonnelId
      || currentRelationship.hiringApplicationId !== applicationId) throw new Error('REPAIR_STATE_CHANGED');
    const claim = currentApplication.candidate.profileJson as any;
    const nationalCode = String(claim?.nationalCode || currentApplication.candidate.nationalCode || '').trim();
    const firstName = String(claim?.firstName || currentApplication.candidate.firstName).trim();
    const lastName = String(claim?.lastName || currentApplication.candidate.lastName).trim();
    await tx.personnel.update({ where: { id: currentLegacy.id }, data: {
      nationalCode: null, identityCompletionStatus: 'NEEDS_COMPLETION',
    } });
    const correctPersonnel = await tx.personnel.create({ data: {
      firstName, lastName, nationalCode, identityCompletionStatus: 'COMPLETE', isActive: false,
    } });
    await tx.hrCandidate.update({ where: { id: currentApplication.candidateId }, data: {
      firstName, lastName, nationalCode, linkedPersonnelId: correctPersonnel.id,
    } });
    await tx.hrEmploymentRelationship.update({ where: { id: relationshipId }, data: { personnelId: correctPersonnel.id } });
    await tx.hrJobApplication.update({ where: { id: applicationId }, data: {
      identityClearance: 'IN_PROGRESS', contractClearance: 'IN_PROGRESS', activatedAt: null, activatedBy: null,
    } });
    const now = new Date();
    const conflict = await tx.hrCandidatePersonnelIdentityConflict.create({ data: {
      applicationId, candidateId: currentApplication.candidateId, potentialPersonnelId: legacyPersonnelId,
      status: 'RESOLVED', claimedIdentityJson: json({ firstName, lastName, nationalCode }),
      matchedIdentityJson: json({ firstName: currentLegacy.firstName, lastName: currentLegacy.lastName, nationalCode: currentLegacy.nationalCode }),
      dueAt: now, resolutionCode: 'CREATE_NEW', selectedPersonnelId: correctPersonnel.id,
      rejectedPersonnelId: legacyPersonnelId, authoritativeEvidenceIds: inspected.report.authoritativeEvidenceIds,
      resolvedByUserId: actorUserId, resolvedAt: now,
    } });
    await tx.hrPersonnelAudit.createMany({ data: [
      { personnelId: legacyPersonnelId, actorUserId, eventType: 'CANONICAL_IDENTITY_DETACHED_FOR_RECONCILIATION', sourceCategory: 'IDENTITY_RECONCILIATION', reason: 'کد ملی متعلق به علی رضایی تأیید شد.', payloadJson: json({ applicationId, conflictId: conflict.id, previousNationalCode: nationalCode, identityCompletionStatus: 'NEEDS_COMPLETION' }) },
      { personnelId: correctPersonnel.id, actorUserId, eventType: 'PERSONNEL_CREATED_FROM_VERIFIED_IDENTITY_RECONCILIATION', sourceCategory: 'IDENTITY_RECONCILIATION', reason: 'ترمیم لینک اشتباه Candidate و Personnel', payloadJson: json({ applicationId, conflictId: conflict.id, movedRelationshipId: relationshipId, previousPersonnelId: legacyPersonnelId }) },
    ] });
    await tx.hrHiringAudit.create({ data: {
      applicationId, actorUserId, actorKind: 'USER', eventType: 'HIRE_CONVERSION_PERSONNEL_LINK_CORRECTED',
      payloadJson: json({ conflictId: conflict.id, previousPersonnelId: legacyPersonnelId,
        correctedPersonnelId: correctPersonnel.id, relationshipId, preservedHistoricalEvent: 'HIRE_CONVERTED',
        evidenceIds: inspected.report.authoritativeEvidenceIds }),
    } });
    return { correctPersonnelId: correctPersonnel.id, conflictId: conflict.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
  console.log(JSON.stringify({ applied: true, ...result }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
