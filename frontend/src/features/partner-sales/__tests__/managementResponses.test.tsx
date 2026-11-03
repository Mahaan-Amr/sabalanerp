import assert from 'node:assert/strict';
import test from 'node:test';
import { responseDecisions, settleResponseDrafts } from '../responder/responseDraft';

test('bulk approval preserves each selected row price and omits unselected rows', () => {
  const result = responseDecisions([
    { rowId: 'row-a', revision: 3, currency: 'IRR' },
    { rowId: 'row-b', revision: 8, currency: 'IRT' },
    { rowId: 'row-c', revision: 2, currency: 'IRR' },
  ], {
    'row-a': { selected: true, outcome: 'APPROVED', amount: '120000', note: '' },
    'row-b': { selected: true, outcome: 'APPROVED', amount: '۲۵۰۰۰', note: 'نرخ مستقل' },
    'row-c': { selected: false, outcome: 'APPROVED', amount: '900', note: '' },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.decisions, [
    { rowId: 'row-a', expectedRevision: 3, outcome: 'APPROVED', wholesaleUnitPrice: { amount: '120000', currency: 'IRR' } },
    { rowId: 'row-b', expectedRevision: 8, outcome: 'APPROVED', wholesaleUnitPrice: { amount: '25000', currency: 'IRT' }, note: 'نرخ مستقل' },
  ]);
});

test('partial outcomes remove successful edits and require fresh selection for stale rows', () => {
  const drafts = {
    a: { selected: true, outcome: 'APPROVED' as const, amount: '100', note: '' },
    b: { selected: true, outcome: 'APPROVED' as const, amount: '250', note: 'قیمت مستقل' },
    c: { selected: false, outcome: 'REJECTED' as const, amount: '', note: 'مشخصات ناقص' },
  };
  assert.deepEqual(settleResponseDrafts(drafts, { schemaVersion: 1, commandId: 'fixture-command', outcomes: [
    { ok: true, rowId: 'a', revision: 2, outcomeId: 'fixture-outcome', outcome: 'APPROVED' },
    { ok: false, rowId: 'b', error: { code: 'ROW_STALE', status: 409, message: 'اطلاعات تغییر کرده است؛ صفحه را تازه کنید.' } },
  ] }), { b: { ...drafts.b, selected: false }, c: drafts.c });
});

test('rejection requires a Persian reason while approval rejects ambiguous numeric input', () => {
  const rows = [{ rowId: 'a', revision: 1, currency: 'IRR' as const }];
  for (const amount of ['1,000', '1e3', '-2', 'NaN', '', '9'.repeat(81)]) {
    assert.equal(responseDecisions(rows, { a: { selected: true, outcome: 'APPROVED', amount, note: '' } }).ok, false);
  }
  assert.equal(responseDecisions(rows, { a: { selected: true, outcome: 'REJECTED', amount: '', note: 'no' } }).ok, false);
  assert.deepEqual(responseDecisions(rows, { a: { selected: true, outcome: 'REJECTED', amount: '', note: 'مشخصات کافی نیست' } }), {
    ok: true, decisions: [{ rowId: 'a', expectedRevision: 1, outcome: 'REJECTED', reason: 'مشخصات کافی نیست' }],
  });
});
