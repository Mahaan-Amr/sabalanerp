import { Prisma, type PrismaClient } from '@prisma/client';
import { formatExactQuantityAtoms, parseExactQuantityAtoms } from './exactQuantity';
import { loadStoneReturnCandidates, type StoneReturnCandidates } from './stoneReturnCandidates';
import { listStoneReturnReceipts, readStoneReturnReceipt } from './stoneReturnReceipts';
import { StoneReturnAllocationError, validateStoneReturnAllocations, type StoneReturnAllocationInput } from './stoneReturnAllocationRules';

type Tx = Prisma.TransactionClient;

export async function lockStoneReturnCase(tx: Tx, receiptId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`stone-return-case:${receiptId}`}))`;
}

const includeRows = { rows: { orderBy: [{ originalInvoiceId: 'asc' }, { originalLineId: 'asc' }, { dispatchEvidenceId: 'asc' }] } } satisfies Prisma.StoneReturnAllocationDraftInclude;

const findLatestDraft = (tx: Tx, receiptId: string) => tx.stoneReturnAllocationDraft.findFirst({
  where: { receiptId }, orderBy: { version: 'desc' }, include: includeRows,
});

function presentDraft(draft: NonNullable<Awaited<ReturnType<typeof findLatestDraft>>>) {
  const { id, version, attributionReason, createdAt, createdBy, rows } = draft;
  return { id, version, attributionReason, createdAt, createdBy, rows: rows.map(({ draftId: _draftId, quantity, ...row }) => ({
    ...row, quantity: quantity.toFixed(),
  })) };
}

export async function readStoneReturnAllocationDraft(tx: Tx, receiptId: string) {
  const draft = await findLatestDraft(tx, receiptId);
  return draft ? presentDraft(draft) : null;
}

function statusOf(receipt: { acceptedQuantity: string }, revisionExists: boolean) {
  if (parseExactQuantityAtoms(receipt.acceptedQuantity) === 0n) return 'REJECTED' as const;
  return revisionExists ? 'DRAFT' as const : 'RECEIVED' as const;
}

export async function listStoneReturnAllocationReviews(db: PrismaClient, after?: string) {
  const page = await listStoneReturnReceipts(db, after);
  const ids = page.items.map(row => row.id);
  const [drafts, finalizations] = ids.length ? await Promise.all([
    db.stoneReturnAllocationDraft.findMany({ where: { receiptId: { in: ids } }, distinct: ['receiptId'], select: { receiptId: true } }),
    db.stoneReturnFinalization.findMany({ where: { receiptId: { in: ids } }, select: { receiptId: true } }),
  ]) : [[], []];
  const drafted = new Set(drafts.map(row => row.receiptId));
  const finalized = new Set(finalizations.map(row => row.receiptId));
  return { ...page, items: page.items.map(row => ({
    ...row, allocationStatus: finalized.has(row.id) ? 'FINALIZED' as const : statusOf(row, drafted.has(row.id)),
  })) };
}

export async function readStoneReturnAllocationReview(tx: Tx, receiptId: string) {
  const [receipt, finalization] = await Promise.all([
    readStoneReturnReceipt(tx, receiptId),
    tx.stoneReturnFinalization.findUnique({ where: { receiptId } }),
  ]);
  const draft = finalization
    ? presentDraft(await tx.stoneReturnAllocationDraft.findUniqueOrThrow({ where: { id: finalization.draftId }, include: includeRows }))
    : await readStoneReturnAllocationDraft(tx, receiptId);
  const sources: StoneReturnCandidates = finalization
    ? { candidates: [], blockedReason: null, hasUnlinkedOriginals: false, originKnown: false }
    : await loadStoneReturnCandidates(tx, receipt);
  const allocated = (draft?.rows ?? []).reduce((sum, row) => sum + parseExactQuantityAtoms(row.quantity), 0n);
  return {
    receipt, ...sources, draft, finalization,
    allocationStatus: finalization ? 'FINALIZED' as const : statusOf(receipt, draft !== null),
    allocatedQuantity: formatExactQuantityAtoms(allocated),
    unallocatedQuantity: formatExactQuantityAtoms(parseExactQuantityAtoms(receipt.acceptedQuantity) - allocated),
  };
}

const inputText = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) {
    throw new StoneReturnAllocationError(400, 'شناسه ردیف تخصیص معتبر نیست.');
  }
  return value.trim();
};

function parseCommand(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StoneReturnAllocationError(400, 'پیش‌نویس معتبر نیست.');
  const { expectedVersion, rows, attributionReason } = body as Record<string, unknown>;
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !Array.isArray(rows)) {
    throw new StoneReturnAllocationError(400, 'نسخه و ردیف‌های پیش‌نویس را بررسی کنید.');
  }
  const parsedRows: StoneReturnAllocationInput[] = rows.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StoneReturnAllocationError(400, 'ردیف تخصیص معتبر نیست.');
    return {
      originalInvoiceId: inputText(value.originalInvoiceId), originalLineId: inputText(value.originalLineId),
      dispatchEvidenceId: inputText(value.dispatchEvidenceId), quantity: inputText(value.quantity),
    };
  });
  return { expectedVersion, rows: parsedRows, attributionReason };
}

export async function saveStoneReturnAllocationDraft(db: PrismaClient, receiptId: string, actorId: string, body: unknown) {
  const command = parseCommand(body);
  try {
    return await db.$transaction(async tx => {
      await lockStoneReturnCase(tx, receiptId);
      if (await tx.stoneReturnFinalization.findUnique({ where: { receiptId }, select: { id: true } })) {
        throw new StoneReturnAllocationError(409, 'این مرجوعی قبلاً ثبت قطعی شده است.');
      }
      const receipt = await readStoneReturnReceipt(tx, receiptId);
      if (parseExactQuantityAtoms(receipt.acceptedQuantity) === 0n) {
        throw new StoneReturnAllocationError(409, 'این دریافت مقدار پذیرفته‌شده‌ای برای تخصیص ندارد.');
      }
      const prior = await tx.stoneReturnAllocationDraft.findFirst({
        where: { receiptId }, orderBy: { version: 'desc' }, select: { version: true },
      });
      if ((prior?.version ?? 0) !== command.expectedVersion) {
        throw new StoneReturnAllocationError(409, 'نسخه جدیدی از پیش‌نویس وجود دارد. پرونده را دوباره باز کنید.');
      }
      const sources = await loadStoneReturnCandidates(tx, receipt);
      if (sources.blockedReason) throw new StoneReturnAllocationError(409, sources.blockedReason);
      const validated = validateStoneReturnAllocations(receipt, sources, command.rows, command.attributionReason);
      const saved = await tx.stoneReturnAllocationDraft.create({
        data: {
          receiptId, version: command.expectedVersion + 1, createdBy: actorId, attributionReason: validated.attributionReason,
          rows: { create: validated.rows.map(({ candidate, quantity }) => ({
            originalInvoiceId: candidate.originalInvoiceId, originalInvoiceNumber: candidate.originalInvoiceNumber,
            originalLineId: candidate.originalLineId, originalTaxInvoiceId: candidate.originalTaxInvoiceId,
            originalTaxLineId: candidate.originalTaxLineId, dispatchEvidenceId: candidate.dispatchEvidenceId,
            contractId: candidate.contractId, contractNumber: candidate.contractNumber, contractItemId: candidate.contractItemId,
            productRowId: candidate.productRowId, quantity,
          })) },
        }, include: includeRows,
      });
      return {
        receipt, ...sources, draft: presentDraft(saved), finalization: null,
        allocationStatus: statusOf(receipt, true),
        allocatedQuantity: validated.allocatedQuantity, unallocatedQuantity: validated.unallocatedQuantity,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    const failure = error as { code?: string; meta?: { code?: string } } | null;
    if (failure?.code === 'P2034' || failure?.code === 'P2002' || (failure?.code === 'P2010' && failure.meta?.code === '40001')) {
      throw new StoneReturnAllocationError(409, 'اطلاعات مرجوعی هم‌زمان تغییر کرد. پرونده را دوباره باز کنید.');
    }
    throw error;
  }
}
