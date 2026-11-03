import type { PartnerEvent } from '../../../../../packages/partner-sales-contracts';
import { CaseEvidence, CommercialRevision, ContractRuntime, Metrics, Period, ReportPurpose, ReportRow, ReportingError } from './contracts';
import { negate, subtract, sum } from './money';
import { projectSabalanRevenue, visibleEvents } from './revenue';

const conflict = () => { throw new ReportingError('INTEGRITY_CONFLICT'); };
const inPeriod = (event: PartnerEvent, period: Period) => event.effectiveDate >= period.from;

function retailMetrics(runtime: ContractRuntime, data: CaseEvidence, events: PartnerEvent[], period: Period) {
  const revisions = new Map<number, CommercialRevision>();
  for (const candidate of data.commercial || []) {
    const view = runtime.PartnerCaseViewSchema.parse(candidate.view);
    const retail = runtime.MoneySchema.parse(candidate.comparable.retail);
    const sabalan = runtime.MoneySchema.parse(candidate.comparable.sabalan);
    runtime.IdSchema.parse(candidate.comparable.evidenceId);
    if (view.owner.caseId !== data.root.caseId || revisions.has(view.owner.revision)
      || retail.currency !== sabalan.currency || retail.currency !== data.internal.totals.currency
      || view.retailTotals.currency !== retail.currency || view.sabalanTotals.currency !== sabalan.currency) conflict();
    revisions.set(view.owner.revision, { view, comparable: { retail, sabalan, evidenceId: candidate.comparable.evidenceId } });
  }
  const current = revisions.get(data.internal.owner.revision);
  if (!current || runtime.checkExpectedRevision(data.internal.owner, current.view.owner)) conflict();
  const revision = (ref: PartnerEvent['owner']) => {
    const value = revisions.get(ref.revision);
    if (!value || runtime.checkExpectedRevision(ref, value.view.owner)) return conflict();
    return value;
  };
  let effective: CommercialRevision | undefined;
  const sales: string[] = []; const margins: string[] = [];
  const receipts = new Map<string, { amount: string; currency: string; planId: string }>();
  const reversed = new Map<string, string[]>();
  const reversalIds = new Map<string, string>();
  const allCollected: string[] = []; const periodCollected: string[] = [];
  const corrections = new Set<string>();
  for (const event of events) {
    if (event.owner.caseId !== data.root.caseId) conflict();
    if (event.type === 'CASE_COMMITTED' && !effective) {
      effective = revision(event.owner);
      if (subtract(effective.comparable.sabalan.amount, event.sabalanNetAmount.amount) !== '0') conflict();
      if (inPeriod(event, period)) {
        sales.push(effective.comparable.retail.amount);
        margins.push(subtract(effective.comparable.retail.amount, effective.comparable.sabalan.amount));
      }
    }
    if (event.type === 'CORRECTION_EFFECTIVE' && !corrections.has(event.correctionId)) {
      if (!effective || runtime.checkExpectedRevision(event.predecessor, effective.view.owner)) conflict();
      const next = revision(event.owner);
      const retailDelta = subtract(next.comparable.retail.amount, effective!.comparable.retail.amount);
      const wholesaleDelta = subtract(next.comparable.sabalan.amount, effective!.comparable.sabalan.amount);
      if (event.scope === 'RETAIL_ONLY' && wholesaleDelta !== '0') conflict();
      if (wholesaleDelta !== '0') {
        const adjustments = events.filter(item => item.type === 'SABALAN_ADJUSTMENT' && item.correctionId === event.correctionId);
        if (!adjustments.length || adjustments.some(item => item.effectiveDate !== event.effectiveDate)) conflict();
        const amounts = adjustments.map(item => item.type === 'SABALAN_ADJUSTMENT' ? item.delta : '0');
        if (sum(amounts) !== wholesaleDelta) conflict();
      }
      if (inPeriod(event, period)) { sales.push(retailDelta); margins.push(subtract(retailDelta, wholesaleDelta)); }
      effective = next; corrections.add(event.correctionId);
    }
    if (event.type === 'CASE_VOIDED') {
      if (!effective || corrections.has(event.correctionId)) conflict();
      if (inPeriod(event, period)) {
        sales.push(negate(effective!.comparable.retail.amount));
        margins.push(negate(subtract(effective!.comparable.retail.amount, effective!.comparable.sabalan.amount)));
      }
      corrections.add(event.correctionId);
    }
    if (event.type === 'RETAIL_RECEIPT') {
      if (event.amount.currency !== data.internal.totals.currency) conflict();
      const previous = receipts.get(event.receiptId);
      if (previous) {
        if (subtract(previous.amount, event.amount.amount) !== '0' || previous.planId !== event.planId) conflict();
        continue;
      }
      if (![...revisions.values()].some(item => item.view.customerPaymentPlan.planId === event.planId)) conflict();
      receipts.set(event.receiptId, { amount: event.amount.amount, currency: event.amount.currency, planId: event.planId });
      allCollected.push(event.amount.amount);
      if (inPeriod(event, period)) periodCollected.push(event.amount.amount);
    }
    if (event.type === 'RETAIL_RECEIPT_REVERSED') {
      const original = receipts.get(event.originalReceiptId);
      const fingerprint = `${event.originalReceiptId}:${event.planId}:${event.amount.currency}:${sum([event.amount.amount])}`;
      if (reversalIds.has(event.reversalId)) {
        if (reversalIds.get(event.reversalId) !== fingerprint) conflict();
        continue;
      }
      if (!original || original.planId !== event.planId || original.currency !== event.amount.currency) conflict();
      const amounts = reversed.get(event.originalReceiptId) || [];
      amounts.push(event.amount.amount); reversed.set(event.originalReceiptId, amounts);
      if (subtract(original!.amount, sum(amounts)).startsWith('-')) conflict();
      reversalIds.set(event.reversalId, fingerprint); allCollected.push(negate(event.amount.amount));
      if (inPeriod(event, period)) periodCollected.push(negate(event.amount.amount));
    }
  }
  const collected = sum(allCollected);
  if (effective && runtime.checkExpectedRevision(effective.view.owner, current!.view.owner)) conflict();
  const balance = subtract(current!.view.retailTotals.payable, collected);
  const collectionStatus = balance.startsWith('-') ? 'OVERPAID' : balance === '0' ? 'SETTLED' : collected === '0' ? 'UNPAID' : 'PARTIAL';
  return { current: current!, retailSales: sum(sales), retailCollected: sum(periodCollected), netComparableMargin: sum(margins), collectionStatus } as const;
}

