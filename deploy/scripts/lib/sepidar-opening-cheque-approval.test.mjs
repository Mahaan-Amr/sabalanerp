import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { enrollSepidarOpening, readSepidarChequeOpeningEvidence } from './sepidar-opening-controller.mjs';
import { canonicalGoPayload } from './customer-allocation-go-manifest.mjs';
import { readSepidarOpeningChequeBatchEvidence, verifySepidarOpeningChequeBatchApproval } from './sepidar-opening-cheque-approval.mjs';

test('cheque approval binds an exact plan and evidence to the owned deployment', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const digest = digit => digit.repeat(64);
  const identity = {
    releaseId: 'release-1', deploymentId: 'deploy-1', buildCommit: 'a'.repeat(40),
    migrationSha256: digest('1'), checkpointHash: digest('2'), qualificationHash: digest('3'),
    candidateImage: 'sha256:' + digest('4'), retainedImage: 'sha256:' + digest('5'),
    bookId: 'book', actorId: 'accountant', fiscalYearId: '1405', periodId: 'period',
    clearingAccountId: 'clearing', custodyFinancialAccountId: 'till', basisAt: '2026-03-21T00:00:00.000Z',
    sourceSha256: digest('6'), planSha256: digest('7'), preparationSha256: digest('8'), accountingApprovalSha256: digest('9'),
    instrumentCount: 37, eventCount: 58, openingRials: '71454000000',
  };
  const observed = { ...identity, phase: 'MIGRATIONS_APPLIED', activeKey: 'production',
    dbClock: '2026-11-26T10:00:05.000Z', leaseExpiresAt: '2026-11-26T10:01:00.000Z' };
  const payload = { ...identity, format: 'sepidar-opening-cheque-batch-approval-v1', decision: 'GO',
    keyId: 'review-key', issuedAt: '2026-11-26T10:00:00.000Z', expiresAt: '2026-11-26T10:05:00.000Z' };
  const envelopeFor = payload => ({
    payload, signature: sign(null, Buffer.from(canonicalGoPayload(payload)), privateKey).toString('base64'),
  });
  const envelope = envelopeFor(payload);
  const approver = { keyId: 'review-key', publicKey };

  const accepted = verifySepidarOpeningChequeBatchApproval(envelope, observed, approver);
  assert.deepEqual(JSON.parse(accepted.manifestText), payload);
  assert.match(accepted.manifestSha256, /^[a-f0-9]{64}$/);
  const queries = [];
  const client = { query: async (sql, args) => {
    queries.push({ sql, args });
    if (sql.includes('sepidar_customer_opening_lock')) return { rows: [{
      build_commit: identity.buildCommit, checkpoint_hash: identity.checkpointHash,
      phase: observed.phase, active_key: observed.activeKey,
      database_clock: new Date(observed.dbClock), lease_expiry: new Date(observed.leaseExpiresAt),
    }] };
    return { rows: [] };
  } };
  const input = { client, scope: 'cheques', deploymentId: identity.deploymentId, releaseId: identity.releaseId,
    leaseToken: 'owned-lease', qualification: observed, envelope, approver };
  assert.deepEqual(await enrollSepidarOpening(input), { manifestSha256: accepted.manifestSha256 });
  assert.match(queries[2].sql, /sepidar_cheque_batch_register/);
  assert.deepEqual(queries[2].args, [identity.deploymentId, identity.releaseId, 'owned-lease',
    accepted.manifestText, accepted.manifestSha256]);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  queries.length = 0;
  await assert.rejects(enrollSepidarOpening({ ...input, qualification: { ...observed, bookId: 'wrong' } }));
  assert.equal(queries.length, 3);
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
  const rejected = { message: 'SEPIDAR_CHEQUE_BATCH_APPROVAL_REJECTED' };
  for (const [field, value] of Object.entries({
    actorId: 'other-actor', periodId: 'other-period', planSha256: digest('0'), openingRials: '1',
    custodyFinancialAccountId: 'other-till', sourceSha256: digest('0'), preparationSha256: digest('0'),
    checkpointHash: digest('0'), retainedImage: 'sha256:' + digest('0'), eventCount: 57,
    phase: 'HEALTH_VERIFIED', activeKey: 'staging', leaseExpiresAt: '2026-11-26T10:00:20.000Z',
  })) {
    assert.throws(() => verifySepidarOpeningChequeBatchApproval(envelope, { ...observed, [field]: value }, approver), rejected, field);
  }
  assert.throws(() => verifySepidarOpeningChequeBatchApproval(envelopeFor({
    ...payload, format: 'sepidar-customer-opening-approval-v1',
  }), observed, approver), rejected);
  assert.throws(() => verifySepidarOpeningChequeBatchApproval({
    ...envelope, payload: { ...payload, expiresAt: '2026-11-26T10:06:00.000Z' },
  }, observed, approver), rejected);
  assert.throws(() => verifySepidarOpeningChequeBatchApproval(envelope, observed,
    { ...approver, publicKey: generateKeyPairSync('ed25519').publicKey }), rejected);
});

