import { loadAcceptedStoneReturnStock } from './stoneReturnAvailability';
import { randomUUID } from 'node:crypto';
import { parseCanonicalDecimal } from '@sabalanerp/contract-product-graph';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AccountingCustomerTreasuryError, type CustomerTreasuryActor } from './accountingCustomerTreasury';
import { recognizeCustomerReturnWithin, type CustomerReturnRecognitionInput } from './accountingCustomerTreasuryPrisma';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { createAccountingSupplyChainPrismaRepository } from './accountingSupplyChainPrismaRepository';
import { formatExactQuantityAtoms, parseExactQuantityAtoms } from './exactQuantity';
import { EXCESS_SHIPMENT_RETURN_SOURCE } from './shipmentQuantityProjection';
import { recordFinalizedExcessShipmentReturns } from './shipmentExcessReturns';
import { lockStoneReturnCase, readStoneReturnAllocationDraft } from './stoneReturnAllocationDraft';
import { StoneReturnAllocationError, stoneReturnSourceKey, validateStoneReturnAllocations } from './stoneReturnAllocationRules';
import { loadStoneReturnCandidates } from './stoneReturnCandidates';
import { allocateOriginalReturnAmounts } from './stoneReturnOriginalAmounts';
import { apportionStoneReturnCredit } from './stoneReturnNegotiatedAmounts';
import { readStoneReturnReceipt } from './stoneReturnReceipts';

type FinalizedShare = {
  draftRowId: string; loadingId: string; loadingNumber: string | null; shipmentReturnEvidenceId: string; valuationLayerId: string; quantity: string;
  originalInvoicedQuantity: string; originalLineNetRials: string;
  originalNetRials: string; originalTaxRials: string; costRials: string;
};
type FinalizedCredit = {
  originalInvoiceId: string; originalInvoiceNumber: string; creditInvoiceId: string;
  creditNumber: string; voucherId: string; voucherNumber: number | null; taxInvoiceId: string;
  openItemId: string | null; customerCreditRials: string;
  originalNetRials: string; originalTaxRials: string; shares: FinalizedShare[];
};

type Tx = Prisma.TransactionClient;
type Draft = NonNullable<Awaited<ReturnType<typeof readStoneReturnAllocationDraft>>>;

function documentDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StoneReturnAllocationError(400, 'تاریخ سند مرجوعی معتبر نیست.');
  }
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || date > new Date()) {
    throw new StoneReturnAllocationError(400, 'تاریخ سند مرجوعی معتبر نیست.');
  }
  return date;
}

function parseCommand(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StoneReturnAllocationError(400, 'فرمان ثبت قطعی معتبر نیست.');
  const { expectedVersion, requestId, date, periodId, postingRuleId, confirmed,
    agreedUnitRateRials: rawRate, rateDifferenceReason: rawReason } = body as Record<string, unknown>;
  const id = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200;
  if (confirmed !== true || typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0
    || !id(requestId) || !id(periodId) || !id(postingRuleId)) {
    throw new StoneReturnAllocationError(400, 'نسخه پیش‌نویس، دوره، قاعده و تأیید ثبت قطعی را بررسی کنید.');
  }
  const invalidRate = 'نرخ توافقی هر واحد باید مبلغ ریالی مثبت باشد.';
  if (typeof rawRate !== 'string' || rawRate.length > 100 || !/^\d+(?:\.\d+)?$/.test(rawRate)) {
    throw new StoneReturnAllocationError(400, invalidRate);
  }
  const agreedUnitRateRials = parseCanonicalDecimal(rawRate);
  if (agreedUnitRateRials === '0') throw new StoneReturnAllocationError(400, invalidRate);
  if (rawReason != null && (typeof rawReason !== 'string' || rawReason.length > 2000)) {
    throw new StoneReturnAllocationError(400, 'دلیل تفاوت نرخ معتبر نیست.');
  }
  const rateDifferenceReason = typeof rawReason === 'string' ? rawReason.trim() || null : null;
  return { expectedVersion, requestId, date: documentDate(date), periodId, postingRuleId, agreedUnitRateRials, rateDifferenceReason };
}

