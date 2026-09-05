import assert from 'node:assert/strict';
import {
  resolveShipmentStatementOperationsTarget,
  evaluateShipmentStatementDeploymentState,
  ShipmentStatementOperationsError,
  startShipmentStatementOperationsForSignedCutoverUnderLock,
} from '../shipmentStatementOperations';
import { loadShipmentStatementRuntimeStateUnderLock } from '../dispatchDocuments/runtimeState';
import { assertProtectedProductionCutoverBoundary } from '../shipmentStatementCutover/productionBoundary';

const active = {
  paused: false,
  incident: false,
  cutoverEnabled: true,
  cutoverAt: new Date('2026-09-05T10:00:00.000Z'),
  environmentEnabled: true,
};

assert.deepEqual(resolveShipmentStatementOperationsTarget({ ...active, action: 'PAUSE_PLANNED' }), { paused: true, incident: false });
assert.deepEqual(resolveShipmentStatementOperationsTarget({ ...active, action: 'PAUSE_INCIDENT' }), { paused: true, incident: true });
assert.deepEqual(resolveShipmentStatementOperationsTarget({ ...active, paused: true, action: 'RESUME' }), { paused: false, incident: false });
assert.deepEqual(resolveShipmentStatementOperationsTarget({ ...active, paused: true, incident: true, action: 'RESUME' }), { paused: false, incident: false });
assert.deepEqual(evaluateShipmentStatementDeploymentState({ ...active, cutoverEnabled: true }), {
  cutoverEnabled: true, environmentEnabled: true, operationalState: 'ACTIVE',
});
assert.throws(
  () => evaluateShipmentStatementDeploymentState({ ...active, cutoverEnabled: true, environmentEnabled: false }),
  (error: unknown) => error instanceof ShipmentStatementOperationsError && error.code === 'POST_CUTOVER_RUNTIME_NOT_ACTIVE',
);
assert.throws(
  () => evaluateShipmentStatementDeploymentState({ ...active, cutoverEnabled: false, cutoverAt: null, environmentEnabled: true }),
  (error: unknown) => error instanceof ShipmentStatementOperationsError && error.code === 'ENVIRONMENT_GATE_PRECEDES_CUTOVER',
);
assert.throws(
  () => resolveShipmentStatementOperationsTarget({ ...active, paused: true, environmentEnabled: false, action: 'RESUME' }),
  (error: unknown) => error instanceof ShipmentStatementOperationsError && error.code === 'SHIPMENT_STATEMENTS_NOT_ACTIVATED',
);
assert.throws(
  () => resolveShipmentStatementOperationsTarget({ ...active, paused: true, cutoverEnabled: false, cutoverAt: null, action: 'RESUME' }),
  (error: unknown) => error instanceof ShipmentStatementOperationsError && error.code === 'SHIPMENT_STATEMENTS_NOT_ACTIVATED',
);

const main = async () => {
  const writes: any[] = [];
  let control = {
    id: 'customer-shipment-statements', paused: true, incident: false, revision: 0,
    changedAt: new Date('2026-09-05T00:00:00.000Z'), changedBy: null, reason: 'Initial safe pause', createdAt: new Date(),
  };
  const tx = {
    shipmentStatementOperationsControl: {
      findUniqueOrThrow: async () => control,
      updateMany: async ({ data }: any) => { control = { ...control, ...data }; return { count: 1 }; },
    },
    shipmentStatementOperationsEvent: {
      findFirst: async () => null,
      create: async ({ data }: any) => { writes.push(data); return { id: 'event-1', ...data }; },
    },
  } as any;
  const started = await startShipmentStatementOperationsForSignedCutoverUnderLock(tx, {
    actorId: 'release-owner', cutoverIntegrityHash: 'a'.repeat(64),
  });
  assert.equal(started.control.paused, false);
  assert.equal(started.control.revision, 1);
  assert.equal(writes[0].action, 'RESUME');
  assert.match(writes[0].integrityHash, /^[a-f0-9]{64}$/);

  const order: string[] = [];
  const runtime = await loadShipmentStatementRuntimeStateUnderLock({
    $executeRawUnsafe: async () => { order.push('lock'); },
    shipmentStatementCutover: { findUnique: async () => { order.push('cutover'); return { enabled: true, cutoverAt: new Date() }; } },
    shipmentStatementOperationsControl: { findUnique: async () => { order.push('control'); return { paused: false }; } },
  } as any);
  assert.equal(order[0], 'lock');
  assert.equal(runtime?.operationalPaused, false);

  const boundaryClient = {
    deploymentOperation: { findUnique: async () => ({
      id: 'deploy-1', activeKey: 'production', phase: 'MIGRATIONS_APPLIED',
      releaseId: 'release-1', targetCommit: 'commit-1', leaseExpiresAt: new Date('2026-09-05T08:10:00.000Z'),
    }) },
    $queryRaw: async () => [{ now: new Date('2026-09-05T08:00:00.000Z') }],
  } as any;
  assert.equal((await assertProtectedProductionCutoverBoundary(boundaryClient, {
    sourceCommit: 'commit-1', releaseId: 'release-1',
    environment: { NODE_ENV: 'production', DEPLOYMENT_ID: 'deploy-1' },
  })).protectedBoundaryRequired, true);
  await assert.rejects(
    () => assertProtectedProductionCutoverBoundary(boundaryClient, {
      sourceCommit: 'different-commit', releaseId: 'release-1',
      environment: { NODE_ENV: 'production', DEPLOYMENT_ID: 'deploy-1' },
    }),
    /live deployment lease/,
  );
  console.log('shipment statement operations policy tests passed');
};

void main();