test('cheque evidence rejects stale preparation, replaced source and a review of other bytes', () => {
  const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const source = json({ source: 'reviewed fixture' });
  const prepared = {
    format: 'sepidar-opening-cheque-batch-preparation-v1', bookId: 'book', actorId: 'accountant',
    fiscalYearId: 'year', periodId: 'period', clearingAccountId: 'transfer', custodyFinancialAccountId: 'till',
    basisAt: '2026-03-21T00:00:00.000Z', sourceSha256: sha(source), planSha256: '7'.repeat(64),
    instrumentCount: 37, eventCount: 58, openingRials: '71454000000',
  };
  const preparation = json(prepared);
  const accounting = { format: 'sepidar-opening-cheque-accounting-review-v1', decision: 'APPROVED',
    reviewReference: 'review-37', preparationSha256: sha(preparation) };
  const evidence = { source, preparation, reproducedPreparation: Buffer.from(preparation), accountingApproval: json(accounting) };
  const { publicKey } = generateKeyPairSync('ed25519');
  const pem = publicKey.export({ type: 'spki', format: 'pem' });
  const qualification = json({});
  const files = { 'source.json': source, 'preparation.json': preparation, 'qualification.json': qualification,
    'accounting-approval.json': evidence.accountingApproval };
  const read = name => files[name];
  const authority = () => json({ keyId: 'reviewer', publicKeyPem: pem });
  const opts = { approvalKeySha256: sha(pem), qualificationSha256: sha(qualification) };
  assert.throws(() => readSepidarChequeOpeningEvidence(read, opts, authority));
  assert.throws(() => readSepidarChequeOpeningEvidence(read, {
    ...opts, describe: () => ({ ...prepared, eventCount: 57 }),
  }, authority));
  const controller = readSepidarChequeOpeningEvidence(read, { ...opts, prepareOnly: true, describe: () => prepared }, authority);
  assert.equal(controller.qualification.planSha256, prepared.planSha256);
  const observed = readSepidarOpeningChequeBatchEvidence(evidence);
  assert.equal(observed.planSha256, prepared.planSha256);
  assert.equal(observed.preparationSha256, sha(preparation));
  assert.equal(observed.accountingApprovalSha256, sha(evidence.accountingApproval));
  for (const changed of [
    { source: json({ source: 'different fixture' }) },
    { reproducedPreparation: json({ ...prepared, eventCount: 57 }) },
    { accountingApproval: json({ ...accounting, preparationSha256: '0'.repeat(64) }) },
    { accountingApproval: json({ ...accounting, format: 'sepidar-opening-accounting-review-v1' }) },
  ]) {
    assert.throws(() => readSepidarOpeningChequeBatchEvidence({ ...evidence, ...changed }),
      { message: 'SEPIDAR_CHEQUE_BATCH_APPROVAL_REJECTED' });
  }
});
