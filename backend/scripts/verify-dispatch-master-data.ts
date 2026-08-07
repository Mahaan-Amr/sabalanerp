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
    try { if ((await fetch(`${baseUrl}/api/ready`)).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Verification API did not become ready.');
};
const request = async (token: string, pathname: string, init: RequestInit = {}) => {
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`, ...(init.headers || {}) } });
  let body: any = null; try { body = await response.json(); } catch { /* empty */ }
  return { response, body };
};
const master = (token: string, pathname: string, init: RequestInit = {}) => request(token, `/api/dispatch-master-data${pathname}`, init);
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

const main = async () => {
  assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Verification must target sabalanerp-local PostgreSQL.');
  const createUser = async (kind: string, role = 'USER') => prisma.user.create({ data: { email: `dispatch-${kind}-${suffix}@example.invalid`, username: `dispatch-${kind}-${suffix}`, password: 'not-used', firstName: kind, lastName: 'Verifier', role: role as any } });
  const admin = await createUser('admin', 'ADMIN'); ids.admin = admin.id;
  const viewer = await createUser('viewer'); ids.viewer = viewer.id;
  const hrUser = await createUser('hr'); ids.hrUser = hrUser.id;
  const fleetUser = await createUser('fleet'); ids.fleetUser = fleetUser.id;
  const guardUser = await createUser('guard'); ids.guardUser = guardUser.id;
  await prisma.featurePermission.createMany({ data: [
    { userId: hrUser.id, workspace: 'hr', feature: 'hr_internal_drivers_view', permissionLevel: 'edit', grantedBy: admin.id },
    { userId: hrUser.id, workspace: 'hr', feature: 'hr_internal_drivers_manage', permissionLevel: 'edit', grantedBy: admin.id },
    { userId: fleetUser.id, workspace: 'hr', feature: 'hr_vehicle_operations_view', permissionLevel: 'edit', grantedBy: admin.id },
    { userId: fleetUser.id, workspace: 'hr', feature: 'hr_vehicle_operations_manage', permissionLevel: 'edit', grantedBy: admin.id },
    { userId: guardUser.id, workspace: 'security', feature: 'security_external_drivers_view', permissionLevel: 'edit', grantedBy: admin.id },
    { userId: guardUser.id, workspace: 'security', feature: 'security_external_drivers_manage', permissionLevel: 'edit', grantedBy: admin.id },
  ] });
  const personnel = await prisma.personnel.create({ data: { firstName: 'Dispatch', lastName: 'Driver', employeeNumber: `DRV-${suffix}` } }); ids.personnel = personnel.id;
  await prisma.hrEmploymentRelationship.create({ data: { personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: admin.id } });
  const tokens = Object.fromEntries(await Promise.all([admin, viewer, hrUser, fleetUser, guardUser].map(async (user) => [user.id, (await createAuthoritativeSession(prisma, user.id, { userAgent: 'dispatch-master-data-verifier' })).token])));

  const server = spawn(process.execPath, [path.resolve('dist/index.js')], { env: { ...process.env, PORT: String(port), NODE_ENV: 'development', FRONTEND_URL: 'http://localhost:3000' }, stdio: 'ignore', windowsHide: true });
  try {
    await waitUntilReady();
    assert.equal((await master(tokens[viewer.id], '/internal-drivers')).response.status, 403);

    const driverCreated = await master(tokens[hrUser.id], '/internal-drivers', json('POST', { personnelId: personnel.id, licenceNumber: 'must-be-ignored', effectiveFrom: '2026-01-01', reason: 'HR designation' }));
    assert.equal(driverCreated.response.status, 201, JSON.stringify(driverCreated.body)); ids.driver = driverCreated.body.data.id;
    assert.equal(driverCreated.body.data.licenceNumber, null, 'HR designation cannot write Vehicle Operations fields');
    assert.equal((await master(tokens[hrUser.id], `/internal-drivers/${ids.driver}/profile`, json('PUT', { licenceNumber: 'forbidden', reason: 'authority proof' }))).response.status, 403);
    assert.equal((await master(tokens[fleetUser.id], `/internal-drivers/${ids.driver}/eligibility`, json('POST', { status: 'SUSPENDED', effectiveFrom: '2026-02-01', reason: 'authority proof' }))).response.status, 403);

    const incompleteDrivers = await master(tokens[fleetUser.id], '/vehicle-operations/internal-drivers?at=2026-08-07T00:00:00.000Z');
    assert.deepEqual(incompleteDrivers.body.data[0].readiness.blockers.slice(0, 5), ['DRIVING_PROFILE_INACTIVE', 'LICENCE_NUMBER_MISSING', 'LICENCE_CLASS_MISSING', 'LICENCE_EXPIRY_MISSING', 'VEHICLE_NOT_ASSIGNED']);
    assert.equal((await master(tokens[fleetUser.id], `/internal-drivers/${ids.driver}/profile`, json('PUT', { licenceNumber: 'LIC-INVALID', licenceClass: 'CLASS_ONE', licenceExpiresAt: 'not-a-date', reason: 'Invalid expiry proof' }))).response.status, 400);
    const profile = await master(tokens[fleetUser.id], `/internal-drivers/${ids.driver}/profile`, json('PUT', { licenceNumber: `LIC-${suffix}`, licenceClass: 'CLASS_ONE', licenceExpiresAt: '2027-12-31', reason: 'Profile completion' }));
    assert.equal(profile.response.status, 200, JSON.stringify(profile.body));
    assert.equal((await master(tokens[fleetUser.id], `/internal-drivers/${ids.driver}/profile-status`, json('POST', { status: 'ACTIVE', reason: 'Profile readiness verified' }))).response.status, 200);

    const vehicle = await master(tokens[fleetUser.id], '/company-vehicles', json('POST', { fleetCode: `FLEET-${suffix}`, vehicleType: 'TRUCK', plate: `77B${suffix.slice(-6)}`, effectiveFrom: '2026-01-01', reason: 'Fleet draft' }));
    assert.equal(vehicle.response.status, 201, JSON.stringify(vehicle.body)); ids.vehicle = vehicle.body.data.id; assert.equal(vehicle.body.data.status, 'DRAFT');
    assert.equal((await master(tokens[fleetUser.id], `/company-vehicles/${ids.vehicle}/status`, json('POST', { status: 'ACTIVE', effectiveFrom: '2026-01-01', reason: 'Fleet activation' }))).response.status, 200);
    const disposableVehicle = await master(tokens[fleetUser.id], '/company-vehicles', json('POST', { fleetCode: `TEMP-${suffix}`, vehicleType: 'TRUCK', plate: `66T${suffix.slice(-6)}`, effectiveFrom: '2026-01-01', reason: 'Lifecycle proof draft' }));
    assert.equal(disposableVehicle.response.status, 201); ids.disposableVehicle = disposableVehicle.body.data.id;
    assert.equal((await master(tokens[fleetUser.id], `/company-vehicles/${ids.disposableVehicle}/status`, json('POST', { status: 'ACTIVE', effectiveFrom: '2026-01-01', reason: 'Lifecycle proof activation' }))).response.status, 200);
    assert.equal((await master(tokens[fleetUser.id], `/company-vehicles/${ids.disposableVehicle}/status`, json('POST', { status: 'ARCHIVED', effectiveFrom: '2026-08-01', reason: 'Lifecycle proof archive' }))).response.status, 200);
    assert.equal((await master(tokens[fleetUser.id], `/company-vehicles/${ids.disposableVehicle}/status`, json('POST', { status: 'DRAFT', effectiveFrom: '2026-08-02', reason: 'Lifecycle proof restore' }))).response.status, 200);
    assert.equal((await master(tokens[fleetUser.id], `/company-vehicles/${ids.disposableVehicle}`, json('DELETE', { reason: 'Unused restored draft cleanup' }))).response.status, 200);
    assert.equal((await master(tokens[fleetUser.id], '/driver-vehicle-assignments', json('POST', { driverId: ids.driver, vehicleId: ids.vehicle, effectiveFrom: '2026-01-02', reason: 'Operational assignment' }))).response.status, 201);
    const ready = await master(tokens[fleetUser.id], '/vehicle-operations/internal-drivers?at=2026-08-07T00:00:00.000Z');
    assert.deepEqual(ready.body.data.find((item: any) => item.id === ids.driver).readiness, { status: 'READY', blockers: [] });

    await master(tokens[hrUser.id], `/internal-drivers/${ids.driver}/eligibility`, json('POST', { status: 'SUSPENDED', effectiveFrom: '2026-08-08', reason: 'HR suspension' }));
    const reinstated = await master(tokens[hrUser.id], `/internal-drivers/${ids.driver}/eligibility`, json('POST', { status: 'ELIGIBLE', effectiveFrom: '2026-08-09', reason: 'HR reinstatement' }));
    assert.equal(reinstated.body.data.eligibilityPeriods.length, 3);

    const externalDriver = await master(tokens[guardUser.id], '/external-drivers', json('POST', { firstName: 'External', lastName: 'Driver', nationalCode: `${Date.now()}`.slice(-10), phone: '09120000000', reason: 'External draft' }));
    assert.equal(externalDriver.response.status, 201, JSON.stringify(externalDriver.body)); ids.externalDriver = externalDriver.body.data.id; assert.equal(externalDriver.body.data.status, 'DRAFT');
    assert.equal((await master(tokens[guardUser.id], `/external-drivers/${ids.externalDriver}/status`, json('POST', { status: 'ACTIVE', effectiveFrom: '2026-01-01', reason: 'Identity checked' }))).response.status, 200);

    const collision = await master(tokens[guardUser.id], '/external-vehicles', json('POST', { vehicleType: 'TRUCK', plate: vehicle.body.data.plates[0].plate, effectiveFrom: '2026-01-02', reason: 'Collision proof' }));
    assert.equal(collision.response.status, 409);
    const externalVehicle = await master(tokens[guardUser.id], '/external-vehicles', json('POST', { vehicleType: 'TRUCK', plate: `88C${suffix.slice(-6)}`, effectiveFrom: '2026-01-02', reason: 'External vehicle draft' }));
    assert.equal(externalVehicle.response.status, 201, JSON.stringify(externalVehicle.body)); ids.externalVehicle = externalVehicle.body.data.id;
    assert.equal((await master(tokens[guardUser.id], `/external-vehicles/${ids.externalVehicle}/status`, json('POST', { status: 'ACTIVE', effectiveFrom: '2026-01-02', reason: 'Vehicle checked' }))).response.status, 200);
    const restricted = await master(tokens[guardUser.id], `/external-vehicles/${ids.externalVehicle}/status`, json('POST', { status: 'RESTRICTED', effectiveFrom: '2026-08-02', reason: 'Accountable restriction evidence' }));
    assert.equal(restricted.response.status, 200); assert.equal(restricted.body.data.statusReason, 'Accountable restriction evidence');
    assert.equal((await master(tokens[guardUser.id], `/external-drivers/${ids.externalDriver}/status`, json('POST', { status: 'ARCHIVED', effectiveFrom: '2026-08-03', reason: 'Archive lifecycle proof' }))).response.status, 200);
    assert.equal((await master(tokens[guardUser.id], `/external-drivers/${ids.externalDriver}/status`, json('POST', { status: 'DRAFT', effectiveFrom: '2026-08-04', reason: 'Restore lifecycle proof' }))).response.status, 200);
    const disposable = await master(tokens[guardUser.id], '/external-drivers', json('POST', { firstName: 'Disposable', lastName: 'Draft', nationalCode: `9${Date.now()}`.slice(-10), phone: '09121111111', reason: 'Deletion proof' }));
    assert.equal(disposable.response.status, 201); ids.disposableDriver = disposable.body.data.id;
    assert.equal((await master(tokens[guardUser.id], `/external-drivers/${ids.disposableDriver}`, json('DELETE', { reason: 'Unused draft cleanup proof' }))).response.status, 200);
    assert.equal(await prisma.externalDriver.count({ where: { id: ids.disposableDriver } }), 0);

    const hrAudit = await master(tokens[hrUser.id], `/audit/hr/internal-driver/${ids.driver}`); assert.equal(hrAudit.response.status, 200); assert.ok(hrAudit.body.data.every((event: any) => event.ownerScope === 'HR'));
    const fleetAudit = await master(tokens[fleetUser.id], `/audit/vehicle-operations/INTERNAL_DRIVER_PROFILE/${ids.driver}`); assert.equal(fleetAudit.response.status, 200); assert.ok(fleetAudit.body.data.every((event: any) => event.ownerScope === 'VEHICLE_OPERATIONS'));
    assert.equal((await master(tokens[hrUser.id], `/audit/guard/EXTERNAL_DRIVER/${ids.externalDriver}`)).response.status, 403);
    assert.equal((await master(tokens[guardUser.id], `/audit/hr/internal-driver/${ids.driver}`)).response.status, 403);
    assert.equal((await master(tokens[hrUser.id], `/audit/vehicle-operations/INTERNAL_DRIVER_PROFILE/${ids.driver}`)).response.status, 403);
    assert.equal((await master(tokens[guardUser.id], `/audit/guard/EXTERNAL_DRIVER/${ids.externalDriver}`)).response.status, 200);

    assert.equal((await request(tokens[admin.id], '/api/security/vehicle-pairs', json('POST', {}))).response.status, 410);
    assert.equal((await request(tokens[admin.id], '/api/security/vehicle-pairs/legacy-id', json('PUT', {}))).response.status, 410);
    assert.equal((await request(tokens[admin.id], '/api/security/vehicle-pairs/legacy-id', json('DELETE', {}))).response.status, 410);
    assert.equal((await request(tokens[admin.id], '/api/security/vehicle-pairs/legacy-id/photos', json('POST', {}))).response.status, 410);
    assert.equal((await request(tokens[admin.id], '/api/security/vehicle-pairs/legacy-id/photos/photo-id', json('DELETE', {}))).response.status, 410);
    assert.equal((await request(tokens[admin.id], '/api/security/driver-queue', json('POST', { vehiclePairId: 'legacy' }))).response.status, 410);
    assert.equal((await request(tokens[admin.id], '/api/security/driver-queue/legacy-turn/enter-loading-area', json('POST', {}))).response.status, 410);
    assert.equal((await request(tokens[admin.id], '/api/security/loading-driver-requests/legacy-request/assign', json('POST', { queueTurnId: 'legacy-turn' }))).response.status, 410);
    assert.equal((await request(tokens[admin.id], '/api/security/vehicle-movements/inbound', json('POST', { purpose: 'OUTSIDE_PURCHASE', vehiclePairId: 'legacy-pair' }))).response.status, 410);
    console.log('Dispatch master-data API/database verification passed.');
  } finally { server.kill(); }
};

main().finally(async () => {
  const subjects = [ids.driver, ids.vehicle, ids.disposableVehicle, ids.externalDriver, ids.externalVehicle, ids.disposableDriver].filter(Boolean);
  if (subjects.length) await prisma.dispatchMasterDataAudit.deleteMany({ where: { subjectId: { in: subjects } } });
  if (ids.driver) { await prisma.driverVehicleAssignment.deleteMany({ where: { driverId: ids.driver } }); await prisma.internalDriverEligibilityPeriod.deleteMany({ where: { driverId: ids.driver } }); await prisma.internalDriverProfile.deleteMany({ where: { id: ids.driver } }); }
  if (ids.vehicle) { await prisma.companyVehiclePlate.deleteMany({ where: { vehicleId: ids.vehicle } }); await prisma.companyVehicle.deleteMany({ where: { id: ids.vehicle } }); }
  if (ids.externalDriver) { await prisma.externalDriverPersonnelContinuityLink.deleteMany({ where: { externalDriverId: ids.externalDriver } }); await prisma.externalDriver.deleteMany({ where: { id: ids.externalDriver } }); }
  if (ids.externalVehicle) { await prisma.externalVehiclePlate.deleteMany({ where: { vehicleId: ids.externalVehicle } }); await prisma.externalVehicle.deleteMany({ where: { id: ids.externalVehicle } }); }
  if (ids.personnel) { await prisma.hrEmploymentRelationship.deleteMany({ where: { personnelId: ids.personnel } }); await prisma.personnel.deleteMany({ where: { id: ids.personnel } }); }
  const userIds = [ids.admin, ids.viewer, ids.hrUser, ids.fleetUser, ids.guardUser].filter(Boolean);
  if (userIds.length) { await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } }); await prisma.recognizedBrowserProfile.deleteMany({ where: { userId: { in: userIds } } }); await prisma.user.deleteMany({ where: { id: { in: userIds } } }); }
  await prisma.$disconnect();
}).catch((error) => { console.error(error); process.exitCode = 1; });