async function postingOptions(tx: Tx, bookId: string, date: Date) {
  const book = await tx.accountingBook.findUnique({ where: { id: bookId } });
  if (!book || book.baseCurrency !== 'IRR') throw new StoneReturnAllocationError(409, 'دفتر ریالی صورتحساب مرجع در دسترس نیست.');
  const [periods, rules, accounts] = await Promise.all([
    tx.accountingPostingPeriod.findMany({ where: {
      fiscalYear: { bookId, status: 'ACTIVE', startsAt: { lte: date }, endsAt: { gte: date } },
      status: 'OPEN', startsAt: { lte: date }, endsAt: { gte: date },
    }, select: { id: true, titlePersian: true, fiscalYearId: true, fiscalYear: { select: { titlePersian: true } } },
    orderBy: [{ startsAt: 'desc' }, { sequence: 'asc' }] }),
    tx.accountingCustomerPostingRule.findMany({ where: {
      legalEntityId: book.legalEntityId, effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    }, orderBy: [{ effectiveFrom: 'desc' }, { code: 'asc' }, { version: 'desc' }] }),
    tx.accountingLedgerAccount.findMany({ where: {
      bookId, level: 'MOIN', effectiveFrom: { lte: date }, retiredAt: null,
    }, select: { id: true } }),
  ]);
  const bookAccounts = new Set(accounts.map(account => account.id));
  return {
    book: { id: book.id, namePersian: book.namePersian }, periods,
    rules: rules.filter(rule => [rule.receivableAccountId, rule.revenueAccountId, rule.outputTaxAccountId,
      rule.inventoryAccountId, rule.costAccountId].every(id => bookAccounts.has(id)))
      .map(({ id, code, version }) => ({ id, code, version })),
  };
}

async function validateDraft(tx: Tx, receipt: Awaited<ReturnType<typeof readStoneReturnReceipt>>, draft: Draft, date: Date) {
  const sources = await loadStoneReturnCandidates(tx, receipt);
  if (sources.blockedReason) throw new StoneReturnAllocationError(409, sources.blockedReason);
  const validated = validateStoneReturnAllocations(receipt, sources, draft.rows, draft.attributionReason, true);
  const persisted = new Map(draft.rows.map(row => [stoneReturnSourceKey(row), row]));
  const shares = validated.rows.map(({ candidate, quantity }) => {
    const row = persisted.get(stoneReturnSourceKey(candidate))!;
    if (row.originalTaxInvoiceId !== candidate.originalTaxInvoiceId || row.originalTaxLineId !== candidate.originalTaxLineId
      || row.contractId !== candidate.contractId || row.contractItemId !== candidate.contractItemId
      || row.productRowId !== candidate.productRowId) {
      throw new StoneReturnAllocationError(409, 'شواهد ردیف فروش از زمان ذخیره تخصیص تغییر کرده است.');
    }
    return { id: row.id, quantity, candidate };
  });
  const bookIds = new Set(shares.map(({ candidate }) => candidate.bookId));
  if (bookIds.size !== 1) throw new StoneReturnAllocationError(409, 'همه صورتحساب‌های مرجع باید در یک دفتر حسابداری ثبت شده باشند.');
  const bookId = shares[0].candidate.bookId;
  const invoiceIds = [...new Set(shares.map(({ candidate }) => candidate.originalInvoiceId))].sort();
  const originals = await tx.accountingCommercialCustomerInvoice.findMany({
    where: { id: { in: invoiceIds } }, select: { issuedAt: true },
  });
  if (originals.length !== invoiceIds.length || originals.some(row => row.issuedAt.toISOString().slice(0, 10) > date.toISOString().slice(0, 10))) {
    throw new StoneReturnAllocationError(409, 'تاریخ سند مرجوعی باید در روز صدور یا پس از همه صورتحساب‌های مرجع باشد.');
  }
  return { bookId, shares, invoiceIds };
}

type ValidatedShare = Awaited<ReturnType<typeof validateDraft>>['shares'][number];

