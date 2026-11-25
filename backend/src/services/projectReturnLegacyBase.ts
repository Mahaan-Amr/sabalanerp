import type { Prisma } from '@prisma/client';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { formatExactQuantityAtoms, parseExactQuantityAtoms } from './exactQuantity';
import { ProjectReturnReceiptError } from './projectReturnReceipts';
import { mapPersistedEvidence, shipmentQuantityEvidenceHashMatches } from './shipmentQuantityProjectionStore';
import { lockStoneReturnCase, readStoneReturnAllocationReview } from './stoneReturnAllocationDraft';
import { stoneReturnSourceKey } from './stoneReturnAllocationRules';
import { loadAcceptedStoneReturnStock } from './stoneReturnAvailability';
import { type StoneReturnCandidate } from './stoneReturnCandidates';
import { readVerifiedProjectDispatch, stoneReturnEvidenceRecord as record } from './projectReturnDispatch';

type Tx = Prisma.TransactionClient;
type Draft = NonNullable<Awaited<ReturnType<typeof readStoneReturnAllocationReview>>['draft']>;
type PostedRow = Draft['rows'][number];

const invalidBase = () => new ProjectReturnReceiptError(409, 'شواهد ثبت قطعی، تخصیص یا اسناد مرجوعی اصلی قابل تأیید نیست.');

async function historicalProject(tx: Tx, row: PostedRow, customerId: string, productId: string, unit: string) {
  const dispatch = await tx.shipmentQuantityEvidence.findUnique({ where: { id: row.dispatchEvidenceId } });
  if (!dispatch || dispatch.contractId !== row.contractId || dispatch.contractItemId !== row.contractItemId
    || dispatch.productRowId !== row.productRowId || dispatch.unit !== unit) return null;
  return readVerifiedProjectDispatch(tx, dispatch, customerId, productId);
}

