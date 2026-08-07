import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { createAuthoritativeSession, SESSION_COOKIE } from '../src/services/identitySessionService';

const prisma = new PrismaClient();
const port = Number(process.env.DISPATCH_VERIFY_PORT || 5105);
const baseUrl = `http://127.0.0.1:${port}`;
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ids: Record<string, string> = {};

const waitUntilReady = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/api/ready`)).ok) return; } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Verification API did not become ready.');
};

const request = async (token: string, pathname: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}/api/dispatch-master-data${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, ...(init.headers || {}) },
  });
  const body = await response.json();
  return { response, body };
};

const main = async () => {
  assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Verification must target sabalanerp-local PostgreSQL.');
  const admin = await prisma.user.create({ data: { email: `dispatch-admin-${suffix}@example.invalid`, username: `dispatch-admin-${suffix}`, password: 'not-used', firstName: 'Dispatch', lastName: 'Verifier', role: 'ADMIN' } });
  ids.admin = admin.id;
  const viewer = await prisma.user.create({ data: { email: `dispatch-viewer-${suffix}@example.invalid`, username: `dispatch-viewer-${suffix}`, password: 'not-used', firstName: 'Restricted', lastName: 'Verifier', role: 'USER' } });
  ids.viewer = viewer.id;
  const personnel = await prisma.personnel.create({ data: { firstName: 'راننده', lastName: 'آزمایشی', employeeNumber: `DRV-${suffix}` } });
  ids.personnel = personnel.id;
  await prisma.hrEmploymentRelationship.create({ data: { personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: admin.id } });
  const [{ token: adminToken }, { token: viewerToken }] = await Promise.all([
    createAuthoritativeSession(prisma, admin.id, { userAgent: 'dispatch-master-data-verifier' }),
    createAuthoritativeSession(prisma, viewer.id, { userAgent: 'dispatch-master-data-verifier' }),
  ]);

  const server = spawn(process.execPath, [path.resolve('backend/dist/index.js')], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', FRONTEND_URL: 'http://localhost:3000' },
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    await waitUntilReady();
    const forbidden = await request(viewerToken, '/internal-drivers');
    assert.equal(forbidden.response.status, 403, 'generic authenticated users cannot read HR driver master data');

    const driverCreated = await request(adminToken, '/internal-drivers', { method: 'POST', body: JSON.stringify({ personnelId: personnel.id, licenceNumber: `LIC-${suffix}`, effectiveFrom: '2026-01-01', reason: 'API verification designation' }) });
    assert.equal(driverCreated.response.status, 201, JSON.stringify(driverCreated.body));
    ids.driver = driverCreated.body.data.id;
    assert.equal(driverCreated.body.data.source, 'HR_PERSONNEL');
    const profileUpdated = await request(adminToken, `/internal-drivers/${ids.driver}/profile`, { method: 'PUT', body: JSON.stringify({ licenceNumber: `LIC-${suffix}-UPDATED`, licenceClass: 'پایه یک', reason: 'API verification profile correction' }) });
    assert.equal(profileUpdated.response.status, 200, JSON.stringify(profileUpdated.body));
    assert.equal(profileUpdated.body.data.licenceClass, 'پایه یک');

    const vehicleCreated = await request(adminToken, '/company-vehicles', { method: 'POST', body: JSON.stringify({ fleetCode: `FLEET-${suffix}`, vehicleType: 'کامیون', plate: `77ب${suffix.slice(-6)}`, effectiveFrom: '2026-01-01', reason: 'API verification fleet registration' }) });
    assert.equal(vehicleCreated.response.status, 201, JSON.stringify(vehicleCreated.body));
    ids.vehicle = vehicleCreated.body.data.id;

    const assignment = await request(adminToken, '/driver-vehicle-assignments', { method: 'POST', body: JSON.stringify({ driverId: ids.driver, vehicleId: ids.vehicle, effectiveFrom: '2026-01-02', reason: 'API verification assignment' }) });
    assert.equal(assignment.response.status, 201, JSON.stringify(assignment.body));

    const drivers = await request(adminToken, '/internal-drivers?at=2026-08-07T00:00:00.000Z');
    assert.equal(drivers.response.status, 200);
    assert.equal(drivers.body.data.find((item: any) => item.id === ids.driver)?.readiness.status, 'READY');

    const suspension = await request(adminToken, `/internal-drivers/${ids.driver}/eligibility`, { method: 'POST', body: JSON.stringify({ status: 'SUSPENDED', effectiveFrom: '2026-08-08', reason: 'API verification suspension' }) });
    assert.equal(suspension.response.status, 200, JSON.stringify(suspension.body));
    const reinstatement = await request(adminToken, `/internal-drivers/${ids.driver}/eligibility`, { method: 'POST', body: JSON.stringify({ status: 'ELIGIBLE', effectiveFrom: '2026-08-09', reason: 'API verification reinstatement' }) });
    assert.equal(reinstatement.response.status, 200, JSON.stringify(reinstatement.body));
    assert.equal(reinstatement.body.data.eligibilityPeriods.length, 3, 'eligibility transitions preserve all periods');

    const externalDriver = await request(adminToken, '/external-drivers', { method: 'POST', body: JSON.stringify({ firstName: 'راننده', lastName: 'متفرقه', nationalCode: `${Date.now()}`.slice(-10), phone: '09120000000' }) });
    assert.equal(externalDriver.response.status, 201, JSON.stringify(externalDriver.body));
    ids.externalDriver = externalDriver.body.data.id;

    const conflictingExternalVehicle = await request(adminToken, '/external-vehicles', { method: 'POST', body: JSON.stringify({ vehicleType: 'کامیون متفرقه', plate: vehicleCreated.body.data.plates[0].plate, effectiveFrom: '2026-01-02', reason: 'Cross-registry collision proof' }) });
    assert.equal(conflictingExternalVehicle.response.status, 409, 'the same effective plate cannot exist in company and external registries');
    const externalVehicle = await request(adminToken, '/external-vehicles', { method: 'POST', body: JSON.stringify({ vehicleType: 'کامیون متفرقه', plate: `88ج${suffix.slice(-6)}`, effectiveFrom: '2026-01-02', reason: 'External registry verification' }) });
    assert.equal(externalVehicle.response.status, 201, JSON.stringify(externalVehicle.body));
    ids.externalVehicle = externalVehicle.body.data.id;
    const externalPlate = await request(adminToken, `/external-vehicles/${ids.externalVehicle}/plates`, { method: 'POST', body: JSON.stringify({ plate: `89ج${suffix.slice(-6)}`, effectiveFrom: '2026-08-01', reason: 'External plate history verification' }) });
    assert.equal(externalPlate.response.status, 201, JSON.stringify(externalPlate.body));
    const externalVehicleSuspended = await request(adminToken, `/external-vehicles/${ids.externalVehicle}/status`, { method: 'POST', body: JSON.stringify({ status: 'OUT_OF_SERVICE', reason: 'External lifecycle verification' }) });
    assert.equal(externalVehicleSuspended.response.status, 200, JSON.stringify(externalVehicleSuspended.body));

    const audits = await request(adminToken, `/audit/INTERNAL_DRIVER/${ids.driver}`);
    assert.equal(audits.response.status, 200);
    assert.ok(audits.body.data.length >= 4);
    audits.body.data.forEach((event: any, index: number) => assert.equal(event.previousHash, index ? audits.body.data[index - 1].eventHash : null));
    console.log('Dispatch master-data API/database verification passed.');
  } finally {
    server.kill();
  }
};

main().finally(async () => {
  if (ids.driver) {
    await prisma.dispatchMasterDataAudit.deleteMany({ where: { OR: [{ subjectId: ids.driver }, { subjectId: ids.vehicle }, { subjectId: ids.externalDriver }, { subjectId: ids.externalVehicle }] } });
    await prisma.driverVehicleAssignment.deleteMany({ where: { driverId: ids.driver } });
    await prisma.internalDriverEligibilityPeriod.deleteMany({ where: { driverId: ids.driver } });
    await prisma.internalDriverProfile.deleteMany({ where: { id: ids.driver } });
  }
  if (ids.vehicle) { await prisma.companyVehiclePlate.deleteMany({ where: { vehicleId: ids.vehicle } }); await prisma.companyVehicle.deleteMany({ where: { id: ids.vehicle } }); }
  if (ids.externalDriver) await prisma.externalDriver.deleteMany({ where: { id: ids.externalDriver } });
  if (ids.externalVehicle) { await prisma.externalVehiclePlate.deleteMany({ where: { vehicleId: ids.externalVehicle } }); await prisma.externalVehicle.deleteMany({ where: { id: ids.externalVehicle } }); }
  if (ids.personnel) { await prisma.hrEmploymentRelationship.deleteMany({ where: { personnelId: ids.personnel } }); await prisma.personnel.deleteMany({ where: { id: ids.personnel } }); }
  if (ids.admin || ids.viewer) {
    const userIds = [ids.admin, ids.viewer].filter(Boolean);
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.recognizedBrowserProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });
