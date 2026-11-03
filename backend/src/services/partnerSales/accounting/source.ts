import { contracts, type Money, type PartnerErrorCode, type Result, type RevisionRef, type SabalanInternalRecordView } from './contracts';
import type { CommittedAccountingSource } from './repository';

export type PartnerAccountingSource = {
  view: SabalanInternalRecordView;
  partnerSellerId: string;
};

export type PartnerFinancialPreparation = {
  sourceKind: 'SABALAN_TO_PARTNER';
  owner: RevisionRef;
  internalRecordId: string;
  debtor: { partnerSellerId: string; commercialAccountId: string; identity: SabalanInternalRecordView['debtor'] };
  amount: Money;
  totals: SabalanInternalRecordView['totals'];
  products: SabalanInternalRecordView['products'];
  paymentPlan: SabalanInternalRecordView['sabalanPaymentPlan'];
  evidenceHash: string;
};

export const failure = <T = never>(code: PartnerErrorCode): Result<T> => ({ ok: false, error: contracts.partnerError(code) });

// Exact comparisons without Decimal's ambient precision or binary-number coercion.
export function sumAmounts(values: readonly string[]): string {
  const scale = Math.max(0, ...values.map(value => (value.split('.')[1] || '').length));
  const units = values.reduce((sum, value) => {
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
    const amount = BigInt(whole + fraction.padEnd(scale, '0'));
    return sum + (negative ? -amount : amount);
  }, 0n);
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  const number = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '') : digits;
  return `${units < 0n ? '-' : ''}${number}`;
}

export function equalAmounts(left: string, right: string): boolean {
  return sumAmounts([left, right.startsWith('-') ? right.slice(1) : `-${right}`]) === '0';
}

export function matchesFinancialPreparation(current: PartnerFinancialPreparation, historical: PartnerFinancialPreparation): boolean {
  const owner = historical.owner;
  if (owner.caseId !== current.owner.caseId || owner.revision > current.owner.revision ||
      (owner.revision === current.owner.revision && owner.integrityHash !== current.owner.integrityHash)) return false;
  return contracts.canonicalJson({ ...historical, owner: current.owner }) === contracts.canonicalJson(current);
}

export async function prepareCommittedAccountingSource(source: CommittedAccountingSource, expected: RevisionRef): Promise<Result<PartnerFinancialPreparation>> {
  const prepared = await preparePartnerFinancialSource(source, expected);
  if (!prepared.ok) return prepared;
  const parsed = contracts.PartnerEventSchema.safeParse(source.commitment);
  if (!parsed.success || parsed.data.type !== 'CASE_COMMITTED') return failure('INTEGRITY_CONFLICT');
  const commitment = parsed.data;
  if (commitment.internalRecordId !== source.view.recordId || commitment.salesCreditOwnerId !== source.partnerSellerId ||
      commitment.owner.caseId !== source.view.owner.caseId || commitment.owner.revision > source.view.owner.revision ||
      (commitment.owner.revision === source.view.owner.revision && commitment.owner.integrityHash !== source.view.owner.integrityHash)) return failure('INTEGRITY_CONFLICT');
  return prepared;
}

/** Input is resolved/authenticated by the Case owner, never a browser snapshot. */
export async function preparePartnerFinancialSource(source: PartnerAccountingSource, expected: RevisionRef): Promise<Result<PartnerFinancialPreparation>> {
  const parsed = contracts.SabalanInternalRecordViewSchema.safeParse(source.view);
  if (!parsed.success || !contracts.IdSchema.safeParse(source.partnerSellerId).success ||
      !contracts.RevisionRefSchema.safeParse(expected).success) return failure('INVALID_PAYLOAD');
  const view = parsed.data;
  const conflict = contracts.checkExpectedRevision(expected, view.owner);
  if (conflict) return { ok: false, error: conflict };
  if (view.state !== 'COMMITTED' && view.state !== 'VOIDED') return failure('STATE_CONFLICT');
  if (!view.products.length || new Set(view.products.map(row => row.productRowId)).size !== view.products.length) return failure('INTEGRITY_CONFLICT');
  const installments = view.sabalanPaymentPlan.installments;
  if (new Set(installments.map(row => row.installmentId)).size !== installments.length ||
      installments.some(row => row.amount.currency !== view.totals.currency || (row.method === 'CHECK' && (!row.check || row.check.dueDate !== row.dueDate))) ||
      !equalAmounts(sumAmounts(installments.map(row => row.amount.amount)), view.totals.payable)) return failure('INTEGRITY_CONFLICT');
  const evidence = {
    sourceKind: view.sourceKind, internalRecordId: view.recordId,
    debtor: { partnerSellerId: source.partnerSellerId, commercialAccountId: view.commercialAccountId, identity: view.debtor },
    amount: { amount: view.totals.payable, currency: view.totals.currency },
    totals: view.totals, products: view.products,
    paymentPlan: { ...view.sabalanPaymentPlan,
      installments: installments.map(({ notes: _operationalNote, ...financialTerms }) => financialTerms),
    },
  };
  // Operational notes retain separate history, outside commercial evidence.
  // Excludes the encompassing revision: retail-only successors advance owner but
  // must keep exactly this internal commercial evidence and its existing invoice.
  return { ok: true, value: { ...evidence, owner: view.owner,
    evidenceHash: await contracts.canonicalHash({ schemaVersion: 1, purpose: 'PARTNER_ACCOUNTING_SOURCE', ...evidence }) } };
}
