import type { AccountingFinancialRecord, Prisma } from '@prisma/client';
import { RevisionRefSchema } from '@sabalanerp/partner-sales-contracts';
import { readCurrentPartnerCaseViews, readPartnerRevisionProjections } from '../cases/lifecycle';
import { PartnerAccountingCommandError } from './errors';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE, matchesFinancialPreparation, preparePartnerFinancialSource,
  type PartnerFinancialPreparation } from './source';
import { subtract } from '../reporting/money';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const conflict = () => new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'منبع صورتحساب همکار معتبر نیست؛ بررسی پرونده در حسابداری لازم است.');

/** Caller owns current Case authorization and transaction/lock order. Cached
 * financial projections are checked against both the coherent current pair
 * and the immutable canonical invoice revision, including pending successors. */
export async function readPartnerInvoiceSource(tx: Prisma.TransactionClient, invoice: AccountingFinancialRecord, caseId: string) {
  const preparation = object(invoice.sourceSnapshot)?.partnerPreparation as PartnerFinancialPreparation | undefined;
  const owner = RevisionRefSchema.safeParse(preparation?.owner);
  if (invoice.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE || invoice.kind !== 'INVOICE_CANDIDATE' ||
      invoice.contractId || invoice.customerId || object(invoice.metadata)?.partnerCaseId !== caseId ||
      !owner.success || owner.data.caseId !== caseId) throw conflict();
  const current = await readCurrentPartnerCaseViews(tx, caseId);
  if (!current || current.row.internalRecordId !== invoice.sourceId) throw conflict();
  const historical = await readPartnerRevisionProjections(tx, owner.data);
  if (!historical) throw conflict();
  const prepared = await preparePartnerFinancialSource({ view: { ...historical.accounting, state: 'COMMITTED' },
    partnerSellerId: current.row.profile.userId }, owner.data);
  if (!prepared.ok || !preparation || !matchesFinancialPreparation(prepared.value, preparation) ||
      invoice.currency !== prepared.value.amount.currency || subtract(invoice.amount.toString(), prepared.value.amount.amount) !== '0') throw conflict();
  return { current, historical, preparation };
}
