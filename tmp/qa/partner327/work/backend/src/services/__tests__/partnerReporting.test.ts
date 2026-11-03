import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import * as contracts from '../../../../packages/partner-sales-contracts';
import { PartnerReportingService } from '../partnerSales/reporting/service';
import type { CaseEvidence, Query, ReportingSource, ReportExportStore, FrozenExport } from '../partnerSales/reporting/contracts';
import { matchesCustomerContractNumber } from '../partnerSales/reporting/customerSearch';
import { registerPartnerReportRoutes, ReportHandler, ReportResponse } from '../../routes/partner-reports';

// Resolve the documented /testing export through package self-reference.
const fixture = createRequire(require.resolve('../../../../packages/partner-sales-contracts/package.json'))
  ('@sabalanerp/partner-sales-contracts/testing').createPartnerFixtures();
const root = { caseId: fixture.case.caseId, partnerSellerId: fixture.case.partnerSellerId, departmentId: 'department-326' };
const commitment: contracts.PartnerEvent = {
  schemaVersion: 1, eventId: 'commit-326', commandId: 'command-326', correlationId: 'correlation-326',
  actorId: root.partnerSellerId, recordedAt: '2026-08-27T08:00:00.000Z', effectiveDate: '2026-08-27',
  owner: fixture.case.head, type: 'CASE_COMMITTED', internalRecordId: fixture.accounting.recordId,
  trigger: 'SIGNED', salesCreditOwnerId: root.partnerSellerId, sabalanNetAmount: { amount: '1600', currency: 'IRR' },
};
const query: Query = { purpose: 'PARTNER', from: '2026-08-01', to: '2026-08-31' };

function harness() {
  const state = { purpose: 'PARTNER' as contracts.PermissionContext['purpose'], allowed: true, role: 'PARTNER' as contracts.PermissionContext['persona'],
    actorId: root.partnerSellerId, scope: 'OWN' as contracts.PermissionContext['scope'], reads: 0,
    blockedChannels: [] as string[], now: '2026-08-28T08:00:00.000Z', departmentId: root.departmentId as string | undefined };
  const data: CaseEvidence = structuredClone({ root, events: [commitment], internal: { ...fixture.accounting, state: 'COMMITTED' },
    commercial: [{ view: { ...fixture.partner, state: 'COMMITTED', resaleDifference: '9999' },
      comparable: { retail: { amount: '1800', currency: 'IRR' }, sabalan: { amount: '1600', currency: 'IRR' }, evidenceId: 'basis-326' } }],
    account: { owner: fixture.case.head, caseNumber: fixture.case.caseNumber, amount: { amount: '1600', currency: 'IRR' },
      sabalanPaymentPlan: fixture.partner.sabalanPaymentPlan, received: { amount: '400', currency: 'IRR' },
      balance: { amount: '1200', currency: 'IRR' }, status: 'PARTIALLY_PAID' },
    fulfillment: fixture.fulfillment, deliveryProgress: null });
  const context = (purpose: string, channel: string): contracts.PermissionContext => contracts.PermissionContextSchema.parse({
    actorId: state.actorId, persona: state.role, isAdmin: false, partnerSellerId: root.partnerSellerId,
    partnerStatus: 'ACTIVE', root: { kind: 'CASE', id: root.caseId }, purpose: state.purpose === 'PARTNER' ? purpose : state.purpose,
    channel, scope: state.scope, departmentId: state.departmentId, resourceVisible: true,
    actionGranted: state.allowed && !state.blockedChannels.includes(channel),
    authorizationRevision: 1, lifecycleRevision: 1, evaluatedAt: state.now,
  });
  const source: ReportingSource = { async read(request, work) {
    return work({ snapshotId: 'snapshot-326', capturedAt: state.now,
      access: { ok: true, value: context(request.purpose, 'API') }, roots: [root],
      authorization(purpose, channel) { return { async authorize() { return { ok: true, value: context(purpose, channel) }; } }; },
      async caseEvidence() { state.reads++; return structuredClone(data); },
    });
  } };
  const artifacts = new Map<string, FrozenExport>();
  const store: ReportExportStore = { async put(artifact) { artifacts.set(artifact.id, structuredClone(artifact)); },
    async get(id) { return structuredClone(artifacts.get(id) || null); } };
  return { state, data, service: new PartnerReportingService(contracts, source, store) };
}

