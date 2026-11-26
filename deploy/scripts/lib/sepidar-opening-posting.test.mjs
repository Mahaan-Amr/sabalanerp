import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { canonicalGoPayload } from './customer-allocation-go-manifest.mjs';
import { postSepidarOpeningBatch } from './sepidar-opening-posting.mjs';

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const basisAt = '2026-03-21T00:00:00.000Z';
  const now = () => Date.parse('2026-11-26T08:00:00.000Z');
  const buildCommit = 'a'.repeat(40);
  const sourcePackageHash = 'b'.repeat(64);
  const accountingApprovalHash = 'c'.repeat(64);
  const counterAccountId = 'clearing';
  const bookId = 'book';
  const commands = ['-17', '3'].map((totalRials, index) => ({ totalRials,
    destinationKey: 'customer:' + index, actorId: 'accountant', idempotencyKey: 'opening:' + index,
    sourceVoucherItemId: String(90 + index), sourceCustomerId: String(30 + index), commandHash: String(index + 1).repeat(64) }));
  const preparedRows = commands.map(manifestLine => ({ manifestLine, requestBody: {
    kind: 'OPENING', confirmed: true, amountRials: manifestLine.totalRials, occurredAt: basisAt, counterAccountId, periodId: 'period',
    idempotencyKey: manifestLine.idempotencyKey, openingReview: { expectedSnapshotHash: 'd'.repeat(64), sepidarEvidence: {
      sourceCustomerId: manifestLine.sourceCustomerId, sourceVoucherItemId: manifestLine.sourceVoucherItemId, sourcePackageHash,
    } },
  } }));
  const qualification = { buildCommit, basisAt, sourcePackageHash, counterAccountId, accountingApprovalHash, bookId, commands };
  const payload = { ...qualification, format: 'sepidar-customer-opening-approval-v1', decision: 'GO', keyId: 'key',
    checkpointHash: 'e'.repeat(64), issuedAt: '2026-11-26T07:00:00.000Z', expiresAt: '2026-11-27T07:00:00.000Z' };
  const evidence = { qualification, preparedRows, approver: { publicKey, keyId: 'key' }, envelope: {
    payload, signature: sign(null, Buffer.from(canonicalGoPayload(payload)), privateKey).toString('base64'),
  } };
  const workspaces = commands.map(() => ({
    bookId, capabilities: { canManageAccount: true }, openingSources: [], openingSnapshotHash: 'd'.repeat(64),
  }));
  const records = [], calls = [];
  let loseReply = false, clearingVariance = 0n;
  const request = async (path, init) => {
    const response = data => ({ ok: true, headers: { get: () => buildCommit }, json: async () => ({ success: true, data }) });
    if (path.endsWith('/context')) return response({ periods: [{ id: 'period', fiscalYearId: 'year' }] });
    if (path.includes('/trial-balance?')) {
      const amounts = workspaces.map(workspace => BigInt(workspace.openingReview?.totalRials ?? '0'));
      const debit = amounts.filter(amount => amount < 0n).reduce((sum, amount) => sum - amount, clearingVariance);
      const credit = amounts.filter(amount => amount > 0n).reduce((sum, amount) => sum + amount, clearingVariance);
      return response([{ accountId: counterAccountId, debitRials: debit.toString(), creditRials: credit.toString() }]);
    }
    const index = Number(path.match(/customer%3A([0-9])/)[1]);
    calls.push([init?.method ?? 'GET', index]);
    let data = workspaces[index];
    if (init?.method === 'POST') {
      const line = commands[index];
      assert.deepEqual(JSON.parse(init.body), preparedRows[index].requestBody);
      const openingReviewId = 'review-' + index, voucherId = 'voucher-' + index;
      data.openingReview = { id: openingReviewId, idempotencyKey: line.idempotencyKey, commandHash: line.commandHash,
        createdBy: line.actorId, basisAt, totalRials: line.totalRials, transferRials: line.totalRials,
        evidence: { voucherIds: [voucherId], sepidarAdmission: { sourcePackageHash,
          sourceVoucherItemId: line.sourceVoucherItemId, counterAccountId } } };
      data = { openingReviewId, voucherId };
      if (loseReply) { loseReply = false; throw new Error('connection closed after commit'); }
    }
    return response(data);
  };
  return { args: { evidence, now, request, record: async value => { records.push(value); } }, records, calls, workspaces,
    loseNextReply: () => { loseReply = true; }, changeClearing: () => { clearingVariance = 1n; } };
}

test('preview verifies every destination before writing and flags a stale later row before the first POST', async () => {
  const f = fixture();
  const report = await postSepidarOpeningBatch(f.args);
  assert.equal(report.verifiedCount, 0);
  assert.deepEqual(f.calls, [['GET', 0], ['GET', 1]]);
  f.workspaces[1].openingSnapshotHash = 'f'.repeat(64);
  await assert.rejects(postSepidarOpeningBatch({ ...f.args, apply: true }), /SEPIDAR_OPENING_POSTING_REJECTED/);
  assert.equal(f.calls.some(([method]) => method === 'POST'), false);
});

test('retry reconciles a committed opening after a lost reply and never submits it again', async () => {
  const f = fixture();
  f.loseNextReply();
  await assert.rejects(postSepidarOpeningBatch({ ...f.args, apply: true }), /connection closed/);
  assert.deepEqual(f.records.map(row => row.status), ['ATTEMPTING']);
  const result = await postSepidarOpeningBatch({ ...f.args, apply: true });
  assert.deepEqual(result, { customerCount: 2, verifiedCount: 2, verifiedNetRials: '-14', verifiedClearingBalanceRials: '14' });
  assert.deepEqual(f.calls.filter(([method]) => method === 'POST'), [['POST', 0], ['POST', 1]]);
  assert.deepEqual(f.records.filter(row => row.status === 'VERIFIED').map(row => row.voucherId), ['voucher-0', 'voucher-1']);
});

test('a clearing balance inconsistent with the committed cohort stops posting', async () => {
  const f = fixture();
  f.changeClearing();
  await assert.rejects(postSepidarOpeningBatch({ ...f.args, apply: true }), /SEPIDAR_OPENING_POSTING_REJECTED/);
  assert.equal(f.calls.some(([method]) => method === 'POST'), false);
});
