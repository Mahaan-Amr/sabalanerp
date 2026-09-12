import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PartnerActivationCommandV3Schema,
  PartnerActivationReceiptV3Schema,
  PartnerActivationViewV3Schema,
  canonicalHash,
  partnerError,
  type PartnerActivationCommandV3,
  type PartnerActivationPackageV3Port,
  type PartnerActivationReceiptV3,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import { resolveEligibleResponder } from '../inquiries/adapters';
import { assessReadiness, acceptanceResponsibilities, readinessGates,
  type ReadinessEvidence } from '../operations/readiness';
import { createPrismaPartnerProfileStore } from '../profiles/prismaStore';
import { PARTNER_OPERATIONS_CONTROL_ID } from '../authorization/technicalRollout';

type Tx = Prisma.TransactionClient;
type AuthorizationAction = 'OPERATIONS_MANAGE' | 'PROFILE_READ' | 'PROFILE_CREATE' | 'PROFILE_ACTIVATE' |
  'IDENTITY_VERIFY' | 'COMMERCIAL_TERMS_MANAGE' | 'CREDIT_TERMS_MANAGE' | 'RESPONDER_ASSIGN' |
  'PROFILE_CONVERSION_MANAGE';
type Authorization = (tx: Tx, input: { action: AuthorizationAction;
  purpose: 'OPERATIONS' | 'ONBOARDING' | 'MANAGEMENT' | 'ACCOUNTING';
  reason: string; root: { kind: 'PROFILE'; id: string }; prospectiveOwnerId?: string }) =>
Promise<Result<{ evidenceId: string; isAdmin: boolean }>>;

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
function collectAuthorizationEvidenceIds(value: unknown, target: Set<string>) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) collectAuthorizationEvidenceIds(item, target); return; }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'authorizationEvidenceId' && typeof item === 'string') target.add(item);
    else if (key === 'authorizationEvidenceIds' && item && typeof item === 'object' && !Array.isArray(item)) {
      for (const evidenceId of Object.values(item as Record<string, unknown>)) if (typeof evidenceId === 'string') target.add(evidenceId);
    }
    collectAuthorizationEvidenceIds(item, target);
  }
}

function intent(command: PartnerActivationCommandV3) {
  const { commandId: _commandId, correlationId: _correlationId, idempotency: _idempotency, ...value } = command;
  return value;
}

function label(user: { firstName: string; lastName: string; username: string }) {
  return `${user.firstName} ${user.lastName}`.trim() || user.username;
}

function decodeReceipt(value: unknown): PartnerActivationReceiptV3 | undefined {
  const parsed = PartnerActivationReceiptV3Schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function releaseEvidence(value: Prisma.JsonValue | null): ReadinessEvidence | null {
  const row = object(value);
  if (!row || row.source !== 'DATABASE_VERIFIED' || typeof row.evidenceId !== 'string' ||
      typeof row.releaseId !== 'string' || typeof row.schemaId !== 'string' || typeof row.checkedAt !== 'string' ||
      typeof row.expiresAt !== 'string' || !object(row.gates) || !object(row.acceptedBy)) return null;
  return row as unknown as ReadinessEvidence;
}

async function ready(tx: Tx, value: Prisma.JsonValue | null, runtimeIdentity: { releaseId: string; schemaId: string }) {
  const evidence = releaseEvidence(value);
  if (!evidence) return null;
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const runtime = await import('@sabalanerp/partner-sales-contracts');
  return assessReadiness(runtime, evidence, { now: clock.now.toISOString(), ...runtimeIdentity }) ? evidence : null;
}

async function outcome(tx: Tx, actorId: string, operation: string, targetScope: string, key: string) {
  return tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
    actorId, operation, targetScope, key,
  } } });
}

async function saveOutcome(tx: Tx, input: { actorId: string; operation: string; targetScope: string;
  key: string; payloadHash: string; value: unknown }) {
  await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId: input.actorId,
    operation: input.operation, targetScope: input.targetScope, key: input.key,
    payloadHash: input.payloadHash, outcome: json(input.value) } });
}

