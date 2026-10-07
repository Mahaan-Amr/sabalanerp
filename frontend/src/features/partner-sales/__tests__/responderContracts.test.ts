import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerWorkspaceFixturesV2 } from '@sabalanerp/partner-sales-contracts/testing';
import { responderContracts, responderProductGroups } from '../responder/responderContracts';
import { responseDecisions } from '../responder/responseDraft';

test('same product merges exact measures and preserves original row revisions and dimensions', () => {
  const inquiry = structuredClone(createPartnerWorkspaceFixturesV2().responder);
  const source = inquiry.rows.find(row => row.state === 'PENDING')!;
  inquiry.rows = [
    { ...source, rowId: 'first', revision: 3, configuration: [{ label: 'کد سنگ', value: '۱۲' }, { label: 'عرض', value: '۴۰' }],
      measures: { lengthMeters: '9007199254740993.01', areaSquareMeters: '0.1', count: '2', consumedAreaSquareMeters: '0.2' } },
    { ...source, rowId: 'second', revision: 8, configuration: [{ label: 'کد سنگ', value: '۱۲' }, { label: 'عرض', value: '۶۰' }],
      measures: { lengthMeters: '0.02', areaSquareMeters: '0.2', count: '3', consumedAreaSquareMeters: '0.3' } },
  ];
  const groups = responderProductGroups([inquiry]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].display.measures, { lengthMeters: '9007199254740993.03', areaSquareMeters: '0.3', count: '5', consumedAreaSquareMeters: '0.5' });
  assert.equal(groups[0].rows[1].configuration[1].value, '۶۰');
  const draft = { outcome: 'APPROVED' as const, amount: '۲۵۰۰۰۰', note: '', mandatoryEnabled: true, mandatoryPercentage: '۱۲.۵' };
  const result = responseDecisions(groups[0].rows.map(row => ({ rowId: row.rowId, revision: row.revision, currency: row.identity.currency })), { first: draft, second: draft });
  assert.ok(result.ok);
  if (result.ok) {
    assert.deepEqual(result.decisions.map(decision => [decision.rowId, decision.expectedRevision]), [['first', 3], ['second', 8]]);
    for (const decision of result.decisions) if (decision.outcome === 'APPROVED') {
      assert.equal(decision.wholesaleUnitPrice.amount, '250000');
      assert.deepEqual(decision.wholesaleMandatory, { enabled: true, percentage: '12.5' });
    }
  }
});

test('different name, code, kind, currency or pricing unit never shares a rate; incomplete measures stay unknown', () => {
  const inquiry = structuredClone(createPartnerWorkspaceFixturesV2().responder);
  const source = inquiry.rows.find(row => row.state === 'PENDING')!;
  const main = { ...source, rowId: 'a', measures: { count: '2' } };
  inquiry.rows = [main, { ...main, rowId: 'b', measures: undefined },
    { ...main, rowId: 'c', description: 'نام دیگر' },
    { ...main, rowId: 'd', identity: { ...main.identity, family: 'prepared' } },
    { ...main, rowId: 'e', identity: { ...main.identity, unit: 'ton' } },
    { ...main, rowId: 'f', identity: { ...main.identity, currency: main.identity.currency === 'IRT' ? 'IRR' : 'IRT' } },
    { ...main, rowId: 'g', configuration: [{ label: 'کد سنگ', value: 'کد دیگر' }] },
  ];
  const groups = responderProductGroups([inquiry]);
  assert.equal(groups[0].rows.length, 2);
  assert.equal(groups[0].display.measures?.count, undefined);
  assert.equal(groups.length, 6);
});

test('contract state and request time use current outstanding rows and never display a technical UUID', () => {
  const inquiry = structuredClone(createPartnerWorkspaceFixturesV2().responder);
  const source = inquiry.rows.find(row => row.state === 'PENDING')!;
  inquiry.caseId = 'case-id'; inquiry.caseNumber = 'PC-technical-uuid'; inquiry.trackingNumber = 16;
  inquiry.customerContractNumber = undefined;
  inquiry.rows = [{ ...source, rowId: 'old', superseded: true, submittedAt: '2026-01-01T00:00:00.000Z' },
    { ...source, rowId: 'current', submittedAt: '2026-10-06T08:00:00.000Z' }];
  const contract = responderContracts([inquiry])[0];
  assert.equal(contract.pending, true);
  assert.equal(contract.requestedAt, '2026-10-06T08:00:00.000Z');
  assert.equal(contract.label, 'کد پیگیری ۱۶');
  inquiry.customerContractNumber = '100343';
  assert.equal(responderContracts([inquiry])[0].label, 'شماره قرارداد ۱۰۰۳۴۳');
});


test('compact group summary retains canonical totals but discloses tools, finishings and dimensions only on original rows', () => {
  const inquiry = structuredClone(createPartnerWorkspaceFixturesV2().responder);
  const source = inquiry.rows.find(row => row.state === 'PENDING')!;
  const configuration = [{ label: 'کد محصول', value: '123' }, { label: 'ابزار', value: 'ابزار ردیف اول' },
    { label: 'پرداخت', value: 'پرداخت ردیف اول' }, { label: 'لایه', value: 'لایه ردیف اول' }, { label: 'ضخامت', value: '۲' }];
  inquiry.rows = [{ ...source, configuration, measures: { areaSquareMeters: '3', consumedAreaSquareMeters: '3.2', count: '50', lengthMeters: '100' } }];
  const group = responderProductGroups([inquiry])[0];
  assert.deepEqual(group.rows[0].configuration, configuration);
  assert.deepEqual(group.display.configuration.map(fact => fact.label), ['کد محصول', 'مجموع طول', 'مجموع مساحت', 'مجموع تعداد', 'متراژ سنگ مصرفی اصلی']);
});


test('new enabled mandatory defaults to twenty percent and explicit zero remains editable', () => {
  for (const [percentage, expected] of [[undefined, '20'], ['0', '0'], ['12.5', '12.5']] as const) {
    const result = responseDecisions([{ rowId: 'row', revision: 1, currency: 'IRT' }], {
      row: { outcome: 'APPROVED', amount: '1000000', note: '', mandatoryEnabled: true,
        ...(percentage !== undefined ? { mandatoryPercentage: percentage } : {}) },
    });
    assert.ok(result.ok);
    if (result.ok && result.decisions[0].outcome === 'APPROVED') {
      assert.deepEqual(result.decisions[0].wholesaleMandatory, { enabled: true, percentage: expected });
    }
  }
});
