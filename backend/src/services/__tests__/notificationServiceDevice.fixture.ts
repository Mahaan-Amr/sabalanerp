import assert from 'node:assert/strict';
import webPush from 'web-push';
import bcrypt from 'bcryptjs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { Server } from 'socket.io';
import express from 'express';
import { createAuthoritativeSession, revokeSessions } from '../identitySessionService';

async function main() {
  const target = new URL(process.env.DATABASE_URL!);
  assert.ok(['127.0.0.1:55432', 'localhost:55432'].includes(target.host)
    && /^\/sabalanerp_concurrency_[a-f0-9]{16}$/.test(target.pathname));
  const keys = webPush.generateVAPIDKeys();
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = keys.privateKey;
  const temporaryParent = await fs.realpath(os.tmpdir());
  const coordination = await fs.mkdtemp(path.join(temporaryParent, 'sabalan-realtime-service-'));
  process.env.RECOVERY_COORDINATION_DIR = coordination;
  const { RealtimeDeliveryLifecycle } = await import('../realtimeDeliveryLifecycle');
  const { initializeRecoveryRuntime, withRecoveryBackgroundWrite, waitForActiveWrites } = await import('../recoveryRuntime');
  initializeRecoveryRuntime();
  const execute = async <T>(work: () => Promise<T>) => {
    const result = await withRecoveryBackgroundWrite(async () => ({ value: await work() }));
    if (!result) throw new Error('REALTIME_DELIVERY_UNAVAILABLE');
    return result.value;
  };
  const { prisma } = await import('../../lib/prisma');
  const { deliverPendingNotificationOutbox, deliverDailyWebPushDigests } = await import('../notificationService');
  const originalSend = webPush.sendNotification;
  try {
    const user = await prisma.user.create({ data: { email: 'device-service@example.invalid', username: 'device-service',
      password: 'not-used', firstName: 'آزمون', lastName: 'اعلان', role: 'ADMIN' } });
    const policy = await prisma.notificationPolicyVersion.create({ data: {
      eventType: 'HR_DUTY_ASSIGNED', version: 1, mandatory: true, titleTemplate: 'آزمون', messageTemplate: 'آزمون',
      channels: ['WEB_PUSH'], recipientResolvers: ['DIRECT_USER'],
    } });
    await prisma.notificationPreference.create({ data: { userId: user.id, webPushEnabled: true, mutedCategories: [] } });
    const devices = await Promise.all(['a', 'b'].map(suffix => prisma.webPushSubscription.create({ data: {
      userId: user.id, endpoint: `https://device-${suffix}.example.invalid/push`, p256dh: 'fake-key', auth: 'fake-auth',
    } })));
    const event = async (key: string, priority = 'NORMAL', createdAt = new Date()) => prisma.notificationEvent.create({ data: {
      type: 'HR_DUTY_ASSIGNED', deduplicationKey: key,
      notifications: { create: { userId: user.id, policyVersionId: policy.id, type: 'HR_DUTY_ASSIGNED',
        title: 'private notification text', message: 'must never enter provider payload', priority, createdAt } },
      outbox: { create: {} },
    }, include: { notifications: true, outbox: true } });
    let calls: string[] = [];
    webPush.sendNotification = (async (subscription, payload, options) => {
      calls.push(subscription.endpoint);
      assert.ok(!String(payload).includes('private notification text') && !String(payload).includes('must never'));
      assert.equal(options?.timeout, 15_000);
      if (subscription.endpoint === devices[1].endpoint) throw new Error('accepted connection lost');
      return { statusCode: 201, body: '', headers: {} };
    }) as typeof webPush.sendNotification;
    const immediate = await event('device-service-immediate');
    assert.equal((await deliverPendingNotificationOutbox(prisma, async () => undefined)).businessCode,
      'PERFORMANCE_NOTIFICATION_PROVIDER_OUTCOME_UNKNOWN');
    assert.equal((await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: immediate.outbox!.id } })).status, 'UNKNOWN');
    await prisma.notificationOutbox.update({ where: { id: immediate.outbox!.id }, data: { status: 'PENDING' } });
    await deliverPendingNotificationOutbox(prisma, async () => undefined);
    assert.equal(calls.length, 2, 'recovery of outbox cannot resend either accepted or ambiguous device');

    // The user is revoked after device A succeeds. Device B must consult fresh
    // database authorization rather than the outbox's earlier user snapshot.
    calls = [];
    webPush.sendNotification = (async subscription => {
      calls.push(subscription.endpoint);
      await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
      return { statusCode: 201, body: '', headers: {} };
    }) as typeof webPush.sendNotification;
    await event('device-service-revocation');
    await deliverPendingNotificationOutbox(prisma, async () => undefined);
    assert.equal(calls.length, 1);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });

    await prisma.notificationPreference.update({ where: { userId: user.id }, data: { lowPriorityDelivery: 'DAILY' } });
    const old = new Date(Date.now() - 25 * 60 * 60_000);
    const digestA = await event('device-service-digest-a', 'LOW', old);
    const digestB = await event('device-service-digest-b', 'LOW', old);
    calls = [];
    webPush.sendNotification = (async subscription => {
      calls.push(subscription.endpoint);
      if (subscription.endpoint === devices[0].endpoint) throw new Error('unknown digest outcome');
      return { statusCode: 201, body: '', headers: {} };
    }) as typeof webPush.sendNotification;
    await deliverDailyWebPushDigests(prisma);
    await deliverDailyWebPushDigests(prisma);
    assert.equal(calls.length, 2, 'handled digest page must not resend known or unknown devices');
    const ids = [digestA.notifications[0].id, digestB.notifications[0].id];
    assert.equal(await prisma.notificationDeliveryAttempt.count({ where: {
      notificationId: { in: ids }, status: 'UNKNOWN', channel: { startsWith: 'WEB_PUSH_DEVICE_V1:' },
    } }), 2);
    assert.equal(await prisma.notificationDeliveryAttempt.count({ where: {
      notificationId: { in: ids }, status: 'SETTLED', channel: 'WEB_PUSH_DIGEST_V1',
    } }), 2);
    const { protect } = await import('../../middleware/auth');
    const { default: authRoutes } = await import('../../routes/auth');
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    let boundMutations = 0;
    app.post('/api/qa-protected', protect, (_request, response) => { boundMutations++; response.json({ success: true }); });
    const server = createServer(app);
    const io = new Server(server);
    let releaseAuthorization = () => {};
    let beginAuthorization!: () => void;
    let waitForAuthorization = false;
    const entered = new Promise<void>(resolve => { beginAuthorization = resolve; });
    const authorization = new Promise<void>(resolve => { releaseAuthorization = resolve; });
    const lifecycle = new RealtimeDeliveryLifecycle(prisma, () => io.sockets.sockets.values(), async () => {
      if (waitForAuthorization) { beginAuthorization(); await authorization; }
      return true;
    }, () => true, execute);
    io.use((socket, next) => { void lifecycle.authenticate(socket).then(() => next(), next); });
    const { io: connect } = createRequire(path.resolve('../frontend/package.json'))('socket.io-client');
    const clients: Array<{ disconnect: () => void }> = [];
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const firstSession = await createAuthoritativeSession(prisma, user.id, {});
      const secondSession = await createAuthoritativeSession(prisma, user.id, {});
      const otherUser = await prisma.user.create({ data: { username: 'other-device-owner', email: 'other-device-owner@example.invalid',
        password: 'not-used', firstName: 'دیگر', lastName: 'حساب' } });
      const otherSession = await createAuthoritativeSession(prisma, otherUser.id, {});
      const continuationPassword = 'local-continuation-fixture-only';
      const passwordHash = await bcrypt.hash(continuationPassword, 4);
      await prisma.user.updateMany({ where: { id: { in: [user.id, otherUser.id] } }, data: { password: passwordHash } });
      const sessionCountBefore = await prisma.authSession.count();
      const login = (identifier: string, expectedUserId: unknown, password = continuationPassword) =>
        fetch(`http://127.0.0.1:${address.port}/api/auth/login`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password, expectedUserId }) });
      const substitutedLogin = await login(otherUser.username!, user.id);
      assert.equal(substitutedLogin.status, 409); assert.equal(substitutedLogin.headers.get('set-cookie'), null);
      assert.equal(await prisma.authSession.count(), sessionCountBefore, 'wrong-account continuation creates no session or cookie');
      assert.equal((await login(user.username!, user.id, 'incorrect-password')).status, 401);
      assert.equal((await login(user.username!, ['invalid-owner'])).status, 400);
      const continuedLogin = await login(user.username!, user.id);
      assert.equal(continuedLogin.status, 200);
      const continuedIdentity = await continuedLogin.json() as any;
      assert.equal(continuedIdentity.data.user.id, user.id);
      assert.ok(continuedIdentity.session.id);
      assert.ok(continuedLogin.headers.get('set-cookie')?.includes('sabalan_session='));
      assert.equal(await prisma.authSession.count(), sessionCountBefore + 1);
      const request = (pathname: string, token: string, headers: Record<string, string> = {}, method = 'GET') =>
        fetch(`http://127.0.0.1:${address.port}${pathname}`, { method, headers: { cookie: `sabalan_session=${token}`, ...headers } });
      const expected = { 'x-sabalan-expected-user': user.id, 'x-sabalan-expected-session': firstSession.session.id };
      assert.equal((await request('/api/qa-protected', firstSession.token, {}, 'POST')).status, 200);
      assert.equal((await request('/api/qa-protected', firstSession.token, expected, 'POST')).status, 200);
      const wrongOwner = await request('/api/qa-protected', otherSession.token, expected, 'POST');
      assert.equal(wrongOwner.status, 401);
      assert.match(wrongOwner.headers.get('cache-control') || '', /no-store/);
      assert.equal((await request('/api/qa-protected', secondSession.token, expected, 'POST')).status, 401);
      assert.equal((await request('/api/qa-protected', firstSession.token, { 'x-sabalan-expected-user': user.id }, 'POST')).status, 401);
      assert.equal(boundMutations, 2, 'cookie switching cannot execute a bound operation as another owner/session');
      const wrongProbe = await request('/api/auth/me', otherSession.token, { 'x-sabalan-expected-user': user.id });
      assert.equal(wrongProbe.status, 401);
      assert.ok(!(await wrongProbe.text()).includes(otherUser.email));
      const ownProbe = await request('/api/auth/me', firstSession.token, { 'x-sabalan-expected-user': user.id });
      assert.equal(ownProbe.status, 200);
      const ownIdentity = await ownProbe.json() as any;
      assert.equal(ownIdentity.data.id, user.id);
      assert.equal(ownIdentity.session.id, firstSession.session.id);
      const idleBefore = new Date(Date.now() - 30 * 60_000);
      await prisma.authSession.updateMany({ where: { id: { in: [firstSession.session.id, secondSession.session.id] } }, data: { lastActivityAt: idleBefore } });
      const open = async (token: string, expectedUserId?: string) => {
        const client = connect(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false,
          auth: expectedUserId ? { expectedUserId } : {}, extraHeaders: { cookie: `sabalan_session=${token}` } });
        clients.push(client);
        await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
        return client;
      };
      const wrongSocket = connect(`http://127.0.0.1:${address.port}`, { transports: ['websocket'], reconnection: false,
        auth: { expectedUserId: user.id }, extraHeaders: { cookie: `sabalan_session=${otherSession.token}` } });
      clients.push(wrongSocket);
      await new Promise<void>((resolve, reject) => {
        wrongSocket.once('connect', () => reject(new Error('Cross-account socket connected')));
        wrongSocket.once('connect_error', () => resolve());
      });
      const firstSocket = await open(firstSession.token, user.id), secondSocket = await open(secondSession.token, user.id);
      let revokedMessages = 0;
      firstSocket.on('notification.created', () => { revokedMessages++; });
      await revokeSessions(prisma, { userId: user.id, sessionId: firstSession.session.id, reason: 'QA_REVOCATION' });
      const delivered = new Promise<any>(resolve => secondSocket.once('notification.created', resolve));
      await lifecycle.notify(user.id, immediate.notifications[0].id);
      assert.equal((await delivered).id, immediate.notifications[0].id);
      assert.equal(revokedMessages, 0);
      assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: secondSession.session.id } })).lastActivityAt.getTime(), idleBefore.getTime(),
        'socket admission and delivery must not refresh idle activity or write maintenance state');
      const serverSocket = io.sockets.sockets.get(secondSocket.id)!;
      await prisma.notificationEvent.update({ where: { id: immediate.id }, data: { workspace: 'sales' } });
      await prisma.user.update({ where: { id: user.id }, data: { role: 'USER' } });
      const workspaceGrant = await prisma.workspacePermission.create({ data: { userId: user.id, workspace: 'sales', permissionLevel: 'view' } });
      const authorizedBefore = new Promise<void>(resolve => secondSocket.once('notification.created', () => resolve()));
      await lifecycle.notify(user.id, immediate.notifications[0].id);
      await authorizedBefore;
      let releaseSession!: () => void, beganSession!: () => void;
      const sessionWait = new Promise<void>(resolve => { releaseSession = resolve; });
      const sessionEntered = new Promise<void>(resolve => { beganSession = resolve; });
      const delayedDatabase = new Proxy(prisma, { get(target, property) {
        if (property === 'authSession') return new Proxy(target.authSession, { get(delegate, operation) {
          if (operation === 'findUnique') return async (args: Parameters<typeof delegate.findUnique>[0]) => {
            beganSession(); await sessionWait; return delegate.findUnique(args);
          };
          return Reflect.get(delegate, operation);
        } });
        return Reflect.get(target, property);
      } });
      const delayed = new RealtimeDeliveryLifecycle(delayedDatabase, () => [serverSocket], async () => true, () => true, execute);
      let unauthorizedMessages = 0;
      const observe = () => { unauthorizedMessages++; };
      secondSocket.on('notification.created', observe);
      const pendingNotification = delayed.notify(user.id, immediate.notifications[0].id);
      try {
        await sessionEntered;
        await prisma.workspacePermission.update({ where: { id: workspaceGrant.id }, data: { isActive: false } });
        releaseSession();
        await pendingNotification;
        const barrier = new Promise<void>(resolve => secondSocket.once('qa.barrier', resolve));
        serverSocket.emit('qa.barrier');
        await barrier;
        assert.equal(unauthorizedMessages, 0, 'resource authorization must follow the delayed socket session read even when the session and role remain valid');
      } finally {
        releaseSession(); await pendingNotification.catch(() => undefined); await delayed.stop(1000);
        secondSocket.off('notification.created', observe);
        await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
        await prisma.notificationEvent.update({ where: { id: immediate.id }, data: { workspace: null } });
      }
      await prisma.user.update({ where: { id: user.id }, data: { role: 'USER' } });
      await prisma.notificationEvent.update({ where: { id: immediate.id }, data: { workspace: 'sales' } });
      const expiresAt = new Date(Date.now() + 700);
      await prisma.workspacePermission.update({ where: { id: workspaceGrant.id }, data: { isActive: true, expiresAt } });
      let resumeFence!: () => void, enteredFence!: () => void;
      const fenceWait = new Promise<void>(resolve => { resumeFence = resolve; });
      const fenceEntered = new Promise<void>(resolve => { enteredFence = resolve; });
      const observedSnapshots: string[] = [];
      let fenceCalls = 0;
      const expiryDatabase = new Proxy(prisma, { get(target, property) {
        if (property === '$queryRaw') return async (query: any, ...values: any[]) => {
          const snapshotQuery = Array.isArray(query) && query.join('').includes('pg_current_snapshot');
          if (snapshotQuery && ++fenceCalls === 2) { enteredFence(); await fenceWait; }
          const result = await target.$queryRaw(query, ...values) as any[];
          if (snapshotQuery) observedSnapshots.push(result[0].snapshot);
          return result;
        };
        return Reflect.get(target, property);
      } });
      const expiring = new RealtimeDeliveryLifecycle(expiryDatabase, () => [serverSocket], async () => true, () => true, execute);
      let expiredMessages = 0;
      const observeExpiry = () => { expiredMessages++; };
      secondSocket.on('notification.created', observeExpiry);
      const expiringNotification = expiring.notify(user.id, immediate.notifications[0].id);
      try {
        await Promise.race([fenceEntered, expiringNotification.then(() => { throw new Error('Authority expired before final-fence regression was entered'); })]);
        await new Promise(resolve => setTimeout(resolve, Math.max(1, expiresAt.getTime() - Date.now() + 10)));
        resumeFence(); await expiringNotification;
        const barrier = new Promise<void>(resolve => secondSocket.once('qa.expiry-barrier', resolve));
        serverSocket.emit('qa.expiry-barrier'); await barrier;
        assert.equal(observedSnapshots.length, 2);
        assert.equal(observedSnapshots[0], observedSnapshots[1], 'the expiry regression must not rely on a concurrent database commit');
        assert.equal(expiredMessages, 0, 'grant expiry without a database write must suppress emission after the final fence wait');
      } finally {
        resumeFence(); await expiringNotification.catch(() => undefined); await expiring.stop(1000);
        secondSocket.off('notification.created', observeExpiry);
        await prisma.workspacePermission.update({ where: { id: workspaceGrant.id }, data: { isActive: false, expiresAt: null } });
        await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });
        await prisma.notificationEvent.update({ where: { id: immediate.id }, data: { workspace: null } });
      }
      const concurrentSession = await createAuthoritativeSession(prisma, user.id, {});
      const concurrentClient = await open(concurrentSession.token);
      const concurrentSocket = io.sockets.sockets.get(concurrentClient.id)!;
      let resumeResource!: () => void, beganResource!: () => void;
      const resourceWait = new Promise<void>(resolve => { resumeResource = resolve; });
      const resourceEntered = new Promise<void>(resolve => { beganResource = resolve; });
      const resourceDatabase = new Proxy(prisma, { get(target, property) {
        if (property === 'notification') return new Proxy(target.notification, { get(delegate, operation) {
          if (operation === 'findUnique') return async (args: Parameters<typeof delegate.findUnique>[0]) => {
            beganResource(); await resourceWait; return delegate.findUnique(args);
          };
          return Reflect.get(delegate, operation);
        } });
        return Reflect.get(target, property);
      } });
      const resourceLifecycle = new RealtimeDeliveryLifecycle(resourceDatabase, () => [concurrentSocket], async () => true, () => true, execute);
      let messagesAfterRevocation = 0;
      concurrentClient.on('notification.created', () => { messagesAfterRevocation++; });
      const resourcePending = resourceLifecycle.notify(user.id, immediate.notifications[0].id);
      try {
        await resourceEntered;
        await revokeSessions(prisma, { userId: user.id, sessionId: concurrentSession.session.id, reason: 'QA_DURING_RESOURCE_LOOKUP' });
        resumeResource(); await resourcePending;
        const barrier = new Promise<void>(resolve => concurrentClient.once('qa.barrier', resolve));
        concurrentSocket.emit('qa.barrier'); await barrier;
        assert.equal(messagesAfterRevocation, 0, 'revocation during resource authorization must suppress the private event');
      } finally { resumeResource(); await resourcePending.catch(() => undefined); await resourceLifecycle.stop(1000); }
      let invalidations = 0;
      secondSocket.on('hr.changed', () => { invalidations++; });
      waitForAuthorization = true;
      const invalidating = lifecycle.invalidate('hr.changed');
      await entered;
      await assert.rejects(waitForActiveWrites(20), { code: 'RECOVERY_WRITE_DRAIN_TIMEOUT' });
      await revokeSessions(prisma, { userId: user.id, sessionId: secondSession.session.id, reason: 'QA_DURING_AUTHORIZATION' });
      let drained = false;
      const stopping = lifecycle.stop(1000).then(() => { drained = true; });
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(drained, false);
      releaseAuthorization();
      await invalidating;
      await stopping;
      assert.equal(invalidations, 0);
    } finally {
      releaseAuthorization();
      for (const client of clients) client.disconnect();
      await lifecycle.stop(1000);
      await new Promise<void>(resolve => io.close(() => resolve()));
    }
    console.log('NOTIFICATION_SERVICE_DEVICE_ACCEPTANCE_PASSED');
  } finally {
    webPush.sendNotification = originalSend;
    // This subprocess's shared application client belongs solely to the
    // temporary database harness; no long-running runtime imports this fixture.
    await prisma.$disconnect();
    assert.equal(path.dirname(await fs.realpath(coordination)), temporaryParent);
    await fs.rm(coordination, { recursive: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
