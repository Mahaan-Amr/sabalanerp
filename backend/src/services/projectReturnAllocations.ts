import { Prisma, type PrismaClient } from '@prisma/client';
import { multiplyContractMonetaryAmounts, parseCanonicalDecimal, roundContractPayableTotal } from '@sabalanerp/contract-product-graph';
import { formatExactQuantityAtoms, parseExactQuantityAtoms } from './exactQuantity';
import { listProjectReturnReceipts, projectReturnId, readProjectReturnReceipt } from './projectReturnReceipts';
import { includePriorProjectReturnCapacity, readCurrentProjectReturnLegacyBase, requireCurrentLegacyProjectReturnBase } from './projectReturnLegacyBase';
import { stoneReturnEvidenceRecord } from './projectReturnDispatch';
import { loadProjectReturnFinancialCandidates, type CapturedProjectReturnSource } from './projectReturnFinancialCandidates';
import { loadStoneReturnCandidates } from './stoneReturnCandidates';
import {
  StoneReturnAllocationError, stoneReturnDraftBalances, validateStoneReturnAllocations, type AllocationSource,
} from './stoneReturnAllocationRules';

import {
  lockProjectReturnCase, presentDraft, readLatestProjectReturnAllocationDraft, withProjectReturnCaseTransaction, type ProjectReturnDraftRow,
  type ProjectReturnRateBasis,
} from './projectReturnDraftState';
export { lockProjectReturnCase, readLatestProjectReturnAllocationDraft, projectReturnDraftHasAllocations } from './projectReturnDraftState';

type Tx = Prisma.TransactionClient;
type Draft = ReturnType<typeof presentDraft>;
type Receipt = Awaited<ReturnType<typeof readProjectReturnReceipt>>;
type LegacyBase = Awaited<ReturnType<typeof readCurrentProjectReturnLegacyBase>>;

function allocationStatus(receipt: Receipt, draft: Draft | null) {
  if (receipt.operationStatus !== 'ACTIVE') return receipt.operationStatus;
  if (receipt.legacyFinalizationId && !receipt.version.submittedAt) return 'CORRECTION_WITH_LOGISTICS';
  if (receipt.version.items.every(item => parseExactQuantityAtoms(item.healthyQuantity) === 0n)) return 'DAMAGED_ONLY';
  if (!draft) return 'RECEIVED';
  const allocated = new Map(draft.items.map(item => [
    item.itemId, item.rows.reduce((total, row) => total + parseExactQuantityAtoms(row.quantity), 0n),
  ]));
  return receipt.version.items.every(item => (allocated.get(item.id) ?? 0n) === parseExactQuantityAtoms(item.healthyQuantity))
    ? 'ALLOCATION_COMPLETE' : 'DRAFT';
}

export async function listProjectReturnAllocationReviews(tx: Tx, after?: string) {
  const page = await listProjectReturnReceipts(tx, after, 'latest');
  const versions = page.items.map(receipt => receipt.version.id);
  const versionDrafts = await tx.projectReturnVersion.findMany({
    where: { id: { in: versions } },
    select: { id: true, allocationDrafts: { orderBy: { number: 'desc' }, take: 1 } },
  });
  const latestDrafts = new Map(versionDrafts.map(({ id, allocationDrafts: [draft] }) => [id, draft ? presentDraft(draft) : null]));
  return { ...page, items: page.items.map(receipt => ({
    ...receipt, allocationStatus: allocationStatus(receipt, latestDrafts.get(receipt.version.id) ?? null),
  })) };
}

function readCapturedContractSources(value: Prisma.JsonValue): CapturedProjectReturnSource[] | undefined {
  // Earlier versions stored no source snapshot; preserve readback of those receipts.
  if (value === null) return undefined;
  if (!Array.isArray(value)) return [];
  return value.flatMap<CapturedProjectReturnSource>(entry => {
    const { projectId, contractId, contractItemId, productRowId, dispatchEvidenceId, partnerCaseId, partnerRevision } = stoneReturnEvidenceRecord(entry);
    if (typeof projectId !== 'string' || typeof contractId !== 'string') return [];
    if (typeof partnerCaseId === 'string' && typeof partnerRevision === 'number' && typeof productRowId === 'string') {
      return [{ projectId, contractId, productRowId, partnerCaseId, partnerRevision }];
    }
    if (typeof contractItemId !== 'string' || (productRowId !== null && typeof productRowId !== 'string')
      || (dispatchEvidenceId !== undefined && typeof dispatchEvidenceId !== 'string')) return [];
    return [{ projectId, contractId, contractItemId, productRowId, dispatchEvidenceId }];
  });
}

