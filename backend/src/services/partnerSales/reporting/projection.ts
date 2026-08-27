import type { PartnerEvent } from '../../../../../packages/partner-sales-contracts';
import { CaseEvidence, CommercialRevision, ContractRuntime, Metrics, Period, ReportPurpose, ReportRow, ReportingError } from './contracts';
import { negate, subtract, sum } from './money';
import { projectSabalanRevenue, visibleEvents } from './revenue';
import { caseHistory, collectionHistory } from './history';

const conflict = () => { throw new ReportingError('INTEGRITY_CONFLICT'); };
const inPeriod = (event: PartnerEvent, period: Period) => event.effectiveDate >= period.from;

function retailMetrics(runtime: ContractRuntime, data: CaseEvidence, events: PartnerEvent[], period: Period, history: ReturnType<typeof caseHistory>) {
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
  const sales: string[] = []; const margins: string[] = [];
  if (history.commitment) {
    const initial = revision(history.commitment.owner);
    if (subtract(initial.comparable.sabalan.amount, history.commitment.sabalanNetAmount.amount) !== '0') conflict();
    if (inPeriod(history.commitment, period)) {
      sales.push(initial.comparable.retail.amount);
      margins.push(subtract(initial.comparable.retail.amount, initial.comparable.sabalan.amount));
    }
  }
  for (const event of history.corrections) {
    const previous = revision(event.predecessor);
    const next = revision(event.owner);
    const retailDelta = subtract(next.comparable.retail.amount, previous.comparable.retail.amount);
    const wholesaleDelta = subtract(next.comparable.sabalan.amount, previous.comparable.sabalan.amount);
    if (event.scope === 'RETAIL_ONLY' && wholesaleDelta !== '0') conflict();
    if (wholesaleDelta !== '0') {
      const adjustments = events.filter(item => item.type === 'SABALAN_ADJUSTMENT' && item.correctionId === event.correctionId);
      if (!adjustments.length || adjustments.some(item => item.effectiveDate !== event.effectiveDate)) conflict();
      const amounts = adjustments.map(item => item.type === 'SABALAN_ADJUSTMENT' ? item.delta : '0');
      if (sum(amounts) !== wholesaleDelta) conflict();
    }
    if (inPeriod(event, period)) { sales.push(retailDelta); margins.push(subtract(retailDelta, wholesaleDelta)); }
  }
  if (history.voided && inPeriod(history.voided, period)) {
    const voided = revision(history.voided.owner);
    sales.push(negate(voided.comparable.retail.amount));
    margins.push(negate(subtract(voided.comparable.retail.amount, voided.comparable.sabalan.amount)));
  }
  const { collected, periodCollected } = collectionHistory(events, {
    planIds: new Set([...revisions.values()].map(item => item.view.customerPaymentPlan.planId)),
    currency: data.internal.totals.currency, period,
  });
  const balance = subtract(current!.view.retailTotals.payable, collected);
  const collectionStatus = balance.startsWith('-') ? 'OVERPAID' : balance === '0' ? 'SETTLED' : collected === '0' ? 'UNPAID' : 'PARTIAL';
  return { current: current!, retailSales: sum(sales), retailCollected: periodCollected, netComparableMargin: sum(margins), collectionStatus } as const;
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
  const history = caseHistory(runtime, events);
  if (history.effective && runtime.checkExpectedRevision(history.effective, internal.owner)) conflict();
  if (['COMMITTED', 'VOIDED'].includes(internal.state) && !history.effective) conflict();
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
    const retail = retailMetrics(runtime, data, events, period, history);
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
