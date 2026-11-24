import assert from 'node:assert/strict';
import test from 'node:test';
import type { AxiosAdapter } from 'axios';

import api, { accountingAPI } from '../api';

test('Sabalan payment plan reads and writes use the mounted Partner Accounting endpoints', async () => {
  const expected = { caseId: 'case-1', revision: 1, integrityHash: 'a'.repeat(64) };
  const payable = { amount: '100000', currency: 'IRR' };
  const candidate = { expected, caseNumber: 'PS-1', internalRecordNumber: 'S-1',
    partnerDisplayName: 'همکار', payable };
  const command = {
    expected,
    idempotencyKey: 'plan-1',
    plan: { effectiveDate: '2026-11-25', installments: [{
      installmentId: 'installment-1', dueDate: '2026-11-25', amount: payable, method: 'BANK_TRANSFER',
    }] },
  };
  const saved = { planId: 'plan-1', invoiceRecordId: 'invoice-1', replayed: false };
  const adapter: AxiosAdapter = async config => {
    const { pathname } = new URL(api.getUri(config), 'http://test.invalid');
    assert.equal(config.headers.get('x-sabalan-expected-user'), 'accountant-1');
    switch (`${config.method} ${pathname}`) {
      case 'get /api/partner/accounting/sabalan-plan-candidates':
        return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: [candidate] } };
      case 'post /api/partner/accounting/sabalan-payment-plan':
        assert.deepEqual(JSON.parse(config.data), command);
        return { config, status: 200, statusText: 'OK', headers: {}, data: { success: true, data: saved } };
      default:
        assert.fail(`The Partner Accounting router does not serve ${config.method} ${pathname}`);
    }
  };
  const request = { adapter, headers: { 'x-sabalan-expected-user': 'accountant-1' } };
  const [read, write] = await Promise.all([
    accountingAPI.getPartnerSabalanPlanCandidates(request),
    accountingAPI.setPartnerSabalanPaymentPlan(command, request),
  ]);
  assert.deepEqual(read.data, { success: true, data: [candidate] });
  assert.deepEqual(write.data, { success: true, data: saved });
});