async function readOriginalShares(tx: Tx, shares: ValidatedShare[]) {
  const sources = await tx.accountingTaxInvoiceLine.findMany({
    where: { id: { in: shares.map(({ candidate }) => candidate.originalTaxLineId) } },
  });
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const cumulativeByLine = new Map<string, string>();
  return shares.map(share => {
    const { candidate, quantity } = share;
    const source = sourceById.get(candidate.originalTaxLineId);
    const rateBasisPoints = (source?.allocationEvidence as Prisma.JsonObject)?.rateBasisPoints;
    if (!source || source.taxInvoiceId !== candidate.originalTaxInvoiceId
      || typeof rateBasisPoints !== 'number' || !Number.isInteger(rateBasisPoints)) {
      throw new StoneReturnAllocationError(409, 'قاعده مالیات ثبت‌شده در ردیف صورتحساب مرجع معتبر نیست.');
    }
    const originalRate = { originalInvoicedQuantity: source.quantity.toFixed(), originalLineNetRials: source.rawBaseAmount.toFixed() };
    const prior = cumulativeByLine.get(source.id) ?? candidate.linePriorReturnedQuantity;
    const amounts = allocateOriginalReturnAmounts({
      quantity: originalRate.originalInvoicedQuantity, netRials: originalRate.originalLineNetRials,
      taxRials: source.roundedTaxRials.toFixed(), costRials: source.costRials.toFixed(),
    }, prior, quantity);
    cumulativeByLine.set(source.id, formatExactQuantityAtoms(parseExactQuantityAtoms(prior) + parseExactQuantityAtoms(quantity)));
    const taxRule = { id: source.taxRuleId, version: source.taxRuleVersion, citation: source.citation, rateBasisPoints, exempt: source.exempt };
    return { ...share, originalRate, amounts, taxRule };
  });
}

function originalAmounts(shares: Awaited<ReturnType<typeof readOriginalShares>>) {
  let netRials = 0n;
  let taxRials = 0n;
  for (const { amounts } of shares) {
    netRials += amounts.netRials;
    taxRials += amounts.taxRials;
  }
  return { originalNetRials: netRials.toString(), originalTaxRials: taxRials.toString() };
}

