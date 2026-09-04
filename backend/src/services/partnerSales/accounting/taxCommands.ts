import { Prisma, type PrismaClient, type AccountingTaxRecord } from '@prisma/client';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { partnerPredecessorIsFrozen } from '../corrections/mutationFreeze';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './source';
import { PartnerAccountingCommandError, PartnerAccountingTechnicalError } from './errors';
import { readPartnerAccountingCapabilities } from './capabilities';
import { hasPartnerAccountingEvidence } from './provenance';
import { assertPartnerTaxEvidence, assertSinglePartnerTaxRecord } from './taxEvidence';
import { readPartnerInvoiceSource } from './invoiceSource';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const conflict = () => new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'شواهد مالیاتی پرونده همکار سازگار نیست؛ بررسی حسابداری لازم است.');
type Command = { kind: string; invoiceId?: string; recordId?: string; contractId?: string; idempotencyKey?: string;
  correlationId?: string; note?: string; status?: string };
type TaxContext = { partner: false } | { partner: true; metadata: Prisma.InputJsonObject; frozen: boolean; now: Date };

/** Existing tax writers stay the owners of fiscal tracking. Their Partner branch
 * shares the Case lock, current authority and command receipt with other private
 * Accounting effects. Ordinary contracts retain the existing implementation. */
export async function runPartnerAwareTaxMutation(database: PrismaClient, command: Command, actor: { userId: string },
  apply: (tx: Prisma.TransactionClient, context: TaxContext) => Promise<AccountingTaxRecord>): Promise<AccountingTaxRecord> {
  let partner = false;
  const result = await database.$transaction(async tx => {
    const invoiceId = command.invoiceId || command.recordId;
    const target = await tx.accountingFinancialRecord.findUnique({ where: { id: invoiceId! } });
    if (target?.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE) {
      const children = await tx.accountingTaxRecord.findMany({ where: { invoiceRecordId: invoiceId! }, select: { metadata: true } });
      if (hasPartnerAccountingEvidence([target?.sourceSnapshot, target?.metadata, children])) throw conflict();
      const tax = await apply(tx, { partner: false });
      if (hasPartnerAccountingEvidence(tax.metadata)) throw conflict();
      return tax;
    }
    partner = true;
    const caseId = object(target.metadata)?.partnerCaseId;
    if (typeof caseId !== 'string' || command.contractId || !command.idempotencyKey?.trim() || !command.correlationId?.trim() ||
        command.idempotencyKey.length > 200 || command.correlationId.length > 200) throw conflict();
    await lockPartnerOperationsControl(tx);
    await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
    const decision = await createAuditedPartnerAuthorization(tx, { actorId: actor.userId, purpose: 'ACCOUNTING', channel: 'API' },
      { correlationId: command.correlationId, reason: command.note || 'ثبت پیگیری مالیاتی پرونده همکار' })
      .authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId });
    if (!decision.ok || !(await readPartnerAccountingCapabilities(tx, actor.userId)).tax) return { denied: true as const };
    // The pre-lock read resolves authority only. A replacement may have retired
    // this invoice while this request waited for the operations/Case locks.
    const invoice = await tx.accountingFinancialRecord.findUnique({ where: { id: target.id } });
    if (!invoice || invoice.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE || invoice.sourceId !== target.sourceId ||
        object(invoice.metadata)?.partnerCaseId !== caseId) throw conflict();
    const { current, preparation } = await readPartnerInvoiceSource(tx, invoice, caseId);
    const taxRows = await tx.accountingTaxRecord.findMany({ where: { invoiceRecordId: invoice.id } });
    assertSinglePartnerTaxRecord(taxRows);
    for (const taxRow of taxRows) assertPartnerTaxEvidence(taxRow, invoice.id, preparation);
    const identity = { actorId: actor.userId, operation: `ACCOUNTING_${command.kind}`, targetScope: invoice.id, key: command.idempotencyKey };
    const { correlationId: _correlationId, ...payload } = command;
    const payloadHash = await canonicalHash(payload);
    const previous = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
    if (previous) {
      if (previous.payloadHash !== payloadHash) throw new PartnerAccountingCommandError('IDEMPOTENCY_CONFLICT', 'این درخواست مالیاتی قبلاً با اطلاعات دیگری ثبت شده است؛ صفحه را تازه کنید.');
      const id = object(previous.outcome)?.taxId;
      const row = typeof id === 'string' ? await tx.accountingTaxRecord.findFirst({ where: { id, invoiceRecordId: invoice.id } }) : null;
      if (!row) throw conflict();
      return row;
    }
    if (current.row.state !== 'COMMITTED' || !['ISSUED', 'POSTED'].includes(invoice.status) ||
        !object(invoice.metadata)?.partnerApproval) throw conflict();
    const frozen = await partnerPredecessorIsFrozen(tx, caseId, current.row.headRevision);
    if (frozen && (command.kind === 'MARK_TAX_READY' || ['SUBMITTED', 'SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY'].includes(command.status || 'SUBMITTED'))) {
      throw new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'ارسال مالیاتی جدید تا تعیین تکلیف اصلاح پرونده همکار متوقف است.');
    }
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const tax = await apply(tx, { partner: true, frozen, now: clock.now,
      metadata: { partnerCaseId: caseId, owner: preparation.owner, financialEvidenceHash: preparation.evidenceHash } });
    assertPartnerTaxEvidence(tax, invoice.id, preparation);
    await tx.partnerCommandOutcome.create({ data: { id: `partner-tax:${(await canonicalHash(identity)).slice(10)}`,
      ...identity, payloadHash, outcome: { taxId: tax.id } } });
    return tax;
  }, { timeout: 30_000 }).catch(error => {
    if (!partner || error instanceof PartnerAccountingCommandError) throw error;
    throw new PartnerAccountingTechnicalError(error);
  });
  if ('denied' in result) throw new PartnerAccountingCommandError('FORBIDDEN', 'مجوز تغییر اطلاعات مالیاتی این پرونده همکار فعال نیست؛ مدیر حسابداری باید دسترسی پرونده را بررسی کند.');
  return result;
}
