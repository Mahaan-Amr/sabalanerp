import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { PartnerActivationGates, PartnerProfileRecord, PartnerProfileStore } from './service';
import { resolveEligibleResponder } from '../inquiries/adapters';
import { validatePartnerConversionDispositions } from './managementPrismaStore';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function purpose(value: Prisma.JsonValue): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    typeof (value as Prisma.JsonObject).purpose === 'string' ? (value as Prisma.JsonObject).purpose as string : undefined;
}

async function currentResponderConflict(tx: Prisma.TransactionClient, userId: string) {
  const [profileAssignments, inquiryAssignments] = await Promise.all([
    tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM partner_profile_responder_assignments a
      WHERE a."responderId" = ${userId} AND a.revision = (SELECT max(b.revision)
        FROM partner_profile_responder_assignments b WHERE b."profileId" = a."profileId")`,
    tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM partner_inquiry_assignments a
      JOIN partner_inquiries i ON i.id = a."inquiryId"
      WHERE a."responderId" = ${userId} AND a.revision = (SELECT max(b.revision)
        FROM partner_inquiry_assignments b WHERE b."inquiryId" = a."inquiryId")
        AND EXISTS (SELECT 1 FROM partner_inquiry_rows r WHERE r."inquiryId" = i.id AND r.outcome = 'PENDING')`,
  ]);
  return (profileAssignments[0]?.count ?? 0n) > 0n || (inquiryAssignments[0]?.count ?? 0n) > 0n;
}

