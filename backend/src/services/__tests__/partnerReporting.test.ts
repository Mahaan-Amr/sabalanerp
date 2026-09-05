import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import * as contracts from '../../../../packages/partner-sales-contracts';
import { PartnerReportingService } from '../partnerSales/reporting/service';
import type { CaseEvidence, Query, ReportingSource, ReportExportStore, FrozenExport, Root } from '../partnerSales/reporting/contracts';
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
    blockedChannels: [] as string[], now: '2026-08-28T08:00:00.000Z', departmentId: root.departmentId as string | undefined,
    partnerStatus: 'ACTIVE' as contracts.PermissionContext['partnerStatus'] };
  const data: CaseEvidence = structuredClone({ root, events: [commitment], internal: { ...fixture.accounting, state: 'COMMITTED' },
    commercial: [{ view: { ...fixture.partner, state: 'COMMITTED', resaleDifference: '9999' },
      comparable: { retail: { amount: '1800', currency: 'IRR' }, sabalan: { amount: '1600', currency: 'IRR' }, evidenceId: 'basis-326' } }],
    account: { owner: fixture.case.head, caseNumber: fixture.case.caseNumber, amount: { amount: '1600', currency: 'IRR' },
      sabalanPaymentPlan: fixture.partner.sabalanPaymentPlan, received: { amount: '400', currency: 'IRR' },
      balance: { amount: '1200', currency: 'IRR' }, status: 'PARTIALLY_PAID' },
    fulfillment: fixture.fulfillment, deliveryProgress: null });
  const datasets = [data];
  const context = (purpose: string, channel: string, target: Root = root): contracts.PermissionContext => contracts.PermissionContextSchema.parse({
    actorId: state.actorId, persona: state.role, isAdmin: false, partnerSellerId: target.partnerSellerId,
    partnerStatus: state.partnerStatus, root: { kind: 'CASE', id: target.caseId }, purpose: state.purpose === 'PARTNER' ? purpose : state.purpose,
    channel, scope: state.scope, departmentId: state.departmentId, resourceVisible: true,
    actionGranted: state.allowed && !state.blockedChannels.includes(channel),
    authorizationRevision: 1, lifecycleRevision: 1, evaluatedAt: state.now,
  });
  const source: ReportingSource = { async read(request, work) {
    return work({ snapshotId: 'snapshot-326', capturedAt: state.now,
      access: { ok: true, value: context(request.purpose, 'API') }, roots: datasets.map(item => item.root),
      authorization(purpose, channel) { return { async authorize(_action, requested) {
        const target = datasets.find(item => item.root.caseId === requested.id)!.root;
        return { ok: true, value: context(purpose, channel, target) };
      } }; },
      async caseEvidence(target) { state.reads++; return structuredClone(datasets.find(item => item.root.caseId === target.caseId)!); },
      async putExport(artifact) { artifacts.set(artifact.id, structuredClone(artifact)); },
    });
  } };
  const artifacts = new Map<string, FrozenExport>();
  const store: ReportExportStore = { async get(id) { return structuredClone(artifacts.get(id) || null); } };
  return { state, data, datasets, service: new PartnerReportingService(contracts, source, store) };
}

test('Partner queries keep discounted retail, wholesale and Accounting balances separate', async () => {
  const { service } = harness();
  const report = await service.query(query);
  assert.equal(report.count, 1);
  assert.deepEqual(report.totals[0], { currency: 'IRR', metrics: {
    wholesalePurchases: '1600', retailSales: '1800', retailCollected: '0', netComparableMargin: '200',
  }, accountingBalance: '1200', accountingReceivedAsOf: '400', accountingCovered: 1, accountingEligible: 1 });
  assert.equal(report.rows[0].collectionStatus, 'UNPAID');
  assert.equal(JSON.stringify(report).includes('FIXTURE-INTERNAL-313'), false);
  assert.equal((await service.query({ ...query, search: 'FIXTURE-INTERNAL-313' })).count, 0);
  assert.equal((await service.query({ ...query, search: 'FIXTURE-CUSTOMER-313' })).count, 1);
});

