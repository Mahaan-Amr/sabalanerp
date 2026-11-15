import assert from 'node:assert/strict';
import test from 'node:test';
import api from '../../../lib/api';
import { submitFinancialApproval } from '../submitFinancialApproval';

test('lost approval response retries the same intent with the same actual HTTP idempotency key', async () => {
  const headers: Array<Record<string,string>> = [];
  const original = api.defaults.adapter;
  api.defaults.adapter = async config => { headers.push(config.headers.toJSON() as Record<string,string>); throw Object.assign(new Error('response lost'), {config}); };
  try {
    const request = () => submitFinancialApproval({ invoiceId:'qa-record', systemInvoiceNumber:'123', systemInvoiceDate:'2026-10-01', sepidarAmount:'100' });
    await assert.rejects(request(), /response lost/);
    await assert.rejects(request(), /response lost/);
    assert.ok(headers[0]['x-idempotency-key']);
    assert.equal(headers[0]['x-idempotency-key'], headers[1]['x-idempotency-key']);
    assert.notEqual(headers[0]['x-correlation-id'], headers[1]['x-correlation-id']);
    await assert.rejects(submitFinancialApproval({ invoiceId:'qa-record', systemInvoiceNumber:'456', systemInvoiceDate:'2026-10-01', sepidarAmount:'100' }), /response lost/);
    assert.notEqual(headers[0]['x-idempotency-key'], headers[2]['x-idempotency-key']);
  } finally { api.defaults.adapter = original; }
});
