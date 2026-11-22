import assert from 'node:assert/strict';
import test from 'node:test';
import { invoiceDraftApprovalCommand } from '../invoiceDraftApproval.ts';

test('invoice approval keeps both identities for a retry and rotates them when details change', () => {
  const ids = ['request-1', 'trace-1', 'request-2', 'trace-2'];
  const newId = () => {
    const id = ids.shift();
    if (!id) throw new Error('Unexpected identity creation');
    return id;
  };
  const details = { systemInvoiceNumber: 'S-19', systemInvoiceDate: '2026-11-16', sepidarAmount: '100' };
  const first = invoiceDraftApprovalCommand(null, 'draft-1', details, newId);
  assert.deepEqual(first.command, { kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId: 'draft-1', ...details,
    idempotencyKey: 'request-1', correlationId: 'trace-1' });
  const retried = invoiceDraftApprovalCommand(first.identity, 'draft-1', { ...details }, newId);
  assert.deepEqual(retried.command, first.command);
  const edited = invoiceDraftApprovalCommand(retried.identity, 'draft-1', { ...details, sepidarAmount: '101' }, newId);
  assert.equal(edited.command.idempotencyKey, 'request-2');
  assert.equal(edited.command.correlationId, 'trace-2');
});