async function sourcesForReceipt(tx: Tx, receipt: Receipt, base: LegacyBase | null) {
  const projectIds = receipt.version.submittedAt ? receipt.version.projects.map(project => project.projectId) : [];
  const snapshots = await tx.projectReturnVersionItem.findMany({
    where: { versionId: receipt.version.id }, select: { id: true, contractSources: true },
  });
  const sourcesByItem = new Map(snapshots.map(item => [item.id, readCapturedContractSources(item.contractSources)]));
  return Promise.all(receipt.version.items.map(async item => {
    const contractSources = sourcesByItem.get(item.id);
    const createdAt = base?.receipt.createdAt ?? receipt.createdAt;
    const deliveredBefore = base?.deliveredBefore ?? receipt.visit?.admittedAt ?? createdAt;
    const sources = await loadStoneReturnCandidates(tx, {
      customerId: receipt.customerId, productId: item.productId, unit: item.unit,
      acceptedQuantity: item.healthyQuantity, createdAt, guardReturnMovementId: null,
    }, { projectIds, deliveredBefore, contractSources: contractSources?.filter(source => 'contractItemId' in source) });
    const financial = parseExactQuantityAtoms(item.healthyQuantity) > 0n
      ? await loadProjectReturnFinancialCandidates(tx, {
        customerId: receipt.customerId, productId: item.productId, unit: item.unit,
        projectIds, before: createdAt, contractSources,
      }, sources.candidates)
      : [];
    const physical = base ? includePriorProjectReturnCapacity(sources.candidates, base) : sources.candidates;
    return { ...item, ...sources, candidates: [...physical, ...financial] };
  }));
}

type ItemsWithSources = Awaited<ReturnType<typeof sourcesForReceipt>>;

function expectedRateBasis(unit: string): ProjectReturnRateBasis {
  return unit === 'meter' ? 'HEALTHY_SQUARE_METER' : 'RECEIPT_UNIT';
}

function priceDraftAllocation(
  item: Pick<Receipt['version']['items'][number], 'unit' | 'effectiveWidthMeters'>,
  entry: Draft['items'][number] | undefined,
  allocated: bigint,
  allocationError: string | null,
) {
  const expected = expectedRateBasis(item.unit);
  const savedRate = entry?.agreedUnitRateRials ?? null;
  const savedBasis = entry?.agreedRateBasis ?? 'RECEIPT_UNIT';
  const agreedRateBasis = savedRate !== null && savedBasis === expected ? expected : null;
  const agreedUnitRateRials = agreedRateBasis === null ? null : savedRate;
  const legacyRateNeedsReview = item.unit === 'meter' && savedRate !== null && agreedUnitRateRials === null;
  const width = item.unit === 'meter' ? item.effectiveWidthMeters : '1';
  const draftAmountRials = agreedUnitRateRials !== null && width && allocated > 0n && !allocationError
    ? roundContractPayableTotal(multiplyContractMonetaryAmounts(agreedUnitRateRials,
      multiplyContractMonetaryAmounts(formatExactQuantityAtoms(allocated), width)), 'IRR').roundedAmount
    : null;
  return { agreedRateBasis, agreedUnitRateRials, legacyRateNeedsReview, draftAmountRials };
}