async function readGates(tx: Prisma.TransactionClient, profile: PartnerProfileRecord): Promise<PartnerActivationGates> {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const profileSource = await tx.partnerProfile.findUnique({ where: { id: profile.id }, select: {
    commercialAccount: { select: { id: true } }, responderAssignments: { orderBy: { revision: 'desc' }, take: 1,
      select: { id: true, responderId: true } }, cohortMemberships: { select: { id: true, cohortId: true } },
  } });
  const userIds = [...new Set([profile.userId,
    ...(profileSource?.responderAssignments[0]?.responderId ? [profileSource.responderAssignments[0].responderId] : [])])].sort();
  for (const id of userIds) await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
  if (profileSource?.commercialAccount?.id) {
    await tx.$queryRaw`SELECT id FROM partner_commercial_accounts WHERE id = ${profileSource.commercialAccount.id} FOR UPDATE`;
  }
  for (const cohortId of [...new Set(profileSource?.cohortMemberships.map(item => item.cohortId) ?? [])].sort()) {
    await tx.$queryRaw`SELECT id FROM partner_release_cohorts WHERE id = ${cohortId} FOR UPDATE`;
  }
  const [source, terms, cohort, openDuty, openDraft, responsibleContract, openCorrection,
    workspaceGrant, featureGrant, scopedGrant, responderConflict, conversionEvent] = await Promise.all([
    tx.partnerProfile.findUnique({ where: { id: profile.id }, select: { user: { select: {
      isActive: true, role: true,
    } }, commercialAccount: { select: { identities: { orderBy: { version: 'desc' }, take: 1,
      select: { id: true, identifiers: true, integrityHash: true } } } } } }),
    tx.partnerCommercialTerms.findMany({ where: { account: { profileId: profile.id }, effectiveDate: { lte: clock.now } },
      orderBy: { version: 'desc' }, select: { id: true, terms: true, integrityHash: true, effectiveDate: true } }),
    tx.partnerCohortMembership.findMany({ where: { profileId: profile.id }, select: { id: true, cohort: { select: {
      activationEnabled: true, enrollmentPaused: true, operationalPaused: true,
    } } } }),
    tx.crossWorkspaceDuty.count({ where: { currentAssigneeUserId: profile.userId, status: 'OPEN' } }),
    tx.salesContractEditSession.count({ where: { ownerUserId: profile.userId, purpose: 'STANDARD' } }),
    tx.salesContract.count({ where: { responsibleSellerId: profile.userId, isInactive: false,
      status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SIGNED', 'PRINTED'] } } }),
    tx.accountingCorrectionRequest.count({ where: { assignedToUserId: profile.userId, status: 'OPEN' } }),
    tx.workspacePermission.count({ where: { userId: profile.userId, isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] } }),
    tx.featurePermission.count({ where: { userId: profile.userId, isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] } }),
    tx.effectiveActionGrant.count({ where: { subjectUserId: profile.userId, revokedAt: null,
      domain: { not: 'PARTNER' }, effect: 'ALLOW',
      OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] } }),
    currentResponderConflict(tx, profile.userId),
    tx.$queryRaw<Array<{ id: string; transition: string | null; evidence: Prisma.JsonValue }>>`
      SELECT id, evidence->>'transition' AS transition, evidence FROM partner_profile_events
      WHERE "profileId" = ${profile.id} AND evidence->>'type' = 'PROFILE_CONVERSION'
      ORDER BY revision DESC LIMIT 1`,
  ]);
  const currentTerms = new Map<string, { id: string; terms: Prisma.JsonValue; integrityHash: string; effectiveDate: Date }>();
  for (const item of terms) {
    const kind = purpose(item.terms);
    if (kind && !currentTerms.has(kind)) currentTerms.set(kind, item);
  }
  const identityProjection = source?.commercialAccount?.identities[0];
  const identityEvidenceId = identityProjection?.identifiers && typeof identityProjection.identifiers === 'object' &&
    !Array.isArray(identityProjection.identifiers) && typeof (identityProjection.identifiers as Prisma.JsonObject).evidenceId === 'string'
    ? (identityProjection.identifiers as Prisma.JsonObject).evidenceId as string : undefined;
  const commercialProjection = currentTerms.get('PARTNER_TECHNICAL_PRICING');
  const creditProjection = currentTerms.get('PARTNER_CREDIT_TERMS');
  const policyId = (item: typeof commercialProjection) => item?.terms && typeof item.terms === 'object' &&
    !Array.isArray(item.terms) && typeof (item.terms as Prisma.JsonObject).policyId === 'string'
    ? (item.terms as Prisma.JsonObject).policyId as string : undefined;
  const commercialPolicyId = policyId(commercialProjection), creditPolicyId = policyId(creditProjection);
  if (identityEvidenceId) await tx.$queryRaw`SELECT id FROM partner_identity_evidence WHERE id = ${identityEvidenceId} FOR UPDATE`;
  for (const id of [commercialPolicyId, creditPolicyId].filter((value): value is string => Boolean(value)).sort()) {
    await tx.$queryRaw`SELECT id FROM partner_terms_policies WHERE id = ${id} FOR UPDATE`;
  }
  const [identityEvidence, commercialPolicy, creditPolicy] = await Promise.all([
    identityEvidenceId ? tx.partnerIdentityEvidence.findUnique({ where: { id: identityEvidenceId } }) : null,
    commercialPolicyId ? tx.partnerTermsPolicy.findUnique({ where: { id: commercialPolicyId } }) : null,
    creditPolicyId ? tx.partnerTermsPolicy.findUnique({ where: { id: creditPolicyId } }) : null,
  ]);
  const identityCurrent = identityEvidence && identityProjection && identityEvidence.userId === profile.userId &&
    !identityEvidence.revokedAt && identityEvidence.issuedAt <= clock.now &&
    (!identityEvidence.expiresAt || identityEvidence.expiresAt > clock.now) &&
    identityEvidence.integrityHash === identityProjection.integrityHash ? identityEvidence : undefined;
  const currentPolicy = (policy: typeof commercialPolicy, projection: typeof commercialProjection,
    expectedPurpose: 'PARTNER_TECHNICAL_PRICING' | 'PARTNER_CREDIT_TERMS') => policy && projection &&
    policy.purpose === expectedPurpose && !policy.revokedAt && policy.issuedAt <= clock.now &&
    policy.effectiveDate <= clock.now && (!policy.expiresAt || policy.expiresAt > clock.now) &&
    policy.integrityHash === projection.integrityHash && policy.effectiveDate.getTime() === projection.effectiveDate.getTime()
    ? policy : undefined;
  const currentCommercial = currentPolicy(commercialPolicy, commercialProjection, 'PARTNER_TECHNICAL_PRICING');
  const currentCredit = currentPolicy(creditPolicy, creditProjection, 'PARTNER_CREDIT_TERMS');
  const responderAssignment = profileSource?.responderAssignments[0];
  const responder = responderAssignment
    ? await resolveEligibleResponder(tx, { responderId: responderAssignment.responderId })
    : null;
  const internalConflict = source?.user.role !== 'USER' || workspaceGrant > 0 || featureGrant > 0 ||
    scopedGrant > 0 || openDuty > 0 || openDraft > 0 || responsibleContract > 0 || openCorrection > 0 || responderConflict;
  const conversionInProgress = conversionEvent[0]?.transition === 'START';
  const conversionRecord = conversionEvent[0];
  const conversionPayload = conversionRecord?.evidence && typeof conversionRecord.evidence === 'object' &&
    !Array.isArray(conversionRecord.evidence) ? conversionRecord.evidence as Prisma.JsonObject : undefined;
  const blockerIds = Array.isArray(conversionPayload?.blockerIds)
    ? conversionPayload.blockerIds.filter((id): id is string => typeof id === 'string') : [];
  const dispositionEvidenceIds = Array.isArray(conversionPayload?.dispositionEvidenceIds)
    ? conversionPayload.dispositionEvidenceIds.filter((id): id is string => typeof id === 'string') : [];
  const resolvedConversionValid = conversionRecord?.transition === 'RESOLVE' &&
    await validatePartnerConversionDispositions(tx, { profileId: profile.id, profileUserId: profile.userId,
      blockerIds, evidenceIds: dispositionEvidenceIds, now: clock.now });
  const conversionEvidenceId = resolvedConversionValid ? conversionRecord?.id : undefined;
  const identityId = identityCurrent?.id;
  const commercialId = currentCommercial?.id;
  const creditId = currentCredit?.id;
  const cohortMembership = cohort.length === 1 && cohort[0].cohort.activationEnabled &&
    !cohort[0].cohort.enrollmentPaused && !cohort[0].cohort.operationalPaused ? cohort[0] : undefined;
  return {
    identityVerified: Boolean(identityId),
    commercialTermsReady: Boolean(commercialId),
    creditTermsReady: Boolean(creditId),
    responderReady: Boolean(responder?.ok),
    conversionCleared: !internalConflict && !conversionInProgress &&
      (conversionRecord?.transition !== 'RESOLVE' || resolvedConversionValid),
    cohortReady: Boolean(cohortMembership),
    userActive: source?.user.isActive ?? false,
    conflictingInternalAuthority: internalConflict,
    evidenceIds: [identityId, commercialId, creditId,
      responder?.ok ? responderAssignment?.id : undefined, cohortMembership?.id,
      conversionEvidenceId].filter((id): id is string => Boolean(id)),
  };
}