export async function readStoneReturnPostingContext(db: PrismaClient, receiptId: string, rawDate: unknown) {
  const date = documentDate(rawDate);
  return db.$transaction(async tx => {
    const [receipt, draft, finalized] = await Promise.all([
      readStoneReturnReceipt(tx, receiptId),
      readStoneReturnAllocationDraft(tx, receiptId),
      tx.stoneReturnFinalization.findUnique({ where: { receiptId }, select: { id: true } }),
    ]);
    if (finalized) throw new StoneReturnAllocationError(409, 'این مرجوعی قبلاً ثبت قطعی شده است.');
    if (!draft) throw new StoneReturnAllocationError(409, 'پیش‌نویس تخصیص برای ثبت قطعی لازم است.');
    const { bookId, shares } = await validateDraft(tx, receipt, draft, date);
    const originalShares = await readOriginalShares(tx, shares);
    return {
      draftVersion: draft.version, ...await postingOptions(tx, bookId, date),
      originalAmounts: originalAmounts(originalShares),
      originalRates: originalShares.map(share => share.originalRate),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

export async function finalizeStoneReturn(db: PrismaClient, receiptId: string, actor: CustomerTreasuryActor, body: unknown) {
  if (actor.profile === 'VIEWER') {
    throw new AccountingCustomerTreasuryError('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت قطعی مرجوعی ندارید.', 403);
  }
  const command = parseCommand(body);
  const commandHash = hashAccountingEvidence({ receiptId, ...command });
  const record = async (tx: Tx) => {
    await lockStoneReturnCase(tx, receiptId);
    const prior = await tx.stoneReturnFinalization.findUnique({ where: { receiptId } });
    if (prior) {
      if (prior.finalizedBy !== actor.id || prior.requestId !== command.requestId || prior.commandHash !== commandHash) {
        throw new StoneReturnAllocationError(409, 'این مرجوعی قبلاً با فرمان دیگری ثبت قطعی شده است.');
      }
      return { data: prior, replayed: true };
    }
    const [receipt, draft] = await Promise.all([
      readStoneReturnReceipt(tx, receiptId), readStoneReturnAllocationDraft(tx, receiptId),
    ]);
    if (!draft || draft.version !== command.expectedVersion) {
      throw new StoneReturnAllocationError(409, 'نسخه تخصیص تغییر کرده است. پرونده را دوباره باز کنید.');
    }
    const accountKey = `customer-account:${receipt.customerId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountKey}))`;
    if (receipt.guardReturnMovementId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`GUARD_RETURN:${receipt.guardReturnMovementId}`}))`;
    }
    for (const id of [...new Set(draft.rows.map(row => row.originalInvoiceId))].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-return:${id}`}))`;
    }
    for (const id of [...new Set(draft.rows.map(row => row.dispatchEvidenceId))].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`SHIPMENT_EVIDENCE:${id}`}))`;
    }
    const { bookId, shares, invoiceIds } = await validateDraft(tx, receipt, draft, command.date);
    const originalShares = await readOriginalShares(tx, shares);
    const invoiceGroups = invoiceIds.map(originalInvoiceId => ({
      originalInvoiceId, invoiceShares: originalShares.filter(({ candidate }) => candidate.originalInvoiceId === originalInvoiceId),
    }));
    const negotiated = apportionStoneReturnCredit(command.agreedUnitRateRials, invoiceGroups.map(({ invoiceShares }) =>
      formatExactQuantityAtoms(invoiceShares.reduce((total, row) => total + parseExactQuantityAtoms(row.quantity), 0n))));
    if (negotiated.agreedRials <= 0n) {
      throw new StoneReturnAllocationError(400, 'مبلغ بستانکاری پس از گرد کردن باید دست‌کم یک ریال باشد.');
    }
    const options = await postingOptions(tx, bookId, command.date);
    const period = options.periods.find(item => item.id === command.periodId);
    const rule = options.rules.find(item => item.id === command.postingRuleId);
    if (!period || !rule) throw new StoneReturnAllocationError(409, 'دوره باز و قاعده مؤثر ثبت مشتری را از دفتر مرجع انتخاب کنید.');
    if (receipt.inventoryIdentityId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${receipt.inventoryIdentityId}))`;
    }
    const stock = await loadAcceptedStoneReturnStock(tx, receipt);
    if (!stock) throw new StoneReturnAllocationError(409, 'مقدار یا هویت موجودی با شاهد تغییرناپذیر پذیرش لجستیک سازگار نیست.');
    const repository = createAccountingSupplyChainPrismaRepository(tx);
    await repository.lockInventoryIdentities([stock.identity.id]);
    if ((await repository.listLayers(stock.identity.id)).length) {
      throw new StoneReturnAllocationError(409, 'موجودی این دریافت قبلاً ارزش‌گذاری شده است.');
    }
    const finalizedAt = new Date();
    const draftHash = hashAccountingEvidence(draft);
    const shipmentReturns = await recordFinalizedExcessShipmentReturns(tx, {
      caseId: receiptId, actorId: actor.id, finalizedAt,
      shares: shares.map(({ id, quantity, candidate }) => ({
        dispatchShareId: id, dispatchEvidenceId: candidate.dispatchEvidenceId, quantity, unit: candidate.unit,
        contractId: candidate.contractId, contractItemId: candidate.contractItemId, productRowId: candidate.productRowId,
      })),
    });
    const shipmentIds = new Map(shipmentReturns.map(item => [item.dispatchShareId, item.evidenceId]));
    const credits: FinalizedCredit[] = [];
    for (const [index, { originalInvoiceId, invoiceShares }] of invoiceGroups.entries()) {
      const customerCreditRials = negotiated.invoiceCredits[index];
      const lines: CustomerReturnRecognitionInput['lines'] = invoiceShares.map(({ id, quantity, candidate, amounts, taxRule }) => ({
        id, originalLineId: candidate.originalLineId, evidenceId: shipmentIds.get(id)!, productRowId: candidate.productRowId,
        quantity, ...amounts, taxRule,
      }));
      const identity = `stone-return:${receiptId}:${originalInvoiceId}`;
      const credit = await recognizeCustomerReturnWithin(tx, {
        originalInvoiceId, commercialCreditNumber: identity, bookId, fiscalYearId: period.fiscalYearId, periodId: period.id,
        returnedAt: command.date, postingRule: rule, idempotencyKey: identity, correlationId: `stone-return:${receiptId}`,
        evidenceIds: lines.map(line => line.evidenceId), lines, actor,
      }, {
        caseId: receiptId, agreedGrossRials: customerCreditRials,
        lines: lines.map(line => ({ lineId: line.id, agreedUnitRateRials: command.agreedUnitRateRials,
          rateDifferenceReason: command.rateDifferenceReason ?? undefined })),
      }, {
        caseId: receiptId, finalizedAt, customerId: receipt.customerId, unit: receipt.unit, receiptEventId: stock.event.id,
        receiptEvidenceHash: stock.evidence.hash, draftId: draft.id, draftVersion: draft.version, draftHash, attributionReason: draft.attributionReason,
        shares: invoiceShares.map(({ id, candidate }) => ({
          id, evidenceId: shipmentIds.get(id)!, dispatchEvidenceId: candidate.dispatchEvidenceId,
          contractItemId: candidate.contractItemId, originalTaxLineId: candidate.originalTaxLineId,
        })),
      });
      if (!credit.taxInvoiceId) throw new StoneReturnAllocationError(409, 'سند مالیاتی مرجوعی در زنجیره ثبت قطعی پیدا نشد.');
      const [voucher, openItem] = await Promise.all([
        tx.accountingLedgerVoucher.findUniqueOrThrow({ where: { id: credit.ledgerVoucherId }, select: { statutoryNumber: true } }),
        tx.accountingCustomerOpenItem.findUnique({ where: { invoiceId_kind: { invoiceId: credit.id, kind: 'CREDIT' } },
          select: { id: true, originalRials: true } }),
      ]);
      const postedCreditRials = openItem?.originalRials.toFixed(0) ?? '0';
      if (postedCreditRials !== customerCreditRials.toString() || (customerCreditRials === 0n && openItem)) {
        throw new StoneReturnAllocationError(409, 'بستانکاری ثبت‌شده با مبلغ توافقی مرجوعی سازگار نیست.');
      }
      const valuedShares: FinalizedShare[] = [];
      for (const [lineIndex, line] of lines.entries()) {
        const layerId = randomUUID();
        await repository.saveLayer({
          id: layerId, identityId: stock.identity.id, originId: receiptId, unit: receipt.unit,
          warehouseId: stock.event.warehouseId, locationId: stock.event.locationId, quantity: line.quantity,
          valueRials: line.costRials, valuationMethod: stock.identity.valuationMethod,
          sourceType: EXCESS_SHIPMENT_RETURN_SOURCE, sourceId: line.id, createdAt: finalizedAt,
        });
        const { originalRate, candidate } = invoiceShares[lineIndex];
        valuedShares.push({
          loadingId: candidate.loadingId, loadingNumber: candidate.loadingNumber, draftRowId: line.id, shipmentReturnEvidenceId: line.evidenceId, valuationLayerId: layerId, quantity: line.quantity,
          ...originalRate,
          originalNetRials: line.netRials.toString(), originalTaxRials: line.taxRials.toString(), costRials: line.costRials.toString(),
        });
      }
      credits.push({
        originalInvoiceId, originalInvoiceNumber: invoiceShares[0].candidate.originalInvoiceNumber,
        creditInvoiceId: credit.id, creditNumber: credit.number, voucherId: credit.ledgerVoucherId, taxInvoiceId: credit.taxInvoiceId,
        voucherNumber: voucher.statutoryNumber, openItemId: openItem?.id ?? null,
        customerCreditRials: postedCreditRials, ...originalAmounts(invoiceShares), shares: valuedShares,
      });
    }
    const data = await tx.stoneReturnFinalization.create({ data: {
      receiptId, draftId: draft.id, draftVersion: draft.version, draftHash, requestId: command.requestId, commandHash,
      finalizedBy: actor.id, finalizedAt, documentDate: command.date, bookId, periodId: period.id, postingRuleId: rule.id,
      summary: {
        inventoryIdentityId: stock.identity.id, receiptEventId: stock.event.id, receiptEvidenceHash: stock.evidence.hash,
        agreedUnitRateRials: command.agreedUnitRateRials, rateDifferenceReason: command.rateDifferenceReason,
        customerCreditRials: negotiated.agreedRials.toString(), ...originalAmounts(originalShares), credits,
      },
    } });
    return { data, replayed: false };
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(record, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
    } catch (error) {
      const failure = error as { code?: string; meta?: { code?: string } } | null;
      if (failure?.code !== 'P2034' && failure?.code !== 'P2002' && !(failure?.code === 'P2010' && failure.meta?.code === '40001')) throw error;
      if (attempt === 2) throw new StoneReturnAllocationError(409, 'اطلاعات مرجوعی هم‌زمان تغییر کرد. پرونده را دوباره باز کنید.');
    }
  }
}