export function projectReportRow(runtime: ContractRuntime, data: CaseEvidence, purpose: ReportPurpose, period: Period): ReportRow {
  const internal = runtime.SabalanInternalRecordViewSchema.parse(data.internal);
  const fulfillment = runtime.FulfillmentViewSchema.parse(data.fulfillment);
  if (internal.owner.caseId !== data.root.caseId || runtime.checkExpectedRevision(internal.owner, fulfillment.owner)
    || internal.recordId !== fulfillment.recordId) conflict();
  const events = visibleEvents(runtime, data.events, period);
  if (events.some(event => event.owner.caseId !== data.root.caseId
    || ('internalRecordId' in event && event.internalRecordId !== internal.recordId)
    || (event.type === 'CASE_COMMITTED' && event.salesCreditOwnerId !== data.root.partnerSellerId))) conflict();
  let effectiveOwner = events.find(event => event.type === 'CASE_COMMITTED')?.owner;
  for (const event of events) {
    if (event.type === 'CORRECTION_EFFECTIVE') {
      if (!effectiveOwner || runtime.checkExpectedRevision(event.predecessor, effectiveOwner)) conflict();
      effectiveOwner = event.owner;
    }
  }
  if (effectiveOwner && runtime.checkExpectedRevision(effectiveOwner, internal.owner)) conflict();
  if (['COMMITTED', 'VOIDED'].includes(internal.state) && !effectiveOwner) conflict();
  if (events.some(event => event.type === 'CASE_VOIDED')) {
    if (internal.state !== 'VOIDED') conflict();
    for (const event of events) {
      if (event.type !== 'CASE_VOIDED') continue;
      const original = events.find(item => item.type === 'CASE_COMMITTED' && item.eventId === event.commitmentEventId);
      const adjustments = events.filter(item => item.type === 'SABALAN_ADJUSTMENT' && event.adjustmentEventIds.includes(item.eventId));
      if (!original || !adjustments.length || adjustments.length !== new Set(event.adjustmentEventIds).size
        || adjustments.some(item => item.effectiveDate !== event.effectiveDate)) conflict();
    }
    const net = projectSabalanRevenue(runtime, events, { ...period, from: '0001-01-01' });
    if (sum(net.map(item => item.amount)) !== '0') conflict();
  } else if (internal.state === 'VOIDED') conflict();
  const row: ReportRow = { caseId: data.root.caseId, revision: internal.owner.revision,
    caseNumber: internal.caseNumber, customerContractNumber: internal.customerContractNumber, state: internal.state,
    deliveries: fulfillment.deliveries, deliveryProgress: null };
  if (data.deliveryProgress !== null) {
    const seen = new Set<string>();
    row.deliveryProgress = data.deliveryProgress.map(item => {
      const product = fulfillment.products.find(product => product.productRowId === item.productRowId);
      if (!product || product.unit !== item.unit || seen.has(item.productRowId)) conflict();
      seen.add(item.productRowId);
      for (const amount of [item.contracted, item.reserved, item.dispatched]) {
        runtime.SignedDecimalSchema.parse(amount);
        if (amount.startsWith('-')) conflict();
      }
      if (subtract(item.contracted, sum([item.reserved, item.dispatched])).startsWith('-')) conflict();
      return { productRowId: item.productRowId, unit: item.unit, contracted: item.contracted, reserved: item.reserved, dispatched: item.dispatched };
    });
  }
  if (purpose === 'FULFILLMENT') return row;
  row.currency = internal.totals.currency;
  if (purpose !== 'PARTNER') row.internalRecordNumber = internal.recordNumber;
  const revenue = projectSabalanRevenue(runtime, events, period);
  row.metrics = { wholesalePurchases: sum(revenue.map(event => event.amount)) };
  if (data.account === null) row.account = null;
  else {
    const account = runtime.PartnerAccountViewSchema.parse({ schemaVersion: 1, purpose: 'PARTNER_ACCOUNT',
      partnerSellerId: data.root.partnerSellerId, purchases: [data.account] }).purchases[0];
    if (runtime.checkExpectedRevision(internal.owner, account.owner) || account.caseNumber !== internal.caseNumber
      || [account.amount, account.received, account.balance].some(value => value.currency !== row.currency)) conflict();
    // Private Accounting installment notes are not report/export content.
    row.account = { owner: account.owner, caseNumber: account.caseNumber, amount: account.amount,
      received: account.received, balance: account.balance, status: account.status,
      sabalanPaymentPlan: { planId: account.sabalanPaymentPlan.planId, version: account.sabalanPaymentPlan.version,
        effectiveDate: account.sabalanPaymentPlan.effectiveDate,
        installments: account.sabalanPaymentPlan.installments.map(item => ({ installmentId: item.installmentId,
          dueDate: item.dueDate, amount: item.amount, method: item.method })) } };
  }
  if (purpose === 'PARTNER' || purpose === 'MANAGEMENT') {
    const retail = retailMetrics(runtime, data, events, period);
    if (retail.current.view.caseNumber !== internal.caseNumber || retail.current.view.customerContractNumber !== internal.customerContractNumber) conflict();
    row.metrics.retailSales = retail.retailSales; row.metrics.retailCollected = retail.retailCollected;
    row.metrics.netComparableMargin = retail.netComparableMargin;
    row.customerPaymentPlan = retail.current.view.customerPaymentPlan; row.collectionStatus = retail.collectionStatus;
  }
  return row;
}

export function totalMetrics(rows: ReportRow[], economics: boolean): Metrics {
  const values = (key: keyof Metrics) => sum(rows.map(row => row.metrics?.[key] || '0'));
  const metrics: Metrics = { wholesalePurchases: values('wholesalePurchases') };
  if (economics) { metrics.retailSales = values('retailSales'); metrics.retailCollected = values('retailCollected'); metrics.netComparableMargin = values('netComparableMargin'); }
  return metrics;
}
