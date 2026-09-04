import { Prisma } from '@prisma/client';
import { canonicalHash, TotalsSchema, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { buildCaseProjections, type CaseRevisionProjectionEvidence } from '../cases/projections';
import type { RetailCorrectionRevision } from './retailCorrection';
import { multiply, subtract, sum } from '../reporting/money';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid retail revision evidence');
  return value as Record<string, unknown>;
};

/** Case-owned evidence and the shared projection writer also own retail successors. */
export async function prepareRetailSuccessor(tx: Prisma.TransactionClient, input: {
  predecessor: RevisionRef; retailPrices: RetailCorrectionRevision['retailPrices'];
  customerPaymentPlan: RetailCorrectionRevision['customerPaymentPlan'];
}) {
  const previous = await tx.partnerCaseRevision.findUniqueOrThrow({ where: { caseId_revision: {
    caseId: input.predecessor.caseId, revision: input.predecessor.revision } } });
  if (previous.integrityHash !== input.predecessor.integrityHash) throw new Error('Stale retail correction predecessor');
  const sale = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: previous.caseId }, select: {
    caseNumber: true, internalRecordId: true, customerContract: { select: { contractNumber: true } },
    internalRecord: { select: { recordNumber: true, commercialAccountId: true } } } });
  const retail = object(previous.retailEnvelope), wholesale = object(previous.wholesaleEnvelope);
  if (!Array.isArray(retail.products) || !Array.isArray(wholesale.products)) throw new Error('Missing retail revision rows');
  const prices = new Map(input.retailPrices.map(row => [row.productRowId, row.retailUnitPrice]));
  const oldTotals = TotalsSchema.parse(retail.totals);
  const products: Array<Record<string, unknown> & { retailUnitPrice: string }> = retail.products.map(raw => {
    const row = object(raw), price = prices.get(String(row.productRowId));
    if (!price || price.currency !== oldTotals.currency) throw new Error('Retail successor row or currency conflict');
    return { ...row, retailUnitPrice: price.amount };
  });
  if (prices.size !== products.length) throw new Error('Retail successor row set conflict');
  const net = sum(products.map(row => multiply(String(row.quantity), row.retailUnitPrice)));
  const payable = sum([subtract(net, oldTotals.discount), oldTotals.tax, oldTotals.charges]);
  const planTotal = sum(input.customerPaymentPlan.installments.map(row => row.amount.amount));
  if (planTotal !== payable) throw new Error('Retail successor payment plan does not reconcile');
  const retailEnvelope = { ...retail, products, totals: { ...oldTotals, net, payable } };
  const fields = { graphHash: previous.graphHash, graph: previous.graph, partySnapshots: previous.partySnapshots,
    wholesaleEnvelope: previous.wholesaleEnvelope, retailEnvelope,
    paymentEvidence: { ...object(previous.paymentEvidence), customerPaymentPlan: input.customerPaymentPlan },
    customerContent: previous.customerContent };
  const owner = { caseId: previous.caseId, revision: previous.revision + 1,
    integrityHash: await canonicalHash({ purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1,
      predecessor: { revision: previous.revision, integrityHash: previous.integrityHash }, ...fields }) };
  const evidence = { ...fields, products: wholesale.products.map(raw => {
    const row = object(raw), price = prices.get(String(row.productRowId));
    if (!price) throw new Error('Wholesale and retail row identity conflict');
    return { ...row, retailUnitPrice: price.amount };
  }), resaleDifference: subtract(payable, TotalsSchema.parse(wholesale.totals).payable) } as unknown as CaseRevisionProjectionEvidence;
  const projections = await buildCaseProjections({ ...owner, caseNumber: sale.caseNumber,
    internalRecordId: sale.internalRecordId, internalRecordNumber: sale.internalRecord.recordNumber,
    customerContractNumber: sale.customerContract.contractNumber, commercialAccountId: sale.internalRecord.commercialAccountId,
    state: 'DRAFT', evidence });
  if (!projections.ok) throw new Error('Retail successor projection integrity conflict');
  return { owner, fields, projections: projections.value };
}