test('Partner queries keep discounted retail, wholesale and Accounting balances separate', async () => {
  const { service } = harness();
  const report = await service.query(query);
  assert.equal(report.count, 1);
  assert.deepEqual(report.totals[0], { currency: 'IRR', metrics: {
    wholesalePurchases: '1600', sabalanReceived: '0', retailSales: '1800', retailCollected: '0', netComparableMargin: '200',
  }, accountingBalance: '1200', accountingCovered: 1, accountingEligible: 1 });
  assert.equal(report.rows[0].collectionStatus, 'UNPAID');
  assert.equal(JSON.stringify(report).includes('FIXTURE-INTERNAL-313'), false);
  assert.equal((await service.query({ ...query, search: 'FIXTURE-INTERNAL-313' })).count, 0);
  assert.equal((await service.query({ ...query, search: 'FIXTURE-CUSTOMER-313' })).count, 1);
});

test('Accounting cross-search never widens to retail and Logistics receives no prices', async () => {
  const { service, state, data } = harness();
  state.role = 'INTERNAL'; state.purpose = 'ACCOUNTING'; state.scope = 'PURPOSE_BOUND';
  data.commercial = undefined;
  const report = await service.query({ ...query, purpose: 'ACCOUNTING', search: 'FIXTURE-INTERNAL-313' });
  assert.equal(report.count, 1);
  const json = JSON.stringify(report);
  for (const forbidden of ['retailSales', 'retailCollected', 'netComparableMargin', 'customerPaymentPlan', 'retailUnitPrice']) {
    assert.equal(json.includes(forbidden), false, forbidden);
  }
  state.purpose = 'FULFILLMENT';
  const logistics = await service.query({ ...query, purpose: 'FULFILLMENT' });
  assert.equal(logistics.rows.length, 1);
  assert.deepEqual(logistics.totals, []);
  for (const forbidden of ['metrics', 'currency', 'account', 'UnitPrice', 'internalRecordNumber']) {
    assert.equal(JSON.stringify(logistics.rows).includes(forbidden), false, forbidden);
  }
});

test('HR, CRM, responder, public and unrelated Partner cannot use report channels', async () => {
  for (const purpose of ['ONBOARDING', 'CRM', 'RESPONDER'] as const) {
    const { service, state } = harness(); state.purpose = purpose; state.role = 'INTERNAL'; state.scope = 'DEPARTMENT';
    for (const run of [() => service.query(query), () => service.count(query),
      () => service.detail({ ...query, caseId: root.caseId }), () => service.createExport(query)]) {
      await assert.rejects(run, { code: 'FORBIDDEN' });
    }
    assert.equal(state.reads, 0);
  }
  for (const actor of ['PUBLIC', 'OTHER_PARTNER']) {
    const { service, state } = harness();
    if (actor === 'PUBLIC') state.role = 'PUBLIC'; else state.actorId = 'other-partner';
    await assert.rejects(() => service.query(query), { code: 'FORBIDDEN' });
    assert.equal(state.reads, 0);
  }
});

test('filtered totals cover the full snapshot, not the page, and missing Accounting is explicit', async () => {
  const { service, data } = harness(); data.account = null;
  const report = await service.query({ ...query, offset: 1, limit: 1 });
  assert.deepEqual(report.rows, []);
  assert.equal(report.count, 1);
  assert.equal(report.totals[0].metrics.retailSales, '1800');
  assert.equal(report.totals[0].accountingBalance, null);
  assert.equal(report.totals[0].accountingEligible, 1);
  assert.equal(report.totals[0].accountingCovered, 0);
});

