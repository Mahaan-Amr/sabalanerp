import assert from 'node:assert/strict';
import { assertIsolatedRecoveryDrill, recoveryDrillFreshness, recoveryRehearsalFreshness } from '../deploymentDrillPolicy';

assert.throws(
  () => assertIsolatedRecoveryDrill({ NODE_ENV: 'production', DEPLOYMENT_DRILL_ISOLATED: 'true', DATABASE_URL: 'postgresql://drill' }),
  (error: any) => error?.code === 'DEPLOYMENT_DRILL_NOT_ISOLATED',
);
assert.throws(
  () => assertIsolatedRecoveryDrill({ NODE_ENV: 'test', DEPLOYMENT_DRILL_ISOLATED: 'true', DATABASE_URL: 'same', PRODUCTION_DATABASE_URL: 'same', DEPLOYMENT_DRILL_DATABASE_MARKER: '12345678901234567890123456789012' }),
  (error: any) => error?.code === 'DEPLOYMENT_DRILL_DATABASE_UNSAFE',
);
assert.throws(
  () => assertIsolatedRecoveryDrill({ NODE_ENV: 'test', DEPLOYMENT_DRILL_ISOLATED: 'true', DATABASE_URL: 'postgresql://drill', PRODUCTION_DATABASE_URL: 'postgresql://production' }),
  (error: any) => error?.code === 'DEPLOYMENT_DRILL_DATABASE_MARKER_UNSAFE',
);
assert.doesNotThrow(() => assertIsolatedRecoveryDrill({
  NODE_ENV: 'test',
  DEPLOYMENT_DRILL_ISOLATED: 'true',
  DATABASE_URL: 'postgresql://drill',
  PRODUCTION_DATABASE_URL: 'postgresql://production',
  DEPLOYMENT_DRILL_DATABASE_MARKER: '12345678901234567890123456789012',
}));
assert.equal(recoveryDrillFreshness({ checkpointCreatedAt: new Date('2026-08-01'), now: new Date('2026-08-11') }).healthy, true);
assert.equal(recoveryDrillFreshness({ checkpointCreatedAt: new Date('2026-01-01'), now: new Date('2026-08-11') }).healthy, false);
assert.equal(recoveryDrillFreshness({ checkpointCreatedAt: new Date('2026-01-01'), lastHealthyDrillAt: new Date('2026-08-01'), now: new Date('2026-08-11') }).healthy, true);
assert.equal(recoveryRehearsalFreshness({ checkpointCreatedAt: new Date('2026-01-01'), now: new Date('2026-08-11') }).healthy, false);
assert.equal(recoveryRehearsalFreshness({ checkpointCreatedAt: new Date('2026-01-01'), lastHealthyRehearsalAt: new Date('2026-07-01'), now: new Date('2026-08-11') }).healthy, true);
console.log('deployment drill policy tests passed');
