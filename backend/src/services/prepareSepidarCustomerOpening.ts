import type { Prisma } from '@prisma/client';
import { customerAccountOperationEvidence, resolveCustomerWorkspace, type CustomerAccountOperation } from './accountingCustomerWorkspace';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';
import { customerOpeningSnapshot, isSepidarOpeningClearingAccount } from './accountingCustomerOpening';

type SourceOpening = {
  sourcePackageHash: string;
  sourceCustomerId: string;
  sourceVoucherItemId: string;
  targetWorkspaceKey: string;
  signedRials: string;
  debitRials: string;
  creditRials: string;
};

type ReviewedDestination = {
  customerId: string;
  profileId: string | null;
  bookId: string;
  periodId: string;
  postingRuleId: string;
  counterAccountId: string;
  basisAt: Date;
  snapshotHash: string;
  postedSourceCount: number;
  priorOpeningReview: boolean;
  sourceRecordByBasisCount: number;
  actor: CustomerAccountOperation['actor'];
};

type ApprovedTarget = Pick<ReviewedDestination, 'basisAt' | 'bookId' | 'periodId' | 'postingRuleId' | 'counterAccountId' | 'actor'>;

const amount = /^(0|[1-9][0-9]{0,19})$/;
const sourceId = /^[1-9][0-9]*$/;
const hash = /^[0-9a-f]{64}$/;

type ReconciledEvidenceRow = {
  sourcePartyId: number | string;
  targetWorkspaceKey: string;
  receivable: {
    contractId: string | null;
    openingVoucherItemId: number | string;
    debitRials: string;
    creditRials: string;
    signedRials: string;
  } | null;
};

/** Open only the reconciled customer balance rows; custody has its own history and ledger anchors. */
export function readReconciledSepidarCustomerEvidence(bytes: Buffer) {
  const evidence = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) as {
    format: string; currency: string; basisPersian: string; transferStatus: string;
    rows: ReconciledEvidenceRow[]; receivableCustomerCount: number;
  } | null;
  const invalid = () => { throw new AccountingCustomerTreasuryError(
    'SEPIDAR_OPENING_EVIDENCE_INVALID', 'بستهٔ تطبیق مانده‌های افتتاحیهٔ ۱۴۰۵ معتبر نیست.', 400,
  ); };
  if (!evidence || evidence.format !== 'sepidar-reviewed-opening-evidence-v1' || evidence.transferStatus !== 'UNPOSTED'
    || evidence.currency !== 'IRR' || evidence.basisPersian !== '1405-01-01' || !Array.isArray(evidence.rows)) invalid();
  const sourcePackageHash = createHash('sha256').update(bytes).digest('hex');
  const ids = new Set<string>();
  const items = new Set<string>();
  const destinations = new Set<string>();
  const rows: SourceOpening[] = [];
  const asSourceId = (value: number | string) => {
    if ((typeof value !== 'string' && !Number.isSafeInteger(value)) || !sourceId.test(String(value))) invalid();
    return String(value);
  };
  for (const row of evidence!.rows) {
    if (!row || typeof row !== 'object') invalid();
    if (row.receivable === null) continue;
    if (!row.receivable || row.receivable.contractId !== null || typeof row.targetWorkspaceKey !== 'string'
      || !row.targetWorkspaceKey.trim() || row.targetWorkspaceKey !== row.targetWorkspaceKey.trim()) invalid();
    const customerId = asSourceId(row.sourcePartyId);
    const itemId = asSourceId(row.receivable.openingVoucherItemId);
    if (ids.has(customerId) || items.has(itemId) || destinations.has(row.targetWorkspaceKey)) invalid();
    ids.add(customerId);
    items.add(itemId);
    destinations.add(row.targetWorkspaceKey);
    rows.push({ sourcePackageHash, sourceCustomerId: customerId, sourceVoucherItemId: itemId,
      targetWorkspaceKey: row.targetWorkspaceKey, debitRials: row.receivable.debitRials,
      creditRials: row.receivable.creditRials, signedRials: row.receivable.signedRials });
  }
  if (rows.length === 0 || rows.length !== evidence!.receivableCustomerCount) invalid();
  return { sourcePackageHash, rows };
}

/** Build a single unattributed command from a reconciled row and a fresh target preview.
 * The returned command has no authority to post until its exact manifest line is approved.
 */