export async function readLegacyProjectReturnBase(tx: Tx, receiptId: string) {
  const { receipt, finalization, draft } = await readStoneReturnAllocationReview(tx, receiptId);
  if (!finalization || !draft) throw new ProjectReturnReceiptError(409, 'برای این رسید ثبت قطعی وجود ندارد.');
  const summary = record(finalization.summary);
  const finalizedDraft = await tx.stoneReturnAllocationDraft.findUniqueOrThrow({ where: { id: draft.id }, select: { receiptId: true } });
  if (finalizedDraft.receiptId !== receipt.id || finalization.draftVersion !== draft.version
    || finalization.draftHash !== hashAccountingEvidence(draft) || !draft.rows.length
    || draft.rows.reduce((sum, row) => sum + parseExactQuantityAtoms(row.quantity), 0n) !== parseExactQuantityAtoms(receipt.acceptedQuantity)
    || !Array.isArray(summary.credits) || !summary.credits.length
    || typeof summary.agreedUnitRateRials !== 'string' || typeof summary.customerCreditRials !== 'string') throw invalidBase();

  const stock = await loadAcceptedStoneReturnStock(tx, receipt);
  if (!stock || summary.inventoryIdentityId !== stock.identity.id
    || summary.receiptEventId !== stock.event.id || summary.receiptEvidenceHash !== stock.evidence.hash) throw invalidBase();

  const rowsById = new Map(draft.rows.map(row => [row.id, row]));
  const verifiedRows = new Set<string>();
  const credits = await Promise.all(summary.credits.map(async entry => {
    const ref = record(entry);
    const { creditInvoiceId, originalInvoiceId, voucherId, taxInvoiceId, openItemId, customerCreditRials } = ref;
    if (typeof creditInvoiceId !== 'string' || typeof originalInvoiceId !== 'string' || typeof voucherId !== 'string'
      || typeof taxInvoiceId !== 'string' || (openItemId !== null && typeof openItemId !== 'string')
      || typeof customerCreditRials !== 'string' || !/^\d+$/.test(customerCreditRials)
      || !Array.isArray(ref.shares) || !ref.shares.length) throw invalidBase();
    const [credit, voucher, tax, original] = await Promise.all([
      tx.accountingCommercialCustomerInvoice.findUnique({ where: { id: creditInvoiceId }, include: {
        profile: { select: { partySourceId: true, partySourceKind: true } },
        openItems: { where: { kind: 'CREDIT' }, include: {
          sourceSettlements: { where: { reversesId: null, reversedById: null }, include: { lines: { select: { amountRials: true } } } },
          allocationLines: { where: { allocation: { reversesId: null, reversedById: null } },
            select: { amountRials: true, allocation: { select: { id: true, ledgerVoucherId: true } } } },
        } },
      } }),
      tx.accountingLedgerVoucher.findUnique({ where: { id: voucherId } }),
      tx.accountingTaxInvoice.findUnique({ where: { id: taxInvoiceId } }),
      tx.accountingCommercialCustomerInvoice.findUnique({ where: { id: originalInvoiceId } }),
    ]);
    const payload = record(voucher?.sourcePayload);
    const binding = record(payload.stoneReturn);
    const openItem = credit?.openItems[0];
    if (!credit || credit.status !== 'CREDIT_NOTE' || credit.controlEvidenceType !== 'EXCESS_RETURN_FINALIZED'
      || credit.referenceInvoiceId !== originalInvoiceId || credit.ledgerVoucherId !== voucherId || credit.taxInvoiceId !== taxInvoiceId
      || credit.profile.partySourceId !== receipt.customerId || credit.profile.partySourceKind !== 'CUSTOMER'
      || !voucher || !voucher.postedAt || !['POSTED', 'REVERSED'].includes(voucher.status) || voucher.bookId !== finalization.bookId
      || voucher.sourceType !== 'EXCESS_RETURN_FINALIZED' || voucher.sourceId !== `stone-return:${receipt.id}:${originalInvoiceId}`
      || voucher.sourceVersion !== 1 || hashAccountingEvidence(voucher.sourcePayload) !== voucher.sourceHash
      || binding.caseId !== receipt.id || binding.customerId !== receipt.customerId || binding.unit !== receipt.unit
      || binding.receiptEventId !== stock.event.id || binding.receiptEvidenceHash !== stock.evidence.hash
      || binding.draftId !== draft.id || binding.draftVersion !== draft.version || binding.draftHash !== finalization.draftHash
      || payload.originalInvoiceId !== originalInvoiceId || !original || original.profileId !== credit.profileId || !original.taxInvoiceId
      || !tax || tax.documentKind !== 'RETURN' || tax.referenceTaxInvoiceId !== original.taxInvoiceId
      || tax.commercialInvoiceId !== creditInvoiceId || tax.ledgerVoucherId !== voucherId
      || (openItem?.id ?? null) !== openItemId || (openItem?.originalRials.toFixed(0) ?? '0') !== customerCreditRials
      || (customerCreditRials === '0') !== (openItemId === null)) throw invalidBase();

    const boundShares = Array.isArray(binding.shares) ? binding.shares.map(record) : [];
    if (boundShares.length !== ref.shares.length) throw invalidBase();
    for (const value of ref.shares) {
      const share = record(value);
      const { draftRowId, shipmentReturnEvidenceId } = share;
      const row = typeof draftRowId === 'string' ? rowsById.get(draftRowId) : null;
      const bound = boundShares.find(item => item.id === draftRowId);
      if (!row || verifiedRows.has(row.id) || row.originalInvoiceId !== originalInvoiceId || row.originalTaxInvoiceId !== original.taxInvoiceId
        || !bound || bound.evidenceId !== shipmentReturnEvidenceId || bound.dispatchEvidenceId !== row.dispatchEvidenceId
        || bound.contractItemId !== row.contractItemId || bound.originalTaxLineId !== row.originalTaxLineId
        || typeof shipmentReturnEvidenceId !== 'string') throw invalidBase();
      verifiedRows.add(row.id);
      const [posted, evidence] = await Promise.all([
        tx.accountingReturnEvidenceConsumption.findUnique({ where: { evidenceId: shipmentReturnEvidenceId } }),
        tx.shipmentQuantityEvidence.findUnique({ where: { id: shipmentReturnEvidenceId } }),
      ]);
      if (!posted || posted.creditInvoiceId !== creditInvoiceId || posted.originalInvoiceId !== row.originalInvoiceId
        || posted.originalLineId !== row.originalLineId || posted.productRowId !== row.productRowId || !posted.quantity.eq(row.quantity)
        || !evidence || evidence.kind !== 'EXCESS_RETURN_FINALIZED' || evidence.sourceId !== row.id
        || evidence.dispatchEvidenceId !== row.dispatchEvidenceId || evidence.contractId !== row.contractId
        || evidence.contractItemId !== row.contractItemId || evidence.productRowId !== row.productRowId || evidence.unit !== receipt.unit
        || !evidence.quantity.eq(row.quantity) || record(evidence.metadata).returnCaseId !== receipt.id
        || !shipmentQuantityEvidenceHashMatches(mapPersistedEvidence(evidence))) throw invalidBase();
    }

    const settlements = [
      ...(openItem?.sourceSettlements.flatMap(item => item.lines.map(line => ({
        id: item.id, voucherId: item.ledgerVoucherId, amountRials: line.amountRials.toFixed(0),
      }))) ?? []),
      ...(openItem?.allocationLines.map(line => ({ id: line.allocation.id,
        voucherId: line.allocation.ledgerVoucherId, amountRials: line.amountRials.toFixed(0) })) ?? []),
    ];
    const usedRials = settlements.reduce((sum, item) => sum + BigInt(item.amountRials), 0n);
    return { creditInvoiceId, creditNumber: credit.number, originalInvoiceId, voucherId, openItemId,
      voucherNumber: voucher.statutoryNumber, voucherStatus: voucher.status, customerCreditRials, settlements,
      usedRials: usedRials.toString(),
      availableRials: (BigInt(customerCreditRials) - usedRials).toString(),
      taxDocument: { id: tax.id, serial: tax.internalSerial, status: tax.status, referenceTaxInvoiceId: tax.referenceTaxInvoiceId },
    };
  }));
  if (verifiedRows.size !== draft.rows.length
    || credits.reduce((sum, credit) => sum + BigInt(credit.customerCreditRials), 0n).toString() !== summary.customerCreditRials) throw invalidBase();

  const [projects, dependencies, guardMovement] = await Promise.all([
    Promise.all(draft.rows.map(row => historicalProject(tx, row, receipt.customerId, receipt.productId, receipt.unit))),
    tx.accountingInventoryIdentity.findUnique({
      where: { id: stock.identity.id }, select: {
        reservations: { where: { status: 'ACTIVE' }, select: { id: true, purposeId: true, quantity: true } },
        events: { where: { id: { not: stock.event.id } }, select: { id: true, eventType: true, quantity: true } },
      },
    }),
    receipt.guardReturnMovementId ? tx.securityVehicleMovement.findUnique({
      where: { id: receipt.guardReturnMovementId }, select: { occurredAt: true },
    }) : null,
  ]);
  const sourceChanged = credits.some(credit => credit.voucherStatus !== 'POSTED');
  const projectAttributionKnown = projects.every(project => project !== null);
  return {
    receipt, finalizationId: finalization.id, finalizedAt: finalization.finalizedAt,
    deliveredBefore: guardMovement?.occurredAt ?? receipt.createdAt,
    agreedUnitRateRials: summary.agreedUnitRateRials, creditRials: summary.customerCreditRials,
    rows: draft.rows.map((row, index) => ({
      ...row, projectId: projects[index]?.projectId ?? null, projectName: projects[index]?.projectName ?? null,
    })),
    credits, sourceChanged, projectAttributionKnown,
    reservations: dependencies?.reservations.map(item => ({ ...item, quantity: item.quantity.toFixed() })) ?? [],
    inventoryEvents: dependencies?.events.map(item => ({ ...item, quantity: item.quantity.toFixed() })) ?? [],
  };
}

