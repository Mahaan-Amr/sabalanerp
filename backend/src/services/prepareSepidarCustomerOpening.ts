import { customerAccountOperationEvidence, type CustomerAccountOperation } from './accountingCustomerWorkspace';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

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
  profileId: string;
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

const amount = /^(0|[1-9][0-9]{0,19})$/;
const sourceId = /^[1-9][0-9]*$/;
const hash = /^[0-9a-f]{64}$/;

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
  if (source.targetWorkspaceKey !== destination.profileId || !destination.actor.id?.trim() || destination.actor.profile === 'VIEWER'
    || ![destination.customerId, destination.profileId, destination.bookId, destination.periodId,
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
      idempotencyKey, profileId: destination.profileId, actorId: destination.actor.id,
      sourceCustomerId: source.sourceCustomerId, sourceVoucherItemId: source.sourceVoucherItemId, totalRials: total.toString(),
      commandHash: hashAccountingEvidence(customerAccountOperationEvidence(destination.customerId, command)),
    },
  };
}