test('current reports omit retired zero-obligation lineage without hiding an outstanding retired balance', async () => {
  const { service, data } = harness();
  const current = data.fulfillment.products[0]!;
  data.deliveryProgress = [{ productRowId: current.productRowId, unit: current.unit,
    contracted: current.quantity, reserved: '0.000', dispatched: '0.000' },
  { productRowId: 'retired-row', unit: current.unit, contracted: '0.000', reserved: '0.000', dispatched: '0.000' }];
  const report = await service.query(query);
  assert.equal(report.rows[0].deliveryProgress?.length, 1);
  assert.equal(JSON.stringify(report.rows[0].deliveryProgress).includes('retired-row'), false);
  data.deliveryProgress[1]!.dispatched = '1.000';
  await assert.rejects(service.query(query), { code: 'INTEGRITY_CONFLICT' });
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

test('another actor without a report grant cannot distinguish existing and missing exports', async () => {
  const { service, state } = harness();
  const created = await service.createExport(query);
  state.actorId = 'other-actor'; state.allowed = false;
  await assert.rejects(() => service.downloadExport(created.exportId), { code: 'NOT_FOUND' });
  await assert.rejects(() => service.downloadExport('missing-export'), { code: 'NOT_FOUND' });
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
  // A timestamp and lexical event ID are not a causal sequence.
  data.events[1].eventId = 'z-receipt'; data.events[2].eventId = 'a-reversal';
  data.events[2].recordedAt = data.events[1].recordedAt;
  assert.equal((await service.query(query)).rows[0].metrics!.retailCollected, '800');
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
  data.events[1].recordedAt = data.events[0].recordedAt; data.events[1].eventId = 'a-correction';
  assert.equal((await service.query({ ...query, from: '2026-09-01', to: '2026-09-30' })).rows[0].metrics!.retailSales, '-100');
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

test('Accounting is the received/balance authority and mixed currencies are rejected', async () => {
  const { service, data } = harness();
  data.account!.received.amount = '300'; data.account!.balance.amount = '1300';
  const report = await service.query(query);
  assert.equal(report.totals[0].accountingReceivedAsOf, '300');
  assert.equal(report.totals[0].accountingBalance, '1300');
  data.account!.received.currency = 'IRT';
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

test('same-snapshot totals stay complete across pagination and currencies never mix', async () => {
  const { service, data, datasets } = harness();
  const second: CaseEvidence = JSON.parse(JSON.stringify(data)
    .replace(/fixture-313-case/g, 'fixture-326-second-case')
    .replace(/FIXTURE-CASE-313/g, 'FIXTURE-CASE-326')
    .replace(/FIXTURE-CUSTOMER-313/g, 'FIXTURE-CUSTOMER-326')
    .replace(/fixture-313-internal/g, 'fixture-326-second-internal')
    .replace(/commit-326/g, 'commit-second-326'));
  datasets.push(second);
  const page = await service.query({ ...query, limit: 1 });
  assert.equal(page.rows.length, 1); assert.equal(page.count, 2);
  assert.equal(page.totals[0].metrics.retailSales, '3600');
  const count = await service.count(query);
  assert.deepEqual(count.totals, page.totals); assert.equal(count.snapshotId, page.snapshotId);
  const exported = await service.createExport({ ...query, offset: 1, limit: 1 });
  assert.equal((await service.downloadExport(exported.exportId)).rows.length, 2);
  datasets[1] = JSON.parse(JSON.stringify(second).replace(/"currency":"IRR"/g, '"currency":"IRT"'));
  const currencies = await service.query(query);
  assert.equal(currencies.totals.length, 2);
  assert.deepEqual(currencies.totals.map(total => [total.currency, total.metrics.retailSales]), [['IRR', '1800'], ['IRT', '1800']]);
});

test('suspended Partners retain read history while pending/terminated cannot report', async () => {
  const { service, state } = harness(); state.partnerStatus = 'SUSPENDED';
  assert.equal((await service.query(query)).count, 1);
  state.partnerStatus = 'PENDING'; await assert.rejects(() => service.query(query), { code: 'FORBIDDEN' });
  state.partnerStatus = 'TERMINATED'; await assert.rejects(() => service.query(query), { code: 'FORBIDDEN' });
});

test('a reviewed void posts negative period flows and keeps original commitment evidence', async () => {
  const { service, data } = harness();
  data.internal.state = 'VOIDED'; data.commercial![0].view.state = 'VOIDED'; data.account!.status = 'VOIDED'; data.account!.balance.amount = '0';
  const base = { schemaVersion: 1 as const, owner: fixture.case.head, commandId: 'void-command', correlationId: 'void-correlation',
    actorId: 'accountant-326', effectiveDate: '2026-08-28', recordedAt: '2026-08-28T07:00:00.000Z' };
  data.events.push({ ...base, type: 'SABALAN_ADJUSTMENT', eventId: 'void-adjustment', internalRecordId: fixture.accounting.recordId,
    originalRealizationEventId: commitment.eventId, correctionId: 'void-326', delta: '-1600', currency: 'IRR', reason: 'ابطال بررسی‌شده' });
  data.events.push({ ...base, type: 'CASE_VOIDED', eventId: 'void-event', recordedAt: '2026-08-28T07:01:00.000Z',
    correctionId: 'void-326', commitmentEventId: commitment.eventId, adjustmentEventIds: ['void-adjustment'],
    dependencyEvidenceIds: ['dependency-cleared'], reason: 'ابطال بررسی‌شده' });
  const report = await service.query({ ...query, from: '2026-08-28' });
  assert.equal(report.rows[0].metrics!.retailSales, '-1800');
  assert.equal(report.rows[0].metrics!.wholesalePurchases, '-1600');
  assert.equal(report.rows[0].metrics!.netComparableMargin, '-200');
  assert.equal(data.events.filter(event => event.type === 'CASE_COMMITTED').length, 1);
});

test('negative margin is reported without blocking an authorized below-cost sale', async () => {
  const { service, data } = harness(); data.commercial![0].comparable.retail.amount = '1500';
  assert.equal((await service.query(query)).rows[0].metrics!.netComparableMargin, '-100');
});

export { harness, query, root, commitment };