async function internalWorkBlockers(tx: Tx, userId: string) {
  const [duties, drafts, contracts, projects, corrections, profileResponses, inquiryResponses] = await Promise.all([
    tx.crossWorkspaceDuty.count({ where: { currentAssigneeUserId: userId, status: 'OPEN' } }),
    tx.salesContractEditSession.count({ where: { ownerUserId: userId, purpose: 'STANDARD' } }),
    tx.salesContract.count({ where: { responsibleSellerId: userId, isInactive: false,
      status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SIGNED', 'PRINTED'] } } }),
    tx.crmPotentialProject.count({ where: { responsibleSellerId: userId, partnerRevision: null, isActive: true } }),
    tx.accountingCorrectionRequest.count({ where: { assignedToUserId: userId, status: 'OPEN' } }),
    tx.partnerProfileResponderAssignment.count({ where: { responderId: userId } }),
    tx.partnerInquiryAssignment.count({ where: { responderId: userId,
      inquiry: { rows: { some: { outcome: 'PENDING' } } } } }),
  ]);
  return duties + drafts + contracts + projects + corrections + profileResponses + inquiryResponses;
}

export function createPrismaPartnerActivationPackage(input: {
  database: PrismaClient; actorId: string; authorize: Authorization;
  runtimeIdentity: { releaseId: string; schemaId: string };
  resolveVerifiedReadiness(tx: Tx, verifiedPackageId: string): Promise<ReadinessEvidence | null>;
}): PartnerActivationPackageV3Port {
  const profileStore = createPrismaPartnerProfileStore(input.database);

  async function query(request: { schemaVersion: 3; purpose: 'PARTNER_ACTIVATION'; userId?: string }) {
    try {
      return await input.database.$transaction(async tx => {
        const control = await tx.partnerOperationsControl.findUniqueOrThrow({
          where: { id: PARTNER_OPERATIONS_CONTROL_ID }, include: { cohort: true },
        });
        const evidence = await ready(tx, control.readinessEvidence, input.runtimeIdentity);
        const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
        const candidateSelect = { id: true, firstName: true, lastName: true, username: true } as const;
        const preparedCandidates = request.userId ? [] : await tx.user.findMany({ where: { isActive: true,
          partnerProfile: null, partnerIdentityEvidence: { some: { revokedAt: null, issuedAt: { lte: clock.now },
            OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] } } },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }], take: 100, select: candidateSelect });
        const fallbackLimit = Math.max(0, 100 - preparedCandidates.length);
        const fallbackCandidates = fallbackLimit === 0 ? [] : await tx.user.findMany({ where: { isActive: true,
          partnerProfile: null, ...(request.userId ? { id: request.userId }
            : { id: { notIn: preparedCandidates.map(user => user.id) } }) },
          orderBy: { id: 'asc' }, take: fallbackLimit, select: candidateSelect });
        const candidates = request.userId ? fallbackCandidates : [...preparedCandidates, ...fallbackCandidates];
        const profile = request.userId ? await tx.partnerProfile.findUnique({ where: { userId: request.userId },
          include: { user: { select: { firstName: true, lastName: true, username: true } } } }) : null;
        const readTarget = request.userId ?? candidates[0]?.id ?? input.actorId;
        const access = await input.authorize(tx, { action: 'PROFILE_READ', purpose: 'ONBOARDING',
          reason: 'نمایش کنترل‌شده اطلاعات فعال‌سازی فروشنده همکار',
          root: { kind: 'PROFILE', id: profile?.id ?? `prospective:${readTarget}` },
          ...(!profile ? { prospectiveOwnerId: readTarget } : {}) });
        if (!access.ok) return access;
        if (!access.value.isAdmin) return { ok: false as const, error: partnerError('FORBIDDEN') };
        const openIncident = await tx.partnerOperationsIncident.findFirst({
          where: { resolution: { equals: Prisma.AnyNull } }, select: { key: true },
        });
        const policies = await tx.partnerTermsPolicy.findMany({ where: { revokedAt: null,
          issuedAt: { lte: clock.now }, effectiveDate: { lte: clock.now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] },
          orderBy: [{ effectiveDate: 'desc' }, { id: 'asc' }], select: { id: true, purpose: true, label: true } });
        const identities = request.userId ? await tx.partnerIdentityEvidence.findMany({ where: { userId: request.userId,
          revokedAt: null, issuedAt: { lte: clock.now }, OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] },
          orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }], select: { id: true, legalName: true, personType: true } }) : [];
        const responders = (await tx.user.findMany({ where: { isActive: true, role: { not: 'ADMIN' },
          partnerProfile: null, scopedActionGrants: { some: { principalKind: 'USER', domain: 'PARTNER',
            action: 'INQUIRY_RESPOND', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'ASSIGNED', effect: 'ALLOW',
            revokedAt: null, effectiveFrom: { lte: clock.now }, OR: [{ expiresAt: null }, { expiresAt: { gt: clock.now } }] } } },
          orderBy: { id: 'asc' }, take: 100,
          select: { id: true, firstName: true, lastName: true, username: true } }))
          .map(user => ({ id: user.id, label: label(user) }));
        let subject: Record<string, unknown> | undefined;
        if (profile) {
          const gates = await profileStore.readActivationGates(tx, profile);
          const membership = control.cohortId ? await tx.partnerCohortMembership.findFirst({ where: {
            profileId: profile.id, cohortId: control.cohortId }, select: { id: true } }) : null;
          const gateRows = [
            ['IDENTITY', 'هویت معتبر', gates.identityVerified],
            ['COMMERCIAL_TERMS', 'شرایط تجاری', gates.commercialTermsReady],
            ['CREDIT_TERMS', 'شرایط اعتبار', gates.creditTermsReady],
            ['RESPONDER', 'پاسخ‌دهنده قیمت', gates.responderReady],
            ['CONVERSION', 'تعیین تکلیف دسترسی داخلی', gates.conversionCleared],
            ['ENROLLMENT', 'عضویت مستقل در cohort', Boolean(membership)],
            ['COHORT', 'cohort آماده عملیات', gates.cohortReady],
            ['USER', 'حساب ورود فعال', gates.userActive],
            ['RELEASE', 'آمادگی انتشار', Boolean(evidence)],
            ['OPERATIONS', 'عملیات بدون توقف یا رخداد باز', !control.operationalPaused &&
              !control.cohort?.operationalPaused && !openIncident],
          ].map(([id, gateLabel, gateReady]) => ({ id, label: gateLabel, ready: gateReady,
            ...(!gateReady ? { blocker: partnerError('DEPENDENCY_BLOCKED') } : {}) }));
          const activatable = profile.state === 'PENDING' && gateRows.every(gate => gate.ready);
          subject = { userId: profile.userId, profileId: profile.id, profileRevision: profile.revision,
            displayName: label(profile.user), gates: gateRows,
            actions: [{ action: 'PROFILE_ACTIVATE', enabled: activatable,
              ...(!activatable ? { disabledReason: partnerError('DEPENDENCY_BLOCKED') } : {}) }],
          };
        }
        const view = PartnerActivationViewV3Schema.safeParse({ schemaVersion: 3, purpose: 'PARTNER_ACTIVATION',
          actorId: input.actorId, release: { controlRevision: control.revision,
            status: evidence ? 'READY' : control.readinessEvidence ? 'EXPIRED' : 'MISSING',
            ...(evidence ? { publicationId: evidence.evidenceId, releaseId: evidence.releaseId,
              expiresAt: evidence.expiresAt } : {}), actions: [] },
          ...(control.cohort ? { cohort: { id: control.cohort.id, name: control.cohort.name,
            enrollmentOpen: !control.enrollmentPaused && !control.cohort.enrollmentPaused,
            operationsOpen: !control.operationalPaused && !control.cohort.operationalPaused } } : {}),
          ...(subject ? { subject } : {}),
          candidates: candidates.map(user => ({ userId: user.id, displayName: label(user) })),
          identityEvidence: identities.map(identity => ({ id: identity.id, label: identity.legalName,
            personType: identity.personType === 'LEGAL' ? 'LEGAL' : 'NATURAL' })),
          commercialTerms: policies.filter(policy => policy.purpose === 'PARTNER_TECHNICAL_PRICING')
            .map(policy => ({ id: policy.id, label: policy.label })),
          creditTerms: policies.filter(policy => policy.purpose === 'PARTNER_CREDIT_TERMS')
            .map(policy => ({ id: policy.id, label: policy.label })), responders });
        return view.success ? { ok: true as const, value: view.data }
          : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
      });
    } catch { return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') }; }
  }

  async function execute(raw: PartnerActivationCommandV3) {
    const parsed = PartnerActivationCommandV3Schema.safeParse(raw);
    if (!parsed.success) return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
    const command = parsed.data;
    const payloadHash = await canonicalHash(intent(command));
    if (command.idempotency.actorId !== input.actorId || command.idempotency.operation !== command.type ||
        command.idempotency.payloadHash !== payloadHash) return { ok: false as const, error: partnerError('INVALID_PAYLOAD') };
    try {
      return await input.database.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM partner_operations_controls
          WHERE id = ${PARTNER_OPERATIONS_CONTROL_ID} FOR UPDATE`;
        const targetScope = command.type === 'RELEASE_READINESS_PUBLISH' ? command.verifiedPackageId
          : command.type === 'PROFILE_BOOTSTRAP' ? command.userId : command.profileId;
        const existingBootstrapProfile = command.type === 'PROFILE_BOOTSTRAP'
          ? await tx.partnerProfile.findUnique({ where: { userId: command.userId }, select: { id: true } }) : null;
        const prospectiveOwnerId = command.type === 'PROFILE_BOOTSTRAP' && !existingBootstrapProfile ? command.userId
          : command.type === 'RELEASE_READINESS_PUBLISH' ? input.actorId : undefined;
        const bootstrapProfileId = command.type === 'PROFILE_BOOTSTRAP' ? existingBootstrapProfile?.id ?? randomUUID() : undefined;
        const authRoot = command.type === 'PROFILE_ACTIVATE' ? command.profileId : bootstrapProfileId ??
          `prospective:${prospectiveOwnerId}`;
        const authorization = await input.authorize(tx, { action: command.type === 'RELEASE_READINESS_PUBLISH'
          ? 'OPERATIONS_MANAGE' : command.type === 'PROFILE_BOOTSTRAP' ? 'PROFILE_CREATE' : 'PROFILE_ACTIVATE',
          purpose: command.type === 'RELEASE_READINESS_PUBLISH' ? 'OPERATIONS' : 'ONBOARDING',
          reason: command.reason, root: { kind: 'PROFILE', id: authRoot },
          ...(prospectiveOwnerId ? { prospectiveOwnerId } : {}) });
        if (!authorization.ok) return authorization;
        const prior = await outcome(tx, input.actorId, command.type, targetScope, command.idempotency.key);
        if (prior) {
          if (prior.payloadHash !== payloadHash) return { ok: false as const, error: partnerError('IDEMPOTENCY_CONFLICT') };
          const receipt = decodeReceipt(prior.outcome);
          return receipt?.commandId === command.commandId ? { ok: true as const, value: { ...receipt, replayed: true } }
            : { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') };
        }
        const control = await tx.partnerOperationsControl.findUniqueOrThrow({ where: { id: PARTNER_OPERATIONS_CONTROL_ID },
          include: { cohort: { select: { operationalPaused: true } } } });
        if (control.revision !== command.expectedControlRevision) return { ok: false as const, error: partnerError('ROW_STALE') };

        if (command.type === 'RELEASE_READINESS_PUBLISH') {
          const evidence = await input.resolveVerifiedReadiness(tx, command.verifiedPackageId);
          if (!evidence ||
              !await ready(tx, json(evidence) as Prisma.JsonValue, input.runtimeIdentity)) {
            return { ok: false as const, error: partnerError('DEPENDENCY_BLOCKED') };
          }
          const nextRevision = control.revision + 1;
          await tx.partnerOperationsControl.update({ where: { id: control.id }, data: {
            revision: nextRevision, readinessEvidence: json(evidence), enrollmentPaused: true, operationalPaused: true,
          } });
          const eventId = randomUUID();
          await tx.partnerOperationsControlEvent.create({ data: { id: eventId, controlId: control.id,
            revision: nextRevision, actorId: input.actorId, reason: command.reason, commandId: command.commandId,
            evidence: json({ schemaVersion: 3, type: command.type, verifiedPackageId: command.verifiedPackageId,
              authorizationEvidenceId: authorization.value.evidenceId, readinessEvidenceId: evidence.evidenceId }) } });
          const receipt = PartnerActivationReceiptV3Schema.parse({ schemaVersion: 3, commandId: command.commandId,
            replayed: false, controlRevision: nextRevision, eventIds: [eventId] });
          await saveOutcome(tx, { actorId: input.actorId, operation: command.type, targetScope,
            key: command.idempotency.key, payloadHash, value: receipt });
          return { ok: true as const, value: receipt };
        }

        const readiness = await ready(tx, control.readinessEvidence, input.runtimeIdentity);
        if (!readiness) return { ok: false as const, error: partnerError('COHORT_NOT_READY') };

        if (command.type === 'PROFILE_BOOTSTRAP') {
          const user = await tx.user.findUnique({ where: { id: command.userId }, select: { id: true, isActive: true,
            role: true, partnerProfile: { select: { id: true } } } });
          if (!user?.isActive) return { ok: false as const, error: partnerError('NOT_FOUND') };
          if (user.partnerProfile) return { ok: false as const, error: partnerError('STATE_CONFLICT') };
          if (await internalWorkBlockers(tx, user.id)) return { ok: false as const, error: partnerError('DEPENDENCY_BLOCKED') };
          const [identityEvidence, commercial, credit, responder] = await Promise.all([
            tx.partnerIdentityEvidence.findUnique({ where: { id: command.identityEvidenceId } }),
            tx.partnerTermsPolicy.findUnique({ where: { id: command.commercialTermsPolicyId } }),
            tx.partnerTermsPolicy.findUnique({ where: { id: command.creditTermsPolicyId } }),
            resolveEligibleResponder(tx, { responderId: command.responderId }),
          ]);
          const [databaseClock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
          const now = databaseClock.now;
          const currentPolicy = (policy: typeof commercial, purpose: 'PARTNER_TECHNICAL_PRICING' | 'PARTNER_CREDIT_TERMS') =>
            policy?.purpose === purpose && !policy.revokedAt && policy.issuedAt <= now && policy.effectiveDate <= now &&
            (!policy.expiresAt || policy.expiresAt > now);
          if (!identityEvidence || identityEvidence.userId !== user.id || identityEvidence.revokedAt ||
              identityEvidence.issuedAt > now || (identityEvidence.expiresAt && identityEvidence.expiresAt <= now) ||
              !currentPolicy(commercial, 'PARTNER_TECHNICAL_PRICING') ||
              !currentPolicy(credit, 'PARTNER_CREDIT_TERMS') || !responder.ok) {
            return { ok: false as const, error: partnerError('DEPENDENCY_BLOCKED') };
          }
          const existingCohort = await tx.partnerReleaseCohort.findFirst({ where: {
            OR: [{ id: command.cohortId }, { name: command.cohortName }],
          }, select: { id: true, name: true, activationEnabled: true, enrollmentPaused: true,
            operationalPaused: true, _count: { select: { memberships: true } } } });
          if (!existingCohort || existingCohort.id !== command.cohortId || existingCohort.name !== command.cohortName ||
              control.cohortId !== command.cohortId) {
            return { ok: false as const, error: partnerError('STATE_CONFLICT') };
          }
          if (!existingCohort.activationEnabled || existingCohort.enrollmentPaused || control.enrollmentPaused) {
            return { ok: false as const, error: partnerError('COHORT_NOT_READY') };
          }
          const openIncident = await tx.partnerOperationsIncident.findFirst({ where: { resolution: { equals: Prisma.AnyNull } },
            select: { key: true } });
          if (openIncident) return { ok: false as const, error: partnerError('COHORT_NOT_READY') };

          const authorizations = new Map<AuthorizationAction, string>([['PROFILE_CREATE', authorization.value.evidenceId]]);
          const requireAuthorization = async (action: AuthorizationAction,
            purpose: 'OPERATIONS' | 'ONBOARDING' | 'MANAGEMENT' | 'ACCOUNTING') => {
            const result = await input.authorize(tx, { action, purpose, reason: command.reason,
              root: { kind: 'PROFILE', id: bootstrapProfileId! }, prospectiveOwnerId: user.id });
            if (result.ok) authorizations.set(action, result.value.evidenceId);
            return result;
          };
          for (const [action, purpose] of [
            ['IDENTITY_VERIFY', 'ONBOARDING'], ['COMMERCIAL_TERMS_MANAGE', 'MANAGEMENT'],
            ['CREDIT_TERMS_MANAGE', 'ACCOUNTING'], ['RESPONDER_ASSIGN', 'MANAGEMENT'],
            ['PROFILE_CONVERSION_MANAGE', 'MANAGEMENT'],
          ] as const) {
            const result = await requireAuthorization(action, purpose);
            if (!result.ok) return result;
          }
          const identityId = identityEvidence.id;
          const identityHash = identityEvidence.integrityHash;
          const profileId = bootstrapProfileId!, accountId = randomUUID(), createEventId = randomUUID();
          await tx.partnerProfile.create({ data: { id: profileId, userId: user.id,
            commercialAccount: { create: { id: accountId, identities: { create: { id: randomUUID(), version: 1,
              legalName: identityEvidence.legalName, tradeName: identityEvidence.tradeName,
              identifiers: json({ ...(identityEvidence.identifiers as object), evidenceId: identityId,
                personType: identityEvidence.personType }), phone: identityEvidence.phone, address: identityEvidence.address,
              integrityHash: identityHash, actorId: input.actorId }, }, terms: { create: [
                { id: randomUUID(), version: 1, effectiveDate: commercial!.effectiveDate,
                  terms: json({ ...(commercial!.terms as object), purpose: commercial!.purpose, policyId: commercial!.id }),
                  integrityHash: commercial!.integrityHash, actorId: input.actorId, reason: command.reason },
                { id: randomUUID(), version: 2, effectiveDate: credit!.effectiveDate,
                  terms: json({ ...(credit!.terms as object), purpose: credit!.purpose, policyId: credit!.id }),
                  integrityHash: credit!.integrityHash, actorId: input.actorId, reason: command.reason },
              ] } } }, events: { create: { id: createEventId, revision: 1, fromState: null, toState: 'PENDING',
              actorId: input.actorId, reason: command.reason, commandId: `${command.commandId}:create`,
              evidence: json({ schemaVersion: 3, type: 'PROFILE_BOOTSTRAP', identityEvidenceId: identityId,
                commercialTermsPolicyId: commercial!.id, creditTermsPolicyId: credit!.id,
                authorizationEvidenceIds: {
                  profileCreate: authorizations.get('PROFILE_CREATE'), identityVerify: authorizations.get('IDENTITY_VERIFY'),
                  commercialTerms: authorizations.get('COMMERCIAL_TERMS_MANAGE'), creditTerms: authorizations.get('CREDIT_TERMS_MANAGE'),
                } }) } } } });

          const workspace = await tx.workspacePermission.findMany({ where: { userId: user.id, isActive: true }, select: { id: true } });
          const features = await tx.featurePermission.findMany({ where: { userId: user.id, isActive: true }, select: { id: true } });
          const grants = await tx.effectiveActionGrant.findMany({ where: { subjectUserId: user.id,
            domain: { not: 'PARTNER' }, effect: 'ALLOW', revokedAt: null }, select: { id: true } });
          const blockers = [
            ...(user.role !== 'USER' ? [{ sourceType: 'USER_ROLE', sourceId: user.id }] : []),
            ...workspace.map(row => ({ sourceType: 'WORKSPACE_PERMISSION', sourceId: row.id })),
            ...features.map(row => ({ sourceType: 'FEATURE_PERMISSION', sourceId: row.id })),
            ...grants.map(row => ({ sourceType: 'ACTION_GRANT', sourceId: row.id })),
          ];
          await tx.user.update({ where: { id: user.id }, data: { role: 'USER' } });
          await tx.workspacePermission.updateMany({ where: { id: { in: workspace.map(row => row.id) } }, data: { isActive: false } });
          await tx.featurePermission.updateMany({ where: { id: { in: features.map(row => row.id) } }, data: { isActive: false } });
          await tx.effectiveActionGrant.updateMany({ where: { id: { in: grants.map(row => row.id) }, revokedAt: null },
            data: { revokedAt: now, revokedBy: input.actorId, revocationReason: command.reason,
              revocationCorrelationId: command.correlationId } });
          const dispositions: string[] = [];
          for (const blocker of blockers) {
            const id = randomUUID(); dispositions.push(id);
            await tx.partnerConversionDisposition.create({ data: { id, profileId,
              sourceType: blocker.sourceType, sourceId: blocker.sourceId, disposition: blocker.sourceType === 'USER_ROLE' ? 'RESET' : 'REVOKED',
              actorId: input.actorId, evidence: json({ schemaVersion: 3,
                authorizationEvidenceId: authorizations.get('PROFILE_CONVERSION_MANAGE') }) } });
          }
          let revision = 1;
          const eventIds = [createEventId];
          if (blockers.length) {
            revision += 1;
            await tx.partnerProfile.update({ where: { id: profileId }, data: { revision } });
            const conversionEventId = randomUUID(); eventIds.push(conversionEventId);
            await tx.partnerProfileEvent.create({ data: { id: conversionEventId, profileId, revision,
              fromState: 'PENDING', toState: 'PENDING', actorId: input.actorId, reason: command.reason,
              commandId: `${command.commandId}:conversion`, evidence: json({ schemaVersion: 3,
                type: 'PROFILE_CONVERSION', transition: 'RESOLVE', blockerIds: blockers.map(row => `${row.sourceType}:${row.sourceId}`),
                dispositionEvidenceIds: dispositions,
                authorizationEvidenceId: authorizations.get('PROFILE_CONVERSION_MANAGE') }) } });
          }
          const assignmentId = randomUUID();
          await tx.partnerProfileResponderAssignment.create({ data: { id: assignmentId, profileId, revision: 1,
            responderId: responder.value.responderId, actorId: input.actorId, reason: command.reason,
            eligibilityEvidence: json({ ...responder.value.eligibilityEvidence,
              authorizationEvidenceId: authorizations.get('RESPONDER_ASSIGN') }) } });
          revision += 1;
          await tx.partnerProfile.update({ where: { id: profileId }, data: { revision } });
          const receipt = PartnerActivationReceiptV3Schema.parse({ schemaVersion: 3, commandId: command.commandId,
            replayed: false, userId: user.id, profileId, profileRevision: revision,
            controlRevision: control.revision, eventIds: [...eventIds, assignmentId] });
          await saveOutcome(tx, { actorId: input.actorId, operation: command.type, targetScope,
            key: command.idempotency.key, payloadHash, value: receipt });
          return { ok: true as const, value: receipt };
        }

        await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${command.profileId} FOR UPDATE`;
        const profile = await tx.partnerProfile.findUnique({ where: { id: command.profileId }, select: {
          id: true, userId: true, state: true, revision: true, firstActivatedAt: true, irreversibleAt: true } });
        if (!profile) return { ok: false as const, error: partnerError('NOT_FOUND') };
        if (profile.state !== 'PENDING') return { ok: false as const, error: partnerError('STATE_CONFLICT') };
        if (profile.revision !== command.expectedProfileRevision) return { ok: false as const, error: partnerError('ROW_STALE') };
        if (control.operationalPaused || control.cohort?.operationalPaused) {
          return { ok: false as const, error: partnerError('OPERATIONAL_PAUSE') };
        }
        const openIncident = await tx.partnerOperationsIncident.findFirst({
          where: { resolution: { equals: Prisma.AnyNull } }, select: { key: true },
        });
        if (openIncident) return { ok: false as const, error: partnerError('COHORT_NOT_READY') };
        const gates = await profileStore.readActivationGates(tx, profile);
        const currentEvidence = [...gates.evidenceIds].sort();
        if (!gates.identityVerified || !gates.commercialTermsReady || !gates.creditTermsReady || !gates.responderReady ||
            !gates.conversionCleared || !gates.cohortReady || !gates.userActive || gates.conflictingInternalAuthority ||
            !currentEvidence.length) {
          return { ok: false as const, error: partnerError('DEPENDENCY_BLOCKED') };
        }
        const [profileEvents, assignments, memberships] = await Promise.all([
          tx.partnerProfileEvent.findMany({ where: { profileId: profile.id }, orderBy: { revision: 'asc' },
            select: { id: true, evidence: true } }),
          tx.partnerProfileResponderAssignment.findMany({ where: { profileId: profile.id, id: { in: currentEvidence } },
            select: { eligibilityEvidence: true } }),
          tx.partnerCohortMembership.findMany({ where: { profileId: profile.id, id: { in: currentEvidence } },
            select: { eligibilityEvidence: true } }),
        ]);
        const authorizationEvidenceIds = new Set<string>([authorization.value.evidenceId]);
        for (const evidence of [...profileEvents.map(row => row.evidence),
          ...assignments.map(row => row.eligibilityEvidence), ...memberships.map(row => row.eligibilityEvidence)]) {
          collectAuthorizationEvidenceIds(evidence, authorizationEvidenceIds);
        }
        const bundleId = randomUUID();
        const bundleEvidence = { schemaVersion: 3, bundleId, userId: profile.userId, profileId: profile.id,
          profileRevision: profile.revision, controlRevision: control.revision,
          readinessEvidenceId: readiness.evidenceId, gateEvidenceIds: currentEvidence,
          profileEventIds: profileEvents.map(row => row.id),
          authorizationEvidenceIds: [...authorizationEvidenceIds].sort() };
        const bundleHash = await canonicalHash(bundleEvidence);
        await saveOutcome(tx, { actorId: input.actorId, operation: 'PARTNER_ACTIVATION_BUNDLE',
          targetScope: profile.id, key: bundleId, payloadHash: bundleHash,
          value: { ...bundleEvidence, integrityHash: bundleHash } });
        const nextRevision = profile.revision + 1, eventId = randomUUID();
        await tx.partnerProfile.update({ where: { id: profile.id }, data: { state: 'ACTIVE', revision: nextRevision,
          firstActivatedAt: new Date(), irreversibleAt: new Date() } });
        await tx.partnerProfileEvent.create({ data: { id: eventId, profileId: profile.id, revision: nextRevision,
          fromState: 'PENDING', toState: 'ACTIVE', actorId: input.actorId, reason: command.reason,
          commandId: command.commandId, evidence: json({ schemaVersion: 3, type: 'PROFILE_ACTIVATE',
            activationBundleId: bundleId, activationBundleHash: bundleHash,
            authorizationEvidenceId: authorization.value.evidenceId, gateEvidenceIds: currentEvidence }) } });
        const receipt = PartnerActivationReceiptV3Schema.parse({ schemaVersion: 3, commandId: command.commandId,
          replayed: false, userId: profile.userId, profileId: profile.id, profileRevision: nextRevision,
          controlRevision: control.revision, eventIds: [eventId], activationBundleId: bundleId,
          activationBundleHash: bundleHash });
        await saveOutcome(tx, { actorId: input.actorId, operation: command.type, targetScope,
          key: command.idempotency.key, payloadHash, value: receipt });
        return { ok: true as const, value: receipt };
      }, { timeout: 30_000 });
    } catch { return { ok: false as const, error: partnerError('INTEGRITY_CONFLICT') }; }
  }

  return { query, execute };
}

export const partnerActivationReadinessVocabulary = { readinessGates, acceptanceResponsibilities };