function presentReview(receipt: Receipt, sources: ItemsWithSources, draft: Draft | null, base: LegacyBase | null) {
  const draftByItem = new Map(draft?.items.map(item => [item.itemId, item]));
  const items = sources.map(item => {
    const { candidates, hasUnlinkedOriginals, ...details } = item;
    const entry = draftByItem.get(item.id);
    const rows = entry?.rows ?? [];
    const allocated = rows.reduce((total, row) => total + parseExactQuantityAtoms(row.quantity), 0n);
    const unallocated = parseExactQuantityAtoms(item.healthyQuantity) - allocated;
    let allocationError: string | null = null;
    try {
      if (rows.length) validateStoneReturnAllocations({ acceptedQuantity: item.healthyQuantity, unit: item.unit }, item, rows, null);
    } catch (error) {
      if (!(error instanceof StoneReturnAllocationError)) throw error;
      allocationError = error.message;
    }
    return {
      ...details, candidates: stoneReturnDraftBalances(candidates, rows), hasUnlinkedOriginals, rows, ...priceDraftAllocation(details, entry, allocated, allocationError), allocationError,
      allocatedQuantity: formatExactQuantityAtoms(allocated), unallocatedQuantity: formatExactQuantityAtoms(unallocated),
    };
  });
  const status = allocationStatus(receipt, draft);
  const allocationBlock = receipt.operationStatus !== 'ACTIVE'
    ? { code: 'OPERATIONAL_REWORK', message: 'وضعیت عملیاتی پرونده اجازهٔ ثبت قطعی نمی‌دهد.' }
    : status === 'DAMAGED_ONLY'
    ? { code: 'NO_HEALTHY_QUANTITY', message: 'این پرونده مقدار سالمی برای تخصیص و ثبت مالی ندارد.' }
    : items.some(item => item.allocationError)
      ? { code: 'ALLOCATION_STALE', message: 'مانده فروش تغییر کرده است. تخصیص‌های پرونده را دوباره بررسی کنید.' }
      : items.some(item => parseExactQuantityAtoms(item.unallocatedQuantity) !== 0n)
        ? { code: 'ALLOCATION_INCOMPLETE', message: 'برای ثبت قطعی باید تمام مقدار سالم به ردیف‌های معتبر فروش تخصیص یابد.' }
        : items.some(item => item.rows.length && item.agreedUnitRateRials === null)
          ? { code: 'RATE_REQUIRED', message: 'نرخ توافقی هر محصول تخصیص‌یافته را وارد کنید.' }
          : items.some(item => item.rows.length && item.unit === 'meter' && item.draftAmountRials === null)
            ? { code: 'WIDTH_REQUIRED', message: 'برای محاسبهٔ مبلغ سنگ طولی، عرض مؤثر باید در رسید ثبت شود.' }
            : { code: 'FINANCE_CONNECTION_UNAVAILABLE', message: 'تخصیص کامل است. اتصال ثبت مالی مرجوعی پروژه هنوز فعال نیست.' };
  const correctionBlocks: Array<{ code: string; message: string }> = [];
  if (base?.sourceChanged) correctionBlocks.push({ code: 'LEGACY_SOURCE_CHANGED', message: 'در مسیر قبلی مرجوعی اصلاح ثبت شده یا سند مرجع تغییر کرده است.' });
  if (status === 'CORRECTION_WITH_LOGISTICS') correctionBlocks.push({ code: 'CORRECTION_WITH_LOGISTICS', message: 'نسخهٔ اصلاحی برای تکمیل نزد لجستیک است.' });
  if (base && !base.projectAttributionKnown) correctionBlocks.push({ code: 'HISTORICAL_PROJECT_UNKNOWN', message: 'پروژهٔ ثبت قطعی تاریخی قابل احراز نیست. انتخاب پروژه در نسخهٔ پیشنهادی این مسدودی را رفع نمی‌کند.' });
  if (base && base.rows.some(row => row.projectId && !receipt.version.projects.some(project => project.projectId === row.projectId))) {
    correctionBlocks.push({ code: 'HISTORICAL_PROJECT_MISMATCH', message: 'نسخهٔ پیشنهادی همهٔ پروژه‌های احرازشدهٔ مرجوعی قطعی را پوشش نمی‌دهد.' });
  }
  if (base?.credits.some(credit => credit.usedRials !== '0')) correctionBlocks.push({ code: 'CREDIT_SETTLED', message: 'بخشی از بستانکاری قبلی مصرف یا تسویه شده است.' });
  if (base?.reservations.length) correctionBlocks.push({ code: 'STOCK_RESERVED', message: 'موجودی مرجوعی اصلی رزرو فعال دارد.' });
  if (base?.inventoryEvents.length) correctionBlocks.push({ code: 'STOCK_MOVED', message: 'پس از دریافت اصلی روی موجودی گردش ثبت شده است.' });
  if (base) correctionBlocks.push({ code: 'FINANCE_CONNECTION_UNAVAILABLE', message: 'اتصال ثبت مالی اصلاح مرجوعی پروژه هنوز فعال نیست.' });
  return {
    receipt, items, prior: base, correctionBlocks, draft: draft ? { number: draft.number, createdAt: draft.createdAt } : null,
    allocationStatus: status, postingBlock: correctionBlocks[0] ?? allocationBlock,
  };
}

