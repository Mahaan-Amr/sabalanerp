import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createAuthoritativeSession, SESSION_COOKIE } from '../src/services/identitySessionService';

const prisma = new PrismaClient();
const baseUrl = 'http://127.0.0.1:5000';
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids: Record<string, string> = {};

const request = async (token: string, pathname: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, ...(init.headers || {}) },
  });
  let body: any = null;
  try { body = await response.json(); } catch { /* empty */ }
  return { response, body };
};

const main = async () => {
  assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Verification must target sabalanerp-local PostgreSQL.');
  const guard = await prisma.user.create({ data: {
    email: `guard-queue-${suffix}@example.invalid`, username: `guard-queue-${suffix}`, password: 'not-used',
    firstName: 'Guard', lastName: 'Verifier', role: 'ADMIN',
  } });
  ids.guard = guard.id;
  const legacyPair = await prisma.securityVehiclePair.create({ data: {
    firstName: 'Legacy', lastName: 'Driver', vehiclePlate: `LEG-${suffix.slice(-5)}`, vehicleType: 'TRUCK',
    phone: '09121111111', nationalCode: `8${Date.now()}`.slice(-10), createdBy: guard.id,
  } });
  ids.legacyPair = legacyPair.id;
  const legacyTurn = await prisma.securityDriverQueueTurn.create({ data: { vehiclePairId: legacyPair.id, enteredBy: guard.id, status: 'OUT_OF_QUEUE', removedAt: new Date(), removedBy: guard.id, removalReason: 'Legacy cutover evidence' } });
  ids.legacyTurn = legacyTurn.id;
  const logistics = await prisma.user.create({ data: {
    email: `logistics-queue-${suffix}@example.invalid`, username: `logistics-queue-${suffix}`, password: 'not-used',
    firstName: 'Logistics', lastName: 'Verifier', role: 'USER',
  } });
  ids.logistics = logistics.id;
  const unauthorized = await prisma.user.create({ data: {
    email: `queue-unauthorized-${suffix}@example.invalid`, username: `queue-unauthorized-${suffix}`, password: 'not-used',
    firstName: 'Unauthorized', lastName: 'Verifier', role: 'USER',
  } });
  ids.unauthorized = unauthorized.id;
  const viewOnly = await prisma.user.create({ data: {
    email: `queue-view-${suffix}@example.invalid`, username: `queue-view-${suffix}`, password: 'not-used',
    firstName: 'View', lastName: 'Only', role: 'USER',
  } });
  ids.viewOnly = viewOnly.id;
  await prisma.workspacePermission.create({ data: { userId: viewOnly.id, workspace: 'security', permissionLevel: 'view', grantedBy: guard.id } });
  await prisma.workspacePermission.create({ data: { userId: logistics.id, workspace: 'logistics', permissionLevel: 'edit', grantedBy: guard.id } });
  await prisma.featurePermission.create({ data: { userId: logistics.id, workspace: 'logistics', feature: 'logistics_drivers_view', permissionLevel: 'view', grantedBy: guard.id } });
  const personnel = await prisma.personnel.create({ data: { firstName: 'Internal', lastName: 'Driver', employeeNumber: `QUEUE-${suffix}` } });
  ids.personnel = personnel.id;
  await prisma.hrEmploymentRelationship.create({ data: { personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'), createdBy: guard.id } });
  const driver = await prisma.internalDriverProfile.create({ data: {
    personnelId: personnel.id, licenceNumber: `LIC-${suffix}`, licenceClass: 'CLASS_ONE', licenceExpiresAt: new Date('2027-12-31'),
    status: 'ACTIVE', createdBy: guard.id,
  } });
  ids.driver = driver.id;
  await prisma.internalDriverEligibilityPeriod.create({ data: { driverId: driver.id, status: 'ELIGIBLE', effectiveFrom: new Date('2026-01-01'), reason: 'Queue verification', recordedBy: guard.id } });
  const vehicle = await prisma.companyVehicle.create({ data: { fleetCode: `FLEET-${suffix}`, vehicleType: 'TRUCK', status: 'ACTIVE', createdBy: guard.id } });
  ids.vehicle = vehicle.id;
  const plate = await prisma.companyVehiclePlate.create({ data: { vehicleId: vehicle.id, plate: `77ب${suffix.slice(-5)}`, normalizedPlate: `77B${suffix.slice(-5)}`, effectiveFrom: new Date('2026-01-01'), reason: 'Queue verification', recordedBy: guard.id } });
  await prisma.driverVehicleAssignment.create({ data: { driverId: driver.id, vehicleId: vehicle.id, effectiveFrom: new Date('2026-01-01'), reason: 'Queue verification', recordedBy: guard.id } });
  const customer = await prisma.crmCustomer.create({ data: { firstName: 'Queue', lastName: 'Customer' } });
  ids.customer = customer.id;
  const project = await prisma.projectAddress.create({ data: { customerId: customer.id, address: 'Queue verification project' } });
  ids.project = project.id;
  const loading = await prisma.logisticsLoading.create({ data: { loadingNumber: `QUEUE-${suffix}`, customerId: customer.id, projectId: project.id, createdBy: logistics.id } });
  ids.loading = loading.id;
  const externalDriver = await prisma.externalDriver.create({ data: { firstName: 'External', lastName: 'Driver', nationalCode: `${Date.now()}`.slice(-10), phone: '09120000000', status: 'ACTIVE', createdBy: guard.id } });
  ids.externalDriver = externalDriver.id;
  await prisma.externalDriverDocument.create({ data: { driverId: externalDriver.id, documentType: 'DRIVING_LICENCE', reference: `EXT-LIC-${suffix}`, expiresAt: new Date('2027-12-31'), recordedBy: guard.id } });
  const externalVehicle = await prisma.externalVehicle.create({ data: { vehicleType: 'TRUCK', status: 'ACTIVE', createdBy: guard.id } });
  ids.externalVehicle = externalVehicle.id;
  const externalPlate = await prisma.externalVehiclePlate.create({ data: { vehicleId: externalVehicle.id, plate: `88ج${suffix.slice(-5)}`, normalizedPlate: `88C${suffix.slice(-5)}`, effectiveFrom: new Date('2026-01-01'), reason: 'Queue verification', recordedBy: guard.id } });
  await prisma.externalVehicleDocument.create({ data: { vehicleId: externalVehicle.id, documentType: 'VEHICLE_REGISTRATION', reference: `EXT-REG-${suffix}`, expiresAt: new Date('2027-12-31'), recordedBy: guard.id } });
  const token = (await createAuthoritativeSession(prisma, guard.id, { userAgent: 'guard-queue-verifier' })).token;
  const logisticsToken = (await createAuthoritativeSession(prisma, logistics.id, { userAgent: 'guard-queue-verifier' })).token;
  const unauthorizedToken = (await createAuthoritativeSession(prisma, unauthorized.id, { userAgent: 'guard-queue-verifier' })).token;
  const viewOnlyToken = (await createAuthoritativeSession(prisma, viewOnly.id, { userAgent: 'guard-queue-verifier' })).token;

  try {
    assert.equal((await fetch(`${baseUrl}/api/ready`)).status, 200, 'sabalanerp-local backend must be ready on port 5000');
    assert.equal((await request(unauthorizedToken, '/api/security/canonical-driver-queue')).response.status, 403);
    assert.equal((await request(unauthorizedToken, '/api/security/canonical-driver-queue', { method: 'POST', body: JSON.stringify({ source: 'INTERNAL', driverId: driver.id }) })).response.status, 403);
    const admitted = await request(token, '/api/security/canonical-driver-queue', { method: 'POST', body: JSON.stringify({ source: 'INTERNAL', driverId: driver.id }) });
    assert.equal(admitted.response.status, 201, JSON.stringify(admitted.body));
    assert.equal(admitted.body.data.status, 'WAITING_AT_GATE');
    assert.equal(admitted.body.data.driverSource, 'INTERNAL');
    assert.equal(admitted.body.data.driverId, driver.id);
    assert.equal(admitted.body.data.vehicleId, vehicle.id);
    assert.equal(admitted.body.data.admissionSnapshot.plate.id, plate.id);
    assert.equal(admitted.body.data.admissionSnapshot.readiness.status, 'READY');
    assert.match(admitted.body.data.integrityHash, /^[a-f0-9]{64}$/);
    const redacted = await request(viewOnlyToken, '/api/security/canonical-driver-queue');
    assert.equal(redacted.response.status, 200);
    assert.equal(redacted.body.capabilities.canEdit, false);
    assert.equal(redacted.body.data[0].redacted, true);
    assert.equal(redacted.body.data[0].admissionSnapshot.driver.nationalCode, undefined);
    assert.equal(redacted.body.data[0].admissionSnapshot.documents, undefined);
    assert.equal((await request(viewOnlyToken, '/api/security/canonical-driver-queue/admission-options')).response.status, 403);
    assert.equal((await request(viewOnlyToken, `/api/security/canonical-driver-queue/${admitted.body.data.id}/available`, { method: 'POST', body: '{}' })).response.status, 403);
    await assert.rejects(
      prisma.guardDriverQueueTurn.update({ where: { id: admitted.body.data.id }, data: { admissionSnapshot: { tampered: true } } }),
      /immutable/i,
    );
    const available = await request(token, `/api/security/canonical-driver-queue/${admitted.body.data.id}/available`, { method: 'POST', body: '{}' });
    assert.equal(available.response.status, 200, JSON.stringify(available.body));
    assert.equal(available.body.data.status, 'AVAILABLE_FOR_LOADING');
    assert.equal(available.body.data.integrityHash, admitted.body.data.integrityHash, 'lifecycle changes cannot rewrite the admission snapshot hash');
    assert.equal(await prisma.guardDriverQueueEvent.count({ where: { turnId: admitted.body.data.id } }), 2);
    assert.equal((await request(logisticsToken, `/api/logistics/canonical-driver-queue/${admitted.body.data.id}/reserve`, { method: 'POST', body: JSON.stringify({ loadingId: loading.id }) })).response.status, 403);
    await prisma.featurePermission.create({ data: { userId: logistics.id, workspace: 'logistics', feature: 'logistics_drivers_manage', permissionLevel: 'edit', grantedBy: guard.id } });
    const reserved = await request(logisticsToken, `/api/logistics/canonical-driver-queue/${admitted.body.data.id}/reserve`, { method: 'POST', body: JSON.stringify({ loadingId: loading.id }) });
    assert.equal(reserved.response.status, 200, JSON.stringify(reserved.body));
    assert.equal(reserved.body.data.status, 'RESERVED_FOR_LOADING');
    assert.equal(reserved.body.data.loadingId, loading.id);
    assert.equal(reserved.body.data.reservedBy, logistics.id);
    const released = await request(logisticsToken, `/api/logistics/canonical-driver-queue/${admitted.body.data.id}/release`, { method: 'POST', body: JSON.stringify({ loadingId: loading.id, reason: 'Loading plan changed' }) });
    assert.equal(released.response.status, 200, JSON.stringify(released.body));
    assert.equal(released.body.data.status, 'AVAILABLE_FOR_LOADING');
    assert.equal(released.body.data.loadingId, null);
    const releaseEvent = await prisma.guardDriverQueueEvent.findFirstOrThrow({ where: { turnId: admitted.body.data.id, eventType: 'RESERVATION_RELEASED' } });
    assert.equal(releaseEvent.reason, 'Loading plan changed');
    await assert.rejects(prisma.guardDriverQueueEvent.update({ where: { id: releaseEvent.id }, data: { reason: 'tampered' } }), /append-only/i);
    await assert.rejects(prisma.guardDriverQueueEvent.delete({ where: { id: releaseEvent.id } }), /append-only/i);
    const waitingAgain = await request(token, `/api/security/canonical-driver-queue/${admitted.body.data.id}/return-to-waiting`, { method: 'POST', body: JSON.stringify({ reason: 'Driver returned to gate waiting area' }) });
    assert.equal(waitingAgain.response.status, 200, JSON.stringify(waitingAgain.body));
    assert.equal(waitingAgain.body.data.status, 'WAITING_AT_GATE');
    assert.equal(waitingAgain.body.data.integrityHash, admitted.body.data.integrityHash);
    const duplicateOpenVisit = await request(token, '/api/security/canonical-driver-queue', { method: 'POST', body: JSON.stringify({ source: 'INTERNAL', driverId: driver.id }) });
    assert.equal(duplicateOpenVisit.response.status, 409, JSON.stringify(duplicateOpenVisit.body));
    const closed = await request(token, `/api/security/canonical-driver-queue/${admitted.body.data.id}/close-without-loading`, { method: 'POST', body: JSON.stringify({ reason: 'Driver departed before loading' }) });
    assert.equal(closed.response.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.data.status, 'CLOSED_WITHOUT_LOADING');
    assert.equal(closed.body.data.closureReason, 'Driver departed before loading');
    const repeatVisit = await request(token, '/api/security/canonical-driver-queue', { method: 'POST', body: JSON.stringify({ source: 'INTERNAL', driverId: driver.id }) });
    assert.equal(repeatVisit.response.status, 201, JSON.stringify(repeatVisit.body));
    const voided = await request(token, `/api/security/canonical-driver-queue/${repeatVisit.body.data.id}/void`, { method: 'POST', body: JSON.stringify({ reason: 'Admission entered by mistake' }) });
    assert.equal(voided.response.status, 200, JSON.stringify(voided.body));
    assert.equal(voided.body.data.status, 'VOIDED');
    assert.equal(voided.body.data.voidReason, 'Admission entered by mistake');
    assert.equal(await prisma.guardDriverQueueTurn.count({ where: { id: repeatVisit.body.data.id } }), 1, 'voiding preserves the queue turn');

    const admissionOptions = await request(token, '/api/security/canonical-driver-queue/admission-options');
    assert.equal(admissionOptions.response.status, 200, JSON.stringify(admissionOptions.body));
    assert.ok(admissionOptions.body.data.internalAssignments.some((option: any) => option.driverId === driver.id && option.vehicleId === vehicle.id));
    assert.ok(admissionOptions.body.data.externalDrivers.some((option: any) => option.id === externalDriver.id));
    assert.ok(admissionOptions.body.data.externalVehicles.some((option: any) => option.id === externalVehicle.id));

    const externalAdmitted = await request(token, '/api/security/canonical-driver-queue', { method: 'POST', body: JSON.stringify({ source: 'EXTERNAL', driverId: externalDriver.id, vehicleId: externalVehicle.id }) });
    assert.equal(externalAdmitted.response.status, 201, JSON.stringify(externalAdmitted.body));
    assert.equal(externalAdmitted.body.data.driverSource, 'EXTERNAL');
    assert.equal(externalAdmitted.body.data.driverId, externalDriver.id);
    assert.equal(externalAdmitted.body.data.vehicleId, externalVehicle.id);
    assert.equal(externalAdmitted.body.data.admissionSnapshot.plate.id, externalPlate.id);
    assert.deepEqual(externalAdmitted.body.data.admissionSnapshot.documents.map((document: any) => document.type).sort(), ['DRIVING_LICENCE', 'VEHICLE_REGISTRATION']);
    const currentQueue = await request(token, '/api/security/canonical-driver-queue');
    assert.equal(currentQueue.response.status, 200, JSON.stringify(currentQueue.body));
    assert.ok(currentQueue.body.data.some((turn: any) => turn.id === externalAdmitted.body.data.id));
    assert.equal(currentQueue.body.data.some((turn: any) => [admitted.body.data.id, repeatVisit.body.data.id].includes(turn.id)), false);
    const canonicalHistory = await request(token, '/api/security/canonical-driver-queue?history=true');
    assert.equal(canonicalHistory.response.status, 200, JSON.stringify(canonicalHistory.body));
    assert.ok(canonicalHistory.body.data.some((turn: any) => turn.status === 'CLOSED_WITHOUT_LOADING'));
    assert.ok(canonicalHistory.body.data.some((turn: any) => turn.status === 'VOIDED'));
    assert.ok(canonicalHistory.body.data.every((turn: any) => turn.events.length > 0));
    const legacyHistory = await request(token, '/api/security/driver-queue?history=true');
    assert.equal(legacyHistory.response.status, 200, JSON.stringify(legacyHistory.body));
    assert.ok(legacyHistory.body.data.some((turn: any) => turn.id === legacyTurn.id && turn.historicalOnly === true));
    const externalAvailable = await request(token, `/api/security/canonical-driver-queue/${externalAdmitted.body.data.id}/available`, { method: 'POST', body: '{}' });
    assert.equal(externalAvailable.response.status, 200, JSON.stringify(externalAvailable.body));
    const sharedPool = await request(logisticsToken, '/api/logistics/drivers');
    assert.equal(sharedPool.response.status, 200, JSON.stringify(sharedPool.body));
    assert.ok(sharedPool.body.data.some((option: any) => option.id === externalAdmitted.body.data.id && option.canonicalQueueStatus === 'AVAILABLE_FOR_LOADING' && option.queueStatus === 'ENTERED_LOADING_AREA'));
    await prisma.externalVehicle.update({ where: { id: externalVehicle.id }, data: { status: 'RESTRICTED' } });
    assert.equal((await request(logisticsToken, '/api/logistics/drivers')).body.data.some((option: any) => option.id === externalAdmitted.body.data.id), false);
    assert.equal((await request(logisticsToken, `/api/logistics/canonical-driver-queue/${externalAdmitted.body.data.id}/reserve`, { method: 'POST', body: JSON.stringify({ loadingId: loading.id }) })).response.status, 409);
    await prisma.externalVehicle.update({ where: { id: externalVehicle.id }, data: { status: 'ACTIVE' } });
    const competingReservations = await Promise.all([
      request(logisticsToken, `/api/logistics/canonical-driver-queue/${externalAdmitted.body.data.id}/reserve`, { method: 'POST', body: JSON.stringify({ loadingId: loading.id }) }),
      request(logisticsToken, `/api/logistics/canonical-driver-queue/${externalAdmitted.body.data.id}/reserve`, { method: 'POST', body: JSON.stringify({ loadingId: loading.id }) }),
    ]);
    assert.deepEqual(competingReservations.map((result) => result.response.status).sort(), [200, 409]);
    assert.equal(await prisma.guardDriverQueueEvent.count({ where: { turnId: externalAdmitted.body.data.id, eventType: 'RESERVED_FOR_LOADING' } }), 1);
    const reservedDeparture = await request(token, `/api/security/canonical-driver-queue/${externalAdmitted.body.data.id}/close-without-loading`, { method: 'POST', body: JSON.stringify({ reason: 'Driver departed while reserved' }) });
    assert.equal(reservedDeparture.response.status, 200, JSON.stringify(reservedDeparture.body));
    assert.equal(reservedDeparture.body.data.status, 'CLOSED_WITHOUT_LOADING');
    assert.equal(reservedDeparture.body.data.loadingId, null);
    assert.equal(await prisma.guardDriverQueueEvent.count({ where: { turnId: externalAdmitted.body.data.id, eventType: 'RESERVATION_RELEASED_FOR_DEPARTURE' } }), 1);
    const eventChain = await prisma.guardDriverQueueEvent.findMany({ where: { turnId: externalAdmitted.body.data.id }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
    eventChain.forEach((event, index) => assert.equal(event.previousHash, index ? eventChain[index - 1].eventHash : null));
  } finally { /* cleanup runs below */ }
};

main().finally(async () => prisma.$transaction(async (cleanup) => {
  // Canonical visits and their master-data evidence intentionally remain: the production chain is append-only.
  if (ids.loading) await cleanup.logisticsLoading.deleteMany({ where: { id: ids.loading } });
  if (ids.project) await cleanup.projectAddress.deleteMany({ where: { id: ids.project } });
  if (ids.customer) await cleanup.crmCustomer.deleteMany({ where: { id: ids.customer } });
  if (ids.legacyTurn) await cleanup.securityDriverQueueTurn.deleteMany({ where: { id: ids.legacyTurn } });
  if (ids.legacyPair) await cleanup.securityVehiclePair.deleteMany({ where: { id: ids.legacyPair } });
  if (ids.guard) await cleanup.authSession.deleteMany({ where: { userId: ids.guard } });
  if (ids.logistics) await cleanup.authSession.deleteMany({ where: { userId: ids.logistics } });
  if (ids.unauthorized) await cleanup.authSession.deleteMany({ where: { userId: ids.unauthorized } });
  if (ids.viewOnly) await cleanup.authSession.deleteMany({ where: { userId: ids.viewOnly } });
  if (ids.logistics) await cleanup.workspacePermission.deleteMany({ where: { userId: ids.logistics } });
  if (ids.viewOnly) await cleanup.workspacePermission.deleteMany({ where: { userId: ids.viewOnly } });
  if (ids.logistics) await cleanup.featurePermission.deleteMany({ where: { userId: ids.logistics } });
  if (ids.logistics) await cleanup.user.deleteMany({ where: { id: ids.logistics } });
  if (ids.unauthorized) await cleanup.user.deleteMany({ where: { id: ids.unauthorized } });
  if (ids.viewOnly) await cleanup.user.deleteMany({ where: { id: ids.viewOnly } });
  if (ids.guard) await cleanup.user.deleteMany({ where: { id: ids.guard } });
})).finally(() => prisma.$disconnect());
