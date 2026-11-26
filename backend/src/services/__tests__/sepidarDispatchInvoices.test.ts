import assert from 'node:assert/strict';
import test from 'node:test';
import { sepidarInvoiceTotalsMatch } from '../sepidarDispatchInvoices';

test('reconciles the approved loading and entered invoice totals at three decimal places', () => {
  const loadingTotalRial = '1056776876.1156194219';
  const invoices = ['600000000', '300000000', '156776876.116'].map(amountRial => ({ amountRial }));

  assert.equal(sepidarInvoiceTotalsMatch(invoices, loadingTotalRial), true);
  assert.equal(sepidarInvoiceTotalsMatch(invoices, null), false);
  assert.equal(sepidarInvoiceTotalsMatch([...invoices, { amountRial: '0.001' }], loadingTotalRial), false);
});

test('rounds each aggregate once and accepts full-precision invoice amounts', () => {
  assert.equal(sepidarInvoiceTotalsMatch([{ amountRial: '0.0004' }, { amountRial: '0.0004' }], '0.001'), true);
  assert.equal(sepidarInvoiceTotalsMatch([{ amountRial: '0.0005' }], '0.001'), true);
  assert.equal(sepidarInvoiceTotalsMatch([{ amountRial: '0.000499999999' }], '0.001'), false);
  assert.equal(sepidarInvoiceTotalsMatch([{ amountRial: '0' }], '-0.0004'), false);
});
