import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { assertCustomerAllocationReleasePlan, observeCustomerAllocationCompose } from '../../deploy/scripts/customer-allocation-release.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const digest = digit => digit.repeat(64);
const image = digit => 'sha256:' + digest(digit);
const triple = digit => ({ backend: image(digit), frontend: image(digit), inquiry: image(digit) });
const facts = {
  candidateImages: triple('1'), predecessorImages: triple('2'),
  candidateCommit: 'a'.repeat(40), candidateTree: 'b'.repeat(40), inquiryCommit: 'c'.repeat(40),
  predecessorCommit: 'd'.repeat(40), predecessorScannerImage: image('3'),
  predecessorScannerContainerId: digest('4'), predecessorBrowserBuildId: 'erp_qualified',
  predecessorMigrationSha256: digest('5'), migrationSha256: digest('5'),
};
const reader = Object.fromEntries(Object.entries(facts).filter(([field]) => field.startsWith('predecessor')));

test('the qualified reader must identify the observed rollback runtime and share the exact migration catalog', () => {
  assert.doesNotThrow(() => assertCustomerAllocationReleasePlan(facts, reader));
  for (const field of ['predecessorCommit', 'predecessorScannerImage', 'predecessorScannerContainerId',
    'predecessorMigrationSha256', 'predecessorBrowserBuildId']) {
    assert.throws(() => assertCustomerAllocationReleasePlan(facts, { ...reader, [field]: 'different' }),
      /CUSTOMER_ALLOCATION_RELEASE_IDENTITY_MISMATCH/);
  }
  assert.throws(() => assertCustomerAllocationReleasePlan({ ...facts, migrationSha256: digest('6') }, reader),
    /CUSTOMER_ALLOCATION_RELEASE_IDENTITY_MISMATCH/);
});

test('protected activation requires the same effective backend database configuration and project network', () => {
  const runtimeUrl = 'postgresql://sabalan_application_runtime:fixture@postgres:5432/sabalanerp';
  const controlUrl = 'postgresql://control:fixture@postgres:5432/sabalanerp';
  const networks = { app_network: null };
  const rendered = { services: {
    backend: { networks, environment: { DATABASE_URL: runtimeUrl } },
    deployment: { networks, environment: { DATABASE_URL: controlUrl } },
    postgres: { networks, environment: { POSTGRES_USER: 'control', POSTGRES_DB: 'sabalanerp' } },
  }, networks: { app_network: { name: 'sabalanerp_app_network' } } };
  const predecessor = { network: 'sabalanerp_app_network' };
  assert.deepEqual(observeCustomerAllocationCompose(rendered, predecessor, sha(runtimeUrl)), {
    runtimeUrl, controlUrl, bootstrapUser: 'control', network: 'sabalanerp_app_network',
  });
  assert.throws(() => observeCustomerAllocationCompose(rendered, predecessor, sha(controlUrl)),
    /CUSTOMER_ALLOCATION_RUNTIME_CONFIGURATION_CHANGED/);
  assert.throws(() => observeCustomerAllocationCompose(rendered, { network: 'foreign_app_network' }, sha(runtimeUrl)),
    /CUSTOMER_ALLOCATION_DATABASE_TARGET_CHANGED/);
});