export async function readProjectReturnAllocationReview(tx: Tx, caseId: string) {
  const receipt = await readProjectReturnReceipt(tx, caseId, 'latest');
  const base = receipt.legacyFinalizationId ? await readCurrentProjectReturnLegacyBase(tx, receipt.legacyFinalizationId) : null;
  const draft = await readLatestProjectReturnAllocationDraft(tx, receipt.version.id);
  return presentReview(receipt, await sourcesForReceipt(tx, receipt, base), draft, base);
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoneReturnAllocationError(400, 'پیش‌نویس تخصیص معتبر نیست.');
  return value as Record<string, unknown>;
}

function parseUnsignedDecimal(value: unknown, message: string) {
  if (typeof value !== 'string' || value.length > 100 || !/^[0-9۰-۹٠-٩]+(?:[.٫][0-9۰-۹٠-٩]+)?$/.test(value.trim())) {
    throw new StoneReturnAllocationError(400, message);
  }
  return parseCanonicalDecimal(value);
}

function parseRate(rate: unknown) {
  if (rate === null) return null;
  const message = 'نرخ توافقی هر واحد باید مبلغ ریالی مثبت باشد.';
  const canonical = parseUnsignedDecimal(rate, message);
  if (canonical === '0') throw new StoneReturnAllocationError(400, message);
  return canonical;
}

function parseRateBasis(basis: unknown): ProjectReturnRateBasis | undefined {
  if (basis === undefined || basis === 'RECEIPT_UNIT' || basis === 'HEALTHY_SQUARE_METER') return basis;
  throw new StoneReturnAllocationError(400, 'واحد نرخ توافقی را بررسی کنید.');
}

function parseCommand(body: unknown) {
  const { expectedVersionId, expectedDraftNumber, items } = asRecord(body);
  if (typeof expectedDraftNumber !== 'number' || !Number.isSafeInteger(expectedDraftNumber) || expectedDraftNumber < 0
    || !Array.isArray(items) || items.length > 100) {
    throw new StoneReturnAllocationError(400, 'نسخه و ردیف‌های پیش‌نویس را بررسی کنید.');
  }
  const seen = new Set<string>();
  return {
    expectedVersionId: projectReturnId(expectedVersionId, 'نسخه'),
    expectedDraftNumber,
    items: items.map(rawItem => {
      const item = asRecord(rawItem);
      const itemId = projectReturnId(item.itemId, 'ردیف محصول');
      if (seen.has(itemId) || !Array.isArray(item.rows) || item.rows.length > 500) {
        throw new StoneReturnAllocationError(400, 'ردیف‌های تخصیص محصول را بررسی کنید.');
      }
      seen.add(itemId);
      const rows: Array<AllocationSource & { quantity: string }> = item.rows.map(rawRow => {
        const row = asRecord(rawRow);
        const quantity = parseUnsignedDecimal(row.quantity, 'مقدار تخصیص معتبر نیست.');
        if (row.financialRecordId !== undefined || row.financialLineId !== undefined) {
          if (row.originalInvoiceId != null || row.originalLineId != null || row.dispatchEvidenceId != null) {
            throw new StoneReturnAllocationError(400, 'برای هر سهم یک مرجع فروش انتخاب کنید.');
          }
          return { financialRecordId: projectReturnId(row.financialRecordId, 'رکورد مالی'),
            financialLineId: projectReturnId(row.financialLineId, 'ردیف مالی'), quantity };
        }
        return {
          originalInvoiceId: projectReturnId(row.originalInvoiceId, 'صورتحساب'),
          originalLineId: projectReturnId(row.originalLineId, 'ردیف فروش'),
          dispatchEvidenceId: projectReturnId(row.dispatchEvidenceId, 'ارسال'), quantity,
        };
      });
      return { itemId, agreedUnitRateRials: parseRate(item.agreedUnitRateRials), agreedRateBasis: parseRateBasis(item.agreedRateBasis), rows };
    }),
  };
}

