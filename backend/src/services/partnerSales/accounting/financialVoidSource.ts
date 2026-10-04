import type { Prisma } from '@prisma/client';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { readPartnerAccountingCapabilities } from './capabilities';
import { readPartnerInvoiceSource } from './invoiceSource';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './source';
import { PartnerAccountingCommandError } from './errors';

/** Resolve the private financial source under the same authority/Case fence as
 * collections. The linked customer contract identifies the workflow only;
 * accounting records themselves must retain their internal-source ownership. */
export async function lockPartnerFinancialVoidSource(tx: Prisma.TransactionClient, recordId: string,
  actorId: string, correlationId: string) {
  const target = await tx.accountingFinancialRecord.findUnique({ where: { id: recordId } });
  if (target?.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE) return null;
  const metadata = target.metadata as Record<string, unknown> | null;
  const caseId = metadata?.partnerCaseId;
  if (typeof caseId !== 'string') throw new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'مالک سند مالی همکار معتبر نیست.');
  await lockPartnerOperationsControl(tx);
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
  const allowed = await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'ACCOUNTING', channel: 'API' },
    { correlationId, reason: 'رسیدگی به ابطال رکورد مالی همکار' }).authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId });
  if (!allowed.ok || !(await readPartnerAccountingCapabilities(tx, actorId)).approve) {
    throw new PartnerAccountingCommandError('FORBIDDEN', 'مجوز ابطال سند مالی این همکار فعال نیست.');
  }
  const invoice = await tx.accountingFinancialRecord.findUniqueOrThrow({ where: { id: recordId } });
  const { current } = await readPartnerInvoiceSource(tx, invoice, caseId);
  if (!current.row.customerContractId) throw new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'قرارداد مرتبط سند پیدا نشد.');
  return { caseId, contractId: current.row.customerContractId, sourceId: invoice.sourceId, invoice };
}

export async function partnerFinancialChainIsVoiding(tx: Prisma.TransactionClient, caseId: string) {
  return Boolean(await tx.accountingFinancialVoidCase.findFirst({ where: { status: 'OPEN',
    metadata: { path: ['partnerCaseId'], equals: caseId } }, select: { id: true } }));
}
