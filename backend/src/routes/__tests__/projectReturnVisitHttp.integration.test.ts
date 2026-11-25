import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { createTemporaryConcurrencyDatabase } from '../../services/__tests__/shipmentStatementConcurrency/database';

const sourceDatabaseUrl = process.env.PROJECT_RETURN_TEST_DATABASE_URL;
const admissionPath = '/api/security/canonical-driver-queue';
const visitsPath = '/api/logistics/project-return-visits';

test('Guard return visits are isolated from loading and cancellation records a real exit without a receipt',
  { skip: !sourceDatabaseUrl, timeout: 240_000 }, async () => {
    const isolated = await createTemporaryConcurrencyDatabase({
      repositoryRoot: path.resolve(__dirname, '../../../..'), sourceDatabaseUrl: sourceDatabaseUrl!, migrateEmptySchema: true,
    });
    const db = isolated.client();
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = isolated.databaseUrl;
    let server: Server | undefined;
    let disconnectRuntime: (() => Promise<void>) | undefined;
    try {
      const { disconnectDatabase } = await import('../../lib/prisma');
      disconnectRuntime = disconnectDatabase;
      const { createAuthoritativeSession, SESSION_COOKIE } = await import('../../services/identitySessionService');
      const { default: guardQueueRouter } = await import('../canonical-guard-queue');
      const { default: logisticsRouter } = await import('../logistics');
      const actor = await db.user.create({ data: {
        email: 'return-guard@example.invalid', username: 'return-guard',
        firstName: 'آزمون', lastName: 'مرجوعی', password: 'non-login-fixture', role: 'ADMIN', mustChangePassword: false,
      } });
      const readOnly = await db.user.create({ data: {
        email: 'return-viewer@example.invalid', username: 'return-viewer',
        firstName: 'مشاهده', lastName: 'مرجوعی', password: 'non-login-fixture', role: 'USER', mustChangePassword: false,
      } });
      await db.workspacePermission.createMany({ data: [
        { userId: readOnly.id, workspace: 'security', permissionLevel: 'view' },
        { userId: readOnly.id, workspace: 'logistics', permissionLevel: 'view' },
      ] });
      await db.featurePermission.create({ data: {
        userId: readOnly.id, workspace: 'logistics', feature: 'logistics_stone_returns', permissionLevel: 'view',
      } });

      const now = Date.now();
      const effectiveFrom = new Date(now - 86_400_000);
      const expiresAt = new Date(now + 365 * 86_400_000);
      const customer = await db.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'بارگیری' } });
      const project = await db.projectAddress.create({ data: { customerId: customer.id, projectName: 'بارگیری آزمون', address: 'نشانی آزمون' } });
      const loading = await db.logisticsLoading.create({ data: {
        loadingNumber: 'QA-RETURN-1', customerId: customer.id, projectId: project.id, createdBy: actor.id,
      } });
      const personnel = await db.personnel.create({ data: {
        firstName: 'راننده', lastName: 'داخلی', hrEmploymentRelationships: { create: {
          status: 'ACTIVE', effectiveFrom, createdBy: actor.id,
        } },
      } });
      const internalDriver = await db.internalDriverProfile.create({ data: {
        personnelId: personnel.id, status: 'ACTIVE', licenceNumber: 'internal-return-licence', licenceClass: '1', licenceExpiresAt: expiresAt,
        createdBy: actor.id, eligibilityPeriods: { create: { status: 'ELIGIBLE', effectiveFrom, reason: 'fixture', recordedBy: actor.id } },
      } });
      const companyVehicle = await db.companyVehicle.create({ data: {
        fleetCode: 'RETURN-QA-1', vehicleType: 'کامیون', status: 'ACTIVE', createdBy: actor.id,
        plates: { create: { plate: '12 ب 345 ایران 67', normalizedPlate: '12ب345ایران67', effectiveFrom, reason: 'fixture', recordedBy: actor.id } },
      } });
      await db.driverVehicleAssignment.create({ data: {
        driverId: internalDriver.id, vehicleId: companyVehicle.id, effectiveFrom, reason: 'fixture', recordedBy: actor.id,
      } });
      const externalDriver = await db.externalDriver.create({ data: {
        firstName: 'راننده', lastName: 'بیرونی', nationalCode: '0012345678', phone: '09120000001', status: 'ACTIVE',
        licenceNumber: 'external-return-licence', licenceClass: '1', licenceExpiresAt: expiresAt, createdBy: actor.id,
        documents: { create: { documentType: 'DRIVING_LICENCE', reference: 'fixture', expiresAt, recordedBy: actor.id } },
      } });
      const externalVehicle = await db.externalVehicle.create({ data: {
        vehicleType: 'کامیون', status: 'ACTIVE', createdBy: actor.id,
        plates: { create: { plate: '22 ب 345 ایران 67', normalizedPlate: '22ب345ایران67', effectiveFrom, reason: 'fixture', recordedBy: actor.id } },
        documents: { create: { documentType: 'VEHICLE_REGISTRATION', reference: 'fixture', expiresAt, recordedBy: actor.id } },
      } });
      await db.externalDriverVehicleAssignment.create({ data: {
        driverId: externalDriver.id, vehicleId: externalVehicle.id, effectiveFrom, reason: 'fixture', recordedBy: actor.id,
      } });
      await db.driverBiometricEnrollment.create({ data: {
        externalDriverId: externalDriver.id, status: 'ACTIVE', confirmationPhone: '09120000001', enrolledBy: actor.id,
      } });

      const [editor, viewer] = await Promise.all([actor, readOnly].map(user =>
        createAuthoritativeSession(db, user.id, { ipAddress: '127.0.0.1', userAgent: 'project-return-http-qa' })));
      const app = express();
      app.use(express.json());
      app.use('/api/security', guardQueueRouter);
      app.use('/api/logistics', logisticsRouter);
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve, reject) => server!.once('listening', resolve).once('error', reject));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const call = async (route: string, body?: unknown, token = editor.token) => {
        const response = await fetch(origin + route, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: `${SESSION_COOKIE}=${token}` },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        });
        assert.match(response.headers.get('content-type') || '', /application\/json/, `${route}: HTTP ${response.status}`);
        const payload = await response.json() as { success: boolean; error?: string; data: any; capabilities: { canCancel: boolean } };
        return { ...payload, status: response.status };
      };
      const inputs = [
        { source: 'INTERNAL', driverId: internalDriver.id },
        { source: 'EXTERNAL', driverId: externalDriver.id, vehicleId: externalVehicle.id },
        { source: 'CUSTOMER_PICKUP', vehicleType: 'وانت', plate: '32 ب 345 ایران 67', phone: '09120000002' },
        { source: 'PERSONAL_PICKUP', plate: '42 ب 345 ایران 67' },
      ];
      const turnIds: string[] = [];
      for (const input of inputs) {
        const admitted = await call(admissionPath, { ...input, purpose: 'PROJECT_RETURN' });
        assert.equal(admitted.status, 201, JSON.stringify(admitted));
        assert.equal(admitted.data.driverSource, input.source);
        assert.equal(admitted.data.projectReturnStatus, 'AWAITING_RECEIPT');
        assert.equal(admitted.data.loadingId, null);
        turnIds.push(admitted.data.id);

        const results = await Promise.all([
          call(`/api/logistics/canonical-driver-queue/${admitted.data.id}/reserve`, { loadingId: loading.id }),
          call(`${admissionPath}/${admitted.data.id}/available`, {}),
          call(`${admissionPath}/${admitted.data.id}/close-without-loading`, { reason: 'fixture' }),
          call(`${admissionPath}/${admitted.data.id}/void`, { reason: 'fixture' }),
          call(`${admissionPath}/${admitted.data.id}/project-return-transfer`, {}),
          call(`${admissionPath}/${admitted.data.id}/project-return-complete`, {}),
        ]);
        assert.deepEqual(results.map(item => item.status), [409, 409, 409, 409, 409, 409]);
      }
      assert.deepEqual((await call('/api/logistics/drivers')).data, []);
      assert.equal((await call('/api/logistics/loadings', { projectId: project.id, driverTurnIds: turnIds })).status, 410);
      assert.equal(await db.logisticsLoading.count(), 1);

      const concurrentPickup = { source: 'CUSTOMER_PICKUP', vehicleType: 'وانت', plate: '52 ب 345 ایران 67', phone: '09120000003' };
      const simultaneous = await Promise.all([
        call(admissionPath, { ...concurrentPickup, purpose: 'PROJECT_RETURN' }),
        call(admissionPath, concurrentPickup),
      ]);
      assert.deepEqual(simultaneous.map(item => item.status).sort(), [201, 409]);

      const informal = turnIds[2];
      const queue = await call(visitsPath, undefined, viewer.token);
      assert.equal(queue.status, 200);
      assert.equal(queue.capabilities.canCancel, false);
      assert.ok(turnIds.every(id => queue.data.some((row: { id: string }) => row.id === id)));
      assert.equal((await call(`${visitsPath}/${informal}/cancel`, {}, viewer.token)).status, 403);
      assert.equal((await call(`${admissionPath}/${informal}/project-return-exit`, {})).status, 409);

      const cancelAndReserve = await Promise.all([
        call(`${visitsPath}/${informal}/cancel`, {}),
        call(`/api/logistics/canonical-driver-queue/${informal}/reserve`, { loadingId: loading.id }),
      ]);
      assert.deepEqual(cancelAndReserve.map(item => item.status), [200, 409]);
      assert.equal((await call(`${visitsPath}/${informal}/cancel`, {})).status, 200);
      assert.equal((await call(`${admissionPath}/${informal}/project-return-exit`, {}, viewer.token)).status, 403);
      assert.equal((await call(`${admissionPath}/${informal}/project-return-exit`, {})).status, 200);
      assert.equal((await call(`${admissionPath}/${informal}/project-return-exit`, {})).status, 200);

      const audited = await db.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: informal }, include: { events: true } });
      assert.equal(audited.projectReturnStatus, 'CANCELLED_WITHOUT_DELIVERY');
      assert.equal(audited.status, 'EXIT_RECORDED');
      assert.equal(audited.exitedBy, actor.id);
      assert.ok(audited.exitedAt instanceof Date);
      assert.deepEqual(audited.events.map(item => item.eventType).sort(), [
        'ADMITTED', 'PHYSICAL_EXIT_RECORDED', 'PROJECT_RETURN_CANCELLED_WITHOUT_DELIVERY',
      ]);
      assert.equal(await db.stoneReturnReceipt.count(), 0);
      const newInformal = await call(admissionPath, { ...inputs[2], purpose: 'PROJECT_RETURN' });
      assert.equal(newInformal.status, 201, 'The same plate can be admitted after actual departure');

      const transferIds = [turnIds[0], turnIds[1], newInformal.data.id];
      for (const id of transferIds) {
        assert.equal((await call(`${visitsPath}/${id}/cancel`, {})).status, 200);
        assert.equal((await call(`${admissionPath}/${id}/available`, {})).status, 409);
      }
      const internalTransfer = `${admissionPath}/${transferIds[0]}/project-return-transfer`;
      assert.equal((await call(internalTransfer, {}, viewer.token)).status, 403);
      await db.internalDriverProfile.update({ where: { id: internalDriver.id }, data: { licenceExpiresAt: effectiveFrom } });
      assert.equal((await call(internalTransfer, {})).status, 409);
      await db.internalDriverProfile.update({ where: { id: internalDriver.id }, data: { licenceExpiresAt: expiresAt } });

      const visitsBeforeTransfer = await db.guardDriverQueueTurn.count();
      const movementsBeforeTransfer = await db.securityVehicleMovement.count();
      for (const id of transferIds) {
        const route = `${admissionPath}/${id}`;
        const moved = await call(`${route}/project-return-transfer`, {});
        assert.equal(moved.status, 200, JSON.stringify(moved));
        assert.equal(moved.data.id, id);
        assert.equal(moved.data.status, 'AVAILABLE_FOR_LOADING');
        assert.equal(moved.data.projectReturnStatus, 'CANCELLED_WITHOUT_DELIVERY');
        assert.equal(moved.data.loadingId, null);
        assert.equal(moved.data.exitedAt, null);
        assert.equal((await call(`${route}/project-return-transfer`, {})).status, 200);
        assert.ok((await call('/api/logistics/drivers')).data.some((row: { id: string; queueTurnId?: string }) =>
          row.id === id || row.queueTurnId === id));
        assert.equal((await call(`${route}/return-to-waiting`, { reason: 'fixture' })).status, 200);
        assert.equal((await call(`${route}/project-return-exit`, {})).status, 409);
        assert.equal((await call(`${route}/available`, {})).status, 200);
        assert.equal((await call(`/api/logistics/canonical-driver-queue/${id}/reserve`, { loadingId: loading.id })).status, 200);
        const history = await call(`${route}/events`);
        assert.equal(history.status, 200, JSON.stringify(history));
        assert.equal(history.data.filter((item: { eventType: string }) => item.eventType === 'ADMITTED').length, 1);
        const transfers = history.data.filter((item: { eventType: string }) => item.eventType === 'PROJECT_RETURN_TRANSFERRED_TO_LOADING');
        assert.equal(transfers.length, 1);
        assert.equal(transfers[0].actorId, actor.id);
        assert.equal(transfers[0].fromStatus, 'WAITING_AT_GATE');
        assert.equal(transfers[0].toStatus, 'AVAILABLE_FOR_LOADING');
        assert.ok(!history.data.some((item: { eventType: string }) => item.eventType === 'PHYSICAL_EXIT_RECORDED'));
      }
      assert.equal(await db.guardDriverQueueTurn.count(), visitsBeforeTransfer);
      assert.equal(await db.securityVehicleMovement.count(), movementsBeforeTransfer);
      assert.ok(!(await call(visitsPath)).data.some((row: { id: string }) => transferIds.includes(row.id)));
    } finally {
      try {
        if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
        await disconnectRuntime?.();
      } finally {
        if (previousDatabaseUrl) process.env.DATABASE_URL = previousDatabaseUrl;
        else delete process.env.DATABASE_URL;
        try { await db.$disconnect(); } finally { await isolated.cleanup(); }
      }
    }
  });
