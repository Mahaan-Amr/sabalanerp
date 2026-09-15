import { randomUUID } from 'node:crypto';
import { Prisma, UserRole, type PrismaClient } from '@prisma/client';
import {
  PartnerDirectActivationCommandV4Schema,
  PartnerDirectActivationReceiptV4Schema,
  PartnerDirectActivationRevertCommandV4Schema,
  PartnerDirectActivationRevertReceiptV4Schema,
  PartnerDirectActivationViewV4Schema,
  canonicalHash,
  partnerError,
  type PartnerDirectActivationCommandV4,
  type PartnerDirectActivationReceiptV4,
  type PartnerDirectActivationRevertCommandV4,
  type PartnerDirectActivationRevertReceiptV4,
  type PartnerDirectActivationV4Port,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import { resolveEligibleResponder } from '../inquiries/adapters';

type Tx = Prisma.TransactionClient;
type AuthorizationAction = 'PROFILE_READ' | 'PROFILE_CREATE' | 'PROFILE_ACTIVATE' |
  'RESPONDER_ASSIGN' | 'PROFILE_CONVERSION_MANAGE';
type Authorization = (tx: Tx, input: { action: AuthorizationAction; purpose: 'ONBOARDING' | 'MANAGEMENT';
  reason: string; root: { kind: 'PROFILE'; id: string }; prospectiveOwnerId?: string }) =>
Promise<Result<{ evidenceId: string }>>;

const STANDARD_REASON = 'تبدیل به فروشنده همکار';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const label = (user: { firstName: string; lastName: string; username: string }) =>
  `${user.firstName} ${user.lastName}`.trim() || user.username;

function intent(command: PartnerDirectActivationCommandV4 | PartnerDirectActivationRevertCommandV4) {
  const { commandId: _commandId, correlationId: _correlationId, idempotency: _idempotency, ...value } = command;
  return value;
}

function decodeRevertReceipt(value: unknown): PartnerDirectActivationRevertReceiptV4 | undefined {
  const parsed = PartnerDirectActivationRevertReceiptV4Schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

async function responsibilityCount(tx: Tx, userId: string) {
  const [duties, sessions, contracts, projects, corrections] = await Promise.all([
    tx.crossWorkspaceDuty.count({ where: { currentAssigneeUserId: userId, status: 'OPEN' } }),
    tx.salesContractEditSession.count({ where: { ownerUserId: userId, purpose: 'STANDARD' } }),
    tx.salesContract.count({ where: { responsibleSellerId: userId, isInactive: false,
      status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SIGNED', 'PRINTED'] } } }),
    tx.crmPotentialProject.count({ where: { responsibleSellerId: userId, partnerRevision: null, isActive: true } }),
    tx.accountingCorrectionRequest.count({ where: { assignedToUserId: userId, status: 'OPEN' } }),
  ]);
  return duties + sessions + contracts + projects + corrections;
}

async function eligibleResponders(tx: Tx) {
  const candidates = await tx.user.findMany({ where: { isActive: true, partnerProfile: null },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }], take: 100,
    select: { id: true, firstName: true, lastName: true, username: true } });
  const eligible = await Promise.all(candidates.map(async user => ({ user,
    result: await resolveEligibleResponder(tx, { responderId: user.id }) })));
  return eligible.filter(item => item.result.ok).map(({ user }) => ({ id: user.id, label: label(user) }));
}

function decodeReceipt(value: unknown): PartnerDirectActivationReceiptV4 | undefined {
  const parsed = PartnerDirectActivationReceiptV4Schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function createPrismaPartnerDirectActivation(input: {
  database: PrismaClient;
  actorId: string;
  authorize: Authorization;
}): PartnerDirectActivationV4Port {
  return {
    async query(request) {
      try {
        return await input.database.$transaction(async tx => {
          const user = await tx.user.findUnique({ where: { id: request.userId }, select: {
            id: true, firstName: true, lastName: true, username: true, role: true, isActive: true, updatedAt: true,
            partnerProfile: { select: { id: true, state: true, revision: true, firstActivatedAt: true, irreversibleAt: true,
              responderAssignments: { orderBy: { revision: 'desc' }, take: 1, select: { responderId: true } },
              _count: { select: { customers: true, inquiries: true, saleCases: true, conversionDispositions: true } },
              conversionDispositions: { where: { sourceType: 'PARTNER_ACTIVATION', disposition: 'DIRECT_V4' },
                take: 1, select: { id: true } },
              events: { where: { toState: 'ACTIVE' }, orderBy: { revision: 'asc' }, take: 1,
                select: { actorId: true, recordedAt: true } },
            } },
          } });
          if (!user) return { ok: false as const, error: partnerError('NOT_FOUND') };
          const profileId = user.partnerProfile?.id;
          const authorization = await input.authorize(tx, { action: 'PROFILE_READ', purpose: 'ONBOARDING',
            reason: 'مشاهده وضعیت فروشنده همکار در پروفایل کاربر',
            root: { kind: 'PROFILE', id: profileId ?? `prospective:${user.id}` },
            ...(!profileId ? { prospectiveOwnerId: user.id } : {}) });
          if (!authorization.ok) return authorization;
          const [responders, priorResponsibilityCount] = await Promise.all([
            eligibleResponders(tx), responsibilityCount(tx, user.id),
          ]);
          const state = user.partnerProfile?.state ?? 'NONE';
          const canActivate = user.isActive && input.actorId !== user.id && !['ADMIN', 'MANAGER'].includes(user.role) &&
            (state === 'NONE' || state === 'PENDING') && responders.length > 0;
          const blocker = canActivate ? undefined : partnerError(!user.isActive ? 'PARTNER_NOT_ACTIVE'
            : responders.length === 0 ? 'RESPONDER_UNAVAILABLE' : 'STATE_CONFLICT');
          const commercialEvidenceCount = user.partnerProfile
            ? user.partnerProfile._count.customers + user.partnerProfile._count.inquiries + user.partnerProfile._count.saleCases : 0;
          const canRevert = Boolean(user.partnerProfile && user.partnerProfile.state === 'ACTIVE' &&
            user.partnerProfile.conversionDispositions.length && !user.partnerProfile.irreversibleAt &&
            commercialEvidenceCount === 0 && input.actorId !== user.id);
          const revertBlocker = user.partnerProfile?.state === 'ACTIVE' && !canRevert ? partnerError('STATE_CONFLICT') : undefined;
          const activation = user.partnerProfile?.events[0];
          const view = PartnerDirectActivationViewV4Schema.parse({ schemaVersion: 4,
            purpose: 'PARTNER_DIRECT_ACTIVATION', actorId: input.actorId,
            subject: { userId: user.id, displayName: label(user), active: user.isActive, role: user.role,
              userUpdatedAt: user.updatedAt.toISOString(), partnerState: state,
              ...(user.partnerProfile ? { profileId: user.partnerProfile.id, profileRevision: user.partnerProfile.revision,
                responderId: user.partnerProfile.responderAssignments[0]?.responderId,
                customerCount: user.partnerProfile._count.customers, inquiryCount: user.partnerProfile._count.inquiries,
                caseCount: user.partnerProfile._count.saleCases } : { customerCount: 0, inquiryCount: 0, caseCount: 0 }),
              ...(activation ? { convertedAt: activation.recordedAt.toISOString(), convertedBy: activation.actorId } : {}),
              canActivate, ...(blocker ? { blocker } : {}), canRevert, ...(revertBlocker ? { revertBlocker } : {}),
              priorResponsibilityCount }, responders });
          return { ok: true as const, value: view };
        });
      } catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
    },

    async execute(raw) {
      const parsed = PartnerDirectActivationCommandV4Schema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      const command = parsed.data;
      const payloadHash = await canonicalHash(intent(command));
      if (command.idempotency.actorId !== input.actorId || command.idempotency.payloadHash !== payloadHash) {
        return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      }
      try {
        return await input.database.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${command.userId} FOR UPDATE`;
          const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
            actorId: input.actorId, operation: command.type, targetScope: command.userId, key: command.idempotency.key,
          } } });
          if (prior) {
            if (prior.payloadHash !== payloadHash) return { ok: false as const, error: partnerError('IDEMPOTENCY_CONFLICT') };
            const receipt = decodeReceipt(prior.outcome);
            return receipt?.commandId === command.commandId
              ? { ok: true as const, value: { ...receipt, replayed: true } }
              : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
          }
          const user = await tx.user.findUnique({ where: { id: command.userId }, select: {
            id: true, email: true, username: true, firstName: true, lastName: true, role: true, isActive: true,
            updatedAt: true, profile: { select: { phone: true, address: true } },
            partnerProfile: { select: { id: true, state: true, revision: true, firstActivatedAt: true,
              commercialAccount: { select: { id: true } },
              responderAssignments: { orderBy: { revision: 'desc' }, take: 1, select: { revision: true } } } },
          } });
          if (!user) return { ok: false as const, error: partnerError('NOT_FOUND') };
          if (input.actorId === user.id || !user.isActive || ['ADMIN', 'MANAGER'].includes(user.role) ||
              (user.partnerProfile && user.partnerProfile.state !== 'PENDING') ||
              user.updatedAt.toISOString() !== command.expectedUserUpdatedAt) {
            return { ok: false as const, error: user.updatedAt.toISOString() !== command.expectedUserUpdatedAt
              ? partnerError('ROW_STALE') : partnerError('STATE_CONFLICT') };
          }
          const profileId = user.partnerProfile?.id ?? randomUUID();
          const authRoot = { kind: 'PROFILE' as const, id: profileId };
          const authorizations = new Map<AuthorizationAction, string>();
          for (const [action, purpose] of [
            [user.partnerProfile ? 'PROFILE_ACTIVATE' : 'PROFILE_CREATE', 'ONBOARDING'],
            ['PROFILE_ACTIVATE', 'ONBOARDING'], ['RESPONDER_ASSIGN', 'MANAGEMENT'],
            ['PROFILE_CONVERSION_MANAGE', 'MANAGEMENT'],
          ] as const) {
            if (authorizations.has(action)) continue;
            const result = await input.authorize(tx, { action, purpose, reason: STANDARD_REASON, root: authRoot,
              ...(!user.partnerProfile ? { prospectiveOwnerId: user.id } : {}) });
            if (!result.ok) return result;
            authorizations.set(action, result.value.evidenceId);
          }
          const responder = await resolveEligibleResponder(tx, { responderId: command.responderId });
          if (!responder.ok) return responder;
          const [workspace, features, grants, preservedResponsibilityCount] = await Promise.all([
            tx.workspacePermission.findMany({ where: { userId: user.id, isActive: true },
              select: { id: true, workspace: true, permissionLevel: true, grantedBy: true, grantedAt: true, expiresAt: true } }),
            tx.featurePermission.findMany({ where: { userId: user.id, isActive: true },
              select: { id: true, workspace: true, feature: true, permissionLevel: true,
                grantedBy: true, grantedAt: true, expiresAt: true } }),
            tx.effectiveActionGrant.findMany({ where: { subjectUserId: user.id, domain: { not: 'PARTNER' },
              effect: 'ALLOW', revokedAt: null }, select: { id: true, domain: true, action: true, rootKind: true,
              purpose: true, scope: true, effect: true, effectiveFrom: true, expiresAt: true } }),
            responsibilityCount(tx, user.id),
          ]);
          const roleChanged = user.role !== 'USER';
          const removedAccessCount = Number(roleChanged) + workspace.length + features.length + grants.length;
          const accountId = user.partnerProfile?.commercialAccount?.id ?? randomUUID();
          const now = new Date();
          let profileRevision: number;
          const eventId = randomUUID();
          if (!user.partnerProfile) {
            const identity = { legalName: label(user), phone: user.profile?.phone || 'ثبت‌نشده', address: user.profile?.address || 'ثبت‌نشده',
              email: user.email, source: 'USER_PROFILE' };
            await tx.partnerProfile.create({ data: { id: profileId, userId: user.id, state: 'ACTIVE', revision: 1,
              firstActivatedAt: now, commercialAccount: { create: { id: accountId, identities: { create: {
                id: randomUUID(), version: 1, legalName: identity.legalName, identifiers: json({ email: identity.email,
                  username: user.username, source: identity.source }), phone: identity.phone, address: identity.address,
                integrityHash: await canonicalHash(identity), actorId: input.actorId,
              } } } }, events: { create: { id: eventId, revision: 1, fromState: null, toState: 'ACTIVE',
                actorId: input.actorId, reason: STANDARD_REASON, commandId: command.commandId,
                evidence: json({ schemaVersion: 4, type: command.type, automaticCapabilityBundle: true,
                  commercialAccountId: accountId, authorizationEvidenceIds: Object.fromEntries(authorizations) }) } } } });
            profileRevision = 1;
          } else {
            profileRevision = user.partnerProfile.revision + 1;
            await tx.partnerProfile.update({ where: { id: profileId }, data: { state: 'ACTIVE', revision: profileRevision,
              ...(!user.partnerProfile.firstActivatedAt ? { firstActivatedAt: now } : {}) } });
            if (!user.partnerProfile.commercialAccount) {
              const identity = { legalName: label(user), phone: user.profile?.phone || 'ثبت‌نشده', address: user.profile?.address || 'ثبت‌نشده',
                email: user.email, source: 'USER_PROFILE' };
              await tx.partnerCommercialAccount.create({ data: { id: accountId, profileId, identities: { create: {
                id: randomUUID(), version: 1, legalName: identity.legalName,
                identifiers: json({ email: identity.email, username: user.username, source: identity.source }),
                phone: identity.phone, address: identity.address, integrityHash: await canonicalHash(identity), actorId: input.actorId,
              } } } });
            }
            await tx.partnerProfileEvent.create({ data: { id: eventId, profileId, revision: profileRevision,
              fromState: 'PENDING', toState: 'ACTIVE', actorId: input.actorId, reason: STANDARD_REASON,
              commandId: command.commandId, evidence: json({ schemaVersion: 4, type: command.type,
                automaticCapabilityBundle: true, commercialAccountId: accountId,
                authorizationEvidenceIds: Object.fromEntries(authorizations) }) } });
          }
          const dispositions: Array<{ sourceType: string; sourceId: string; disposition: string; evidence: unknown }> = [
            { sourceType: 'PARTNER_ACTIVATION', sourceId: command.commandId, disposition: 'DIRECT_V4',
              evidence: { automaticCapabilityBundle: true } },
            ...(roleChanged ? [{ sourceType: 'USER_ROLE', sourceId: user.id, disposition: 'RESET',
              evidence: { previousRole: user.role } }] : []),
            ...workspace.map(row => ({ sourceType: 'WORKSPACE_PERMISSION', sourceId: row.id, disposition: 'REVOKED',
              evidence: { workspace: row.workspace, permissionLevel: row.permissionLevel } })),
            ...features.map(row => ({ sourceType: 'FEATURE_PERMISSION', sourceId: row.id, disposition: 'REVOKED',
              evidence: { workspace: row.workspace, feature: row.feature, permissionLevel: row.permissionLevel } })),
            ...grants.map(row => ({ sourceType: 'ACTION_GRANT', sourceId: row.id, disposition: 'REVOKED', evidence: row })),
          ];
          if (roleChanged) await tx.user.update({ where: { id: user.id }, data: { role: 'USER' } });
          if (workspace.length) await tx.workspacePermission.updateMany({ where: { id: { in: workspace.map(row => row.id) } }, data: { isActive: false } });
          if (features.length) await tx.featurePermission.updateMany({ where: { id: { in: features.map(row => row.id) } }, data: { isActive: false } });
          if (grants.length) await tx.effectiveActionGrant.updateMany({ where: { id: { in: grants.map(row => row.id) } },
            data: { revokedAt: now, revokedBy: input.actorId, revocationReason: STANDARD_REASON,
              revocationCorrelationId: command.correlationId } });
          if (dispositions.length) await tx.partnerConversionDisposition.createMany({ data: dispositions.map(row => ({
            id: randomUUID(), profileId, sourceType: row.sourceType, sourceId: row.sourceId,
            disposition: row.disposition, actorId: input.actorId,
            evidence: json({ schemaVersion: 4, ...row.evidence as object,
              conversionCorrelationId: command.correlationId,
              authorizationEvidenceId: authorizations.get('PROFILE_CONVERSION_MANAGE') }),
          })) });
          const assignmentId = randomUUID();
          await tx.partnerProfileResponderAssignment.create({ data: { id: assignmentId, profileId,
            revision: (user.partnerProfile?.responderAssignments[0]?.revision ?? 0) + 1,
            responderId: responder.value.responderId, actorId: input.actorId, reason: STANDARD_REASON,
            eligibilityEvidence: json({ ...responder.value.eligibilityEvidence,
              authorizationEvidenceId: authorizations.get('RESPONDER_ASSIGN') }) } });
          const receipt = PartnerDirectActivationReceiptV4Schema.parse({ schemaVersion: 4,
            commandId: command.commandId, replayed: false, userId: user.id, profileId, profileRevision,
            responderAssignmentId: assignmentId, commercialAccountId: accountId, eventIds: [eventId],
            removedAccessCount, preservedResponsibilityCount });
          await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: input.actorId,
            operation: command.type, targetScope: command.userId, key: command.idempotency.key,
            payloadHash, outcome: json(receipt) } });
          return { ok: true as const, value: receipt };
        });
      } catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
    },

    async revert(raw) {
      const parsed = PartnerDirectActivationRevertCommandV4Schema.safeParse(raw);
      if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      const command = parsed.data;
      const payloadHash = await canonicalHash(intent(command));
      if (command.idempotency.actorId !== input.actorId || command.idempotency.payloadHash !== payloadHash) {
        return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      }
      try {
        return await input.database.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${command.profileId} FOR UPDATE`;
          const prior = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
            actorId: input.actorId, operation: command.type, targetScope: command.profileId, key: command.idempotency.key,
          } } });
          if (prior) {
            if (prior.payloadHash !== payloadHash) return { ok: false as const, error: partnerError('IDEMPOTENCY_CONFLICT') };
            const receipt = decodeRevertReceipt(prior.outcome);
            return receipt?.commandId === command.commandId
              ? { ok: true as const, value: { ...receipt, replayed: true } }
              : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
          }
          const profile = await tx.partnerProfile.findUnique({ where: { id: command.profileId }, select: {
            id: true, userId: true, state: true, revision: true, irreversibleAt: true,
            user: { select: { role: true } },
            _count: { select: { customers: true, inquiries: true, saleCases: true } },
            conversionDispositions: { where: { OR: [
              { sourceType: 'PARTNER_ACTIVATION', disposition: 'DIRECT_V4' },
              { sourceType: { in: ['USER_ROLE', 'WORKSPACE_PERMISSION', 'FEATURE_PERMISSION', 'ACTION_GRANT'] } },
            ] }, orderBy: { recordedAt: 'asc' },
              select: { id: true, sourceType: true, sourceId: true, disposition: true, actorId: true,
                evidence: true, recordedAt: true } },
          } });
          if (!profile || profile.userId !== command.userId) return { ok: false as const, error: partnerError('NOT_FOUND') };
          const evidenceCount = profile._count.customers + profile._count.inquiries + profile._count.saleCases;
          const direct = profile.conversionDispositions.some(row =>
            row.sourceType === 'PARTNER_ACTIVATION' && row.disposition === 'DIRECT_V4');
          if (profile.state !== 'ACTIVE' || profile.revision !== command.expectedProfileRevision ||
              profile.irreversibleAt || evidenceCount > 0 || !direct || input.actorId === profile.userId ||
              profile.user.role !== 'USER') {
            return { ok: false as const, error: profile.revision !== command.expectedProfileRevision
              ? partnerError('ROW_STALE') : partnerError('STATE_CONFLICT') };
          }
          const authorization = await input.authorize(tx, { action: 'PROFILE_CONVERSION_MANAGE', purpose: 'MANAGEMENT',
            reason: 'بازگردانی تبدیل به فروشنده همکار پیش از اولین فعالیت تجاری',
            root: { kind: 'PROFILE', id: profile.id } });
          if (!authorization.ok) return authorization;
          let latestDirectIndex = -1;
          profile.conversionDispositions.forEach((row, index) => {
            if (row.sourceType === 'PARTNER_ACTIVATION' && row.disposition === 'DIRECT_V4') latestDirectIndex = index;
          });
          const activationDispositions = profile.conversionDispositions.slice(latestDirectIndex);
          let restoredAccessCount = 0;
          const roleDisposition = [...activationDispositions].reverse().find(row =>
            row.sourceType === 'USER_ROLE' && row.disposition === 'RESET');
          const previousRole = roleDisposition && typeof roleDisposition.evidence === 'object' && roleDisposition.evidence
            ? (roleDisposition.evidence as Record<string, unknown>).previousRole : undefined;
          const restorableRole = typeof previousRole === 'string' && Object.values(UserRole).includes(previousRole as UserRole)
            ? previousRole as UserRole : undefined;
          const workspaceIds = activationDispositions.filter(row =>
            row.sourceType === 'WORKSPACE_PERMISSION' && row.disposition === 'REVOKED').map(row => row.sourceId);
          const featureIds = activationDispositions.filter(row =>
            row.sourceType === 'FEATURE_PERMISSION' && row.disposition === 'REVOKED').map(row => row.sourceId);
          const actionDispositions = activationDispositions.filter(row =>
            row.sourceType === 'ACTION_GRANT' && row.disposition === 'REVOKED');
          const [workspaceRows, featureRows, actionRows] = await Promise.all([
            tx.workspacePermission.findMany({ where: { id: { in: workspaceIds } }, select: {
              id: true, userId: true, workspace: true, permissionLevel: true, grantedBy: true,
              grantedAt: true, expiresAt: true, isActive: true } }),
            tx.featurePermission.findMany({ where: { id: { in: featureIds } }, select: {
              id: true, userId: true, workspace: true, feature: true, permissionLevel: true, grantedBy: true,
              grantedAt: true, expiresAt: true, isActive: true } }),
            tx.effectiveActionGrant.findMany({ where: { id: { in: actionDispositions.map(row => row.sourceId) } }, select: {
              id: true, subjectUserId: true, domain: true, action: true, rootKind: true, purpose: true, scope: true,
              effect: true, effectiveFrom: true, expiresAt: true,
              revokedAt: true, revokedBy: true, revocationReason: true, revocationCorrelationId: true } }),
          ]);
          const evidence = (row: typeof activationDispositions[number]) =>
            row.evidence && typeof row.evidence === 'object' && !Array.isArray(row.evidence)
              ? row.evidence as Record<string, unknown> : {};
          const workspaceExact = workspaceIds.every(id => {
            const disposition = activationDispositions.find(row => row.sourceType === 'WORKSPACE_PERMISSION' && row.sourceId === id)!;
            const row = workspaceRows.find(item => item.id === id); const saved = evidence(disposition);
            return row?.userId === profile.userId && !row.isActive && row.workspace === saved.workspace &&
              row.permissionLevel === saved.permissionLevel && row.grantedBy === (saved.grantedBy ?? null) &&
              row.grantedAt.toISOString() === saved.grantedAt &&
              (row.expiresAt?.toISOString() ?? null) === (saved.expiresAt ?? null);
          });
          const featureExact = featureIds.every(id => {
            const disposition = activationDispositions.find(row => row.sourceType === 'FEATURE_PERMISSION' && row.sourceId === id)!;
            const row = featureRows.find(item => item.id === id); const saved = evidence(disposition);
            return row?.userId === profile.userId && !row.isActive && row.workspace === saved.workspace &&
              row.feature === saved.feature && row.permissionLevel === saved.permissionLevel &&
              row.grantedBy === (saved.grantedBy ?? null) && row.grantedAt.toISOString() === saved.grantedAt &&
              (row.expiresAt?.toISOString() ?? null) === (saved.expiresAt ?? null);
          });
          const actionsExact = actionDispositions.every(disposition => {
            const row = actionRows.find(item => item.id === disposition.sourceId); const saved = evidence(disposition);
            return row?.subjectUserId === profile.userId && row.domain === saved.domain && row.action === saved.action &&
              row.rootKind === saved.rootKind && row.purpose === saved.purpose && row.scope === saved.scope &&
              row.effect === saved.effect && row.effectiveFrom.toISOString() === saved.effectiveFrom &&
              (row.expiresAt?.toISOString() ?? null) === (saved.expiresAt ?? null) &&
              row.revokedAt !== null && row.revokedBy === disposition.actorId && row.revocationReason === STANDARD_REASON &&
              row.revocationCorrelationId === saved.conversionCorrelationId;
          });
          if (!workspaceExact || !featureExact || !actionsExact) {
            return { ok: false as const, error: partnerError('STATE_CONFLICT') };
          }
          if (restorableRole) {
            const changed = await tx.user.updateMany({ where: { id: profile.userId, role: 'USER' },
              data: { role: restorableRole } });
            if (changed.count !== 1) return { ok: false as const, error: partnerError('STATE_CONFLICT') };
            restoredAccessCount += changed.count;
          }
          if (workspaceIds.length) restoredAccessCount += (await tx.workspacePermission.updateMany({
            where: { id: { in: workspaceIds }, userId: profile.userId, isActive: false }, data: { isActive: true },
          })).count;
          if (featureIds.length) restoredAccessCount += (await tx.featurePermission.updateMany({
            where: { id: { in: featureIds }, userId: profile.userId, isActive: false }, data: { isActive: true },
          })).count;
          for (const disposition of actionDispositions) {
            restoredAccessCount += (await tx.effectiveActionGrant.updateMany({ where: { id: disposition.sourceId,
              subjectUserId: profile.userId, revokedAt: { not: null }, revokedBy: disposition.actorId,
              revocationReason: STANDARD_REASON }, data: { revokedAt: null, revokedBy: null,
                revocationReason: null, revocationCorrelationId: null } })).count;
          }
          const eventId = randomUUID(), profileRevision = profile.revision + 1;
          await tx.partnerProfile.update({ where: { id: profile.id }, data: { state: 'PENDING', revision: profileRevision } });
          await tx.partnerProfileEvent.create({ data: { id: eventId, profileId: profile.id, revision: profileRevision,
            fromState: 'ACTIVE', toState: 'PENDING', actorId: input.actorId,
            reason: 'بازگردانی تبدیل به فروشنده همکار پیش از اولین فعالیت تجاری', commandId: command.commandId,
            evidence: json({ schemaVersion: 4, type: command.type, restoredAccessCount,
              authorizationEvidenceId: authorization.value.evidenceId }) } });
          await tx.partnerConversionDisposition.create({ data: { id: randomUUID(), profileId: profile.id,
            sourceType: 'PARTNER_ACTIVATION', sourceId: command.commandId, disposition: 'REVERTED', actorId: input.actorId,
            evidence: json({ schemaVersion: 4, restoredAccessCount,
              authorizationEvidenceId: authorization.value.evidenceId }) } });
          const receipt = PartnerDirectActivationRevertReceiptV4Schema.parse({ schemaVersion: 4,
            commandId: command.commandId, replayed: false, userId: profile.userId, profileId: profile.id,
            profileRevision, eventId, restoredAccessCount });
          await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: input.actorId,
            operation: command.type, targetScope: command.profileId, key: command.idempotency.key,
            payloadHash, outcome: json(receipt) } });
          return { ok: true as const, value: receipt };
        });
      } catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
    },
  };
}