test('export freezes filtered data, then rechecks current actor, scope and export permission', async () => {
  const { service, data, state } = harness();
  const created = await service.createExport(query);
  data.account!.balance.amount = '9999';
  const downloaded = await service.downloadExport(created.exportId);
  assert.equal(downloaded.totals[0].accountingBalance, '1200');
  assert.equal(downloaded.scope.kind, 'OWN');
  assert.equal(downloaded.scope.effectiveThrough, '2026-08-28');
  state.blockedChannels = ['EXPORT'];
  await assert.rejects(() => service.downloadExport(created.exportId), { code: 'NOT_FOUND' });
  state.blockedChannels = []; state.now = created.expiresAt;
  await assert.rejects(() => service.downloadExport(created.exportId), { code: 'NOT_FOUND' });
});

test('channel denials exclude rows before count and totals, and hidden detail matches missing detail', async () => {
  const { service, state } = harness(); state.blockedChannels = ['COUNT', 'SEARCH', 'DETAIL'];
  assert.equal((await service.count(query)).count, 0);
  assert.equal((await service.query({ ...query, search: 'FIXTURE' })).count, 0);
  await assert.rejects(() => service.detail({ ...query, caseId: root.caseId }), { code: 'NOT_FOUND' });
  await assert.rejects(() => service.detail({ ...query, caseId: 'missing-case' }), { code: 'NOT_FOUND' });
  assert.equal(state.reads, 0);
});

test('retail receipts and reversals affect only the private collection flow', async () => {
  const { service, data } = harness();
  const base = { schemaVersion: 1 as const, owner: fixture.case.head, commandId: 'receipt-command', correlationId: 'receipt-correlation',
    actorId: root.partnerSellerId, effectiveDate: '2026-08-28', recordedAt: '2026-08-28T07:00:00.000Z' };
  data.events.push({ ...base, type: 'RETAIL_RECEIPT', eventId: 'retail-event', receiptId: 'retail-receipt',
    planId: fixture.partner.customerPaymentPlan.planId, amount: { amount: '1000', currency: 'IRR' }, allocations: [] });
  data.events.push({ ...base, type: 'RETAIL_RECEIPT_REVERSED', eventId: 'reverse-event', reversalId: 'reverse-326',
    recordedAt: '2026-08-28T07:01:00.000Z', planId: fixture.partner.customerPaymentPlan.planId,
    originalReceiptId: 'retail-receipt', amount: { amount: '200', currency: 'IRR' }, reason: 'برگشت دریافت' });
  const report = await service.query(query);
  assert.equal(report.rows[0].metrics!.retailCollected, '800');
  assert.equal(report.rows[0].collectionStatus, 'PARTIAL');
  assert.equal(report.totals[0].accountingBalance, '1200');
  assert.equal(report.rows[0].metrics!.wholesalePurchases, '1600');
});

test('retail-only successor books its discount change on the correction date', async () => {
  const { service, data, state } = harness(); state.now = '2026-09-03T08:00:00.000Z';
  const nextOwner = { ...fixture.case.head, revision: 2, integrityHash: `sha256-v1:${'b'.repeat(64)}` };
  data.internal.owner = nextOwner; data.fulfillment.owner = nextOwner; data.account!.owner = nextOwner;
  const previous = data.commercial![0];
  data.commercial!.push({ view: { ...previous.view, owner: nextOwner }, comparable: {
    retail: { amount: '1700', currency: 'IRR' }, sabalan: previous.comparable.sabalan, evidenceId: 'basis-2' } });
  data.events.push({ schemaVersion: 1, eventId: 'correction-326', commandId: 'correct-command', correlationId: 'correct-correlation',
    owner: nextOwner, actorId: root.partnerSellerId, recordedAt: '2026-09-02T08:00:00.000Z', effectiveDate: '2026-09-02',
    type: 'CORRECTION_EFFECTIVE', predecessor: fixture.case.head, correctionId: 'retail-correction', scope: 'RETAIL_ONLY', gateEvidenceIds: ['confirmation-326'] });
  const report = await service.query({ ...query, from: '2026-09-01', to: '2026-09-30' });
  assert.equal(report.rows[0].metrics!.retailSales, '-100');
  assert.equal(report.rows[0].metrics!.netComparableMargin, '-100');
  assert.equal(report.rows[0].metrics!.wholesalePurchases, '0');
});

