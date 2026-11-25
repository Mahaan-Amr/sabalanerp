import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { Prisma, PrismaClient } from '@prisma/client';
import { canonicalHash, partnerError } from '@sabalanerp/partner-sales-contracts';
import { readAuthorizationDecisionByCorrelation } from '../effectiveAuthorization/audit';
import { revokeScopedAction } from '../effectiveAuthorization/scopedActions';
import { createAuditedPartnerAuthorization } from '../partnerSales/authorization/audited';
import { createPrismaPartnerInquiryService, type PartnerInquiryDependencies } from '../partnerSales/inquiries/service';
import { canReadPartnerNotification, resolvePartnerNotificationAction } from '../partnerSales/notifications/access';
import { dispatchPartnerInquiryEvents, inquiryNotificationAccess } from '../partnerSales/notifications/inquiryDelivery';
import { createPrismaPartnerProfileStore } from '../partnerSales/profiles/prismaStore';
import { createPartnerProfileService, type PartnerProfileDependencies } from '../partnerSales/profiles/service';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';

const manager = 'lock-order-manager';
const partner = 'lock-order-partner';
const responder = 'lock-order-responder';
const profile = 'lock-order-profile';
const inquiry = 'lock-order-inquiry';
const assignment = 'lock-order-assignment';
const row = 'lock-order-row';
const deliveredEvent = 'lock-order-delivered-event';
const pendingEvent = 'lock-order-pending-event';
const revocationEvent = 'lock-order-revocation-event';

async function seed(database: PrismaClient) {
  await database.$transaction(async tx => {
    await tx.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    for (const id of [manager, partner, responder]) {
      await tx.user.create({ data: { id, username: id, email: `${id}@example.invalid`,
        password: 'not-a-login', firstName: 'Lock', lastName: 'Fixture', role: id === manager ? 'ADMIN' : 'USER' } });
    }
    for (const action of ['INQUIRY_READ', 'INQUIRY_RESPOND']) {
      await tx.effectiveActionGrant.create({ data: { id: action, principalKind: 'USER', principalId: responder,
        subjectUserId: responder, domain: 'PARTNER', action, rootKind: 'INQUIRY', purpose: 'RESPONDER',
        scope: 'ASSIGNED', effect: 'ALLOW', grantedBy: manager, reason: 'Isolated fixture', correlationId: action } });
    }
    await tx.partnerProfile.create({ data: { id: profile, userId: partner, state: 'ACTIVE' } });
    await tx.partnerReleaseCohort.create({ data: { id: 'cohort', name: 'Lock order fixture', activationEnabled: true } });
    await tx.partnerOperationsControl.create({ data: { id: 'partner-operations', cohortId: 'cohort' } });
    await tx.partnerCohortMembership.create({ data: {
      profileId: profile, cohortId: 'cohort', actorId: manager, eligibilityEvidence: {},
    } });
    await tx.partnerInquiry.create({ data: { id: inquiry, profileId: profile, revision: 4, submittedAt: new Date(),
      assignments: { create: { id: assignment, revision: 1, responderId: responder, actorId: manager,
        reason: 'Isolated fixture', eligibilityEvidence: {} } },
      rows: { create: { id: row, version: 1, configurationHash: `sha256-v1:${'a'.repeat(64)}`, definition: {} } },
    } });
    for (const [id, revision] of [[deliveredEvent, 2], [pendingEvent, 3], [revocationEvent, 4]] as const) {
      await tx.partnerInquiryEvent.create({ data: { id, inquiryId: inquiry, revision,
        actorId: partner, type: 'INQUIRY_SUBMITTED', commandId: id, correlationId: id,
        evidence: { version: 1, assignmentId: assignment, assignmentRevision: 1, rowIds: [row] },
      } });
    }
  });
}

async function authorize(tx: Prisma.TransactionClient, input:
  Parameters<PartnerInquiryDependencies['authorize']>[1] |
  Parameters<PartnerProfileDependencies<Prisma.TransactionClient>['authorize']>[1], correlationId: string) {
  const policy = createAuditedPartnerAuthorization(tx, { actorId: input.actorId, purpose: input.purpose, channel: 'API' },
    { correlationId, reason: input.reason });
  const result = await policy.authorize(input.action, input.root);
  if (!result.ok) return result;
  const evidence = await readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId: input.actorId,
    action: input.action, rootKind: input.root.kind, rootId: input.root.id, purpose: input.purpose, channel: 'API',
    correlationId, allowed: true });
  assert.ok(evidence);
  return { ok: true as const, value: { evidenceId: evidence.id } };
}

async function requireTwoBlockedSessions(database: PrismaClient) {
  const deadline = Date.now() + 3_000;
  do {
    const sessions = await database.$queryRaw<Array<{ pid: number }>>`
      SELECT pid FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock' AND cardinality(pg_blocking_pids(pid)) > 0`;
    if (sessions.length === 2) return;
    await delay(15);
  } while (Date.now() < deadline);
  assert.fail('Inquiry command and delivery did not both enter a PostgreSQL lock wait');
}

