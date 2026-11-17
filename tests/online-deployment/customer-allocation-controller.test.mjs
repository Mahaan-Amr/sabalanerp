import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalGoPayload } from '../../deploy/scripts/lib/customer-allocation-go-manifest.mjs';
import { activateCustomerAllocation, closeCustomerAllocation, customerAllocationControllerDatabase } from '../../deploy/scripts/lib/customer-allocation-controller.mjs';

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
      activate: async ({ manifestSha256 }) => {
        activated += 1;
        return { state: 'ACTIVE', manifest_sha256: manifestSha256 };
      },
    }),
  };
};
const input = (db, signed = envelope(payload())) => ({ db, envelope: signed,
  expected: facts(), deploymentId: 'deployment-456', leaseToken: 'lease-456',
  approver: { keyId: 'independent-approver-1', publicKey } });
const runtime = { query: async () => ({ rows: [{ pid: 42 }] }) };

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
    if (sql.includes('admitted_controller_session')) return { rows: [{
      admitted_controller_session: true, admitted_runtime_session: true,
    }] };
    if (sql.includes('controller_lock')) return { rows: [{ deployment_id: 'deployment-456',
      activeKey, phase, leaseToken, targetCommit, releaseId, controlState,
      dbClock: new Date(now), leaseExpiresAt: new Date('2026-11-16T12:03:00.000Z') }] };
    if (sql.includes('controller_activate')) return { rows: [{ state: 'ACTIVE', manifest_sha256: values[3] }] };
    return { rows: [] };
  } };
  const result = await activateCustomerAllocation(input(customerAllocationControllerDatabase(client, runtime)));
  assert.equal(result.state, 'ACTIVE');
  assert.deepEqual(calls.map(call => call.sql.trimStart().startsWith('SELECT') ? 'SELECT' : call.sql),
    ['BEGIN', 'SELECT', 'SELECT', 'SELECT', 'COMMIT']);
  assert.match(calls[1].sql, /rolname = session_user AND r.rolname = current_user/);
  assert.match(calls[1].sql, /pg_auth_members/);
  assert.match(calls[1].sql, /a.pid = \$1 AND a.datname = current_database/);
  assert.deepEqual(calls[1].values, [42]);

  calls.length = 0;
  const query = client.query;
  client.query = async (sql, values) => {
    if (sql.includes('controller_activate')) {
      calls.push({ sql, values });
      return { rows: [{ state: 'ACTIVE', manifest_sha256: h('f') }] };
    }
    return query(sql, values);
  };
  await assert.rejects(activateCustomerAllocation(input(customerAllocationControllerDatabase(client, runtime))));
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('database adapter rejects an unqualified controller or runtime before acquiring the deployment lock', async () => {
  for (const [controller, application] of [[false, true], [true, false]]) {
    const calls = [];
    const db = customerAllocationControllerDatabase({
      query: async sql => {
        calls.push(sql);
        return { rows: sql.includes('admitted_controller_session') ? [{
          admitted_controller_session: controller, admitted_runtime_session: application,
        }] : [] };
      },
    }, runtime);
    await assert.rejects(activateCustomerAllocation(input(db)), /CUSTOMER_ALLOCATION_CONTROLLER_REJECTED/);
    assert.equal(calls.at(-1), 'ROLLBACK');
    assert.ok(calls.every(sql => !sql.includes('controller_lock')));
  }
});

test('closure passes the exact activation digest and rolls back a mismatched receipt', async () => {
  const calls = [];
  const values = ['rollback-deployment', 'rollback-lease', 'rollback-release', h('a')];
  const db = customerAllocationControllerDatabase({
    query: async (sql, parameters) => {
      calls.push(sql);
      if (sql.includes('admitted_controller_session')) return { rows: [{
        admitted_controller_session: true, admitted_runtime_session: true,
      }] };
      if (sql.includes('controller_close')) {
        assert.deepEqual(parameters, values);
        return { rows: [{ state: 'CLOSED', manifest_sha256: h('b') }] };
      }
      return { rows: [] };
    },
  }, runtime);
  const [deploymentId, leaseToken, releaseId, manifestSha256] = values;
  await assert.rejects(closeCustomerAllocation({ db, deploymentId, leaseToken, releaseId, manifestSha256 }));
  assert.equal(calls.at(-1), 'ROLLBACK');
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
