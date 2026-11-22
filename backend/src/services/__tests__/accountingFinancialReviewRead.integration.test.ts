import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../lib/prisma';
import { listFinancialRecords } from '../accountingService';

test('financial review reads one exact record with its recorded payments', async () => {
  const url = new URL(process.env.DATABASE_URL || '');
  assert(['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '55432');
  try {
    const available = await listFinancialRecords({ kind: 'INVOICE_CANDIDATE', page: 1, pageSize: 1 });
    assert(available.items.length > 0, 'local accounting fixture required');
    const id = available.items[0].id;
    const focused = await listFinancialRecords({ kind: 'INVOICE_CANDIDATE', recordId: id, page: 1, pageSize: 1 });
    assert.equal(focused.total, 1);
    assert.equal(focused.items[0].id, id);
    assert(focused.items[0].receivables.every((receivable: any) => Array.isArray(receivable.paymentStatuses)));
    const missing = await listFinancialRecords({ kind: 'INVOICE_CANDIDATE', recordId: `${id}-missing`, page: 1, pageSize: 1 });
    assert.equal(missing.total, 0);
    assert.deepEqual(missing.items, []);
  } finally {
    await prisma.$disconnect();
  }
});