test('profile termination serializes with response and notification delivery and keeps the command receipt', async () => {
  const source = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  source.searchParams.set('connection_limit', '5');
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl: source.toString() });
  const database = temporary.client();
  try {
    await seed(database);
    await dispatchPartnerInquiryEvents(database, [deliveredEvent, deliveredEvent]);
    const notification = await database.notification.findFirstOrThrow({ where: { userId: responder,
      event: { resourceId: deliveredEvent } }, select: { id: true, referenceId: true } });
    assert.equal(notification.referenceId, null);
    assert.equal(await canReadPartnerNotification(database, responder, notification.id, inquiryNotificationAccess), true);
    assert.equal(await resolvePartnerNotificationAction(database, partner, notification.id, inquiryNotificationAccess), null);

    const transitionIntent = { schemaVersion: 1 as const, type: 'PROFILE_TRANSITION' as const, profileId: profile,
      expectedRevision: 1, to: 'TERMINATED' as const, reason: 'پایان همکاری برای تست همزمانی', gateEvidenceIds: [] };
    const transition = { ...transitionIntent, commandId: 'terminate', correlationId: 'terminate', idempotency: {
      actorId: manager, operation: transitionIntent.type, targetId: profile, key: 'terminate',
      payloadHash: await canonicalHash(transitionIntent),
    } };
    const responseIntent = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId: inquiry,
      expectedAssignmentRevision: 1, decisions: [{ rowId: row, expectedRevision: 1, outcome: 'REJECTED' as const,
        reason: 'ثبت پاسخ قیمت برای تست همزمانی' }] };
    const response = { ...responseIntent, commandId: 'decide', correlationId: 'decide', idempotency: {
      actorId: responder, operation: responseIntent.type, targetId: inquiry, key: 'decide',
      payloadHash: await canonicalHash(responseIntent),
    } };

    let signalProfileLock!: () => void;
    const locked = new Promise<void>(resolve => { signalProfileLock = resolve; });
    let releaseProfile!: () => void;
    const release = new Promise<void>(resolve => { releaseProfile = resolve; });
    const profileService = createPartnerProfileService({ actorId: manager, store: createPrismaPartnerProfileStore(database),
      authorize: async (tx, input) => {
        await tx.$executeRaw`SET LOCAL deadlock_timeout = '100ms'`;
        signalProfileLock();
        await release;
        return authorize(tx, input, transition.correlationId);
      } });
    const inquiryService = createPrismaPartnerInquiryService({ database, actorId: responder,
      authorize: (tx, input) => authorize(tx, input, response.correlationId),
      resolveConfiguration: async () => ({ ok: false, error: partnerError('NOT_FOUND') }),
      resolveInitialResponder: async () => ({ ok: false, error: partnerError('NOT_ASSIGNED') }),
    });

    const termination = profileService.execute(transition);
    const contenders: Promise<unknown>[] = [termination];
    try {
      await Promise.race([locked, termination]);
      const decision = inquiryService.execute(response);
      const delivery = dispatchPartnerInquiryEvents(database, [pendingEvent]);
      contenders.push(decision, delivery);
      await requireTwoBlockedSessions(database);
      releaseProfile();
      const committed = await termination;
      assert.ok(committed.ok, JSON.stringify(committed));
      const denied = await decision;
      assert.equal(denied.ok, false, JSON.stringify(denied));
      await delivery;

      const replay = await profileService.execute(transition);
      assert.deepEqual(replay, { ...committed, value: { ...committed.value, replayed: true } });
      assert.equal(await database.partnerProfileEvent.count({ where: { profileId: profile } }), 1);
      assert.equal((await database.partnerInquiryRow.findUniqueOrThrow({ where: { id: row } })).outcome, 'CANCELLED');
      assert.equal(await database.partnerCommandOutcome.count({ where: { targetScope: inquiry } }), 0);
      assert.equal(await database.effectiveAuthorizationAudit.count({ where: { correlationId: 'decide', allowed: false } }), 1);
      // The assigned responder keeps historical read access until the grant is revoked.
      assert.equal(await canReadPartnerNotification(database, responder, notification.id, inquiryNotificationAccess), true);
      await dispatchPartnerInquiryEvents(database, [pendingEvent]);
      const delivered = await database.partnerInquiryNotificationDelivery.findUniqueOrThrow({ where: { eventId: pendingEvent } });
      assert.deepEqual({ attempts: delivered.attempts, status: delivered.status }, { attempts: 1, status: 'DELIVERED' });
      assert.equal(await database.notification.count({ where: { userId: responder } }), 2);

      let signalRevocation!: () => void;
      const revocationLocked = new Promise<void>(resolve => { signalRevocation = resolve; });
      let releaseRevocation!: () => void;
      const revocationCommit = new Promise<void>(resolve => { releaseRevocation = resolve; });
      const revoke = database.$transaction(async tx => {
        const result = await revokeScopedAction(tx, {
          actorId: manager, correlationId: 'revoke', reason: 'لغو مجوز مشاهده برای تست همزمانی',
        }, 'INQUIRY_READ');
        signalRevocation();
        await revocationCommit;
        return result;
      });
      contenders.push(revoke);
      try {
        await Promise.race([revocationLocked, revoke]);
        const read = canReadPartnerNotification(database, responder, notification.id, inquiryNotificationAccess);
        const dispatch = dispatchPartnerInquiryEvents(database, [revocationEvent]);
        contenders.push(read, dispatch);
        await requireTwoBlockedSessions(database);
        releaseRevocation();
        assert.deepEqual(await revoke, { found: true, changed: true });
        assert.equal(await read, false);
        await dispatch;
      } finally {
        releaseRevocation();
      }
      assert.equal(await resolvePartnerNotificationAction(database, responder, notification.id, inquiryNotificationAccess), null);
      const skipped = await database.partnerInquiryNotificationDelivery.findUniqueOrThrow({ where: { eventId: revocationEvent } });
      assert.deepEqual({ attempts: skipped.attempts, status: skipped.status }, { attempts: 1, status: 'SKIPPED' });
      assert.equal(await database.notification.count({ where: { userId: responder } }), 2);
    } finally {
      releaseProfile();
      await Promise.allSettled(contenders);
    }
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
