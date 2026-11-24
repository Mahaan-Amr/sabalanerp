import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import express from 'express';
import type { AddressInfo } from 'node:net';
import test, { type TestContext } from 'node:test';
import { prisma } from '../../lib/prisma';
import { SESSION_COOKIE } from '../../services/identitySessionService';
import {
  PARTNER_NOTIFICATION_RESOURCE, registerPartnerNotificationAccess,
} from '../../services/partnerSales/notifications/access';
import notifications from '../notifications';

const user = { id: 'recipient', role: 'USER', isActive: true };

function stubDatabaseMethod<T extends object>(
  t: TestContext, delegate: T, method: keyof T, replacement: (...args: never[]) => Promise<unknown>,
) {
  const original = delegate[method];
  Object.assign(delegate, { [method]: replacement });
  t.after(() => { Object.assign(delegate, { [method]: original }); });
}

async function startInbox(t: TestContext) {
  stubDatabaseMethod(t, prisma.authSession, 'findUnique', async () => ({
    id: 'session', user, lastActivityAt: new Date(), idleExpiresAt: new Date(Date.now() + 60_000),
    absoluteExpiresAt: new Date(Date.now() + 60_000),
  }));
  const app = express();
  app.use('/notifications', notifications);
  const server = app.listen(0, '127.0.0.1');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/notifications`;
  return async (path: string, options?: RequestInit) => {
    const response = await fetch(base + path, {
      ...options, headers: { cookie: `${SESSION_COOKIE}=test-session`, ...options?.headers },
    });
    assert.equal(response.status, 200);
    return response.json();
  };
}

test('the unread inbox shows an authorized privacy deadline counted on the badge without exposing its recipient ID', async t => {
  const notice = {
    id: 'deadline', userId: user.id, type: 'PERFORMANCE_PRIVACY_DEADLINE', title: 'Privacy case deadline',
    message: 'Respond to the privacy case', priority: 'HIGH', actionUrl: null, referenceId: null, readAt: null,
    createdAt: new Date('2026-11-24T12:00:00.000Z'),
    event: { resourceType: 'PERFORMANCE_PRIVACY_CASE', resourceId: 'privacy-case', workspace: 'hr', feature: null },
  };
  stubDatabaseMethod(t, prisma.notification, 'findMany', async ({ select }: Prisma.NotificationFindManyArgs) =>
    [Object.fromEntries(Object.entries(notice).filter(([field]) => select?.[field as keyof typeof select]))]);
  stubDatabaseMethod(t, prisma.user, 'findUnique', async () => user);
  stubDatabaseMethod(t, prisma.workspacePermission, 'findMany', async () => []);
  stubDatabaseMethod(t, prisma.roleWorkspacePermission, 'findMany', async () => []);
  stubDatabaseMethod(t, prisma.featurePermission, 'findMany', async () => []);
  stubDatabaseMethod(t, prisma.roleFeaturePermission, 'findMany', async () => []);
  stubDatabaseMethod(t, prisma.hrWorkspaceAccessGrant, 'findMany', async () => []);
  stubDatabaseMethod(t, prisma.hrFeatureAccessGrant, 'findMany', async () => [{
    featureCode: 'VIEW_PERFORMANCE_PRIVACY_CASE', status: 'ACTIVE', effectiveFrom: new Date(0),
    effectiveTo: null, level: 'ADMIN',
  }]);
  stubDatabaseMethod(t, prisma.crossWorkspaceDuty, 'findMany', async () => []);
  stubDatabaseMethod(t, prisma.performancePrivacyCase, 'findUnique', async () => ({ subjectId: 'privacy-subject' }));

  const request = await startInbox(t);
  assert.deepEqual(await request('/unread-count'), { success: true, data: { count: 1 } });
  assert.deepEqual(await request('?state=UNREAD'), {
    success: true,
    data: [{
      id: 'deadline', type: 'PERFORMANCE_PRIVACY_DEADLINE', title: 'Privacy case deadline',
      message: 'Respond to the privacy case', priority: 'HIGH', actionUrl: null, referenceId: null, readAt: null,
      createdAt: '2026-11-24T12:00:00.000Z', workspace: 'hr', category: 'SYSTEM', sessionId: null,
    }],
    pagination: { hasMore: false, nextCursor: null },
  });
});

test('mark all read leaves a Partner notice unread when current command authorization denies it', async t => {
  const notice = { id: 'revoked-notice', userId: user.id, type: 'PARTNER_INQUIRY_SUBMITTED',
    event: { resourceType: PARTNER_NOTIFICATION_RESOURCE, resourceId: 'inquiry' } };
  registerPartnerNotificationAccess({
    // The read snapshot can predate revocation. The read-state command must
    // reauthorize against current authority before changing the notice.
    async readableIds() { return new Set([notice.id]); },
    async canRead() { return false; },
    async lockAndAuthorize() { return null; },
    async resolveAction() { return null; },
  });
  stubDatabaseMethod(t, prisma.notification, 'findMany', async () => [notice]);
  stubDatabaseMethod(t, prisma.notification, 'findFirst', async () => ({ id: notice.id }));
  stubDatabaseMethod(t, prisma.notification, 'updateMany', async ({ where }: Prisma.NotificationUpdateManyArgs) => ({
    count: Number(typeof where?.id === 'object'
      && Array.isArray(where.id.in) && where.id.in.includes(notice.id)),
  }));
  stubDatabaseMethod(t, prisma.apiIdempotencyRecord, 'deleteMany', async () => ({ count: 0 }));
  stubDatabaseMethod(t, prisma.apiIdempotencyRecord, 'create', async () => ({}));
  stubDatabaseMethod(t, prisma.apiIdempotencyRecord, 'update', async () => ({}));

  const request = await startInbox(t);
  assert.deepEqual(await request('/read-all', {
    method: 'PUT', headers: { 'x-idempotency-key': 'notification-revocation' },
  }), { success: true, data: { updated: 0 } });
});