export function createPrismaPartnerProfileStore(database: PrismaClient): PartnerProfileStore<Prisma.TransactionClient> {
  return {
    transaction: work => database.$transaction(work),
    async findOutcome(tx, key) {
      const row = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: key },
        select: { payloadHash: true, outcome: true } });
      return row ? { payloadHash: row.payloadHash, receipt: row.outcome } : null;
    },
    async saveOutcome(tx, key, value) {
      await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...key, payloadHash: value.payloadHash,
        outcome: json(value.receipt) } });
    },
    async lockProfile(tx, profileId) {
      await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${profileId} FOR UPDATE`;
      return tx.partnerProfile.findUnique({ where: { id: profileId }, select: { id: true, userId: true,
        state: true, revision: true, firstActivatedAt: true, irreversibleAt: true } });
    },
    readActivationGates: readGates,
    async updateProfile(tx, update) {
      const written = await tx.partnerProfile.updateMany({ where: { id: update.profileId,
        revision: update.expectedRevision }, data: { state: update.state, revision: update.revision,
        ...(update.firstActivatedAt ? { firstActivatedAt: update.firstActivatedAt } : {}),
        ...(update.irreversibleAt ? { irreversibleAt: update.irreversibleAt } : {}) } });
      if (written.count !== 1) throw new Error('Partner profile CAS failed');
      if (update.disableUser) {
        const disabled = await tx.user.updateMany({ where: { id: (await tx.partnerProfile.findUniqueOrThrow({
          where: { id: update.profileId }, select: { userId: true } })).userId }, data: { isActive: false } });
        if (disabled.count !== 1) throw new Error('Partner login block failed');
      }
      const row = await tx.partnerProfile.findUniqueOrThrow({ where: { id: update.profileId }, select: { id: true,
        userId: true, state: true, revision: true, firstActivatedAt: true, irreversibleAt: true } });
      return row;
    },
    async appendProfileEvent(tx, event) {
      const id = randomUUID();
      await tx.partnerProfileEvent.create({ data: { id, profileId: event.profileId, revision: event.revision,
        fromState: event.fromState, toState: event.toState, actorId: event.actorId, reason: event.reason,
        commandId: event.commandId, evidence: json(event.evidence) } });
      return id;
    },
    async beginRemediation(tx, profileId) {
      await tx.$executeRaw`SELECT set_config('sabalan.partner_remediation_profile', ${profileId}, true)`;
    },
    async terminatePendingWork(tx, input) {
      const inquiries = await tx.partnerInquiry.findMany({ where: { profileId: input.profileId,
        rows: { some: { outcome: 'PENDING' } } }, orderBy: { id: 'asc' }, select: { id: true } });
      const events: string[] = [];
      for (const inquiry of inquiries) {
        await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${inquiry.id} FOR UPDATE`;
        const current = await tx.partnerInquiry.findUnique({ where: { id: inquiry.id }, select: { revision: true } });
        if (!current) continue;
        const nextRevision = current.revision + 1;
        const changed = await tx.partnerInquiryRow.updateMany({ where: { inquiryId: inquiry.id,
          outcome: 'PENDING' }, data: { outcome: 'CANCELLED', revision: { increment: 1 } } });
        if (!changed.count) continue;
        await tx.partnerInquiry.update({ where: { id: inquiry.id }, data: { revision: nextRevision } });
        const id = randomUUID();
        await tx.partnerInquiryEvent.create({ data: { id, inquiryId: inquiry.id, revision: nextRevision,
          actorId: input.actorId, commandId: `${input.commandId}:${inquiry.id}`,
          correlationId: input.correlationId, type: 'PROFILE_TERMINATED', reason: input.reason,
          evidence: json({ schemaVersion: 1, profileId: input.profileId, cancelledPendingRows: changed.count }) } });
        events.push(id);
      }
      return events;
    },
  };
}
