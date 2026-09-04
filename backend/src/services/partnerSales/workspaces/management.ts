import type { Prisma, PrismaClient } from '@prisma/client';
import {
  DuplicateCustomerMatchSchema,
  PartnerManagementWorkspaceViewV2Schema,
  PartnerProfileViewSchema,
  partnerError,
  type ActionAvailabilityV2,
  type PartnerError,
  type PartnerActionV2,
  type PartnerManagementWorkspaceViewV2,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { projectActionAvailabilityV2 } from '../authorization/availability';
import { resolveEligibleResponder } from '../inquiries/adapters';
import { createPrismaPartnerProfileManagementStore } from '../profiles/managementPrismaStore';
import { createPrismaPartnerProfileStore } from '../profiles/prismaStore';

type Transaction = Prisma.TransactionClient;
type Page = { cursor?: string; limit: number };
type Purpose = 'ONBOARDING' | 'MANAGEMENT' | 'ACCOUNTING' | 'CRM';

const actionGroups: ReadonlyArray<{ purpose: Purpose; actions: readonly PartnerActionV2[] }> = [
  // PROFILE_ACTIVATE stays unprojected until a separately versioned wire can
  // carry the exact opaque gate-evidence set required by the owner command.
  { purpose: 'ONBOARDING', actions: ['IDENTITY_VERIFY', 'PROFILE_SUSPEND', 'PROFILE_TERMINATE'] },
  { purpose: 'MANAGEMENT', actions: ['COMMERCIAL_TERMS_MANAGE', 'RESPONDER_ASSIGN', 'PROFILE_CONVERSION_MANAGE'] },
  { purpose: 'ACCOUNTING', actions: ['CREDIT_TERMS_MANAGE'] },
];

const object = (value: Prisma.JsonValue): Prisma.JsonObject | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Prisma.JsonObject : undefined;

function label(user: { firstName: string; lastName: string; username: string }) {
  return `${user.firstName} ${user.lastName}`.trim() || user.username;
}

function policyId(value: Prisma.JsonValue) {
  const row = object(value);
  return typeof row?.policyId === 'string' ? row.policyId : undefined;
}

function purpose(value: Prisma.JsonValue) {
  const row = object(value);
  return typeof row?.purpose === 'string' ? row.purpose : undefined;
}

export function createPrismaManagementWorkspaceReader(input: {
  database: PrismaClient;
  actorId: string;
  correlationId: string;
}) {
  const managementStore = createPrismaPartnerProfileManagementStore(input.database);
  const profileStore = createPrismaPartnerProfileStore(input.database);

  function authorization(transaction: Transaction, purpose: Purpose, reason?: string) {
    return createAuditedPartnerAuthorization(transaction, { actorId: input.actorId, purpose, channel: 'API' },
      { correlationId: input.correlationId, ...(reason ? { reason } : {}) });
  }

  async function profileActions(transaction: Transaction, profileId: string) {
    const root = { kind: 'PROFILE' as const, id: profileId };
    // This is an advisory read-model projection, not mutation authority. Admin
    // commands are reauthorized later with the actor-entered decision reason;
    // identify the projection truthfully so the UI can open that reason dialog.
    const projectionReason = 'Partner management availability projection; command requires an explicit actor reason.';
    const values = await Promise.all(actionGroups.map(group =>
      projectActionAvailabilityV2(authorization(transaction, group.purpose, projectionReason), root, group.actions)));
    const output = new Map<PartnerActionV2, ActionAvailabilityV2>();
    for (const item of values.flat()) output.set(item.action, item);
    return [...output.values()];
  }

  async function visibility(transaction: Transaction, purpose: Purpose,
    root: { kind: 'PROFILE' | 'CUSTOMER'; id: string }, action: 'PROFILE_READ' | 'CUSTOMER_READ'):
  Promise<{ visible: true } | { visible: false; error?: PartnerError }> {
    const decision = await authorization(transaction, purpose).authorize(action, root);
    if (decision.ok) return { visible: true as const };
    if (decision.error.status === 404 || decision.error.code === 'FORBIDDEN' || decision.error.code === 'NOT_ASSIGNED') {
      return { visible: false as const };
    }
    return { visible: false as const, error: decision.error };
  }

  async function responderOptions(transaction: Transaction) {
    const users = await transaction.user.findMany({ where: { isActive: true, partnerProfile: null },
      select: { id: true, firstName: true, lastName: true, username: true }, orderBy: { id: 'asc' } });
    const eligible: Array<{ id: string; label: string }> = [];
    for (const user of users) {
      const result = await resolveEligibleResponder(transaction, { responderId: user.id });
      if (result.ok) eligible.push({ id: user.id, label: label(user) });
    }
    return eligible;
  }

  return async function readManagementWorkspace(transaction: Transaction, page: Page):
  Promise<Result<PartnerManagementWorkspaceViewV2>> {
    const take = Math.min(page.limit * 4 + 1, 401);
    const profiles = await transaction.partnerProfile.findMany({
      where: page.cursor ? { id: { gt: page.cursor } } : undefined,
      orderBy: { id: 'asc' }, take,
      select: {
        id: true, userId: true, state: true, revision: true, firstActivatedAt: true, irreversibleAt: true,
        user: { select: { firstName: true, lastName: true, username: true } },
        commercialAccount: { select: {
          identities: { orderBy: { version: 'desc' }, take: 1, select: {
            legalName: true, phone: true, address: true, identifiers: true,
          } },
          terms: { orderBy: { version: 'desc' }, select: { id: true, terms: true } },
        } },
        responderAssignments: { orderBy: { revision: 'desc' }, take: 1, select: {
          id: true, responderId: true, revision: true,
          profile: { select: { id: true } },
        } },
        cohortMemberships: { select: { cohort: { select: {
          activationEnabled: true, enrollmentPaused: true, operationalPaused: true,
        } } } },
        inquiries: { where: { rows: { some: { outcome: 'PENDING' } } }, select: {
          id: true, assignments: { orderBy: { revision: 'desc' }, take: 1, select: { revision: true } },
        } },
      },
    });
    const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const policies = await transaction.partnerTermsPolicy.findMany({ where: {
      revokedAt: null, issuedAt: { lte: clock.now }, effectiveDate: { lte: clock.now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }],
    }, select: { id: true, purpose: true, label: true }, orderBy: [{ effectiveDate: 'desc' }, { id: 'asc' }] });
    const eligibleResponders = await responderOptions(transaction);
    const projected: PartnerManagementWorkspaceViewV2['profiles'] = [];
    let scannedCursor: string | undefined;
    let hasUnscanned = false;

    for (const [index, profile] of profiles.entries()) {
      scannedCursor = profile.id;
      const profileVisibility = await visibility(transaction, 'ONBOARDING',
        { kind: 'PROFILE', id: profile.id }, 'PROFILE_READ');
      if (!profileVisibility.visible) {
        if (profileVisibility.error) return { ok: false, error: profileVisibility.error };
        continue;
      }
      const actions = await profileActions(transaction, profile.id);
      const gates = await profileStore.readActivationGates(transaction, profile);
      const identity = profile.commercialAccount?.identities[0];
      const identitySource = identity ? object(identity.identifiers) : undefined;
      const termsByPurpose = new Map<string, { id: string; terms: Prisma.JsonValue }>();
      for (const term of profile.commercialAccount?.terms ?? []) {
        const kind = purpose(term.terms);
        if (kind && !termsByPurpose.has(kind)) termsByPurpose.set(kind, term);
      }
      const commercial = termsByPurpose.get('PARTNER_TECHNICAL_PRICING');
      const credit = termsByPurpose.get('PARTNER_CREDIT_TERMS');
      const assignment = profile.responderAssignments[0];
      const responder = assignment
        ? await transaction.user.findUnique({ where: { id: assignment.responderId }, select: {
          id: true, firstName: true, lastName: true, username: true,
        } }) : null;
      const conversion = await managementStore.readConversion(transaction, profile);
      const profileView = PartnerProfileViewSchema.safeParse({ schemaVersion: 1, purpose: 'ONBOARDING',
        profileId: profile.id, partnerSellerId: profile.userId, revision: profile.revision, status: profile.state,
        identityVerified: gates.identityVerified, commercialTermsReady: gates.commercialTermsReady,
        creditTermsReady: gates.creditTermsReady, responderReady: gates.responderReady,
        conversionCleared: gates.conversionCleared, cohortReady: gates.cohortReady,
      });
      if (!profileView.success) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      const can = (action: PartnerActionV2) => actions.some(item => item.action === action && item.enabled);
      const pendingInquiries = [] as NonNullable<PartnerManagementWorkspaceViewV2['profiles'][number]['responder']>['pendingInquiries'];
      if (can('RESPONDER_ASSIGN')) {
        for (const inquiry of profile.inquiries) {
          const current = inquiry.assignments[0];
          if (!current) continue;
          const inquiryActions = await projectActionAvailabilityV2(authorization(transaction, 'MANAGEMENT'),
            { kind: 'INQUIRY', id: inquiry.id }, ['RESPONDER_REASSIGN']);
          if (inquiryActions.length) pendingInquiries.push({ inquiryId: inquiry.id,
            assignmentRevision: current.revision, label: 'استعلام در انتظار پاسخ', actions: inquiryActions });
        }
      }
      projected.push({
        profile: profileView.data,
        displayName: label(profile.user),
        actions,
        ...(gates.identityVerified && identity && typeof identitySource?.evidenceId === 'string' &&
          (can('IDENTITY_VERIFY') || can('PROFILE_ACTIVATE')) ? { identity: {
            evidenceId: identitySource.evidenceId, legalName: identity.legalName, phone: identity.phone,
            address: identity.address, personType: identitySource.personType === 'LEGAL' ? 'LEGAL' as const : 'NATURAL' as const,
          } } : {}),
        ...(can('COMMERCIAL_TERMS_MANAGE') ? { commercialTerms: {
          ...(commercial ? { currentVersionId: policyId(commercial.terms) ?? commercial.id } : {}),
          summary: commercial ? 'شرایط تجاری جاری ثبت شده است.' : 'شرایط تجاری هنوز ثبت نشده است.',
          options: policies.filter(item => item.purpose === 'PARTNER_TECHNICAL_PRICING')
            .map(item => ({ id: item.id, label: item.label })),
        } } : {}),
        ...(can('CREDIT_TERMS_MANAGE') ? { creditTerms: {
          ...(credit ? { currentVersionId: policyId(credit.terms) ?? credit.id } : {}),
          summary: credit ? 'شرایط اعتبار جاری ثبت شده است.' : 'شرایط اعتبار هنوز ثبت نشده است.',
          options: policies.filter(item => item.purpose === 'PARTNER_CREDIT_TERMS')
            .map(item => ({ id: item.id, label: item.label })),
        } } : {}),
        ...(can('RESPONDER_ASSIGN') ? { responder: {
          ...(responder ? { currentId: responder.id, displayName: label(responder) } : {}),
          eligibleOptions: eligibleResponders,
          pendingInquiries,
        } } : {}),
        ...(can('PROFILE_CONVERSION_MANAGE') ? { conversion: {
          started: conversion.started, irreversible: conversion.irreversible,
          blockers: conversion.blockerIds.map(id => ({ id, label: 'مورد باز نیازمند تعیین تکلیف' })),
          dispositionEvidenceIds: conversion.evidenceIds,
        } } : {}),
      });
      if (projected.length === page.limit) {
        hasUnscanned = index < profiles.length - 1;
        break;
      }
    }

    const transfers: PartnerManagementWorkspaceViewV2['transfers'] = [];
    const pendingTransfers = await transaction.partnerCustomerTransfer.findMany({ where: { status: 'PENDING' },
      orderBy: { id: 'asc' }, take: 100, select: { id: true, revision: true, customerId: true, match: {
        select: { snapshot: true },
      } } });
    for (const transfer of pendingTransfers) {
      const port = authorization(transaction, 'CRM');
      const transferVisibility = await visibility(transaction, 'CRM',
        { kind: 'CUSTOMER', id: transfer.customerId }, 'CUSTOMER_READ');
      if (!transferVisibility.visible) {
        if (transferVisibility.error) return { ok: false, error: transferVisibility.error };
        continue;
      }
      const actions = await projectActionAvailabilityV2(port, { kind: 'CUSTOMER', id: transfer.customerId },
        ['CUSTOMER_TRANSFER_DECIDE']);
      const match = DuplicateCustomerMatchSchema.safeParse(transfer.match.snapshot);
      if (!match.success) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      transfers.push({ transferId: transfer.id, revision: transfer.revision, match: match.data, actions });
    }

    const view = PartnerManagementWorkspaceViewV2Schema.safeParse({
      schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', actorId: input.actorId,
      personaLabel: 'مدیریت فروش همکار', actions: [], profiles: projected, transfers,
      ...((hasUnscanned || profiles.length === take) && scannedCursor ? { nextCursor: scannedCursor } : {}),
    });
    return view.success ? { ok: true, value: view.data }
      : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  };
}
