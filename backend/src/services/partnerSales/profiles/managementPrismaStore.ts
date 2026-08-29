import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { PartnerProfileManagementStore } from './management';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

type ConversionDisposition = { id: string; sourceType: string; sourceId: string; disposition: string;
  successorId: string | null };

async function activeInternal(tx: Prisma.TransactionClient, userId: string | null, departmentId?: string) {
  if (!userId) return false;
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { isActive: true, departmentId: true,
    partnerProfile: { select: { id: true } } } });
  return Boolean(user?.isActive && !user.partnerProfile && (!departmentId || user.departmentId === departmentId));
}

/** Revalidates owner dispositions against their authoritative current rows.
 * A disposition record is evidence, never permission to infer that work moved. */
export async function validatePartnerConversionDispositions(tx: Prisma.TransactionClient, input: {
  profileId: string; profileUserId: string; blockerIds: readonly string[]; evidenceIds: readonly string[]; now: Date;
}) {
  if (!input.blockerIds.length || new Set(input.blockerIds).size !== input.blockerIds.length ||
      new Set(input.evidenceIds).size !== input.evidenceIds.length || input.blockerIds.length !== input.evidenceIds.length) return false;
  for (const id of [...input.evidenceIds].sort()) {
    await tx.$queryRaw`SELECT id FROM partner_conversion_dispositions WHERE id = ${id} FOR UPDATE`;
  }
  const rows = await tx.partnerConversionDisposition.findMany({ where: { profileId: input.profileId,
    id: { in: [...input.evidenceIds] } }, select: { id: true, sourceType: true, sourceId: true,
    disposition: true, successorId: true } });
  const bySource = new Map(rows.map(row => [`${row.sourceType}:${row.sourceId}`, row]));
  if (rows.length !== input.evidenceIds.length) return false;
  for (const blockerId of input.blockerIds) {
    const separator = blockerId.indexOf(':');
    if (separator < 1) return false;
    const kind = blockerId.slice(0, separator), sourceId = blockerId.slice(separator + 1);
    const row: ConversionDisposition | undefined = bySource.get(blockerId);
    if (!row) return false;
    if (kind === 'USER_ROLE') {
      if (sourceId !== input.profileUserId) return false;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${sourceId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: sourceId }, select: { role: true } });
      if (row.disposition !== 'RESET' || row.successorId || user?.role !== 'USER') return false;
    } else if (kind === 'WORKSPACE_PERMISSION') {
      await tx.$queryRaw`SELECT id FROM workspace_permissions WHERE id = ${sourceId} FOR UPDATE`;
      const source = await tx.workspacePermission.findUnique({ where: { id: sourceId } });
      if (row.disposition !== 'REVOKED' || row.successorId || !source || source.userId !== input.profileUserId ||
          (source.isActive && (!source.expiresAt || source.expiresAt > input.now))) return false;
    } else if (kind === 'FEATURE_PERMISSION') {
      await tx.$queryRaw`SELECT id FROM feature_permissions WHERE id = ${sourceId} FOR UPDATE`;
      const source = await tx.featurePermission.findUnique({ where: { id: sourceId } });
      if (row.disposition !== 'REVOKED' || row.successorId || !source || source.userId !== input.profileUserId ||
          (source.isActive && (!source.expiresAt || source.expiresAt > input.now))) return false;
    } else if (kind === 'ACTION_GRANT') {
      await tx.$queryRaw`SELECT id FROM effective_action_grants WHERE id = ${sourceId} FOR UPDATE`;
      const source = await tx.effectiveActionGrant.findUnique({ where: { id: sourceId } });
      if (row.disposition !== 'REVOKED' || row.successorId || !source || source.subjectUserId !== input.profileUserId ||
          (!source.revokedAt && (!source.expiresAt || source.expiresAt > input.now))) return false;
    } else if (kind === 'DUTY') {
      await tx.$queryRaw`SELECT id FROM hr_duties WHERE id = ${sourceId} FOR UPDATE`;
      const source = await tx.crossWorkspaceDuty.findUnique({ where: { id: sourceId },
        select: { status: true, currentAssigneeUserId: true } });
      const transferred = row.disposition === 'TRANSFERRED' && source?.status === 'OPEN' &&
        source.currentAssigneeUserId === row.successorId && await activeInternal(tx, row.successorId);
      const closed = row.disposition === 'CLOSED' && !row.successorId && source?.status !== 'OPEN';
      if (!transferred && !closed) return false;
    } else if (kind === 'STANDARD_DRAFT') {
      await tx.$queryRaw`SELECT id FROM sales_contract_edit_sessions WHERE id = ${sourceId} FOR UPDATE`;
      const source = await tx.salesContractEditSession.findUnique({ where: { id: sourceId }, select: { ownerUserId: true } });
      const transferred = row.disposition === 'TRANSFERRED' && source?.ownerUserId === row.successorId &&
        await activeInternal(tx, row.successorId);
      await tx.$queryRaw`SELECT id FROM sales_contract_draft_audits WHERE "draftId" = ${sourceId} FOR UPDATE`;
      const discard = await tx.salesContractDraftAudit.findFirst({ where: { draftId: sourceId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { action: true, ownerUserId: true } });
      const cancelled = row.disposition === 'CANCELLED' && !row.successorId && !source &&
        discard?.action === 'DISCARDED' && discard.ownerUserId === input.profileUserId;
      if (!transferred && !cancelled) return false;
    } else if (kind === 'CONTRACT_RESPONSIBILITY') {
      await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${sourceId} FOR UPDATE`;
      const source = await tx.salesContract.findUnique({ where: { id: sourceId }, select: { responsibleSellerId: true,
        departmentId: true, isInactive: true, status: true } });
      await tx.$queryRaw`SELECT id FROM sales_contract_seller_audits WHERE "contractId" = ${sourceId} FOR UPDATE`;
      const transfer = await tx.salesContractSellerAudit.findFirst({ where: { contractId: sourceId,
        previousSellerId: input.profileUserId, nextSellerId: row.successorId,
        changeType: 'RESPONSIBILITY_REASSIGNED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      if (row.disposition !== 'TRANSFERRED' || !source || source.isInactive ||
          !['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SIGNED', 'PRINTED'].includes(source.status) ||
          source.responsibleSellerId !== row.successorId || !transfer ||
          !await activeInternal(tx, row.successorId, source.departmentId)) return false;
    } else if (kind === 'CORRECTION_REQUEST') {
      await tx.$queryRaw`SELECT id FROM accounting_correction_requests WHERE id = ${sourceId} FOR UPDATE`;
      const source = await tx.accountingCorrectionRequest.findUnique({ where: { id: sourceId },
        select: { status: true, assignedToUserId: true } });
      const transferred = row.disposition === 'TRANSFERRED' && source?.status === 'OPEN' &&
        source.assignedToUserId === row.successorId && await activeInternal(tx, row.successorId);
      const resolved = row.disposition === source?.status && ['RESOLVED', 'CANCELLED'].includes(row.disposition) &&
        !row.successorId;
      if (!transferred && !resolved) return false;
    } else if (kind === 'PROFILE_RESPONDER') {
      await tx.$queryRaw`SELECT id FROM partner_profile_responder_assignments WHERE id = ${sourceId} FOR UPDATE`;
      const original = await tx.partnerProfileResponderAssignment.findUnique({ where: { id: sourceId }, select: { profileId: true } });
      if (original) await tx.$queryRaw`SELECT id FROM partner_profile_responder_assignments
        WHERE "profileId" = ${original.profileId} ORDER BY revision FOR UPDATE`;
      const latest = original ? await tx.partnerProfileResponderAssignment.findFirst({ where: { profileId: original.profileId },
        orderBy: { revision: 'desc' }, select: { responderId: true } }) : null;
      if (row.disposition !== 'TRANSFERRED' || latest?.responderId !== row.successorId ||
          !await activeInternal(tx, row.successorId)) return false;
    } else if (kind === 'INQUIRY_RESPONDER') {
      await tx.$queryRaw`SELECT id FROM partner_inquiry_assignments WHERE id = ${sourceId} FOR UPDATE`;
      const original = await tx.partnerInquiryAssignment.findUnique({ where: { id: sourceId }, select: { inquiryId: true } });
      if (original) await tx.$queryRaw`SELECT id FROM partner_inquiry_assignments
        WHERE "inquiryId" = ${original.inquiryId} ORDER BY revision FOR UPDATE`;
      const latest = original ? await tx.partnerInquiryAssignment.findFirst({ where: { inquiryId: original.inquiryId },
        orderBy: { revision: 'desc' }, select: { responderId: true } }) : null;
      if (row.disposition !== 'TRANSFERRED' || latest?.responderId !== row.successorId ||
          !await activeInternal(tx, row.successorId)) return false;
    } else return false;
  }
  return true;
}

export function createPrismaPartnerProfileManagementStore(database: PrismaClient):
  PartnerProfileManagementStore<Prisma.TransactionClient> {
  return {
    transaction: run => database.$transaction(run),
    async findOutcome(tx, key) {
      const row = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: key },
        select: { payloadHash: true, outcome: true } });
      return row ? { payloadHash: row.payloadHash, receipt: row.outcome } : null;
    },
    async saveOutcome(tx, key, value) {
      await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...key, payloadHash: value.payloadHash,
        outcome: json(value.receipt) } });
    },
    async verifyCreationReceipt(tx, input) {
      await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${input.profileId} FOR UPDATE`;
      const event = await tx.partnerProfileEvent.findUnique({ where: { commandId: input.commandId },
        select: { profileId: true, revision: true, evidence: true } });
      return Boolean(event?.profileId === input.profileId && event.revision === input.revision &&
        event.evidence && typeof event.evidence === 'object' && !Array.isArray(event.evidence) &&
        (event.evidence as Prisma.JsonObject).type === 'PROFILE_CREATE' &&
        (event.evidence as Prisma.JsonObject).identityEvidenceId === input.identityEvidenceId);
    },
    async resolveIdentityEvidence(tx, evidenceId) {
      const locked = await tx.$queryRaw<Array<{ userId: string }>>`
        SELECT "userId" FROM partner_identity_evidence WHERE id = ${evidenceId} FOR UPDATE`;
      if (!locked[0]) return null;
      const [clock, evidence] = await Promise.all([
        tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`,
        tx.partnerIdentityEvidence.findUnique({ where: { id: evidenceId }, select: { id: true, userId: true,
          legalName: true, tradeName: true, personType: true, identifiers: true, phone: true, address: true,
          integrityHash: true, issuedAt: true, expiresAt: true, revokedAt: true,
          subject: { select: { isActive: true } } } }),
      ]);
      if (!evidence?.subject.isActive || evidence.revokedAt || evidence.issuedAt > clock[0].now ||
          (evidence.expiresAt && evidence.expiresAt <= clock[0].now)) return null;
      return { id: evidence.id, userId: evidence.userId, legalName: evidence.legalName,
        ...(evidence.tradeName ? { tradeName: evidence.tradeName } : {}), personType: evidence.personType,
        identifiers: evidence.identifiers as Record<string, unknown>, phone: evidence.phone,
        address: evidence.address, integrityHash: evidence.integrityHash };
    },
    async resolveTermsPolicy(tx, policyId, purpose) {
      await tx.$queryRaw`SELECT id FROM partner_terms_policies WHERE id = ${policyId} FOR UPDATE`;
      const [clock, policy] = await Promise.all([
        tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`,
        tx.partnerTermsPolicy.findUnique({ where: { id: policyId }, select: { id: true, purpose: true,
          effectiveDate: true, expiresAt: true, terms: true, integrityHash: true, issuedAt: true, revokedAt: true } }),
      ]);
      if (!policy || policy.purpose !== purpose || policy.revokedAt || policy.issuedAt > clock[0].now ||
          policy.effectiveDate > clock[0].now || (policy.expiresAt && policy.expiresAt <= clock[0].now)) return null;
      return { id: policy.id, purpose: policy.purpose, effectiveDate: policy.effectiveDate,
        terms: policy.terms as Record<string, unknown>, integrityHash: policy.integrityHash };
    },
    async lockProfile(tx, profileId) {
      await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${profileId} FOR UPDATE`;
      return tx.partnerProfile.findUnique({ where: { id: profileId }, select: { id: true, userId: true,
        state: true, revision: true } });
    },
    findProfileByUser: (tx, userId) => tx.partnerProfile.findUnique({ where: { userId },
      select: { id: true, userId: true, state: true, revision: true } }),
    async createProfile(tx, input) {
      const created = await tx.partnerProfile.create({ data: { id: input.profileId, userId: input.evidence.userId,
        commercialAccount: { create: { id: randomUUID(), identities: { create: { id: randomUUID(), version: 1,
          legalName: input.evidence.legalName, tradeName: input.evidence.tradeName,
          identifiers: json({ ...input.evidence.identifiers, evidenceId: input.evidence.id,
            personType: input.evidence.personType }), phone: input.evidence.phone, address: input.evidence.address,
          integrityHash: input.evidence.integrityHash, actorId: input.actorId } } } } },
        select: { id: true, userId: true, state: true, revision: true } });
      const eventId = randomUUID();
      await tx.partnerProfileEvent.create({ data: { id: eventId, profileId: created.id, revision: created.revision,
        fromState: null, toState: created.state, actorId: input.actorId, reason: input.reason,
        commandId: input.commandId, evidence: json({ schemaVersion: 2, type: 'PROFILE_CREATE',
          identityEvidenceId: input.evidence.id, authorizationEvidenceId: input.authorizationEvidenceId }) } });
      return { profile: created, eventId };
    },
    async appendIdentity(tx, input) {
      const account = await tx.partnerCommercialAccount.findUniqueOrThrow({ where: { profileId: input.profile.id },
        select: { id: true, identities: { orderBy: { version: 'desc' }, take: 1, select: { version: true } } } });
      await tx.$queryRaw`SELECT id FROM partner_commercial_accounts WHERE id = ${account.id} FOR UPDATE`;
      const identity = await tx.partnerCommercialIdentity.create({ data: { id: randomUUID(), accountId: account.id,
        version: (account.identities[0]?.version ?? 0) + 1, legalName: input.evidence.legalName,
        tradeName: input.evidence.tradeName, identifiers: json({ ...input.evidence.identifiers,
          evidenceId: input.evidence.id, personType: input.evidence.personType }), phone: input.evidence.phone,
        address: input.evidence.address, integrityHash: input.evidence.integrityHash, actorId: input.actorId } });
      const updated = await tx.partnerProfile.updateMany({ where: { id: input.profile.id, revision: input.profile.revision },
        data: { revision: { increment: 1 } } });
      if (updated.count !== 1) throw new Error('Partner profile identity CAS failed');
      const revision = input.profile.revision + 1, eventId = randomUUID();
      await tx.partnerProfileEvent.create({ data: { id: eventId, profileId: input.profile.id, revision,
        fromState: input.profile.state, toState: input.profile.state, actorId: input.actorId, reason: input.reason,
        commandId: input.commandId, evidence: json({ schemaVersion: 2, type: 'IDENTITY_VERIFY',
          identityEvidenceId: input.evidence.id, commercialIdentityId: identity.id,
          authorizationEvidenceId: input.authorizationEvidenceId }) } });
      return { revision, eventId };
    },
    async appendTerms(tx, input) {
      const account = await tx.partnerCommercialAccount.findUniqueOrThrow({ where: { profileId: input.profile.id },
        select: { id: true, terms: { orderBy: { version: 'desc' }, take: 1, select: { version: true } } } });
      await tx.$queryRaw`SELECT id FROM partner_commercial_accounts WHERE id = ${account.id} FOR UPDATE`;
      const terms = await tx.partnerCommercialTerms.create({ data: { id: randomUUID(), accountId: account.id,
        version: (account.terms[0]?.version ?? 0) + 1, effectiveDate: input.policy.effectiveDate,
        terms: json({ ...input.policy.terms, purpose: input.policy.purpose, policyId: input.policy.id }),
        integrityHash: input.policy.integrityHash, actorId: input.actorId, reason: input.reason } });
      const updated = await tx.partnerProfile.updateMany({ where: { id: input.profile.id, revision: input.profile.revision },
        data: { revision: { increment: 1 } } });
      if (updated.count !== 1) throw new Error('Partner profile terms CAS failed');
      const revision = input.profile.revision + 1, eventId = randomUUID();
      await tx.partnerProfileEvent.create({ data: { id: eventId, profileId: input.profile.id, revision,
        fromState: input.profile.state, toState: input.profile.state, actorId: input.actorId, reason: input.reason,
        commandId: input.commandId, evidence: json({ schemaVersion: 2, type: input.policy.purpose,
          termsPolicyId: input.policy.id, termsEvidenceId: terms.id,
          authorizationEvidenceId: input.authorizationEvidenceId }) } });
      return { revision, eventId };
    },
    async readConversion(tx, profile) {
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${profile.userId} FOR UPDATE`;
      const [current, events, dispositions, workspace, features, grants, duties, drafts, contracts, corrections,
        profileAssignments, inquiryAssignments] = await Promise.all([
        tx.partnerProfile.findUniqueOrThrow({ where: { id: profile.id }, select: { irreversibleAt: true } }),
        tx.partnerProfileEvent.findMany({ where: { profileId: profile.id }, orderBy: { revision: 'desc' },
          select: { recordedAt: true, evidence: true } }),
        tx.partnerConversionDisposition.findMany({ where: { profileId: profile.id },
          select: { id: true, sourceType: true, sourceId: true, disposition: true, successorId: true, recordedAt: true } }),
        tx.workspacePermission.findMany({ where: { userId: profile.userId, isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] }, select: { id: true } }),
        tx.featurePermission.findMany({ where: { userId: profile.userId, isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] }, select: { id: true } }),
        tx.effectiveActionGrant.findMany({ where: { subjectUserId: profile.userId, domain: { not: 'PARTNER' },
          effect: 'ALLOW', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] }, select: { id: true } }),
        tx.crossWorkspaceDuty.findMany({ where: { currentAssigneeUserId: profile.userId, status: 'OPEN' }, select: { id: true } }),
        tx.salesContractEditSession.findMany({ where: { ownerUserId: profile.userId, purpose: 'STANDARD' }, select: { id: true } }),
        tx.salesContract.findMany({ where: { responsibleSellerId: profile.userId, isInactive: false,
          status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SIGNED', 'PRINTED'] } }, select: { id: true } }),
        tx.accountingCorrectionRequest.findMany({ where: { assignedToUserId: profile.userId, status: 'OPEN' },
          select: { id: true } }),
        tx.partnerProfileResponderAssignment.findMany({ where: { responderId: profile.userId },
          orderBy: [{ profileId: 'asc' }, { revision: 'desc' }], select: { id: true, profileId: true, revision: true } }),
        tx.partnerInquiryAssignment.findMany({ where: { responderId: profile.userId,
          inquiry: { rows: { some: { outcome: 'PENDING' } } } }, orderBy: [{ inquiryId: 'asc' }, { revision: 'desc' }],
          select: { id: true, inquiryId: true, revision: true } }),
      ]);
      const latestConversion = events.map(event => ({ ...event,
        evidence: event.evidence as Record<string, unknown> })).find(event => event.evidence.type === 'PROFILE_CONVERSION');
      const transition = latestConversion?.evidence.transition;
      const started = transition === 'START';
      const startedAt = started ? latestConversion?.recordedAt : undefined;
      const recordedBlockers = latestConversion?.evidence.blockerIds;
      const requiredBlockerIds = started && Array.isArray(recordedBlockers)
        ? recordedBlockers.filter((id): id is string => typeof id === 'string').sort() : [];
      const dispositionByBlocker = new Map<string, string>();
      for (const item of dispositions.filter(item => startedAt && item.recordedAt >= startedAt)
        .sort((left, right) => left.recordedAt.getTime() - right.recordedAt.getTime() || left.id.localeCompare(right.id))) {
        dispositionByBlocker.set(`${item.sourceType}:${item.sourceId}`, item.id);
      }
      const latestProfileAssignments = new Map<string, { id: string; revision: number }>();
      for (const item of profileAssignments) if (!latestProfileAssignments.has(item.profileId)) latestProfileAssignments.set(item.profileId, item);
      const latestInquiryAssignments = new Map<string, { id: string; revision: number }>();
      for (const item of inquiryAssignments) if (!latestInquiryAssignments.has(item.inquiryId)) latestInquiryAssignments.set(item.inquiryId, item);
      const user = await tx.user.findUniqueOrThrow({ where: { id: profile.userId }, select: { role: true } });
      const blockerIds = [
        ...(user.role === 'USER' ? [] : [`USER_ROLE:${profile.userId}`]),
        ...workspace.map(item => `WORKSPACE_PERMISSION:${item.id}`),
        ...features.map(item => `FEATURE_PERMISSION:${item.id}`),
        ...grants.map(item => `ACTION_GRANT:${item.id}`),
        ...duties.map(item => `DUTY:${item.id}`),
        ...drafts.map(item => `STANDARD_DRAFT:${item.id}`),
        ...contracts.map(item => `CONTRACT_RESPONSIBILITY:${item.id}`),
        ...corrections.map(item => `CORRECTION_REQUEST:${item.id}`),
        ...[...latestProfileAssignments.values()].map(item => `PROFILE_RESPONDER:${item.id}`),
        ...[...latestInquiryAssignments.values()].map(item => `INQUIRY_RESPONDER:${item.id}`),
      ].sort();
      const candidateEvidenceIds = requiredBlockerIds.map(id => dispositionByBlocker.get(id))
        .filter((id): id is string => Boolean(id));
      const evidenceIds = await validatePartnerConversionDispositions(tx, { profileId: profile.id,
        profileUserId: profile.userId, blockerIds: requiredBlockerIds, evidenceIds: candidateEvidenceIds, now: clock.now })
        ? candidateEvidenceIds : [];
      return { started, irreversible: Boolean(current.irreversibleAt), blockerIds, requiredBlockerIds, evidenceIds };
    },
    async appendConversion(tx, input) {
      const updated = await tx.partnerProfile.updateMany({ where: { id: input.profile.id, revision: input.profile.revision },
        data: { revision: { increment: 1 } } });
      if (updated.count !== 1) throw new Error('Partner profile conversion CAS failed');
      const revision = input.profile.revision + 1, eventId = randomUUID();
      await tx.partnerProfileEvent.create({ data: { id: eventId, profileId: input.profile.id, revision,
        fromState: input.profile.state, toState: input.profile.state, actorId: input.actorId, reason: input.reason,
        commandId: input.commandId, evidence: json({ schemaVersion: 2, type: 'PROFILE_CONVERSION',
          transition: input.transition, blockerIds: input.blockerIds,
          dispositionEvidenceIds: input.dispositionEvidenceIds,
          authorizationEvidenceId: input.authorizationEvidenceId }) } });
      return { revision, eventId };
    },
  };
}
