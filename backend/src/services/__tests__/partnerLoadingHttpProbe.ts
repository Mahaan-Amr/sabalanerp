import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../lib/prisma';
import logisticsRouter from '../../routes/logistics';
import guardRouter from '../../routes/canonical-guard-queue';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';

// The real mounted router and application-owned client, against only the
// parent's isolated schema. Fixture writes establish identities, not results.
async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' ||
      !/^\/sabalanerp_concurrency_[a-f0-9]{16}$/.test(url.pathname)) throw new Error('Isolated local test DB required');
  const actorId = process.env.PARTNER_TEST_ACTOR_ID!;
  const expected = JSON.parse(process.env.PARTNER_TEST_OWNER!);
  try {
    const session = await createAuthoritativeSession(prisma, actorId, { ipAddress: '127.0.0.1', userAgent: 'isolated-334-loading' });
    const app = express(); app.use(express.json()); app.use('/api/logistics', logisticsRouter);
    app.use('/api/security', guardRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const request = async (path: string, method = 'GET', body?: unknown, token = session.token, key = `${expected.caseId}-http-loading`) => {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path.startsWith('/api/') ? path : `/api/logistics${path}`}`, {
          method, headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token}`,
            'Idempotency-Key': key, 'X-Correlation-Id': `${expected.caseId}-http-loading` },
          ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() as any };
      };
      const payload = { sourceKind: 'PARTNER_CASE', expected, deliveryId: 'second-delivery',
        reason: 'ثبت بارگیری از مسیر اصلی لجستیک' };
      const created = await request('/loadings', 'POST', payload);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const loadingId = created.body.data.loadingId;
      assert.equal(typeof loadingId, 'string');
      const reopened = await request(`/loadings/${loadingId}`);
      assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
      assert.equal(reopened.body.data.source.recipient.destination, 'محل دوم مشتری');
      assert.equal(reopened.body.data.source.rows[0].plannedQuantity, '0.750');
      assert.equal((await request('/loadings', 'POST', payload)).body.data.loadingId, loadingId);
      const outsiderId = `${expected.caseId}-unscoped-logistics`;
      await prisma.user.create({ data: { id: outsiderId, username: outsiderId, email: `${outsiderId}@example.invalid`,
        password: 'not-a-login', firstName: 'Unscoped', lastName: 'Logistics' } });
      await prisma.workspacePermission.create({ data: { userId: outsiderId, workspace: 'logistics', permissionLevel: 'admin' } });
      const outsider = await createAuthoritativeSession(prisma, outsiderId, { ipAddress: '127.0.0.1', userAgent: 'isolated-334-loading' });
      const hidden = await request(`/loadings/${loadingId}`, 'GET', undefined, outsider.token);
      assert.equal(hidden.status, 404, JSON.stringify(hidden.body));
      const list = await request('/loadings', 'GET', undefined, outsider.token);
      assert.equal(list.status, 200, JSON.stringify(list.body));
      assert.equal(JSON.stringify(list.body).includes(loadingId), false, 'ordinary Logistics permission does not expose a private Case loading');
      const dashboard = await request('/dashboard', 'GET', undefined, outsider.token);
      assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
      assert.equal(dashboard.body.data.metrics.drafts, 0, 'dashboard counts are scoped before aggregation');
      for (const attempt of [
        { path: `/loadings/${loadingId}`, method: 'PUT', body: { notes: 'unscoped replacement', lines: [] } },
        { path: `/loadings/${loadingId}/cancel`, method: 'POST', body: { reason: 'unscoped cancellation' } },
        { path: `/loadings/${loadingId}`, method: 'DELETE' },
      ]) {
        const result = await request(attempt.path, attempt.method, attempt.body, outsider.token);
        assert.equal(result.status, 404, `${attempt.method} ${attempt.path}: ${JSON.stringify(result.body)}`);
      }
      assert.equal((await request(`/loadings/${loadingId}`)).body.data.status, 'DRAFT');
      const driver = await prisma.externalDriver.create({ data: { firstName: 'Loading', lastName: 'Fixture',
        nationalCode: '3340000000', phone: '09120003340', status: 'ACTIVE', statusRecordedBy: actorId, createdBy: actorId,
        documents: { create: { documentType: 'DRIVING_LICENCE', reference: 'isolated-334-driver', recordedBy: actorId } } } });
      const vehicle = await prisma.externalVehicle.create({ data: { vehicleType: 'Isolated loading fixture', status: 'ACTIVE',
        statusRecordedBy: actorId, createdBy: actorId,
        plates: { create: { plate: '334-test', normalizedPlate: '334test', effectiveFrom: new Date(), reason: 'isolated fixture', recordedBy: actorId } },
        documents: { create: { documentType: 'VEHICLE_REGISTRATION', reference: 'isolated-334-vehicle', recordedBy: actorId } } } });
      const admission = await request('/api/security/canonical-driver-queue', 'POST', { source: 'EXTERNAL', driverId: driver.id, vehicleId: vehicle.id });
      assert.equal(admission.status, 201, JSON.stringify(admission.body));
      const turnId = admission.body.data.id;
      assert.equal((await request(`/api/security/canonical-driver-queue/${turnId}/available`, 'POST', {})).status, 200);
      const reservePath = `/canonical-driver-queue/${turnId}/reserve`;
      const reservation = { loadingId, expected, reason: 'رزرو راننده برای تحویل مستقیم مشتری پرونده' };
      const deniedReservation = await request(reservePath, 'POST', reservation, outsider.token);
      assert.equal(deniedReservation.status, 404, 'an ordinary driver-management grant cannot reserve a private Case loading');
      const reserved = await request(reservePath, 'POST', reservation);
      assert.equal(reserved.status, 200, JSON.stringify(reserved.body));
      assert.equal(reserved.body.data.status, 'RESERVED_FOR_LOADING');
      const allocationPath = `/loadings/${loadingId}/canonical-allocations/${turnId}`;
      const allocation = { expected, reason: 'تخصیص بخشی از تحویل انتخاب‌شده به راننده',
        lines: [{ sourceKind: 'PARTNER_CASE', productRowId: reopened.body.data.source.rows[0].productRowId,
          quantity: '0.500', unit: reopened.body.data.source.rows[0].unit }] };
      const allocated = await request(allocationPath, 'PUT', allocation);
      assert.equal(allocated.status, 200, JSON.stringify(allocated.body));
      assert.equal(allocated.body.data.lines.length, 1);
      assert.equal(allocated.body.data.lines[0].sourceKind, 'PARTNER_CASE');
      assert.equal(allocated.body.data.lines[0].sourceContractItemId, null);
      assert.equal(allocated.body.data.lines[0].sourceContractId, null);
      assert.equal(allocated.body.data.lines[0].partnerDeliveryId, 'second-delivery');
      assert.equal(Number(allocated.body.data.lines[0].quantity), 0.5);
      const allocationReopened = await request(`/loadings/${loadingId}`);
      assert.equal(allocationReopened.body.data.allocations[0].lines[0].quantity, '0.500',
        'reopening the actual loading retains the driver allocation');
      const blockedFinalization = await request(`/loadings/${loadingId}/finalize`, 'POST', { expected,
        reason: 'نهایی‌سازی تحویل پرونده همکار' }, session.token, `${expected.caseId}-finalize-before-approval`);
      assert.equal(blockedFinalization.status, 409, JSON.stringify(blockedFinalization.body));
      assert.match(blockedFinalization.body.error, /تأیید مالی/,
        'physical allocation cannot finalize before the official wholesale approval is published');
      assert.equal((await request(allocationPath, 'PUT', { ...allocation, reason: { invalid: true } })).status, 400,
        'malformed audit context is rejected as input, not a technical failure');
      const releasePath = `/canonical-driver-queue/${turnId}/release`;
      const release = { loadingId, reason: 'آزادسازی رزرو پیش از تخصیص بار' };
      assert.equal((await request(releasePath, 'POST', release, outsider.token)).status, 404,
        'a Logistics workspace grant alone cannot release another Case reservation');
      await prisma.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: true } });
      try {
        const released = await request(releasePath, 'POST', release);
        assert.equal(released.status, 200, JSON.stringify(released.body));
        assert.equal(released.body.data.status, 'AVAILABLE_FOR_LOADING', 'a pause cannot prevent authorized release of an existing reservation');
      } finally {
        await prisma.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: false } });
      }
      const secondLoading = await request('/loadings', 'POST', payload, session.token, `${expected.caseId}-second-loading`);
      assert.equal(secondLoading.status, 201, JSON.stringify(secondLoading.body));
      const secondLoadingId = secondLoading.body.data.loadingId;
      assert.equal((await request(reservePath, 'POST', { ...reservation, loadingId: secondLoadingId })).status, 200);
      const otherDraft = await request(`/loadings/${secondLoadingId}/canonical-allocations/${turnId}`, 'PUT', allocation);
      assert.equal(otherDraft.status, 200, JSON.stringify(otherDraft.body));
      const retained = await request(`/loadings/${loadingId}`);
      assert.equal(retained.body.data.allocations.length, 1,
        'reusing a released queue turn must not move or erase the prior loading allocation intent');
      assert.equal(retained.body.data.allocations[0].id, allocated.body.data.id);
      assert.equal(retained.body.data.allocations[0].reservationActive, false);
      assert.notEqual(otherDraft.body.data.id, allocated.body.data.id);
      assert.equal((await request(releasePath, 'POST', { ...release, loadingId: secondLoadingId })).status, 200);
      await prisma.workspacePermission.create({ data: { userId: outsiderId, workspace: 'security', permissionLevel: 'edit' } });
      const privateHistory = await request('/api/security/canonical-driver-queue?history=true', 'GET', undefined, outsider.token);
      assert.equal(privateHistory.status, 200, JSON.stringify(privateHistory.body));
      assert.equal(JSON.stringify(privateHistory.body).includes(loadingId), false,
        'clearing the live loading link must not expose private Case IDs through retained queue history');
      assert.equal(JSON.stringify(privateHistory.body).includes(JSON.stringify(expected.caseId)), false);
      assert.equal(privateHistory.body.data.some((turn: { id: string }) => turn.id === turnId), true,
        'the physical driver visit remains visible to Guard independently of private Case association');
      await prisma.effectiveActionGrant.create({ data: { id: `${outsiderId}-guard-read`, principalKind: 'USER',
        principalId: outsiderId, subjectUserId: outsiderId, domain: 'PARTNER', action: 'FULFILLMENT_READ', rootKind: 'CASE',
        purpose: 'FULFILLMENT', scope: 'PURPOSE_BOUND', boundRootId: expected.caseId, effect: 'ALLOW', grantedBy: actorId,
        reason: 'isolated Guard scope fixture', correlationId: `${outsiderId}-guard-read` } });
      const guardHistory = () => request('/api/security/canonical-driver-queue?history=true', 'GET', undefined, outsider.token);
      assert.equal(JSON.stringify((await guardHistory()).body).includes(loadingId), true, 'current Guard and Case authority permit retained association');
      let waiting: ReturnType<typeof guardHistory> | undefined;
      try {
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM partner_operations_controls WHERE id = 'partner-operations' FOR UPDATE`;
          waiting = guardHistory();
          let blocked = false;
          const deadline = Date.now() + 3000;
          while (Date.now() < deadline) {
            await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
            const waits = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
              WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
                AND query LIKE '%partner_operations_controls%'`;
            if (Number(waits[0].count)) { blocked = true; break; }
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          assert.equal(blocked, true, 'Guard history passed route preflight and reached its scoped read lock');
          await tx.workspacePermission.update({ where: { userId_workspace: { userId: outsiderId, workspace: 'security' } }, data: { isActive: false } });
        });
        const revoked = await waiting!;
        assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
        assert.equal(JSON.stringify(revoked.body).includes(loadingId), false,
          'Guard workspace revocation committed during a read wait invalidates private history authority');
      } finally { await waiting; }
      await prisma.workspacePermission.update({ where: { userId_workspace: { userId: outsiderId, workspace: 'security' } }, data: { isActive: true } });
      assert.equal((await request(reservePath, 'POST', reservation)).status, 200);
      for (const operation of ['close-without-loading', 'void']) {
        const denied = await request(`/api/security/canonical-driver-queue/${turnId}/${operation}`, 'POST',
          { reason: 'آزمون منع آزادسازی بدون مجوز پرونده' }, outsider.token);
        assert.equal(denied.status, 403, `${operation} must require Case write authority, not only Guard and Case read access`);
      }
      await prisma.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: true } });
      try {
        const closed = await request(`/api/security/canonical-driver-queue/${turnId}/close-without-loading`, 'POST',
          { reason: 'خروج بدون بار در توقف عملیاتی' });
        assert.equal(closed.status, 200, JSON.stringify(closed.body));
        assert.equal(closed.body.data.status, 'CLOSED_WITHOUT_LOADING');
      } finally { await prisma.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: false } }); }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally { await prisma.$disconnect(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
