import { AsyncLocalStorage } from 'node:async_hooks';

type AccountingReadPhase = 'lockWait' | 'authorization' | 'population' | 'rowHydration'
  | 'scopeSetup' | 'authorizationAudit' | 'provenance' | 'partnerEvidence'
  | 'ordinaryPopulation' | 'partnerPopulation' | 'registerRanking' | 'workspace' | 'trend'
  | 'invoiceEvidence' | 'collectionEvidence' | 'taxEvidence' | 'auditEvidence' | 'workspaceCounters'
  | 'dutyActiveList' | 'dutyActiveCounters' | 'dutyHistoryList' | 'dutyHistoryCounters'
  | 'dutySourceContractDispatch' | 'dutySourceLoadingCancellation' | 'dutySourcePurchasingInquiry'
  | 'dutySourceHrWorkItem' | 'dutySourceSalesCorrection' | 'dutySourceHiringFinance'
  | 'dutySourcePartnerPricing' | 'dutySourceOther';
export type AccountingReadTimings = Partial<Record<AccountingReadPhase, number>>;

type AccountingReadWorkKind = 'historicalInvoices' | 'historicalPayments' | 'historicalAuditEvents'
  | 'historicalPartnerBalances' | 'receiptCandidates' | 'receiptPageRows'
  | 'partnerInvoices' | 'partnerReceivables' | 'partnerPayments' | 'partnerTaxRows'
  | 'partnerAuditWitnesses' | 'markedProvenanceRows'
  | 'dutyActiveCandidates' | 'dutyHistoryCandidates';
export type AccountingReadWork = Partial<Record<AccountingReadWorkKind, number>>;

export const accountingReadTiming = new AsyncLocalStorage<AccountingReadTimings & { readWork?: AccountingReadWork }>();

export function countAccountingReadRows(kind: AccountingReadWorkKind, rows: number) {
  const observation = accountingReadTiming.getStore();
  if (!observation) return;
  const work = observation.readWork ??= {};
  work[kind] = (work[kind] ?? 0) + rows;
}

export function startAccountingReadPhase(phase: AccountingReadPhase): () => void {
  const timings = accountingReadTiming.getStore();
  if (!timings) return () => {};
  const startedAt = performance.now();
  return () => {
    timings[phase] = (timings[phase] ?? 0) + (performance.now() - startedAt);
  };
}

export async function measureAccountingReadPhase<T>(phase: AccountingReadPhase, read: () => Promise<T>): Promise<T> {
  const finish = startAccountingReadPhase(phase);
  try {
    return await read();
  } finally {
    finish();
  }
}
