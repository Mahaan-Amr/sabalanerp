import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalGoPayload } from '../../deploy/scripts/lib/customer-allocation-go-manifest.mjs';
import { activateCustomerAllocation, customerAllocationControllerDatabase } from '../../deploy/scripts/lib/customer-allocation-controller.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const h = value => value.repeat(64);
const now = '2026-11-16T12:00:00.000Z';
const facts = () => ({
  releaseId: 'release-456', deploymentId: 'deployment-456', candidateCommit: 'a'.repeat(40),
  candidateTree: 'b'.repeat(40), inquiryCommit: 'c'.repeat(40), migrationSha256: h('d'),
  candidateImages: { backend: `sha256:${h('1')}`, frontend: `sha256:${h('2')}`, inquiry: `sha256:${h('3')}` },
  predecessorImages: { backend: `sha256:${h('4')}`, frontend: `sha256:${h('5')}`, inquiry: `sha256:${h('6')}` },
  cohortSha256: h('e'), evidence: { reader: h('7'), populatedQa: h('8'), rollback: h('9') },
});
const payload = () => ({ schemaVersion: 1, decision: 'GO', operation: 'GROUPED_ALLOCATION',
  keyId: 'independent-approver-1', issuedAt: '2026-11-16T11:59:00.000Z', expiresAt: '2026-11-16T12:01:00.000Z',
  ...facts(),
});
const envelope = p => ({ payload: p, signature: sign(null, Buffer.from(canonicalGoPayload(p)), privateKey).toString('base64') });
const boundary = () => ({ ...facts(), activeKey: 'production', phase: 'MIGRATIONS_APPLIED',
  leaseToken: 'lease-456', leaseExpiresAt: '2026-11-16T12:03:00.000Z', dbClock: now,
  targetCommit: 'a'.repeat(40), controlState: 'CLOSED' });
const authority = () => {
  let activated = 0;
  const state = { boundary: boundary() };
  return { state, get activated() { return activated; },
    transaction: async work => work({
      lock: async () => ({ deploymentId: 'deployment-456', ...state.boundary }),
      activate: async () => { activated += 1; return { state: 'ACTIVE', manifestSha256: 'receipt' }; },
    }),
  };
};
const input = (db, signed = envelope(payload())) => ({ db, envelope: signed,
  expected: facts(), deploymentId: 'deployment-456', leaseToken: 'lease-456',
  approver: { keyId: 'independent-approver-1', publicKey } });

test('a signed exact GO changes control once under the locked deployment operation', async () => {
  const db = authority();
  assert.equal((await activateCustomerAllocation(input(db))).state, 'ACTIVE');
  assert.equal(db.activated, 1);
});

test('database adapter retains the lock and writes the receipt in one transaction', async () => {
  const calls = [];
  const { activeKey, phase, leaseToken, targetCommit, releaseId, controlState } = boundary();
  const client = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (sql.includes('controller_lock')) return { rows: [{ deployment_id: 'deployment-456',
      activeKey, phase, leaseToken, targetCommit, releaseId, controlState,
      dbClock: new Date(now), leaseExpiresAt: new Date('2026-11-16T12:03:00.000Z') }] };
    if (sql.includes('controller_activate')) return { rows: [{ state: 'ACTIVE', manifest_sha256: h('a') }] };
    return { rows: [] };
  } };
  const result = await activateCustomerAllocation(input(customerAllocationControllerDatabase(client)));
  assert.equal(result.state, 'ACTIVE');
  assert.deepEqual(calls.map(call => call.sql.startsWith('SELECT') ? 'SELECT' : call.sql),
    ['BEGIN', 'SELECT', 'SELECT', 'COMMIT']);
});

test('wrong phase, lease, image, signature and replay never write control', async () => {
  for (const changed of [
    { phase: 'RELEASE_STARTED' }, { leaseToken: 'other' }, { leaseExpiresAt: now },
    { candidateImages: { ...facts().candidateImages, backend: `sha256:${h('f')}` } },
    { controlState: 'ACTIVE' },
  ]) {
    const db = authority(); Object.assign(db.state.boundary, changed);
    await assert.rejects(activateCustomerAllocation(input(db)));
    assert.equal(db.activated, 0);
  }
  const db = authority();
  await assert.rejects(activateCustomerAllocation(input(db, { ...envelope(payload()), signature: 'A'.repeat(88) })));
  assert.equal(db.activated, 0);
});
