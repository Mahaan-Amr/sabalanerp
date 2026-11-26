import { Prisma, type PrismaClient } from '@prisma/client';
import { readProjectReturnAllocationReview } from './projectReturnAllocations';
import { lockProjectReturnCase, withProjectReturnCaseTransaction } from './projectReturnDraftState';
import { parseSepidarInvoices, sepidarInvoiceTotalsMatch } from './sepidarDispatchInvoices';
import { StoneReturnAllocationError } from './stoneReturnAllocationRules';

type Tx = Prisma.TransactionClient;
const stale = () => new StoneReturnAllocationError(409,
  'پیش‌نویس یا فاکتورهای سپیدار تغییر کرده‌اند. فهرست مرجوعی‌ها را به‌روزرسانی کنید.', 'SEPIDAR_REFERENCE_STALE');

async function readReference(tx: Tx, caseId: string, draftId: string) {
  const review = await readProjectReturnAllocationReview(tx, caseId);
  if (review.draft?.id !== draftId) throw stale();
  if (!review.receipt.version.submittedAt || review.allocationStatus !== 'ALLOCATION_COMPLETE') {
    throw new StoneReturnAllocationError(409, 'ابتدا تخصیص کامل مرجوعی را ذخیره کنید.');
  }
  const priced = review.items.filter(item => item.rows.length > 0);
  const totalRial = priced.length && priced.every(item => item.draftAmountRials !== null && !item.allocationError)
    ? priced.reduce((total, item) => total + BigInt(item.draftAmountRials!), 0n).toString() : null;
  const prior = await tx.projectReturnSepidarRevision.findFirst({ where: { draftId }, orderBy: { number: 'desc' } });
  const invoices = prior ? parseSepidarInvoices(prior.invoices) : [];
  if (!invoices) throw new StoneReturnAllocationError(409, 'ارجاع ثبت‌شدهٔ سپیدار معتبر نیست.');
  return { prior, invoices, totalRial, expectedVersion: prior?.id ?? null,
    unavailableReason: totalRial === null ? review.postingBlock.message : undefined };
}

export async function getProjectReturnSepidarInvoices(db: PrismaClient, caseId: string, draftId: string) {
  const { invoices, totalRial, expectedVersion, unavailableReason } = await db.$transaction(
    tx => readReference(tx, caseId, draftId), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return { invoices, totalRial, expectedVersion, unavailableReason };
}

export async function saveProjectReturnSepidarInvoices(db: PrismaClient, caseId: string, draftId: string, actorId: string,
  body: { invoices?: unknown; expectedVersion?: unknown; reason?: unknown } | undefined) {
  const invoices = parseSepidarInvoices(body?.invoices);
  if (!invoices) throw new StoneReturnAllocationError(400, 'برای هر فاکتور یک شمارهٔ یکتا و مبلغ معتبر وارد کنید.');
  const expectedVersion = body?.expectedVersion ?? null;
  if (expectedVersion !== null && (typeof expectedVersion !== 'string' || !expectedVersion || expectedVersion.length > 64)) {
    throw new StoneReturnAllocationError(400, 'نسخهٔ فاکتورهای سپیدار معتبر نیست.');
  }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > 200) throw new StoneReturnAllocationError(400, 'دلیل اصلاح باید حداکثر ۲۰۰ نویسه باشد.');
  const result = await withProjectReturnCaseTransaction(db, async tx => {
    await lockProjectReturnCase(tx, caseId);
    const state = await readReference(tx, caseId, draftId);
    if (expectedVersion !== state.expectedVersion) throw stale();
    if (!invoices.length && !state.invoices.length) throw new StoneReturnAllocationError(400, 'حداقل یک فاکتور وارد کنید.');
    if (state.prior && !reason) throw new StoneReturnAllocationError(400, 'دلیل اصلاح فاکتورهای سپیدار الزامی است.');
    const amounts = new Map(invoices.map(invoice => [invoice.number, invoice.amountRial]));
    if (invoices.length === state.invoices.length && state.invoices.every(invoice => amounts.get(invoice.number) === invoice.amountRial)) {
      throw new StoneReturnAllocationError(400, 'فاکتورها تغییری نکرده‌اند.');
    }
    if (invoices.length && !sepidarInvoiceTotalsMatch(invoices, state.totalRial)) {
      throw new StoneReturnAllocationError(409, 'جمع فاکتورها باید با مبلغ پیش‌نویس مرجوعی برابر باشد.', 'SEPIDAR_AMOUNT_MISMATCH');
    }
    const saved = await tx.projectReturnSepidarRevision.create({ data: {
      draftId, number: (state.prior?.number ?? 0) + 1, invoices,
      totalRial: state.totalRial ?? state.prior!.totalRial, actorId, reason: state.prior ? reason : null,
    } });
    return { invoices, auditEntry: { id: saved.id, actorId, createdAt: saved.createdAt, note: saved.reason,
      beforeState: { invoices: state.invoices }, afterState: { invoices } } };
  }, Prisma.TransactionIsolationLevel.ReadCommitted);
  if (!result) throw stale();
  return result;
}
