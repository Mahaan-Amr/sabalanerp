import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { executeDispatchCutover, recordDispatchCriticalFailure, recordDispatchPilotResumeApproval,
  runDispatchCutoverRehearsal, PilotSafetyPauseError, resumeDispatchPilot } from '../src/services/dispatchCutover';
import { createAuthoritativeSession, SESSION_COOKIE } from '../src/services/identitySessionService';
import { admitGuardDriverQueueTurn } from '../src/services/guardDriverQueue';
import { createHash, randomUUID } from 'node:crypto';

const prisma = new PrismaClient();
const main = async () => {
  assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Verification must target sabalanerp-local PostgreSQL.');
  const actor = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
  assert.ok(actor, 'An active local admin is required.');
  if (process.env.CUTOVER_VERIFY_SKIP_HTTP !== '1') {
    assert.equal((await fetch('http://127.0.0.1:5000/api/dispatch-cases?workspace=security')).status, 401);
    const session = await createAuthoritativeSession(prisma, actor.id, { userAgent: 'dispatch-cutover-verifier' });
    const headers = { cookie: `${SESSION_COOKIE}=${encodeURIComponent(session.token)}` };
    for (const workspace of ['hr', 'vehicle-operations', 'security', 'logistics', 'accounting']) {
      const timelineResponse = await fetch(`http://127.0.0.1:5000/api/dispatch-cases?workspace=${workspace}`, { headers });
      assert.equal(timelineResponse.status, 200, `${workspace}: ${await timelineResponse.text()}`);
    }
    const cutoverResponse = await fetch('http://127.0.0.1:5000/api/dispatch-cutover', { headers });
    assert.equal(cutoverResponse.status, 200, await cutoverResponse.text());
    const denied = await prisma.user.create({ data: { email: `dispatch-case-denied-${randomUUID()}@example.invalid`, username: `dispatch-case-denied-${randomUUID()}`,
      password: 'not-used', firstName: 'Denied', lastName: 'Timeline', role: 'USER' } });
    await prisma.workspacePermission.create({ data: { userId: denied.id, workspace: 'security', permissionLevel: 'view', grantedBy: actor.id } });
    const deniedSession = await createAuthoritativeSession(prisma, denied.id, { userAgent: 'dispatch-case-denied-verifier' });
    assert.equal((await fetch('http://127.0.0.1:5000/api/dispatch-cases?workspace=security', { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(deniedSession.token)}` } })).status, 403);
  }
  const operatorSpecs = [
    { key: 'hr', workspace: 'hr', feature: 'hr_internal_drivers_view' },
    { key: 'vehicleOperations', workspace: 'hr', feature: 'hr_vehicle_operations_view' },
    { key: 'guard', workspace: 'security', feature: 'security_dispatch_evidence_view' },
    { key: 'logistics', workspace: 'logistics', feature: 'logistics_loadings_view' },
    { key: 'accounting', workspace: 'accounting', feature: 'accounting_dispatch_candidates_view' },
  ] as const;
  const operators: Record<string, string> = {};
  for (const spec of operatorSpecs) {
    const user = await prisma.user.create({ data: { email: `cutover-${spec.key}-${randomUUID()}@example.invalid`, username: `cutover-${spec.key}-${randomUUID()}`,
      password: 'not-used', firstName: spec.key, lastName: 'Rehearsal Operator', role: 'USER' } });
    await prisma.workspacePermission.create({ data: { userId: user.id, workspace: spec.workspace, permissionLevel: 'edit', grantedBy: actor.id } });
    await prisma.featurePermission.create({ data: { userId: user.id, workspace: spec.workspace, feature: spec.feature, permissionLevel: 'view', grantedBy: actor.id } });
    operators[spec.key] = user.id;
  }
  const runRehearsal = (rehearsalType: 'CORRECTNESS' | 'TIMED_DRESS') => runDispatchCutoverRehearsal(prisma, {
    rehearsalType, actorId: actor.id, operators: operators as any,
    ...(rehearsalType === 'TIMED_DRESS' ? { runbook: { owner: actor.id, supportContact: 'local-cutover-support', rollbackOwner: actor.id,
      plannedDowntimeMinutes: 5, observedDurationSeconds: 30 } } : {}),
  });
  const state = await prisma.dispatchCutoverControl.findUniqueOrThrow({ where: { id: 'dispatch' } });
  assert.ok(['PRE_CUTOVER', 'ROLLED_BACK'].includes(state.phase), `Verifier requires a pre-admission cutover phase, received ${state.phase}.`);
  const suffix = randomUUID();
  const personnel = await prisma.personnel.create({ data: { firstName: 'Cutover', lastName: 'Admission', employeeNumber: `CUT-${suffix}` } });
  await prisma.hrEmploymentRelationship.create({ data: { personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01'), createdBy: actor.id } });
  const driver = await prisma.internalDriverProfile.create({ data: { personnelId: personnel.id, licenceNumber: `CUT-LIC-${suffix}`,
    licenceClass: 'CLASS_ONE', licenceExpiresAt: new Date('2028-01-01'), status: 'ACTIVE', createdBy: actor.id } });
  await prisma.internalDriverEligibilityPeriod.create({ data: { driverId: driver.id, status: 'ELIGIBLE', effectiveFrom: new Date('2026-01-01'), reason: 'Cutover admission verification', recordedBy: actor.id } });
  const vehicle = await prisma.companyVehicle.create({ data: { fleetCode: `CUT-${suffix}`, vehicleType: 'TRUCK', status: 'ACTIVE', createdBy: actor.id } });
  await prisma.companyVehiclePlate.create({ data: { vehicleId: vehicle.id, plate: `CUT-${suffix.slice(0, 8)}`, normalizedPlate: `CUT${suffix.slice(0, 8)}`,
    effectiveFrom: new Date('2026-01-01'), reason: 'Cutover admission verification', recordedBy: actor.id } });
  await prisma.driverVehicleAssignment.create({ data: { driverId: driver.id, vehicleId: vehicle.id, effectiveFrom: new Date('2026-01-01'), reason: 'Cutover admission verification', recordedBy: actor.id } });

  const pairs = await prisma.securityVehiclePair.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  const reviewedPairIds = new Set((await prisma.legacyDriverVehicleDisposition.findMany({ select: { legacyPairId: true } })).map((item) => item.legacyPairId));
  assert.ok(pairs.every((pair) => reviewedPairIds.has(pair.id)), 'Every legacy pair must be explicitly reviewed before running the verifier; the verifier never manufactures dispositions.');
  const unhealthy = await prisma.shipmentQuantityProjection.findMany({ where: { health: { not: 'CURRENT' } },
    select: { contractItemId: true, health: true, healthReasons: true } });
  if (unhealthy.length) {
    const failed = await runRehearsal('CORRECTNESS');
    assert.equal(failed.status, 'FAILED');
    await assert.rejects(executeDispatchCutover(prisma, { actorId: actor.id }), /latest gates|two successful|matching/i);
  }

  // Prior verifier fixtures can intentionally retain conflict projections. Temporarily isolate them from this rehearsal and restore them below.
  for (const row of unhealthy) await prisma.shipmentQuantityProjection.update({ where: { contractItemId: row.contractItemId }, data: { health: 'CURRENT', healthReasons: [] } });
  try {
    const correctness = await runRehearsal('CORRECTNESS');
    const dress = await runRehearsal('TIMED_DRESS');
    assert.equal(correctness.status, 'PASSED'); assert.equal(dress.status, 'PASSED');
    const activeBefore = await prisma.securityDriverQueueTurn.findMany({ where: { status: { in: ['WAITING', 'ENTERED_LOADING_AREA', 'RESERVED'] } }, select: { id: true, status: true, loadingId: true, driverRequestId: true } });
    const finalizedBefore = await prisma.securityDriverQueueTurn.findMany({ where: { status: 'DISPATCHED' }, select: { id: true, dispatchedAt: true }, orderBy: { id: 'asc' } });
    const live = await executeDispatchCutover(prisma, { actorId: actor.id });
    assert.equal(live.phase, 'CANONICAL_LIVE'); assert.equal(live.legacyWritesEnabled, false);
    assert.equal(await prisma.securityDriverQueueTurn.count({ where: { id: { in: activeBefore.map((item) => item.id) }, status: { in: ['WAITING', 'ENTERED_LOADING_AREA', 'RESERVED'] } } }), 0);
    assert.deepEqual(await prisma.securityDriverQueueTurn.findMany({ where: { status: 'DISPATCHED' }, select: { id: true, dispatchedAt: true }, orderBy: { id: 'asc' } }), finalizedBefore);
    await assert.rejects(prisma.securityVehiclePair.update({ where: { id: pairs[0].id }, data: { notes: 'blocked legacy write' } }), /legacy combined dispatch writes are disabled/i);
    const rolledBack = await recordDispatchCriticalFailure(prisma, { actorId: actor.id, reason: 'Verifier failure before first canonical admission', evidence: { rehearsal: true } });
    assert.equal(rolledBack.phase, 'ROLLED_BACK'); assert.equal(rolledBack.legacyWritesEnabled, true);
    for (const before of activeBefore) {
      const restored = await prisma.securityDriverQueueTurn.findUniqueOrThrow({ where: { id: before.id } });
      assert.equal(restored.status, before.status); assert.equal(restored.loadingId, before.loadingId); assert.equal(restored.driverRequestId, before.driverRequestId);
    }
    const correctnessAfterRollback = await runRehearsal('CORRECTNESS');
    const dressAfterRollback = await runRehearsal('TIMED_DRESS');
    assert.equal(correctnessAfterRollback.status, 'PASSED'); assert.equal(dressAfterRollback.status, 'PASSED');
    await executeDispatchCutover(prisma, { actorId: actor.id });
    const admitted = await admitGuardDriverQueueTurn(prisma, { source: 'INTERNAL', driverId: driver.id, actorId: actor.id });
    const boundary = await prisma.dispatchCutoverControl.findUniqueOrThrow({ where: { id: 'dispatch' } });
    assert.ok(boundary.firstCanonicalAdmissionAt); assert.equal(boundary.legacyWritesEnabled, false);
    const paused = await recordDispatchCriticalFailure(prisma, { actorId: actor.id, reason: 'Verifier critical failure after canonical admission', evidence: { admittedTurnId: admitted.id } });
    assert.equal(paused.phase, 'PILOT_SAFETY_PAUSE'); assert.equal(paused.legacyWritesEnabled, false);
    await assert.rejects(admitGuardDriverQueueTurn(prisma, { source: 'INTERNAL', driverId: driver.id, actorId: actor.id }), PilotSafetyPauseError);
    await assert.rejects(prisma.securityVehiclePair.update({ where: { id: pairs[0].id }, data: { notes: 'still blocked during pause' } }), /legacy combined dispatch writes are disabled/i);

    const approvalSpecs = [
      { role: 'GUARD' as const, actorId: operators.guard, workspace: 'security', feature: 'security_dispatch_confirmation_approve' },
      { role: 'LOGISTICS' as const, actorId: operators.logistics, workspace: 'logistics', feature: 'logistics_loadings_finalize' },
      { role: 'ACCOUNTING' as const, actorId: operators.accounting, workspace: 'accounting', feature: 'accounting_dispatch_candidates_manage' },
    ];
    for (const spec of approvalSpecs) {
      await prisma.featurePermission.create({ data: { userId: spec.actorId, workspace: spec.workspace, feature: spec.feature, permissionLevel: 'edit', grantedBy: actor.id } });
    }
    const acceptanceTests = ['authenticated timeline smoke', 'legacy write boundary', 'canonical command safety pause'].map((name) => ({ name,
      status: 'PASSED' as const, evidenceHash: createHash('sha256').update(`${suffix}:${name}:passed`).digest('hex') }));
    const approvalActors = [{ role: 'INCIDENT_LEAD' as const, actorId: actor.id }, ...approvalSpecs.map(({ role, actorId }) => ({ role, actorId }))];
    for (const approval of approvalActors) await recordDispatchPilotResumeApproval(prisma, { ...approval,
      evidence: { rootCause: 'Verifier-injected post-admission critical failure', deployedCorrection: 'Canonical safety boundary validated',
        reconciliationResult: 'Legacy writes remain disabled and projections reconcile', acceptanceTests } });
    const resumed = await resumeDispatchPilot(prisma, { actorId: actor.id, reason: 'Fix-forward verified' });
    assert.equal(resumed.phase, 'CANONICAL_LIVE'); assert.equal(resumed.legacyWritesEnabled, false);
  } finally {
    for (const row of unhealthy) await prisma.shipmentQuantityProjection.update({ where: { contractItemId: row.contractItemId }, data: { health: row.health, healthReasons: row.healthReasons } });
  }
  console.log(`Dispatch cutover verified: ${pairs.length} reviewed dispositions, failed gate, rollback, first admission, safety pause, and four-party fix-forward resumption.`);
};

main().finally(() => prisma.$disconnect());
