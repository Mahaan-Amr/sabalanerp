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
import { createPrismaPartnerProfileManagementStore } from '../profiles/managementPrismaStore';
import { createPrismaPartnerProfileStore } from '../profiles/prismaStore';

type Transaction = Prisma.TransactionClient;
type Page = { cursor?: string; limit: number };
type Purpose = 'ONBOARDING' | 'MANAGEMENT' | 'ACCOUNTING' | 'CRM';

const actionGroups: ReadonlyArray<{ purpose: Purpose; actions: readonly PartnerActionV2[] }> = [
  // Initial conversion uses the direct activation command. This activation
  // action is projected here only for resuming an existing inactive profile,
  // which deliberately requires no opaque onboarding evidence.
  { purpose: 'ONBOARDING', actions: ['IDENTITY_VERIFY', 'PROFILE_ACTIVATE', 'PROFILE_SUSPEND', 'PROFILE_TERMINATE'] },
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

  async function profileActions(transaction: Transaction, profileId: string,
    state: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED') {
    const root = { kind: 'PROFILE' as const, id: profileId };
    // This is an advisory read-model projection, not mutation authority. Admin
    // commands are reauthorized later with the actor-entered decision reason;
    // identify the projection truthfully so the UI can open that reason dialog.
    const projectionReason = 'Partner management availability projection; command requires an explicit actor reason.';
    const values = await Promise.all(actionGroups.map(group =>
      projectActionAvailabilityV2(authorization(transaction, group.purpose, projectionReason), root, group.actions)));
    const output = new Map<PartnerActionV2, ActionAvailabilityV2>();
    for (const item of values.flat()) output.set(item.action, item);
    if (!['SUSPENDED', 'TERMINATED'].includes(state)) output.delete('PROFILE_ACTIVATE');
    if (state !== 'ACTIVE') output.delete('PROFILE_SUSPEND');
    if (!['ACTIVE', 'SUSPENDED'].includes(state)) output.delete('PROFILE_TERMINATE');
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
      select: { id: true, firstName: true, lastName: true, username: true, role: true }, orderBy: { id: 'asc' } });
    const userIds = users.map(user => user.id);
    const roles = [...new Set(users.map(user => user.role))];
    const [direct, inherited] = await Promise.all([
      transaction.workspacePermission.findMany({ where: { userId: { in: userIds }, workspace: 'sales',
        isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      select: { userId: true, permissionLevel: true } }),
      transaction.roleWorkspacePermission.findMany({ where: { role: { in: roles }, workspace: 'sales', isActive: true },
        select: { role: true, permissionLevel: true } }),
    ]);
    const directByUser = new Map(direct.map(item => [item.userId, item.permissionLevel.toLowerCase()]));
    const inheritedByRole = new Map(inherited.map(item => [item.role, item.permissionLevel.toLowerCase()]));
    const editCapable = (level?: string) => level === 'edit' || level === 'admin';
    return users.filter(user => user.role === 'ADMIN' || editCapable(directByUser.has(user.id)
      ? directByUser.get(user.id) : inheritedByRole.get(user.role))).map(user => ({ id: user.id, label: label(user) }));
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
            legalName: true, phone: true, address: true, identifiers: true, integrityHash: true,
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
    const [policies, identityEvidence] = await Promise.all([
      transaction.partnerTermsPolicy.findMany({ where: {
        revokedAt: null, issuedAt: { lte: clock.now }, effectiveDate: { lte: clock.now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }],
      }, select: { id: true, purpose: true, label: true }, orderBy: [{ effectiveDate: 'desc' }, { id: 'asc' }] }),
      transaction.partnerIdentityEvidence.findMany({ where: { userId: { in: profiles.map(profile => profile.userId) } },
        select: { id: true, userId: true, legalName: true, personType: true, phone: true, address: true,
          integrityHash: true, issuedAt: true, expiresAt: true, revokedAt: true }, orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }] }),
    ]);
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
      const actions = await profileActions(transaction, profile.id, profile.state);
      const gates = await profileStore.readActivationGates(transaction, profile);
      const lifecycleBlockers = ['SUSPENDED', 'TERMINATED'].includes(profile.state) ? [
        ...(!gates.userActive ? [{ action: 'REACTIVATE' as const, code: 'USER_INACTIVE',
          title: 'حساب کاربری غیرفعال است', detail: 'این حساب امکان ورود و ادامه همکاری ندارد.',
          owner: 'مدیریت کاربران', nextStep: 'ابتدا حساب کاربری را فعال کنید.' }] : []),
        ...(!gates.responderReady ? [{ action: 'REACTIVATE' as const, code: 'RESPONDER_UNAVAILABLE',
          title: 'پاسخ‌دهنده قیمت آماده نیست', detail: 'پاسخ‌دهنده فعلی حذف شده یا دسترسی لازم را ندارد.',
          owner: 'مدیریت فروش', nextStep: 'یک پاسخ‌دهنده فعال انتخاب کنید و دوباره تلاش کنید.' }] : []),
        ...(gates.conflictingInternalAuthority ? [{ action: 'REACTIVATE' as const, code: 'INTERNAL_AUTHORITY',
          title: 'دسترسی یا مسئولیت داخلی ناسازگار وجود دارد',
          detail: 'این حساب هنوز نقش، دسترسی یا مسئولیت داخلی ناسازگار با فروشنده همکار دارد.',
          owner: 'مدیر واحد مربوط', nextStep: 'موارد داخلی را لغو یا منتقل کنید و دوباره تلاش کنید.' }] : []),
      ] : [];
      const identity = profile.commercialAccount?.identities[0];
      const identitySource = identity ? object(identity.identifiers) : undefined;
      const currentEvidence = typeof identitySource?.evidenceId === 'string'
        ? identityEvidence.find(item => item.id === identitySource.evidenceId) : undefined;
      const identityRevisionOptions = currentEvidence ? identityEvidence.filter(candidate =>
        candidate.userId === profile.userId && candidate.id !== currentEvidence.id && candidate.issuedAt > currentEvidence.issuedAt &&
        candidate.issuedAt <= clock.now && !candidate.revokedAt && (!candidate.expiresAt || candidate.expiresAt > clock.now))
        .flatMap(candidate => {
          if (!identity || candidate.integrityHash === identity.integrityHash) return [];
          const changes = [
            candidate.legalName !== identity.legalName ? `نام قانونی: «${identity.legalName}» ← «${candidate.legalName}»` : null,
            candidate.personType !== (identitySource?.personType === 'LEGAL' ? 'LEGAL' : 'NATURAL')
              ? `نوع شخص: «${identitySource?.personType === 'LEGAL' ? 'حقوقی' : 'حقیقی'}» ← «${candidate.personType === 'LEGAL' ? 'حقوقی' : 'حقیقی'}»` : null,
            candidate.phone !== identity.phone ? `تلفن: «${identity.phone}» ← «${candidate.phone}»` : null,
            candidate.address !== identity.address ? `نشانی: «${identity.address}» ← «${candidate.address}»` : null,
          ].filter((change): change is string => Boolean(change));
          if (!changes.length) changes.push('شناسه‌ها یا مدارک هویتی تغییر کرده‌اند.');
          return [{ id: candidate.id, label: `شواهد هویت ${candidate.issuedAt.toLocaleDateString('fa-IR')}`, changes }];
        }) : [];
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
          const inquiryActions = await projectActionAvailabilityV2(authorization(transaction, 'MANAGEMENT',
            'Partner inquiry reassignment availability projection; command requires an explicit actor reason.'),
            { kind: 'INQUIRY', id: inquiry.id }, ['RESPONDER_REASSIGN']);
          if (inquiryActions.length) pendingInquiries.push({ inquiryId: inquiry.id,
            assignmentRevision: current.revision, label: 'استعلام در انتظار پاسخ', actions: inquiryActions });
        }
      }
      let visibleActions = gates.identityVerified && identityRevisionOptions.length === 0
        ? actions.filter(item => item.action !== 'IDENTITY_VERIFY')
        : actions;
      if (lifecycleBlockers.length) visibleActions = visibleActions.map(item => item.action === 'PROFILE_ACTIVATE'
        ? { action: item.action, enabled: false, disabledReason: partnerError('DEPENDENCY_BLOCKED') } : item);
      projected.push({
        profile: profileView.data,
        displayName: label(profile.user),
        actions: visibleActions,
        lifecycleBlockers,
        ...(gates.identityVerified && identity && typeof identitySource?.evidenceId === 'string' &&
          profileVisibility.visible ? { identity: {
            evidenceId: identitySource.evidenceId, legalName: identity.legalName, phone: identity.phone,
            address: identity.address, personType: identitySource.personType === 'LEGAL' ? 'LEGAL' as const : 'NATURAL' as const,
          } } : {}),
        ...(gates.identityVerified && identityRevisionOptions.length ? { identityRevision: {
          options: identityRevisionOptions,
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
