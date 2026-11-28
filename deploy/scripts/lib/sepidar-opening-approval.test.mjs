import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { canonicalGoPayload } from './customer-allocation-go-manifest.mjs';
import { verifySepidarOpeningApproval } from './sepidar-opening-approval.mjs';
import { enrollSepidarOpening, readSepidarOpeningEvidence } from './sepidar-opening-controller.mjs';
import { sepidarControllerConnection, sepidarOpeningTarget } from '../sepidar-opening-release.mjs';

test('a protected approval includes exactly the signed accounting commands and release evidence', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const identity = {
    releaseId: 'release-1', deploymentId: 'deployment-1', buildCommit: 'a'.repeat(40), migrationSha256: '3'.repeat(64),
    candidateImage: 'sha256:' + '1'.repeat(64), retainedImage: 'sha256:' + '2'.repeat(64),
    checkpointHash: '4'.repeat(64), qualificationHash: '5'.repeat(64),
  };
  const payload = {
    ...identity,
    format: 'sepidar-customer-opening-approval-v1',
    decision: 'GO',
    keyId: 'accounting-approval',
    issuedAt: '2026-11-25T10:00:00.000Z', expiresAt: '2026-11-25T10:05:00.000Z',
    bookId: 'book', counterAccountId: 'clearing', basisAt: '2026-03-21T00:00:00.000Z',
    sourcePackageHash: 'b'.repeat(64), accountingApprovalHash: 'c'.repeat(64),
    commands: [{ idempotencyKey: 'opening-91', destinationKey: 'p91', actorId: 'accountant', sourceCustomerId: '7',
      sourceVoucherItemId: '91', commandHash: 'd'.repeat(64), totalRials: '-5' }],
  };
  const envelope = {
    payload,
    signature: sign(null, Buffer.from(canonicalGoPayload(payload)), privateKey).toString('base64'),
  };
  const observed = { ...identity, bookId: payload.bookId, counterAccountId: payload.counterAccountId, basisAt: payload.basisAt,
    sourcePackageHash: payload.sourcePackageHash, accountingApprovalHash: payload.accountingApprovalHash, phase: 'MIGRATIONS_APPLIED', activeKey: 'production',
    dbClock: '2026-11-25T10:00:45.000Z', leaseExpiresAt: '2026-11-25T10:05:00.000Z', commands: payload.commands };
  const approver = { keyId: 'accounting-approval', publicKey };
  const result = verifySepidarOpeningApproval(envelope, observed, approver);
  assert.deepEqual(JSON.parse(result.manifestText), payload);
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
  assert.throws(() => verifySepidarOpeningApproval({
    ...envelope, payload: { ...payload, commands: [{ ...payload.commands[0], totalRials: '-6' }] },
  }, observed, approver), /SEPIDAR_OPENING_APPROVAL_REJECTED/);
  assert.throws(() => verifySepidarOpeningApproval(envelope, {
    ...observed, retainedImage: 'sha256:' + '8'.repeat(64),
  }, approver), /SEPIDAR_OPENING_APPROVAL_REJECTED/);
  assert.throws(() => verifySepidarOpeningApproval(envelope, {
    ...observed, commands: [{ ...payload.commands[0], actorId: 'another-actor' }],
  }, approver), /SEPIDAR_OPENING_APPROVAL_REJECTED/);

  let checkpointHash = identity.checkpointHash;
  const queries = [];
  const client = { query: async (sql, parameters) => {
    queries.push({ sql, parameters });
    if (sql.includes('sepidar_customer_opening_lock')) return { rows: [{
      build_commit: identity.buildCommit, checkpoint_hash: checkpointHash,
      phase: observed.phase, active_key: observed.activeKey,
      database_clock: new Date(observed.dbClock), lease_expiry: new Date(observed.leaseExpiresAt),
    }] };
    return { rows: [] };
  } };
  const input = { client, deploymentId: identity.deploymentId, releaseId: identity.releaseId,
    leaseToken: 'current-lease', qualification: observed, envelope, approver };
  assert.deepEqual(await enrollSepidarOpening(input), { manifestSha256: result.manifestSha256 });
  assert.deepEqual(queries[2].parameters, [
    identity.deploymentId, identity.releaseId, 'current-lease', result.manifestText, result.manifestSha256,
  ]);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  queries.length = 0;
  checkpointHash = '9'.repeat(64);
  await assert.rejects(enrollSepidarOpening(input), /SEPIDAR_OPENING_APPROVAL_REJECTED/);
  assert.equal(queries.length, 3);
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
});

