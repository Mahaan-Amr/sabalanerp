import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import * as PartnerContracts from '@sabalanerp/partner-sales-contracts';
import { FEATURES } from '../../middleware/feature';
import { filterCurrentlyAuthorizedNotifications, readCurrentlyAuthorizedUnreadCount } from '../notificationAuthorization';
import { notificationReadObservation } from '../notificationReadObservation';
import { PARTNER_NOTIFICATION_RESOURCE, registerPartnerNotificationAccess } from '../partnerSales/notifications/access';
import { inquiryNotificationAccess } from '../partnerSales/notifications/inquiryDelivery';
import { planInquiryNotifications } from '../partnerSales/notifications/inquiries';
import { partnerNotificationsTestDatabaseUrl } from './partnerNotificationsTestDatabase';

test('a mixed notification backlog keeps exact totals, verifies each notice and refreshes current authority', async t => {
  const database = new PrismaClient({
    datasources: { db: { url: partnerNotificationsTestDatabaseUrl() } },
    log: [{ level: 'query', emit: 'event' }],
  });
  let trackedQueries: number | undefined;
  database.$on('query', () => { if (trackedQueries !== undefined) trackedQueries++; });
  registerPartnerNotificationAccess(inquiryNotificationAccess);
  const prefix = `notice-backlog-${randomUUID()}`;
  const rolledBack = new Error('fixture rolled back');
  const actorId = `${prefix}-actor`;
  const ownerId = `${prefix}-owner`;
  const nextResponderId = `${prefix}-next`;
  const inquiryIds = [`${prefix}-inquiry-a`, `${prefix}-inquiry-b`];
  const fixtureRows = 240;
  const accountingRows = 12;
  const personalRows = 6;
  try {
    await assert.rejects(database.$transaction(async tx => {
      await tx.user.createMany({ data: [actorId, ownerId, nextResponderId].map(id => ({
        id, email: `${id}@example.invalid`, username: id, password: 'not-a-login', firstName: 'Notification', lastName: 'Fixture',
      })) });
      const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
      await tx.workspacePermission.create({ data: { userId: actorId, workspace: 'accounting', permissionLevel: 'view' } });
      await tx.featurePermission.create({ data: {
        userId: actorId, workspace: 'accounting', feature: FEATURES.ACCOUNTING_CONTRACTS_VIEW, permissionLevel: 'view',
      } });
      await tx.effectiveActionGrant.create({ data: {
        id: `${prefix}-grant`, domain: 'PARTNER', action: 'INQUIRY_READ', rootKind: 'INQUIRY', purpose: 'RESPONDER',
        principalKind: 'USER', principalId: actorId, subjectUserId: actorId, grantedBy: ownerId,
        scope: 'ASSIGNED', effect: 'ALLOW', correlationId: prefix, reason: 'Notification pressure fixture',
      } });
      await tx.partnerProfile.create({ data: { id: ownerId, userId: ownerId, state: 'ACTIVE' } });
      await tx.partnerInquiry.createMany({ data: inquiryIds.map(id => ({ id, profileId: ownerId })) });
      await tx.partnerInquiryAssignment.createMany({ data: inquiryIds.map(inquiryId => ({
        id: `${inquiryId}-assignment`, inquiryId, revision: 1, responderId: actorId, actorId: ownerId,
        reason: 'Notification pressure fixture', eligibilityEvidence: { fixture: true },
      })) });
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const recordedAt = new Date(now.getTime() - 60_000);
      const inquiryEvents = Array.from({ length: fixtureRows }, (_, index) => {
        const inquiryId = inquiryIds[index % inquiryIds.length];
        const id = `${prefix}-source-${index}`;
        return { id, inquiryId, revision: index + 1, actorId: ownerId, commandId: id, correlationId: id,
          type: 'INQUIRY_SUBMITTED', recordedAt, evidence: { assignmentId: `${inquiryId}-assignment` } };
      });
      await tx.partnerInquiryEvent.createMany({ data: inquiryEvents });
      const partnerEvents = await Promise.all(inquiryEvents.map(async event => {
        const [payload] = await planInquiryNotifications(PartnerContracts, { now: async () => now.toISOString() }, {
          type: 'SUBMITTED', eventId: event.id, correlationId: event.correlationId,
          occurredAt: recordedAt.toISOString(), recipients: [{ audience: 'RESPONDER',
            recipientEvidenceId: event.evidence.assignmentId, projectionEvidenceId: event.id }],
        });
        return { id: `${event.id}-notice`, deduplicationKey: event.id, type: 'PARTNER_INQUIRY_SUBMITTED',
          resourceType: PARTNER_NOTIFICATION_RESOURCE, resourceId: event.id, payload };
      }));
      const tamperedEvent = { ...partnerEvents[0], id: `${prefix}-tampered`, deduplicationKey: `${prefix}-tampered`,
        payload: { ...partnerEvents[0].payload, correlationId: `${prefix}-mismatch` } };
      const accountingEvents = Array.from({ length: accountingRows }, (_, index) => ({
        id: `${prefix}-accounting-${index}`, deduplicationKey: `${prefix}-accounting-${index}`,
        type: 'CONTRACT_CREATED', workspace: 'accounting', feature: FEATURES.ACCOUNTING_CONTRACTS_VIEW,
      }));
      await tx.notificationEvent.createMany({ data: [...partnerEvents, tamperedEvent, ...accountingEvents] });
      const genericNotice = { userId: actorId, title: 'Fixture', message: 'Fixture' };
      await tx.notification.createMany({ data: [
        ...[...partnerEvents, tamperedEvent, ...accountingEvents].map(event => ({
          ...genericNotice, id: event.id, eventId: event.id, type: event.type,
        })),
        ...Array.from({ length: personalRows }, () => ({ ...genericNotice, type: 'SYSTEM' })),
        { ...genericNotice, type: 'SYSTEM', readAt: now },
        { ...genericNotice, userId: nextResponderId, eventId: partnerEvents[1].id, type: partnerEvents[1].type },
      ] });
      const candidates = await tx.notification.findMany({ where: { userId: actorId, readAt: null }, include: { event: true } });
      const preview = () => filterCurrentlyAuthorizedNotifications(tx, actor, candidates, { inbox: true });
      const expected = fixtureRows + accountingRows + personalRows;
      // Compare the legacy locked Partner reader and the projection on the same
      // immutable evidence and current actor. Keep the sample size small for CI.
      const partnerSample = candidates.filter(row => row.event?.resourceType === PARTNER_NOTIFICATION_RESOURCE
        && row.id !== tamperedEvent.id).slice(0, 12);
      trackedQueries = 0;
      const locked = await filterCurrentlyAuthorizedNotifications(tx, actor, partnerSample);
      const legacyQueries = trackedQueries;
      trackedQueries = 0;
      const batched = await filterCurrentlyAuthorizedNotifications(tx, actor, partnerSample, { inbox: true });
      const batchQueries = trackedQueries;
      trackedQueries = undefined;
      assert.equal(locked.length, 12);
      assert.deepEqual(batched.map(row => row.id), locked.map(row => row.id));
      assert.ok(batchQueries * 3 < legacyQueries, `query events: legacy ${legacyQueries}, batched ${batchQueries}`);
      t.diagnostic(`12 inquiry notices: legacy ${legacyQueries} SQL query events, batched ${batchQueries}`);

      const samples: NonNullable<ReturnType<typeof notificationReadObservation.getStore>> = {};
      const [count, accounting] = await Promise.all([
        notificationReadObservation.run(samples, () => readCurrentlyAuthorizedUnreadCount(tx, actor)),
        database.accountingFinancialRecord.findMany({ select: { id: true }, take: 100 }),
      ]);
      assert.ok(Array.isArray(accounting));
      assert.equal(count, expected);
      assert.equal(samples['partnerInquiry.transaction']?.calls, 3);
      assert.equal(samples['partnerInquiry.evidence']?.calls, 12);
      assert.equal(samples['partnerInquiry.authority']?.calls, 12);
      assert.equal((await preview()).length, expected);
      assert.equal(await readCurrentlyAuthorizedUnreadCount(tx, { ...actor, id: nextResponderId }), 0,
        'a copied notice cannot confer recipient authority');

      await tx.partnerInquiryAssignment.create({ data: { inquiryId: inquiryIds[0], revision: 2, actorId: ownerId,
        responderId: nextResponderId, reason: 'Reassigned in fixture', eligibilityEvidence: { fixture: true } } });
      assert.equal(await readCurrentlyAuthorizedUnreadCount(tx, actor), expected - fixtureRows / 2);
      await tx.featurePermission.update({ where: { userId_workspace_feature: { userId: actorId, workspace: 'accounting', feature: FEATURES.ACCOUNTING_CONTRACTS_VIEW } },
        data: { permissionLevel: 'none' } });
      await tx.effectiveActionGrant.update({ where: { id: `${prefix}-grant` }, data: {
        revokedAt: new Date(), revokedBy: ownerId, revocationReason: 'Revoked in fixture', revocationCorrelationId: prefix,
      } });
      assert.equal(await readCurrentlyAuthorizedUnreadCount(tx, actor), personalRows);
      assert.equal((await preview()).length, personalRows);
      throw rolledBack;
    }, { timeout: 45_000 }), error => error === rolledBack);
  } finally {
    await database.$disconnect();
  }
});