test('a source returning a later revision for a closed period is rejected', async () => {
  const { service, data } = harness();
  data.internal.owner = { ...fixture.case.head, revision: 2 };
  data.fulfillment.owner = data.internal.owner; data.account!.owner = data.internal.owner;
  data.commercial!.push({ view: { ...data.commercial![0].view, owner: data.internal.owner }, comparable: data.commercial![0].comparable });
  await assert.rejects(() => service.query(query), { code: 'INTEGRITY_CONFLICT' });
});

test('customer lookup matches only customer contract number', () => {
  assert.equal(matchesCustomerContractNumber(fixture.customer, fixture.customer.contractNumber), true);
  assert.equal(matchesCustomerContractNumber(fixture.customer, fixture.case.caseNumber), false);
  assert.equal(matchesCustomerContractNumber(fixture.customer, fixture.accounting.recordNumber), false);
});

test('department management cannot count or export a different department', async () => {
  const { service, state } = harness(); state.role = 'INTERNAL'; state.purpose = 'MANAGEMENT'; state.scope = 'DEPARTMENT';
  const management = { ...query, purpose: 'MANAGEMENT' as const };
  assert.equal((await service.query(management)).count, 1);
  state.departmentId = 'other-department';
  assert.equal((await service.count(management)).count, 0);
  assert.equal((await service.createExport(management)).count, 0);
  state.departmentId = undefined;
  await assert.rejects(() => service.query(management), { code: 'FORBIDDEN' });
});

test('a receipt or commitment for a different internal record is rejected', async () => {
  const { service, data } = harness();
  data.events[0] = { ...commitment, internalRecordId: 'other-internal-record' };
  await assert.rejects(() => service.query(query), { code: 'INTEGRITY_CONFLICT' });
});

test('incoherent Accounting balance and mixed currencies are not silently aggregated', async () => {
  const { service, data } = harness();
  data.account!.balance.amount = '9999';
  await assert.rejects(() => service.query(query), { code: 'INTEGRITY_CONFLICT' });
  data.account!.balance.amount = '1200'; data.account!.received.currency = 'IRT';
  await assert.rejects(() => service.query(query), { code: 'INTEGRITY_CONFLICT' });
});

test('route parses pagination, rejects client authority, and sanitizes evidence errors', async () => {
  const { service, data } = harness(); const handlers = new Map<string, ReportHandler>();
  registerPartnerReportRoutes({ get(path, handler) { handlers.set(`GET ${path}`, handler); },
    post(path, handler) { handlers.set(`POST ${path}`, handler); } }, { runtime: contracts, async serviceFor() { return service; } });
  async function request(path: string, input: unknown, params: Record<string, string> = {}) {
    const result = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
    const response: ReportResponse = { status(code) { result.status = code; return response; },
      json(body) { result.body = body; }, setHeader(name, value) { result.headers[name] = value; } };
    await handlers.get(path)!({ query: input, body: input, params }, response);
    return result;
  }
  const valid = await request('GET /', { ...query, limit: '1' });
  assert.equal(valid.status, 200); assert.equal(valid.headers['Cache-Control'], 'private, no-store');
  const denied = await request('GET /', { ...query, scope: 'COMPANY' });
  assert.equal(denied.status, 400);
  (data.internal as unknown as Record<string, unknown>).rawSecret = 'SECRET-INTERNAL-EVIDENCE';
  const invalid = await request('GET /', query);
  assert.equal(invalid.status, 409);
  assert.equal(JSON.stringify(invalid.body).includes('SECRET-INTERNAL-EVIDENCE'), false);
  assert.equal(JSON.stringify(invalid.body).includes('rawSecret'), false);
});

export { harness, query, root, commitment };