export function prepareSepidarCustomerOpening(source: SourceOpening, destination: ReviewedDestination) {
  if (!hash.test(source.sourcePackageHash) || !sourceId.test(source.sourceCustomerId)
    || !sourceId.test(source.sourceVoucherItemId) || !amount.test(source.debitRials)
    || !amount.test(source.creditRials) || !/^(0|-?[1-9][0-9]{0,19})$/.test(source.signedRials)) {
    throw new AccountingCustomerTreasuryError('SEPIDAR_OPENING_EVIDENCE_INVALID', 'مدرک مبلغ یا شناسهٔ منبع افتتاحیه معتبر نیست.', 400);
  }
  const debit = BigInt(source.debitRials), credit = BigInt(source.creditRials), total = BigInt(source.signedRials);
  if (debit - credit !== total || (debit !== 0n && credit !== 0n)) {
    throw new AccountingCustomerTreasuryError('SEPIDAR_OPENING_EVIDENCE_INVALID', 'جمع بدهکار و بستانکار با ماندهٔ سپیدار منطبق نیست.', 400);
  }
  if ((source.targetWorkspaceKey !== destination.profileId && source.targetWorkspaceKey !== `customer:${destination.customerId}`)
    || !destination.actor.id?.trim() || destination.actor.profile === 'VIEWER'
    || ![destination.customerId, destination.bookId, destination.periodId,
      destination.postingRuleId, destination.counterAccountId].every(id => id?.trim())
    || !hash.test(destination.snapshotHash) || !Number.isFinite(destination.basisAt.getTime())
    || destination.postedSourceCount !== 0 || destination.priorOpeningReview || destination.sourceRecordByBasisCount !== 0) {
    throw new AccountingCustomerTreasuryError('SEPIDAR_OPENING_DESTINATION_REVIEW_REQUIRED', 'ابتدا پروندهٔ مقصد و ثبت‌های پیشین را دوباره تطبیق دهید.', 409);
  }
  const reference = `سپیدار، ردیف ${source.sourceVoucherItemId}`;
  const idempotencyKey = `sepidar-opening:${destination.bookId}:${source.sourceVoucherItemId}`;
  const command: CustomerAccountOperation = {
    kind: 'OPENING', amountRials: total, periodId: destination.periodId, postingRuleId: destination.postingRuleId,
    counterAccountId: destination.counterAccountId, occurredAt: destination.basisAt, confirmed: true, idempotencyKey,
    actor: destination.actor, reason: 'انتقال ماندهٔ افتتاحیهٔ تطبیق‌شده از سپیدار', reference,
    openingReview: {
      expectedSnapshotHash: destination.snapshotHash, identityConfirmed: true, totalConfirmed: true,
      sepidarEvidence: { sourcePackageHash: source.sourcePackageHash, sourceCustomerId: source.sourceCustomerId,
        sourceVoucherItemId: source.sourceVoucherItemId },
      lines: [{ key: source.sourceVoucherItemId, kind: total < 0n ? 'CREDIT' : 'RECEIVABLE',
        amountRials: total < 0n ? -total : total, reference, existingSourceIds: [] }],
    },
  };
  return {
    command,
    manifestLine: {
      idempotencyKey, destinationKey: source.targetWorkspaceKey, actorId: destination.actor.id,
      sourceCustomerId: source.sourceCustomerId, sourceVoucherItemId: source.sourceVoucherItemId, totalRials: total.toString(),
      commandHash: hashAccountingEvidence(customerAccountOperationEvidence(destination.customerId, command)),
    },
  };
}

/** Read a new destination snapshot under the caller's read-only preparation transaction. */
export async function readSepidarCustomerOpeningPreparation(
  database: Prisma.TransactionClient, source: SourceOpening, target: ApprovedTarget,
) {
  const resolved = await resolveCustomerWorkspace(database, source.targetWorkspaceKey);
  if (resolved.book?.id !== target.bookId || (!resolved.profile && (!resolved.customer || resolved.customer.cardDeletedAt))) {
    throw new AccountingCustomerTreasuryError('SEPIDAR_OPENING_DESTINATION_REVIEW_REQUIRED', 'پروندهٔ مشتری در دفتر مالی مصوب قابل استفاده نیست.', 409);
  }
  const basisAt = target.basisAt;
  const profileId = resolved.profile?.id;
  const [snapshot, priorOpeningReview, period, rule, counter] = await Promise.all([
    customerOpeningSnapshot(database, { bookId: target.bookId, customerId: resolved.customerId, profileId, basisAt }),
    profileId ? database.accountingCustomerOpeningReview.findUnique({ where: { profileId }, select: { id: true } }) : null,
    database.accountingPostingPeriod.findUnique({ where: { id: target.periodId }, include: { fiscalYear: true } }),
    database.accountingCustomerPostingRule.findUnique({ where: { id: target.postingRuleId } }),
    database.accountingLedgerAccount.findUnique({ where: { id: target.counterAccountId }, include: { dimensionRules: true } }),
  ]);
  if (!period || period.status !== 'OPEN' || period.fiscalYear.bookId !== target.bookId
    || basisAt < period.startsAt || basisAt > period.endsAt
    || !rule || rule.legalEntityId !== resolved.book.legalEntityId || rule.effectiveFrom > basisAt
    || (rule.effectiveTo && rule.effectiveTo < basisAt)) {
    throw new AccountingCustomerTreasuryError('INVALID_ACCOUNTING_CONTEXT', 'دوره و قاعدهٔ ثبت برای تاریخ افتتاحیه معتبر نیست.', 409);
  }
  if (!isSepidarOpeningClearingAccount(counter, rule, target.bookId, basisAt)) {
    throw new AccountingCustomerTreasuryError('SEPIDAR_CLEARING_ACCOUNT_INVALID', 'حساب واسط مستقل و معتبر برای افتتاحیه سپیدار موجود نیست.', 409);
  }
  return prepareSepidarCustomerOpening(source, {
    ...target, customerId: resolved.customerId, profileId: profileId ?? null, snapshotHash: snapshot.snapshotHash,
    postedSourceCount: snapshot.sources.length, priorOpeningReview: Boolean(priorOpeningReview),
    sourceRecordByBasisCount: snapshot.financialRecords.filter(record => record.systemInvoiceDate && record.systemInvoiceDate <= basisAt).length,
  });
}
import { createHash } from 'node:crypto';
