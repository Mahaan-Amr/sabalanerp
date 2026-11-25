import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import * as PartnerContracts from '@sabalanerp/partner-sales-contracts';
import { FEATURES } from '../../middleware/feature';
import { listAccountingContracts } from '../accountingService';
import { filterCurrentlyAuthorizedNotifications, readCurrentlyAuthorizedUnreadCount } from '../notificationAuthorization';
import { notificationReadObservation } from '../notificationReadObservation';
import { withAccountingReadScope } from '../partnerSales/accounting/readScope';
import { PARTNER_NOTIFICATION_RESOURCE, registerPartnerNotificationAccess } from '../partnerSales/notifications/access';
import { inquiryNotificationAccess } from '../partnerSales/notifications/inquiryDelivery';
import { planInquiryNotifications } from '../partnerSales/notifications/inquiries';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';
import { partnerNotificationsTestDatabaseUrl } from './partnerNotificationsTestDatabase';

function completed<T>(result: PromiseSettledResult<T>) {
  if (result.status === 'rejected') throw result.reason;
  return result.value;
}

test('a mixed notification backlog keeps exact totals, verifies each notice and refreshes current authority', async t => {
  const fixture = await createDispatchDocumentsTemporaryDatabase({
    repositoryRoot: resolve(__dirname, '../../../..'),
    sourceDatabaseUrl: partnerNotificationsTestDatabaseUrl(),
    schemaOnly: true,
  });
  const database = new PrismaClient({
    datasources: { db: { url: fixture.databaseUrl } }, log: [{ level: 'query', emit: 'event' }],
  });
  const applicationDatabase = database as unknown as PrismaClient;
  let trackedQueries: string[] | undefined;
  database.$on('query', ({ query }) => { trackedQueries?.push(query.trim()); });
  async function captureQueries<T>(read: () => Promise<T>) {
    const queries: string[] = [];
    trackedQueries = queries;
    try { return { result: await read(), queries }; }
    finally { trackedQueries = undefined; }
  }
  const prefix = `notice-backlog-${randomUUID()}`;
  const actorId = `${prefix}-actor`;
  const ownerId = `${prefix}-owner`;
  const nextResponderId = `${prefix}-next`;
  const inquiryIds = [`${prefix}-inquiry-a`, `${prefix}-inquiry-b`];
  const fixtureRows = 240;
  const accountingRows = 12;
  const personalRows = 6;
  const tamperedId = `${prefix}-tampered`;
  try {
    registerPartnerNotificationAccess(inquiryNotificationAccess);
    await database.$transaction(async tx => {
      await tx.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
      await tx.user.createMany({ data: [actorId, ownerId, nextResponderId].map(id => ({
        id, email: `${id}@example.invalid`, username: id, password: 'not-a-login', firstName: 'Notification', lastName: 'Fixture',
      })) });
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
      const tamperedEvent = { ...partnerEvents[0], id: tamperedId, deduplicationKey: tamperedId,
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
    }, { timeout: 45_000 });

    const actor = await database.user.findUniqueOrThrow({ where: { id: actorId } });
    const getCandidates = () => database.notification.findMany({
      where: { userId: actorId, readAt: null }, include: { event: true },
    });
    const preview = async () => filterCurrentlyAuthorizedNotifications(
      applicationDatabase, actor, await getCandidates(), { inbox: true },
    );
    const unreadCount = () => readCurrentlyAuthorizedUnreadCount(applicationDatabase, actor);
    const expected = fixtureRows + accountingRows + personalRows;
    // Compare both read paths on the same immutable evidence and current actor.
    const partnerSample = (await getCandidates()).filter(row => row.event?.resourceType === PARTNER_NOTIFICATION_RESOURCE
      && row.id !== tamperedId).slice(0, 12);
    const locked = await captureQueries(() =>
      filterCurrentlyAuthorizedNotifications(applicationDatabase, actor, partnerSample));
    const batched = await captureQueries(() =>
      filterCurrentlyAuthorizedNotifications(applicationDatabase, actor, partnerSample, { inbox: true }));
    assert.equal(locked.result.length, 12);
    assert.deepEqual(batched.result.map(row => row.id), locked.result.map(row => row.id));
    assert.equal(locked.queries.filter(query => query === 'COMMIT').length, 12);
    assert.equal(batched.queries.filter(query => query === 'COMMIT').length, 1);
    assert.ok(batched.queries.length * 3 < locked.queries.length,
      `query events: legacy ${locked.queries.length}, batched ${batched.queries.length}`);
    t.diagnostic(`12 inquiry notices: legacy ${locked.queries.length} SQL query events and 12 commits, `
      + `batched ${batched.queries.length} SQL query events and 1 commit`);

    const countObservation: NonNullable<ReturnType<typeof notificationReadObservation.getStore>> = {};
    const previewObservation: typeof countObservation = {};
    const accountingActor = { userId: actorId };
    const { result: [countResult, previewResult, accountingResult], queries } = await captureQueries(() => Promise.allSettled([
      notificationReadObservation.run(countObservation, unreadCount),
      notificationReadObservation.run(previewObservation, preview),
      withAccountingReadScope(applicationDatabase, accountingActor, scope =>
        listAccountingContracts({ view: 'reviewable', page: 1, pageSize: 50 }, accountingActor, scope),
        { purpose: 'CORRECTIONS' }),
    ]));
    const count = completed(countResult);
    const visible = completed(previewResult);
    const accounting = completed(accountingResult);
    assert.equal(accounting.total, 0);
    assert.deepEqual(accounting.items, []);
    assert.equal(count, expected);
    assert.equal(visible.length, expected);
    assert.ok(!visible.some(row => row.id === tamperedId));
    for (const observation of [countObservation, previewObservation]) {
      assert.equal(observation['partnerInquiry.transaction']?.calls, 3);
      assert.equal(observation['partnerInquiry.evidence']?.calls, 12);
      assert.equal(observation['partnerInquiry.authority']?.calls, 12);
      assert.ok(Object.values(observation).every(sample => sample.errorCode === undefined));
    }
    const commits = queries.filter(query => query === 'COMMIT').length;
    assert.equal(commits, 7, 'count and preview each commit three batches and the Accounting register commits one snapshot');
    assert.equal(queries.filter(query => query === 'BEGIN').length, commits);
    assert.ok(!queries.includes('ROLLBACK'));
    t.diagnostic(`Concurrent unread count, preview and Accounting register: ${queries.length} SQL query events, ${commits} commits`);
    assert.equal(await readCurrentlyAuthorizedUnreadCount(applicationDatabase, { ...actor, id: nextResponderId }), 0,
      'a copied notice cannot confer recipient authority');

    await database.partnerInquiryAssignment.create({ data: { inquiryId: inquiryIds[0], revision: 2, actorId: ownerId,
      responderId: nextResponderId, reason: 'Reassigned in fixture', eligibilityEvidence: { fixture: true } } });
    assert.equal(await unreadCount(), expected - fixtureRows / 2);
    await database.featurePermission.update({ where: { userId_workspace_feature: { userId: actorId, workspace: 'accounting', feature: FEATURES.ACCOUNTING_CONTRACTS_VIEW } },
      data: { permissionLevel: 'none' } });
    await database.effectiveActionGrant.update({ where: { id: `${prefix}-grant` }, data: {
      revokedAt: new Date(), revokedBy: ownerId, revocationReason: 'Revoked in fixture', revocationCorrelationId: prefix,
    } });
    assert.equal(await unreadCount(), personalRows);
    assert.equal((await preview()).length, personalRows);
  } finally {
    try { await database.$disconnect(); }
    finally { await fixture.cleanup(); }
  }
});