type Base = Awaited<ReturnType<typeof readLegacyProjectReturnBase>>;

export function requireCurrentLegacyProjectReturnBase(base: Base) {
  if (base.sourceChanged) throw new ProjectReturnReceiptError(409, 'در مسیر قبلی مرجوعی اصلاح ثبت شده یا سند مرجع تغییر کرده است.');
}

export function includePriorProjectReturnCapacity(candidates: StoneReturnCandidate[], base: Base) {
  if (base.sourceChanged) return candidates;
  const rows = new Map(base.rows.map(row => [stoneReturnSourceKey(row), row]));
  return candidates.map(candidate => {
    const prior = rows.get(stoneReturnSourceKey(candidate));
    if (!prior || prior.originalTaxLineId !== candidate.originalTaxLineId || prior.originalTaxInvoiceId !== candidate.originalTaxInvoiceId
      || prior.contractId !== candidate.contractId || prior.contractItemId !== candidate.contractItemId || prior.productRowId !== candidate.productRowId
      || (prior.projectId && prior.projectId !== candidate.projectId)) return candidate;
    const own = parseExactQuantityAtoms(prior.quantity);
    const line = parseExactQuantityAtoms(candidate.lineRemainingQuantity) + own;
    const dispatch = parseExactQuantityAtoms(candidate.dispatchRemainingQuantity) + own;
    return {
      ...candidate,
      lineRemainingQuantity: formatExactQuantityAtoms(line), dispatchRemainingQuantity: formatExactQuantityAtoms(dispatch),
      remainingQuantity: formatExactQuantityAtoms(line < dispatch ? line : dispatch),
      replacementCapacity: { ownQuantity: prior.quantity, lineRemainingQuantity: candidate.lineRemainingQuantity,
        dispatchRemainingQuantity: candidate.dispatchRemainingQuantity },
    };
  });
}

export async function readCurrentProjectReturnLegacyBase(tx: Tx, legacyFinalizationId: string, lock = false) {
  const finalization = await tx.stoneReturnFinalization.findUniqueOrThrow({
    where: { id: legacyFinalizationId }, select: { receiptId: true },
  });
  if (lock) await lockStoneReturnCase(tx, finalization.receiptId);
  return readLegacyProjectReturnBase(tx, finalization.receiptId);
}
