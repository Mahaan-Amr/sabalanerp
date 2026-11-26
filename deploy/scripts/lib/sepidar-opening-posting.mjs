import { verify } from 'node:crypto';
import { canonicalGoPayload } from './customer-allocation-go-manifest.mjs';

const closed = () => { throw new Error('SEPIDAR_OPENING_POSTING_REJECTED'); };
const hex = /^[a-f0-9]{64}$/;
const id = /^[a-zA-Z0-9_:-]+$/;

function verifyBatch({ envelope, approver, qualification, preparedRows }, now) {
  const payload = envelope?.payload;
  if (!payload || payload.format !== 'sepidar-customer-opening-approval-v1' || payload.decision !== 'GO'
    || payload.keyId !== approver?.keyId || approver.publicKey?.asymmetricKeyType !== 'ed25519'
    || !/^[a-f0-9]{40}$/.test(payload.buildCommit ?? '') || !hex.test(payload.checkpointHash ?? '')
    || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature ?? '')
    || !Number.isFinite(Date.parse(payload.issuedAt)) || Date.parse(payload.issuedAt) > now
    || !(Date.parse(payload.expiresAt) > now)
    || Object.entries(qualification).some(([key, expected]) => canonicalGoPayload(payload[key]) !== canonicalGoPayload(expected))
    || !verify(null, Buffer.from(canonicalGoPayload(payload)), approver.publicKey, Buffer.from(envelope.signature, 'base64'))
    || !Array.isArray(preparedRows) || !preparedRows.length || preparedRows.length !== payload.commands?.length) closed();
  for (const [index, row] of preparedRows.entries()) {
    const line = row.manifestLine;
    const body = row.requestBody;
    const source = body?.openingReview?.sepidarEvidence;
    if (canonicalGoPayload(line) !== canonicalGoPayload(payload.commands[index]) || !id.test(line.destinationKey)
      || body?.kind !== 'OPENING' || body.confirmed !== true || body.idempotencyKey !== line.idempotencyKey
      || body.amountRials !== line.totalRials || body.counterAccountId !== payload.counterAccountId
      || body.occurredAt !== payload.basisAt || !hex.test(body.openingReview?.expectedSnapshotHash ?? '')
      || source?.sourcePackageHash !== payload.sourcePackageHash || source.sourceCustomerId !== line.sourceCustomerId
      || source.sourceVoucherItemId !== line.sourceVoucherItemId) closed();
  }
  return payload;
}

function verifiedReview(workspace, line, payload) {
  const review = workspace.openingReview;
  if (!review) return null;
  const evidence = review.evidence?.sepidarAdmission;
  const vouchers = review.evidence?.voucherIds;
  if (!review.id || review.idempotencyKey !== line.idempotencyKey || review.commandHash !== line.commandHash
    || review.createdBy !== line.actorId || review.basisAt !== payload.basisAt || review.totalRials !== line.totalRials
    || review.transferRials !== line.totalRials || evidence?.sourcePackageHash !== payload.sourcePackageHash
    || evidence.sourceVoucherItemId !== line.sourceVoucherItemId || evidence.counterAccountId !== payload.counterAccountId
    || !Array.isArray(vouchers) || vouchers.length !== (line.totalRials === '0' ? 0 : 1)
    || vouchers.some(voucher => typeof voucher !== 'string' || !voucher)) closed();
  return { openingReviewId: review.id, voucherId: vouchers[0] ?? null };
}

/** Reconcile the whole cohort before writing, then use only the authenticated customer posting API. */
export async function postSepidarOpeningBatch({ evidence, request, record, apply = false, now = Date.now }) {
  const payload = verifyBatch(evidence, now());
  const call = async (path, init) => {
    const response = await request(path, init);
    if (response.headers.get('x-accounting-commit') !== payload.buildCommit || !response.ok) closed();
    const body = await response.json();
    if (body?.success !== true || !body.data) closed();
    return body.data;
  };
  const planned = [];
  for (const { manifestLine: line, requestBody } of evidence.preparedRows) {
    const path = '/api/accounting/ledger/customer-accounts/' + encodeURIComponent(line.destinationKey);
    const query = '?openingBasisAt=' + encodeURIComponent(payload.basisAt);
    const current = await call(path + query);
    if (current.bookId !== payload.bookId || current.capabilities?.canManageAccount !== true) closed();
    const review = verifiedReview(current, line, payload);
    if (!review && (current.openingSnapshotHash !== requestBody.openingReview.expectedSnapshotHash
      || current.openingSources?.length !== 0)) closed();
    planned.push({ line, requestBody, path, query, review });
  }
  const periodId = planned[0].requestBody.periodId;
  if (!id.test(periodId ?? '') || planned.some(row => row.requestBody.periodId !== periodId)) closed();
  const context = await call(planned[0].path + '/context');
  const fiscalYearId = context.periods?.find(period => period.id === periodId)?.fiscalYearId;
  if (!id.test(fiscalYearId ?? '')) closed();
  const trialPath = '/api/accounting/ledger/trial-balance?' + new URLSearchParams({ bookId: payload.bookId, fiscalYearId });
  const verifyClearing = async approvedLines => {
    const trial = await call(trialPath);
    if (!Array.isArray(trial)) closed();
    const clearing = trial.filter(row => row.accountId === payload.counterAccountId);
    if (clearing.length > 1) closed();
    let expectedDebit = 0n, expectedCredit = 0n;
    for (const line of approvedLines) {
      const amount = BigInt(line.totalRials);
      if (amount < 0n) expectedDebit -= amount;
      else expectedCredit += amount;
    }
    const debit = clearing.length ? BigInt(clearing[0].debitRials) : 0n;
    const credit = clearing.length ? BigInt(clearing[0].creditRials) : 0n;
    if (debit !== expectedDebit || credit !== expectedCredit) closed();
    return debit - credit;
  };
  let clearingBalance = await verifyClearing(planned.filter(row => row.review).map(row => row.line));
  let net = 0n;
  for (const { line, requestBody, path, query, review } of planned) {
    let receipt = review;
    if (apply && !receipt) {
      if (Date.parse(payload.expiresAt) <= now()) closed();
      await record({ status: 'ATTEMPTING', idempotencyKey: line.idempotencyKey });
      const posted = await call(path + '/operations', { method: 'POST', body: JSON.stringify(requestBody) });
      receipt = verifiedReview(await call(path + query), line, payload);
      if (!receipt || posted.openingReviewId !== receipt.openingReviewId || posted.voucherId !== receipt.voucherId) closed();
    }
    if (receipt) net += BigInt(line.totalRials);
    await record({ status: receipt ? 'VERIFIED' : 'PENDING', idempotencyKey: line.idempotencyKey, ...receipt });
  }
  if (apply) clearingBalance = await verifyClearing(planned.map(row => row.line));
  return { customerCount: planned.length, verifiedCount: apply ? planned.length : planned.filter(item => item.review).length,
    verifiedNetRials: net.toString(), verifiedClearingBalanceRials: clearingBalance.toString() };
}