export async function saveProjectReturnAllocationDraft(db: PrismaClient, caseId: string, actorId: string, body: unknown) {
  const command = parseCommand(body);
  // The original source is immutable. Proposals use the same post-lock read semantics
  // as their Accounting and Logistics transitions; operational stock keeps Serializable.
  const source = await db.projectReturnCase.findUnique({ where: { id: caseId }, select: { legacyFinalizationId: true } });
  const isolationLevel = source?.legacyFinalizationId ? Prisma.TransactionIsolationLevel.ReadCommitted : undefined;
  const result = await withProjectReturnCaseTransaction(db, async tx => {
    await lockProjectReturnCase(tx, caseId);
    const receipt = await readProjectReturnReceipt(tx, caseId, 'latest');
    const prior = await readLatestProjectReturnAllocationDraft(tx, receipt.version.id);
    if (receipt.version.id !== command.expectedVersionId || (prior?.number ?? 0) !== command.expectedDraftNumber) {
      throw new StoneReturnAllocationError(409, 'نسخهٔ پرونده یا پیش‌نویس تغییر کرده است. پرونده را دوباره باز کنید.');
    }
    if (!receipt.version.submittedAt) {
      throw new StoneReturnAllocationError(409, 'ابتدا لجستیک باید نسخهٔ اصلاحی را ارسال کند.');
    }
    const base = receipt.legacyFinalizationId ? await readCurrentProjectReturnLegacyBase(tx, receipt.legacyFinalizationId, true) : null;
    if (base) requireCurrentLegacyProjectReturnBase(base);
    if (receipt.operationStatus !== 'ACTIVE') {
      throw new StoneReturnAllocationError(409, 'این پرونده برای اصلاح در لجستیک یا بررسی وابستگی‌ها متوقف است.');
    }
    if (allocationStatus(receipt, prior) === 'DAMAGED_ONLY') {
      throw new StoneReturnAllocationError(409, 'این پرونده مقدار سالمی برای تخصیص ندارد.');
    }
    // Drafts do not consume invoice or dispatch balances. Revalidate against posted evidence on each save.
    const sources = await sourcesForReceipt(tx, receipt, base);
    const byItemId = new Map(sources.map(item => [item.id, item]));
    const items = command.items.map(({ itemId, agreedUnitRateRials, agreedRateBasis, rows }) => {
      const item = byItemId.get(itemId);
      if (!item || parseExactQuantityAtoms(item.healthyQuantity) === 0n) {
        throw new StoneReturnAllocationError(409, 'یکی از ردیف‌ها مقدار سالم قابل تخصیص در این نسخه ندارد.');
      }
      const expected = expectedRateBasis(item.unit);
      if (agreedUnitRateRials !== null && (agreedRateBasis ?? 'RECEIPT_UNIT') !== expected) {
        throw new StoneReturnAllocationError(400, item.unit === 'meter'
          ? 'نرخ سنگ طولی را به ریال بر مترمربع سالم وارد کنید.'
          : 'نرخ توافقی را به ریال بر واحد محصول وارد کنید.');
      }
      const validated = validateStoneReturnAllocations({ acceptedQuantity: item.healthyQuantity, unit: item.unit }, item, rows, null);
      return {
        itemId, agreedUnitRateRials, agreedRateBasis: agreedUnitRateRials === null ? null : expected,
        rows: validated.rows.map(({ candidate, quantity }): ProjectReturnDraftRow => {
          const common = {
            originalInvoiceNumber: candidate.originalInvoiceNumber, contractId: candidate.contractId,
            contractNumber: candidate.contractNumber, productRowId: candidate.productRowId, projectId: candidate.projectId!, quantity,
          };
          if ('financialRecordId' in candidate) {
            return { ...common, financialRecordId: candidate.financialRecordId, financialLineId: candidate.financialLineId,
              ...(candidate.financialQuantityEvidenceId && { financialQuantityEvidenceId: candidate.financialQuantityEvidenceId }),
              financialParty: candidate.financialParty, dispatchEvidenceId: null,
              contractItemId: candidate.contractItemId, partnerCaseId: candidate.partnerCaseId };
          }
          return { ...common, originalInvoiceId: candidate.originalInvoiceId, originalLineId: candidate.originalLineId,
            originalTaxInvoiceId: candidate.originalTaxInvoiceId, originalTaxLineId: candidate.originalTaxLineId,
            dispatchEvidenceId: candidate.dispatchEvidenceId, contractItemId: candidate.contractItemId };
        }),
      };
    });
    const saved = await tx.projectReturnAllocationDraft.create({
      data: { versionId: receipt.version.id, number: command.expectedDraftNumber + 1, items, createdBy: actorId },
    });
    return presentReview(receipt, sources, presentDraft(saved), base);
  }, isolationLevel);
  if (!result) throw new StoneReturnAllocationError(409, 'وضعیت پرونده تغییر کرده است. پرونده را دوباره باز کنید.');
  return result;
}
