import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerAccountingContractRow } from '../accountingUnifiedContracts';

test('Accounting list projects only the internal sale identity and debtor', () => {
  const record = partnerAccountingContractRow({ id: 'invoice-1', status: 'DRAFT', amount: { toString: () => '1500000' },
    currency: 'IRT', createdAt: new Date('2026-09-26T09:00:00Z'), partnerContext: {
      caseNumber: 'PC-c27668a2-7578-4229-a060-b1f7639b627f', internalRecordNumber: 'PI-100329',
      debtor: { displayName: 'فروشنده همکار' }, actionUrl: '/dashboard/accounting/invoice-candidates?search=case',
    } });
  assert.ok(record);
  assert.match(record.contractNumber, /^همکار-/);
  assert.equal(record.customer.displayName, 'فروشنده همکار');
  assert.equal(record.accounting.currency, 'IRT');
  assert.equal(record.financialRecords[0].id, 'invoice-1');
  assert.equal(JSON.stringify(record).includes('PI-100329'), true);
  assert.equal(JSON.stringify(record).includes('retail'), false);
});
