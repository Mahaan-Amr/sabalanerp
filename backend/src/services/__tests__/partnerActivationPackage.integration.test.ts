import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as contracts from '@sabalanerp/partner-sales-contracts';
import { createPrismaPartnerActivationPackage } from '../partnerSales/activationPackage/prisma';
import { createPrismaPartnerOperationsStore } from '../partnerSales/operations/prismaStore';
import { createOperationsService } from '../partnerSales/operations/service';
import { acceptanceResponsibilities, readinessGates } from '../partnerSales/operations/readiness';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { grantScopedAction } from '../effectiveAuthorization/scopedActions';
import { resolveWorkspaceRouteAvailability } from '../workspaceRouteAvailability';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local database required');
  }
  return url.toString();
}

test('activation package bootstraps and activates one converted seller from immutable release evidence', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()),
    sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client(), run = `partner-activation-${randomUUID()}`;
  const actorId = `${run}-actor`, userId = `${run}-fariba`, responderId = `${run}-yaghoobi`;
  const commercialId = `${run}-commercial`, creditId = `${run}-credit`, verifiedPackageId = `${run}-verified`;
  const identityEvidenceId = `${run}-identity-evidence`;
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    await database.user.createMany({ data: [
      { id: actorId, username: actorId, email: `${actorId}@example.invalid`, password: 'not-a-login',
        firstName: 'مدیر', lastName: 'آزمون', role: 'ADMIN' },
      { id: userId, username: userId, email: `${userId}@example.invalid`, password: 'not-a-login',
        firstName: 'فریبا', lastName: 'پورشهید', role: 'SALES' },
      { id: responderId, username: responderId, email: `${responderId}@example.invalid`, password: 'not-a-login',
        firstName: 'یعقوبی', lastName: 'پاسخ‌دهنده', role: 'USER' },
    ] });
    await grantScopedAction(database, { actorId, reason: 'مجوز پاسخ استعلام برای آزمون فعال‌سازی',
      correlationId: `${run}-responder-grant` }, { principal: { kind: 'USER', id: responderId }, domain: 'PARTNER',
      action: 'INQUIRY_RESPOND', rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'ASSIGNED', effect: 'ALLOW' });
    await database.workspacePermission.create({ data: { id: `${run}-sales-access`, userId,
      workspace: 'sales', permissionLevel: 'EDIT', grantedBy: actorId } });
    await database.partnerIdentityEvidence.create({ data: { id: identityEvidenceId, userId,
      legalName: 'فریبا پورشهید', personType: 'NATURAL', identifiers: { nationalCode: '0013547899' },
      phone: '09170000000', address: 'نشانی نمونه آزمون محلی', integrityHash: `sha256-v1:${'1'.repeat(64)}`,
      issuedBy: actorId } });
    await database.partnerTermsPolicy.createMany({ data: [
      { id: commercialId, purpose: 'PARTNER_TECHNICAL_PRICING', label: 'شرایط استاندارد همکار',
        effectiveDate: new Date('2026-01-01'), terms: { calculationPolicyVersion: 'partner-v1' },
        integrityHash: `sha256-v1:${'2'.repeat(64)}`, issuedBy: actorId },
      { id: creditId, purpose: 'PARTNER_CREDIT_TERMS', label: 'تسویه نقدی',
        effectiveDate: new Date('2026-01-01'), terms: { settlementDays: 0 },
        integrityHash: `sha256-v1:${'3'.repeat(64)}`, issuedBy: actorId },
    ] });
    await database.partnerOperationsControl.create({ data: { id: 'partner-operations', revision: 1,
      enrollmentPaused: true, operationalPaused: true } });
    const now = new Date(); let releaseEvidence = { source: 'DATABASE_VERIFIED' as const,
      evidenceId: `${run}-readiness`, releaseId: `${run}-release`, schemaId: 'partner-schema-v1',
      checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      gates: Object.fromEntries(readinessGates.map(gate => [gate, true])),
      acceptedBy: Object.fromEntries(acceptanceResponsibilities.map(role => [role, `${run}-${role}`])) };
    await database.partnerCommandOutcome.create({ data: { id: randomUUID(), actorId,
      operation: 'PARTNER_RELEASE_VERIFICATION', targetScope: verifiedPackageId, key: verifiedPackageId,
      payloadHash: await contracts.canonicalHash(releaseEvidence),
      outcome: { decision: 'GO', readinessEvidence: releaseEvidence } } });
    const verifiedPackages = new Set([verifiedPackageId]);
    const authorizationCalls: Array<{ action: string; purpose: string; rootId: string }> = [];
    const service = createPrismaPartnerActivationPackage({ database, actorId,
      runtimeIdentity: { releaseId: releaseEvidence.releaseId, schemaId: releaseEvidence.schemaId },
      resolveVerifiedReadiness: async (_tx, packageId) => verifiedPackages.has(packageId) ? releaseEvidence : null,
      authorize: async (_tx, authorization) => {
        authorizationCalls.push({ action: authorization.action, purpose: authorization.purpose,
          rootId: authorization.root.id });
        return { ok: true, value: { evidenceId: `${run}-auth-${authorization.action}`, isAdmin: true } };
      } });
    const command = async <T extends 'RELEASE_READINESS_PUBLISH' | 'PROFILE_BOOTSTRAP' | 'PROFILE_ACTIVATE'>(
      type: T, value: Record<string, unknown>) => {
      const intent = { schemaVersion: 3 as const, type, reason: 'ثبت تصمیم معتبر آزمون فروشنده همکار', ...value };
      const targetId = type === 'RELEASE_READINESS_PUBLISH' ? String(value.verifiedPackageId)
        : type === 'PROFILE_BOOTSTRAP' ? String(value.userId) : String(value.profileId);
      const commandId = `${run}-${type}-${targetId}`;
      return { ...intent, commandId, correlationId: run, idempotency: { actorId, operation: type,
        targetId, key: commandId, payloadHash: await contracts.canonicalHash(intent) } } as unknown as contracts.PartnerActivationCommandV3;
    };
    const publicationCommand = await command('RELEASE_READINESS_PUBLISH', { verifiedPackageId, expectedControlRevision: 1 });
    const untrustedGenericOutcome = createPrismaPartnerActivationPackage({ database, actorId,
      runtimeIdentity: { releaseId: releaseEvidence.releaseId, schemaId: releaseEvidence.schemaId },
      resolveVerifiedReadiness: async () => null,
      authorize: async () => ({ ok: true, value: { evidenceId: `${run}-untrusted-auth`, isAdmin: true } }) });
    const rejectedMagicTag = await untrustedGenericOutcome.execute(publicationCommand);
    assert.equal(rejectedMagicTag.ok ? null : rejectedMagicTag.error.code, 'DEPENDENCY_BLOCKED');
    const foreignRuntime = createPrismaPartnerActivationPackage({ database, actorId,
      runtimeIdentity: { releaseId: `${run}-other-release`, schemaId: releaseEvidence.schemaId },
      resolveVerifiedReadiness: async () => releaseEvidence,
      authorize: async () => ({ ok: true, value: { evidenceId: `${run}-foreign-auth`, isAdmin: true } }) });
    const rejectedForeignEvidence = await foreignRuntime.execute(publicationCommand);
    assert.equal(rejectedForeignEvidence.ok ? null : rejectedForeignEvidence.error.code, 'DEPENDENCY_BLOCKED');
    const published = await service.execute(publicationCommand);
    assert.equal(published.ok, true); if (!published.ok) return;
    const operations = createOperationsService(contracts, createPrismaPartnerOperationsStore({ database, actorId,
      correlationId: `${run}-operations`, runtimeIdentity: { releaseId: releaseEvidence.releaseId,
        schemaId: releaseEvidence.schemaId } }));
    const pauseCommand = async (kind: 'ENROLLMENT' | 'OPERATIONAL', expectedRevision: number, paused: boolean) => {
      const intent = { kind, paused, expectedRevision, reason: 'تغییر کنترل‌شده وضعیت آزمون فعال‌سازی' };
      const suffix = `${kind}-${paused}-${expectedRevision}`;
      return { schemaVersion: 1 as const, type: 'OPERATIONS_PAUSE' as const, commandId: `${run}-${suffix}`,
        correlationId: run, ...intent, idempotency: { actorId, operation: 'OPERATIONS_PAUSE' as const,
          targetId: 'partner-operations', key: `${run}-${suffix}`, payloadHash: await contracts.canonicalHash(intent) } };
    };
    const defined = await operations.defineCohort({ id: `${run}-cohort`, name: 'همکاران آزمون',
      expectedRevision: published.value.controlRevision, reason: 'تعریف cohort مستقل پیش از ساخت نخستین پروفایل' });
    assert.equal(defined.ok, true); if (!defined.ok) return;
    const enrollmentOpened = await operations.pause(await pauseCommand('ENROLLMENT', defined.value.revision, false));
    assert.equal(enrollmentOpened.ok, true); if (!enrollmentOpened.ok) return;
    const enrollmentControl = await database.partnerOperationsControl.findUniqueOrThrow({ where: { id: 'partner-operations' } });
    const bootstrapped = await service.execute(await command('PROFILE_BOOTSTRAP', { userId,
      expectedControlRevision: enrollmentControl.revision, cohortId: `${run}-cohort`, cohortName: 'همکاران آزمون',
      identityEvidenceId,
      commercialTermsPolicyId: commercialId, creditTermsPolicyId: creditId, responderId }));
    assert.equal(bootstrapped.ok, true); if (!bootstrapped.ok) return;
    assert.deepEqual(authorizationCalls.filter(call => call.rootId === bootstrapped.value.profileId)
      .map(call => `${call.action}:${call.purpose}`).sort(), [
      'COMMERCIAL_TERMS_MANAGE:MANAGEMENT', 'CREDIT_TERMS_MANAGE:ACCOUNTING', 'IDENTITY_VERIFY:ONBOARDING',
      'PROFILE_CONVERSION_MANAGE:MANAGEMENT', 'PROFILE_CREATE:ONBOARDING',
      'RESPONDER_ASSIGN:MANAGEMENT',
    ]);
    assert.ok(bootstrapped.value.profileId && bootstrapped.value.profileRevision);
    const converted = await database.user.findUniqueOrThrow({ where: { id: userId }, include: {
      workspacePermissions: true, partnerProfile: { include: { cohortMemberships: true, responderAssignments: true } },
    } });
    assert.equal(converted.role, 'USER');
    assert.equal(converted.workspacePermissions.some(permission => permission.isActive), false);
    assert.equal(converted.partnerProfile?.state, 'PENDING');
    assert.equal(converted.partnerProfile?.cohortMemberships.length, 0,
      'bootstrap نباید عملیات مستقل enrollment را دور بزند');
    assert.equal(converted.partnerProfile?.responderAssignments[0].responderId, responderId);
    const enrolled = await operations.enroll({ sellerId: userId, expectedRevision: enrollmentOpened.value.revision,
      reason: 'عضویت مستقل فروشنده آماده در cohort' });
    assert.equal(enrolled.ok, true); if (!enrolled.ok) return;
    const membership = await database.partnerCohortMembership.findFirstOrThrow({ where: { profileId: bootstrapped.value.profileId } });
    assert.equal(typeof (membership.eligibilityEvidence as Record<string, unknown>).readinessEvidenceId, 'string');
    assert.equal(typeof (membership.eligibilityEvidence as Record<string, unknown>).authorizationEvidenceId, 'string');
    const pausedView = await service.query({ schemaVersion: 3, purpose: 'PARTNER_ACTIVATION', userId });
    assert.equal(pausedView.ok && pausedView.value.subject?.actions[0]?.enabled, false,
      'ساخت بسته نباید توقف مستقل عملیات را باز کند');
    assert.equal(authorizationCalls.at(-1)?.rootId, bootstrapped.value.profileId,
      'خواندن پس از bootstrap باید به پروفایل واقعی مقید باشد، نه prospective resource');
    const operationsOpened = await operations.pause(await pauseCommand('OPERATIONAL', enrolled.value.revision, false));
    assert.equal(operationsOpened.ok, true); if (!operationsOpened.ok) return;
    const activationView = await service.query({ schemaVersion: 3, purpose: 'PARTNER_ACTIVATION', userId });
    assert.equal(activationView.ok && activationView.value.subject?.actions[0]?.enabled, true);
    const globallyPaused = await operations.pause(await pauseCommand('OPERATIONAL', operationsOpened.value.revision, true));
    assert.equal(globallyPaused.ok, true); if (!globallyPaused.ok) return;
    const pausedControl = await database.partnerOperationsControl.findUniqueOrThrow({ where: { id: 'partner-operations' } });
    const rejectedDuringGlobalPause = await service.execute(await command('PROFILE_ACTIVATE', {
      profileId: bootstrapped.value.profileId, expectedProfileRevision: bootstrapped.value.profileRevision,
      expectedControlRevision: pausedControl.revision }));
    assert.equal(rejectedDuringGlobalPause.ok ? null : rejectedDuringGlobalPause.error.code, 'OPERATIONAL_PAUSE');
    const refreshedPackageId = `${run}-verified-after-pause`;
    verifiedPackages.add(refreshedPackageId);
    const [refreshClock] = await database.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const refreshedAt = refreshClock.now;
    assert.ok(!pausedControl.lastOperationalPauseAt || refreshedAt > pausedControl.lastOperationalPauseAt);
    releaseEvidence = { ...releaseEvidence, evidenceId: `${run}-readiness-after-pause`,
      checkedAt: refreshedAt.toISOString(), expiresAt: new Date(refreshedAt.getTime() + 3_600_000).toISOString() };
    const republished = await service.execute(await command('RELEASE_READINESS_PUBLISH', {
      verifiedPackageId: refreshedPackageId, expectedControlRevision: globallyPaused.value.revision }));
    assert.equal(republished.ok, true); if (!republished.ok) return;
    const enrollmentReopened = await operations.pause(await pauseCommand('ENROLLMENT', republished.value.controlRevision, false));
    assert.equal(enrollmentReopened.ok, true); if (!enrollmentReopened.ok) return;
    const reopened = await operations.pause(await pauseCommand('OPERATIONAL', enrollmentReopened.value.revision, false));
    assert.equal(reopened.ok, true); if (!reopened.ok) return;
    const incidentKey = `${run}-open-incident`;
    await database.partnerOperationsIncident.create({ data: { key: incidentKey, category: 'ACTIVATION_TEST',
      evidenceReference: `${run}-incident-evidence`, firstSeenAt: new Date(), lastSeenAt: new Date(), occurrences: 1 } });
    const incidentControl = await database.partnerOperationsControl.findUniqueOrThrow({ where: { id: 'partner-operations' } });
    const incidentView = await service.query({ schemaVersion: 3, purpose: 'PARTNER_ACTIVATION', userId });
    assert.equal(incidentView.ok && incidentView.value.subject?.actions[0]?.enabled, false);
    const rejectedDuringIncident = await service.execute(await command('PROFILE_ACTIVATE', {
      profileId: bootstrapped.value.profileId, expectedProfileRevision: bootstrapped.value.profileRevision,
      expectedControlRevision: incidentControl.revision }));
    assert.equal(rejectedDuringIncident.ok ? null : rejectedDuringIncident.error.code, 'COHORT_NOT_READY');
    await database.partnerOperationsIncident.update({ where: { key: incidentKey }, data: {
      resolution: { resolvedBy: actorId, reason: 'رفع رخداد آزمون پیش از فعال‌سازی' } } });
    const activationControl = await database.partnerOperationsControl.findUniqueOrThrow({ where: { id: 'partner-operations' } });
    const activated = await service.execute(await command('PROFILE_ACTIVATE', {
      profileId: bootstrapped.value.profileId, expectedProfileRevision: bootstrapped.value.profileRevision,
      expectedControlRevision: activationControl.revision }));
    assert.equal(activated.ok, true);
    assert.ok(activated.ok && activated.value.activationBundleId && activated.value.activationBundleHash,
      'activation باید بسته شواهد تازه را اتمیک بسازد و در receipt برگرداند');
    assert.equal((await database.partnerProfile.findUniqueOrThrow({ where: { userId } })).state, 'ACTIVE');
    const [createRoute, casesRoute, managementRoute] = await Promise.all([
      resolveWorkspaceRouteAvailability(database, { userId, role: 'USER', path: '/dashboard/sales/contracts/create' }),
      resolveWorkspaceRouteAvailability(database, { userId, role: 'USER', path: '/dashboard/sales/partner-cases' }),
      resolveWorkspaceRouteAvailability(database, { userId, role: 'USER', path: '/dashboard/sales/partners' }),
    ]);
    assert.equal(createRoute.allowed, true, 'فروشنده فعال باید مسیر ایجاد فروش همکار را در منو ببیند');
    assert.equal(casesRoute.allowed, true, 'فروشنده فعال باید مسیر پرونده‌ها و حساب خود را در منو ببیند');
    assert.equal(managementRoute.allowed, false, 'فروشنده همکار نباید وارد مدیریت داخلی فروشندگان شود');
    const activeView = await service.query({ schemaVersion: 3, purpose: 'PARTNER_ACTIVATION', userId });
    assert.equal(activeView.ok && activeView.value.subject?.actions[0]?.enabled, false);
    const replay = await service.execute(await command('PROFILE_ACTIVATE', {
      profileId: bootstrapped.value.profileId, expectedProfileRevision: bootstrapped.value.profileRevision,
      expectedControlRevision: activationControl.revision }));
    assert.equal(replay.ok && replay.value.replayed, true);
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