test('enrollment evidence binds source rows, zero exclusions, clearing totals and the independent key pin', () => {
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const { publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const files = {};
  const file = (name, content) => {
    files[name] = Buffer.from(JSON.stringify(content));
    return sha256(files[name]);
  };
  const basis = { bookId: 'book', counterAccountId: 'clearing', basisAt: '2026-03-21T00:00:00.000Z' };
  const sourcePackageHash = file('source.json', { format: 'sepidar-reviewed-opening-evidence-v1',
    transferStatus: 'UNPOSTED', currency: 'IRR', basisPersian: '1405-01-01', receivableCustomerCount: 1,
    rows: [{ sourcePartyId: 7, targetWorkspaceKey: 'p91', receivable: { openingVoucherItemId: 91, signedRials: '-5' } }] });
  const manifestLine = { sourceCustomerId: '7', sourceVoucherItemId: '91', destinationKey: 'p91', totalRials: '-5' };
  const preparation = { format: 'sepidar-customer-opening-preparation-v1', ...basis, sourcePackageHash,
    preparedNetRials: '-5', clearingNetRials: '5', prepared: [{ manifestLine }], excluded: [] };
  const approval = { format: 'sepidar-opening-accounting-review-v1', decision: 'APPROVED',
    reviewReference: 'Accounting review 1', ...basis, customerCount: 1, clearingNetRials: '5' };
  file('accounting-approval.json', { ...approval, preparationSha256: file('preparation.json', preparation) });
  const qualificationSha256 = file('qualification.json', { buildCommit: 'a'.repeat(40) });
  file('approver.json', { publicKeyPem: pem, keyId: 'approver-1' });
  file('decision.json', {});
  const read = name => files[name];
  const pins = { approvalKeySha256: sha256(pem), qualificationSha256 };
  assert.deepEqual(readSepidarOpeningEvidence(read, pins).qualification.commands, [manifestLine]);
  assert.throws(() => readSepidarOpeningEvidence(read, { ...pins, approvalKeySha256: 'a'.repeat(64) }),
    /SEPIDAR_OPENING_EVIDENCE_REJECTED/);
  assert.throws(() => readSepidarOpeningEvidence(read, { ...pins, qualificationSha256: 'b'.repeat(64) }),
    /SEPIDAR_OPENING_EVIDENCE_REJECTED/);
  const unrelatedCommand = { ...manifestLine, destinationKey: 'different' };
  file('accounting-approval.json', { ...approval, preparationSha256: file('preparation.json',
    { ...preparation, prepared: [{ manifestLine: unrelatedCommand }] }) });
  assert.throws(() => readSepidarOpeningEvidence(read, pins), /SEPIDAR_OPENING_EVIDENCE_REJECTED/);
});

test('the release runner targets only the protected Compose database and its dedicated login', () => {
  const postgres = { environment: { POSTGRES_DB: 'sabalanerp' }, networks: { default: {} } };
  const service = database => ({
    environment: { DATABASE_URL: `postgresql://runtime:fixture@postgres:5432/${database}` },
    networks: { default: {} },
  });
  const rendered = { name: 'sabalanerp', services: { postgres, backend: service('sabalanerp'), deployment: service('sabalanerp') },
    networks: { default: { name: 'sabalanerp_default' } } };
  assert.deepEqual(sepidarOpeningTarget(rendered), { network: 'sabalanerp_default', database: 'sabalanerp' });
  assert.throws(() => sepidarOpeningTarget({ ...rendered, name: 'sabalanerp-local' }));
  assert.throws(() => sepidarOpeningTarget({ ...rendered,
    services: { ...rendered.services, deployment: service('another_database') } }));
  const controller = 'postgresql://sabalan_sepidar_opening_controller:fixture@postgres:5432/sabalanerp';
  assert.equal(sepidarControllerConnection(controller, 'sabalanerp'), controller);
  for (const wrong of [controller.replace('postgres:5432', 'another:5432'),
    controller.replace('sabalan_sepidar_opening_controller', 'postgres'), controller + '?options=fixture']) {
    assert.throws(() => sepidarControllerConnection(wrong, 'sabalanerp'));
  }
});
