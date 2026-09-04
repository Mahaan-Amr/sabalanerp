import { PartnerAccountViewSchema, PartnerCaseRuntimeResultSchema, canonicalHash, partnerError,
  type PartnerCaseRuntimeRow, type PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import type { RetailCollectionHistory } from '../collections/RetailCollectionsPanel';
import type { PartnerCorrectionStatus } from './PartnerCorrectionPanel';
import api from '@/lib/api';

export type { PartnerCaseRuntimeRow } from '@sabalanerp/partner-sales-contracts';

export async function readPartnerCases(): Promise<PartnerCaseRuntimeRow[]> {
  const response = await api.post('/partner/cases/query-v2', {});
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
      status: receipt.kind === 'REVERSAL' ? 'REVERSED' as const : 'POSTED' as const })),
    collected: { amount: summary.netCollected, currency: summary.currency },
    balance: { amount: summary.balance, currency: summary.currency } };
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

export async function openPartnerPdf(caseId: string, snapshotId: string, mode: 'PREVIEW' | 'FINAL' | 'DOWNLOAD_EXISTING') {
  const response = await api.post(`/partner/cases/${encodeURIComponent(caseId)}/output`, { snapshotId, mode }, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
