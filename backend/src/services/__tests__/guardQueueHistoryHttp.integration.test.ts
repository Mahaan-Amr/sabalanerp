import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import type { GuardDriverQueueTurnStatus } from '@prisma/client';
import express from 'express';
import { prisma } from '../../lib/prisma';
import router from '../../routes/canonical-guard-queue';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';

test('Guard live queue, historical pages and selected event timeline preserve scope and order', {
  skip: !process.env.DATABASE_URL,
}, async () => {
  const target = new URL(process.env.DATABASE_URL!);
  assert.ok(['127.0.0.1:55432', 'localhost:55432'].includes(target.host));
  assert.match(target.pathname, /^\/sabalanerp_concurrency_[a-f0-9]{16}$/);
  const [database] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(target.pathname, `/${database.name}`);

  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    const createActor = async (id: string, permission?: 'view' | 'edit') => {
      await prisma.user.create({ data: {
        id, username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Guard', lastName: 'Tester', role: 'USER',
      } });
      if (permission) await prisma.workspacePermission.create({ data: { userId: id, workspace: 'security', permissionLevel: permission } });
      return (await createAuthoritativeSession(prisma, id, {})).token;
    };
    const guard = await createActor('guard-read-editor', 'edit');
    const viewer = await createActor('guard-read-viewer', 'view');
    const denied = await createActor('guard-read-outsider');
    const customer = await prisma.crmCustomer.create({ data: { firstName: 'Guard', lastName: 'Fixture' } });
    const project = await prisma.projectAddress.create({ data: { customerId: customer.id, address: 'Guard fixture' } });
    const loading = await prisma.logisticsLoading.create({ data: { loadingNumber: 'guard-read-fixture',
      customerId: customer.id, projectId: project.id, createdBy: 'guard-read-editor' } });
    const createTurn = (id: string, status: GuardDriverQueueTurnStatus, admittedAt: string, personal = false) =>
      prisma.guardDriverQueueTurn.create({ data: {
        id, status, admittedAt: new Date(admittedAt), admittedBy: 'guard-read-editor', integrityHash: id,
        driverSource: personal ? 'PERSONAL_PICKUP' : 'CUSTOMER_PICKUP',
        loadingId: personal ? loading.id : null,
        admissionSnapshot: { kind: personal ? 'PERSONAL_PICKUP_SELECTION' : 'ADMISSION',
          driver: { firstName: 'Visit', lastName: id }, plate: { plate: '123456', normalizedPlate: id } },
      } });
    await createTurn('active-a', 'WAITING_AT_GATE', '2026-11-21T08:00:00Z');
    await createTurn('active-b', 'AVAILABLE_FOR_LOADING', '2026-11-21T08:00:00Z');
    await createTurn('history-a', 'CLOSED_WITHOUT_LOADING', '2026-11-20T08:00:00Z');
    await createTurn('history-b', 'VOIDED', '2026-11-20T08:00:00Z');
    await createTurn('history-personal', 'EXIT_RECORDED', '2026-11-22T08:00:00Z', true);
    await prisma.guardDriverQueueEvent.createMany({ data: [
      { id: 'event-b', turnId: 'history-b', eventHash: 'history-event-b', eventType: 'VOIDED', toStatus: 'VOIDED',
        recordedAt: new Date('2026-11-20T09:00:00Z'), actorId: 'guard-read-editor', payload: {}, reason: 'correction evidence' },
      { id: 'event-a', turnId: 'history-b', eventHash: 'history-event-a', eventType: 'ADMITTED', toStatus: 'WAITING_AT_GATE',
        recordedAt: new Date('2026-11-20T09:00:00Z'), actorId: 'guard-read-editor', payload: {} },
      { id: 'other-event', turnId: 'history-a', eventHash: 'other-history-event', eventType: 'ADMITTED', toStatus: 'WAITING_AT_GATE',
        recordedAt: new Date('2026-11-20T08:00:00Z'), actorId: 'guard-read-editor', payload: {} },
    ] });

    const app = express();
    app.use('/api/security', router);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/security/canonical-driver-queue`;
    const read = async (path: string, token?: string) => {
      const response = await fetch(`${base}${path}`, { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} });
      return { status: response.status, body: await response.json() as any };
    };

    assert.equal((await read('')).status, 401);
    assert.equal((await read('?history=true', denied)).status, 403);
    assert.equal((await read('/history-b/events', denied)).status, 403);

    const active = await read('', guard);
    assert.equal(active.status, 200);
    assert.deepEqual(active.body.data.map((turn: { id: string }) => turn.id), ['active-a', 'active-b']);
    assert.ok(active.body.data.every((turn: object) => !('events' in turn)));

    for (const [page, id] of [[1, 'history-b'], [2, 'history-a']] as const) {
      const history = await read(`?history=true&page=${page}&pageSize=1`, guard);
      assert.equal(history.status, 200);
      assert.deepEqual(history.body.pagination, { page, pageSize: 1, total: 2 });
      assert.deepEqual(history.body.data.map((turn: { id: string }) => turn.id), [id]);
      assert.ok(!('events' in history.body.data[0]));
    }
    assert.equal((await read('?history=true&pageSize=1000', guard)).status, 400);
    assert.equal((await read('/history-personal/events', guard)).status, 404);

    const details = await read('/history-b/events', guard);
    assert.equal(details.status, 200);
    assert.deepEqual(details.body.data.map((event: { id: string }) => event.id), ['event-a', 'event-b']);
    assert.equal(details.body.data[1].reason, 'correction evidence');
    const limited = await read('/history-b/events', viewer);
    assert.equal(limited.status, 200);
    assert.deepEqual(limited.body.data.map((event: { id: string }) => event.id), ['event-a', 'event-b']);
    assert.equal(limited.body.data[1].reason, undefined);
    assert.equal(limited.body.data[1].actorId, undefined);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
});
