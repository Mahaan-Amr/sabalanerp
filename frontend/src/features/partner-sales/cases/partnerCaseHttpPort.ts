import { PartnerAccountViewSchema, PartnerCaseRuntimeResultSchema, canonicalHash, partnerError,
  type PartnerCaseRuntimeRow, type PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import type { RetailCollectionHistory } from '../collections/RetailCollectionsPanel';
import type { PartnerCorrectionStatus } from './PartnerCorrectionPanel';
import { assertSuccessfulSalesDownload } from '@/features/sales/salesOperationalError';
import api from '@/lib/api';

export type { PartnerCaseRuntimeRow } from '@sabalanerp/partner-sales-contracts';

export async function readPartnerCases(caseId?: string): Promise<PartnerCaseRuntimeRow[]> {
  const response = await api.post('/partner/cases/query-v2', caseId ? { caseId } : {});
  const parsed = PartnerCaseRuntimeResultSchema.safeParse((response.data as { data?: unknown })?.data);
  if (!parsed.success) throw partnerError('INTEGRITY_CONFLICT');
  return parsed.data.cases;
}

export async function readPartnerAccount() {
  const response = await api.get('/partner/accounting/account');
  return PartnerAccountViewSchema.parse((response.data as { data?: unknown }).data);
}

export async function readPartnerCollections(owner: PartnerCaseView['owner']): Promise<RetailCollectionHistory> {
  const response = await api.post('/partner/retail-collections/query', owner);
  const value = (response.data as { data?: Record<string, unknown> }).data;
  if (!value || !Array.isArray(value.planHistory) || !Array.isArray(value.receipts) ||
      !value.customerPaymentPlan || !value.summary) throw partnerError('INTEGRITY_CONFLICT');
  const summary = value.summary as { currency: 'IRR' | 'IRT'; netCollected: string; balance: string };
  return { currentPlan: value.customerPaymentPlan as RetailCollectionHistory['currentPlan'],
    historicalPlans: (value.planHistory as RetailCollectionHistory['historicalPlans']).filter(plan =>
      plan.planId !== (value.customerPaymentPlan as RetailCollectionHistory['currentPlan']).planId),
    receipts: (value.receipts as Array<Record<string, unknown>>).map(receipt => ({
      receiptId: String(receipt.receiptId), planId: String(receipt.planId),
      amount: receipt.amount as RetailCollectionHistory['receipts'][number]['amount'],
      effectiveDate: String(receipt.effectiveDate),
      status: receipt.kind === 'REVERSAL' ? 'REVERSED' as const : 'POSTED' as const,
      ...(typeof receipt.originalReceiptId === 'string' ? { originalReceiptId: receipt.originalReceiptId } : {}),
      allocations: Array.isArray(receipt.allocations) ? receipt.allocations as Array<{ installmentId: string; amount: string }> : [] })),
    collected: { amount: summary.netCollected, currency: summary.currency },
    balance: { amount: summary.balance, currency: summary.currency } };
}

export async function reversePartnerCollection(view: PartnerCaseView, receiptId: string, effectiveDate: string, reason: string) {
  const actorId = await currentActorId();
  const intent = { type: 'RETAIL_RECEIPT_REVERSE' as const, expected: view.owner, expectedState: 'COMMITTED' as const,
    receiptId, effectiveDate, reason };
  const payloadHash = await canonicalHash(intent);
  const commandId = crypto.randomUUID();
  const response = await api.post('/partner/retail-collections/commands', { schemaVersion: 1, ...intent, commandId,
    correlationId: crypto.randomUUID(), idempotency: { actorId, operation: intent.type, targetId: view.owner.caseId, key: commandId, payloadHash } });
  return response.data;
}

async function currentActorId() {
  const identity = await api.get('/auth/me');
  const actorId = (identity.data as { data?: { id?: unknown } }).data?.id;
  if (typeof actorId !== 'string') throw partnerError('FORBIDDEN');
  return actorId;
}

export async function cancelPartnerCase(view: PartnerCaseView, reason: string) {
  const actorId = await currentActorId();
  const intent = { schemaVersion: 1 as const, type: 'CASE_CANCEL' as const, reason };
  const commandId = crypto.randomUUID();
  const payloadHash = await canonicalHash(intent);
  const response = await api.post('/partner/cases/lifecycle/commands', { ...intent, commandId,
    correlationId: crypto.randomUUID(), expected: view.owner, expectedState: view.state,
    idempotency: { actorId, operation: intent.type, targetId: view.owner.caseId, key: commandId, payloadHash } });
  return response.data;
}

export async function recordPartnerCollection(view: PartnerCaseView, history: RetailCollectionHistory,
  amount: string, effectiveDate: string, details: { method: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER'; reference?: string; note?: string }) {
  const actorId = await currentActorId();
  let remaining = BigInt(amount);
  const receivedByInstallment = new Map<string, bigint>();
  history.receipts.filter(receipt => receipt.status === 'POSTED').forEach(receipt => receipt.allocations?.forEach(allocation =>
    receivedByInstallment.set(allocation.installmentId, (receivedByInstallment.get(allocation.installmentId) ?? BigInt(0)) + BigInt(allocation.amount))));
  const allocations: Array<{ installmentId: string; amount: string }> = [];
  for (const installment of history.currentPlan.installments) {
    if (remaining <= BigInt(0)) break;
    const outstanding = BigInt(installment.amount.amount) - (receivedByInstallment.get(installment.installmentId) ?? BigInt(0));
    const allocated = outstanding < remaining ? outstanding : remaining;
    if (allocated > BigInt(0)) { allocations.push({ installmentId: installment.installmentId, amount: String(allocated) }); remaining -= allocated; }
  }
  if (remaining !== BigInt(0) || !allocations.length) throw partnerError('INVALID_PAYLOAD');
  const receiptId = `retail-receipt:${crypto.randomUUID()}`;
  const intent = { type: 'RETAIL_RECEIPT' as const, expected: view.owner, expectedState: 'COMMITTED' as const,
    planId: history.currentPlan.planId, receiptId, amount: { amount, currency: history.balance.currency }, effectiveDate,
    method: details.method, ...(details.reference ? { reference: details.reference } : {}),
    ...(details.note ? { note: details.note } : {}), allocations };
  const payloadHash = await canonicalHash(intent);
  const commandId = crypto.randomUUID();
  const response = await api.post('/partner/retail-collections/commands', { schemaVersion: 1, ...intent, commandId,
    correlationId: crypto.randomUUID(), idempotency: { actorId, operation: intent.type, targetId: view.owner.caseId, key: commandId, payloadHash } });
  return response.data;
}

export async function savePartnerRetailCorrection(view: PartnerCaseView, input: {
  opportunityId: string; retailPrices: Array<{ productRowId: string; amount: string }>;
  customerPaymentPlanIntent: { installments: Array<{ installmentId: string; amount: { amount: string; currency: 'IRR' | 'IRT' } }> };
}) {
  const actorId = await currentActorId();
  const changed = new Map(input.customerPaymentPlanIntent.installments.map(item => [item.installmentId, item.amount]));
  const planChanged = changed.size > 0;
  const effectiveDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const customerPaymentPlan = planChanged ? { planId: `partner-customer-plan:${crypto.randomUUID()}`,
    version: view.customerPaymentPlan.version + 1, predecessorPlanId: view.customerPaymentPlan.planId,
    effectiveDate,
    installments: view.customerPaymentPlan.installments.map(item => ({ ...item, installmentId: `partner-installment:${crypto.randomUUID()}`,
      dueDate: item.dueDate < effectiveDate ? effectiveDate : item.dueDate,
      amount: changed.get(item.installmentId) ?? item.amount })) } : view.customerPaymentPlan;
  const intent = { type: 'RETAIL_CORRECTION_SAVE' as const, expected: view.owner, expectedState: 'COMMITTED' as const,
    opportunityId: input.opportunityId, retailPrices: input.retailPrices.map(item => ({ productRowId: item.productRowId,
      retailUnitPrice: { amount: item.amount, currency: view.retailTotals.currency } })), customerPaymentPlan };
  const payloadHash = await canonicalHash(intent); const commandId = crypto.randomUUID();
  const response = await api.post('/partner/corrections/commands', { schemaVersion: 1, ...intent, commandId,
    correlationId: crypto.randomUUID(), idempotency: { actorId, operation: intent.type, targetId: view.owner.caseId, key: commandId, payloadHash } });
  return response.data;
}

export async function readPartnerCorrection(caseId: string): Promise<PartnerCorrectionStatus | null> {
  const response = await api.post('/partner/corrections/query', { caseId });
  return (response.data as { data: PartnerCorrectionStatus | null }).data;
}

export async function requestPartnerCorrection(view: PartnerCaseView, scope: PartnerCorrectionStatus['scope']) {
  const identity = await api.get('/auth/me');
  const actorId = (identity.data as { data?: { id?: unknown } }).data?.id;
  if (typeof actorId !== 'string') throw partnerError('FORBIDDEN');
  const commandId = crypto.randomUUID();
  const reason = scope === 'VOID' ? 'درخواست ابطال پرونده توسط فروشنده همکار'
    : 'درخواست اصلاح اطلاعات پرونده توسط فروشنده همکار';
  const intent = { type: 'CORRECTION_REQUEST' as const, expected: view.owner,
    expectedState: 'COMMITTED' as const, scope, reason };
  const payloadHash = await canonicalHash(scope === 'VOID'
    ? { schemaVersion: 1, type: intent.type, scope, reason }
    : intent);
  const response = await api.post('/partner/corrections/commands', { schemaVersion: 1, ...intent,
    commandId, correlationId: crypto.randomUUID(), idempotency: { actorId, operation: intent.type,
      targetId: view.owner.caseId, key: commandId, payloadHash } });
  return response.data;
}

export async function sendPartnerConfirmation(caseId: string) {
  const response = await api.post(`/partner/cases/${encodeURIComponent(caseId)}/confirmation`);
  return response.data;
}

export async function finalizePartnerCase(view: PartnerCaseView, lossAccepted: boolean) {
  const operationId = `finalize:${view.owner.caseId}:${view.owner.revision}:${view.owner.integrityHash.slice(-24)}:${lossAccepted ? 'loss' : 'standard'}`;
  const response = await api.post(`/partner/cases/${encodeURIComponent(view.owner.caseId)}/finalize`, {
    operationId, expected: view.owner, expectedState: view.state, lossAccepted,
  });
  return response.data;
}

export async function openPartnerPdf(caseId: string, snapshotId: string, mode: 'PREVIEW' | 'FINAL' | 'DOWNLOAD_EXISTING') {
  const response = await api.post(`/partner/cases/${encodeURIComponent(caseId)}/output`, { snapshotId, mode }, { responseType: 'blob' });
  await assertSuccessfulSalesDownload(response);
  const url = URL.createObjectURL(response.data as Blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
