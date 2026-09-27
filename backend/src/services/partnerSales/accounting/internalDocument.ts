import { FinancialRecordKind, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { withAccountingReadScope } from './readScope';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './source';

/** Only the Sabalan-to-Partner financial source enters this document. */
export async function readPartnerInternalDocument(caseId: string, actorUserId: string) {
  return withAccountingReadScope(prisma, { userId: actorUserId }, async scope => {
    const records = await scope.database.accountingFinancialRecord.findMany({
      where: scope.financial({ kind: FinancialRecordKind.INVOICE_CANDIDATE,
        sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, contractId: null, customerId: null }),
      include: { invoiceItems: true, receivables: { where: scope.receivable(),
        include: { paymentStatuses: { where: scope.payment() } } },
        taxRecords: { where: scope.tax() } },
    });
    const contextualized = await scope.contextualize('FINANCIAL', records);
    const record = contextualized.find(item => item.partnerContext?.caseId === caseId);
    if (!record?.partnerContext) return null;
    const flags = await scope.database.accountingContractFlag.findMany({
      where: { sourceFinancialRecordId: record.id }, orderBy: { createdAt: 'desc' } });
    return {
      id: record.id, status: record.status, amount: record.amount.toString(),
      currency: record.currency, createdAt: record.createdAt,
      systemInvoiceNumber: record.systemInvoiceNumber,
      partnerContext: record.partnerContext,
      items: record.invoiceItems.map(item => ({ description: item.description,
        quantity: item.quantity.toString(), unitPrice: item.unitPrice.toString(),
        totalPrice: item.totalPrice.toString() })),
      receivables: record.receivables.map(item => ({ status: item.status,
        paidAmount: item.paidAmount.toString(), remainingAmount: item.remainingAmount.toString(),
        dueDate: item.dueDate,
        payments: item.paymentStatuses.map(payment => ({ amount: payment.amount.toString(),
          method: payment.method, status: payment.status, occurredAt: payment.occurredAt })) })),
      taxRecords: record.taxRecords.map(item => ({ readinessStatus: item.readinessStatus,
        submissionStatus: item.submissionStatus, taxableAmount: item.taxableAmount.toString(),
        vatAmount: item.vatAmount.toString() })),
      flags: flags.map(flag => ({ id: flag.id, title: flag.title, note: flag.note,
        severity: flag.severity, status: flag.status })),
    };
  });
}

/** Resolve the internal financial record under the same Partner read and write
 * authority. The customer contract ID is only a duty/flag correlation key;
 * retail amounts never enter this command boundary. */
export async function withPartnerInternalAccountingTarget<T>(caseId: string, actorUserId: string,
  work: (database: Prisma.TransactionClient, target: { customerContractId: string;
    invoiceRecordId: string }) => Promise<T>): Promise<T | null> {
  return withAccountingReadScope(prisma, { userId: actorUserId }, async scope => {
    const sale = await scope.database.partnerSaleCase.findUnique({ where: { id: caseId },
      select: { customerContractId: true, internalRecordId: true, state: true } });
    if (!sale?.customerContractId || !sale.internalRecordId || sale.state !== 'COMMITTED') return null;
    const invoices = await scope.database.accountingFinancialRecord.findMany({
      where: scope.financial({ kind: FinancialRecordKind.INVOICE_CANDIDATE,
        sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: sale.internalRecordId,
        contractId: null, customerId: null }), select: { id: true } });
    const authorized = await scope.contextualize('FINANCIAL', invoices);
    const invoice = authorized.find(item => item.partnerContext?.caseId === caseId);
    if (!invoice) return null;
    const authority = createAuditedPartnerAuthorization(scope.database,
      { actorId: actorUserId, purpose: 'ACCOUNTING', channel: 'API' },
      { correlationId: randomUUID(), reason: 'ثبت اقدام حسابداری سند داخلی همکار' });
    if (!(await authority.authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId })).ok) return null;
    return work(scope.database, { customerContractId: sale.customerContractId, invoiceRecordId: invoice.id });
  });
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function renderPartnerInternalDocumentHtml(document: NonNullable<Awaited<ReturnType<typeof readPartnerInternalDocument>>>) {
  const context = document.partnerContext;
  const rows = document.items.length ? document.items.map((item, index) =>
    `<tr><td>${index + 1}</td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.quantity)}</td><td>${escapeHtml(item.unitPrice)}</td><td>${escapeHtml(item.totalPrice)}</td></tr>`).join('')
    : '<tr><td colspan="5">ریز اقلام در سند مالی ثبت نشده است</td></tr>';
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>
    body{font-family:Tahoma,Arial,sans-serif;color:#172531;padding:22px;line-height:1.8}
    h1{font-size:20px} section{border:1px solid #cbd5e1;border-radius:8px;padding:14px;margin:14px 0}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #cbd5e1;padding:8px;text-align:right}
  </style></head><body><h1>سند فروش سبلان به فروشنده همکار</h1>
  <section><div>شماره قرارداد: ${escapeHtml(context.customerContractNumber)}</div>
  <div>طرف‌حساب سبلان: ${escapeHtml(context.debtor.displayName)}</div>
  <div>مشتری نهایی مرتبط: ${escapeHtml(context.endCustomer.displayName)}</div>
  <div>شماره سند داخلی: ${escapeHtml(context.internalRecordNumber)}</div>
  <div>شماره صورتحساب سیستمی: ${escapeHtml(document.systemInvoiceNumber || 'ثبت نشده')}</div></section>
  <section><table><thead><tr><th>ردیف</th><th>شرح</th><th>مقدار</th><th>نرخ</th><th>مبلغ</th></tr></thead>
  <tbody>${rows}</tbody></table></section>
  <section><strong>جمع خرید از سبلان: ${escapeHtml(document.amount)} ${escapeHtml(document.currency)}</strong></section>
  </body></html>`;
}
