import type { Prisma, PrismaClient } from '@prisma/client';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { PARTNER_CREATION_TRANSACTION_OPTIONS } from '../creationTransactionBudget';
import { readCurrentPartnerCaseViews } from './lifecycle';

/** One persona binding for Sales detail and its related read surfaces. */
export async function authorizePartnerSalesCaseRead(tx: Prisma.TransactionClient, input: {
  actorId: string; caseId: string; correlationId: string;
}) {
  // Identity is current persisted evidence, never an HTTP role/purpose override.
  const partner = await tx.partnerProfile.findUnique({ where: { userId: input.actorId }, select: { id: true } });
  return createAuditedPartnerAuthorization(tx, {
    actorId: input.actorId, purpose: partner ? 'PARTNER' : 'MANAGEMENT', channel: 'DETAIL',
  }, { correlationId: input.correlationId }).authorize('CASE_READ', { kind: 'CASE', id: input.caseId });
}

/** The ordinary Sales detail route must verify the same current Case and
 * actor authority as the Partner editor, within its bounded read budget. */
export function readPartnerSalesContractDetail(database: PrismaClient, input: {
  actorId: string;
  correlationId: string;
  contract: { id: string; partnerCaseId: string | null; partnerRevision: number | null; partnerIntegrityHash: string | null };
}) {
  const { contract } = input;
  return database.$transaction(async tx => {
    if (!contract.partnerCaseId || !contract.partnerRevision || !contract.partnerIntegrityHash) return null;
    const current = await readCurrentPartnerCaseViews(tx, contract.partnerCaseId);
    if (!current || current.row.customerContractId !== contract.id ||
        current.row.headRevision !== contract.partnerRevision ||
        current.row.integrityHash !== contract.partnerIntegrityHash) return null;
    const caseRead = await authorizePartnerSalesCaseRead(tx, {
      actorId: input.actorId, caseId: contract.partnerCaseId, correlationId: input.correlationId,
    });
    if (caseRead.ok === false) return { ok: false as const, error: caseRead.error };
    const output = await createAuditedPartnerAuthorization(tx, {
      actorId: input.actorId, purpose: 'CUSTOMER_OUTPUT', channel: 'API',
    }, { correlationId: input.correlationId }).authorize('CUSTOMER_OUTPUT', { kind: 'CASE', id: contract.partnerCaseId });
    return { ok: true as const, view: current.partner, output: output.ok };
  }, PARTNER_CREATION_TRANSACTION_OPTIONS);
}

/** Preserve hidden-existence responses while giving the UI actionable Persian. */
export function partnerSalesContractDetailFailure(error: { status: number; code: string } | null, trackingId: string) {
  const status = error?.status ?? 409;
  const message = status === 404
    ? 'قرارداد پیدا نشد یا برای حساب شما قابل مشاهده نیست؛ به فهرست قراردادهای خود برگردید.'
    : status === 403
      ? 'اجازه مشاهده این قرارداد همکار را ندارید؛ از مدیر سامانه بخواهید دسترسی مشاهده قراردادهای همکار را بررسی کند.'
      : status === 409
        ? 'اطلاعات پرونده همکار با نسخه فعلی قرارداد مطابقت ندارد؛ صفحه را تازه کنید و اگر پیام تکرار شد، کد پیگیری را به مدیر سامانه بدهید.'
        : 'دریافت اطلاعات قرارداد همکار موقتاً ممکن نیست؛ کمی بعد دوباره تلاش کنید و اگر پیام تکرار شد، کد پیگیری را به مدیر سامانه بدهید.';
  return { status, body: { success: false, error: message, code: status === 404 ? 'NOT_FOUND' : error?.code ?? 'INTEGRITY_CONFLICT', trackingId } };
}
