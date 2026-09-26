import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAccountingWorkAttention } from '../accountingWorkAttention';

const createdAt = new Date('2026-09-01T08:00:00.000Z');
const base = {
  eligible: true, invoiceStatus: 'DRAFT', receivableStatus: 'NONE', taxStatus: 'READY',
  hasReceivable: false, missingTaxFields: [], openCorrections: [], openBlockerFlags: [],
  openInvoiceCandidates: [{ createdAt }], overdueReceivables: [], assignedUsers: {}, createdAt,
};

test('a blocking correction takes priority and retains the actual assigned owner and waiting date', () => {
  const correctionDate = new Date('2026-09-03T08:00:00.000Z');
  const attention = resolveAccountingWorkAttention({ ...base, assignedUsers: { 'user-1': 'حسابدار نمونه' },
    openCorrections: [{ createdAt: correctionDate, assignedToUserId: 'user-1' }] });
  assert.equal(attention?.reason, 'درخواست اصلاح باز');
  assert.equal(attention?.owner, 'حسابدار نمونه');
  assert.equal(attention?.priority, 1);
  assert.equal(attention?.waitingSince, correctionDate);
});

test('financial approval waits in detail instead of becoming a list-side command', () => {
  const attention = resolveAccountingWorkAttention(base);
  assert.equal(attention?.nextAction, 'بررسی و تأیید مالی');
  assert.equal(attention?.evidence, 'مبلغ، پرداخت‌ها و مدارک منشأ در پرونده بررسی شوند.');
});

test('an already complete contract does not enter the work inbox', () => {
  assert.equal(resolveAccountingWorkAttention({ ...base, invoiceStatus: 'ISSUED', hasReceivable: true,
    openInvoiceCandidates: [], taxStatus: 'READY' }), null);
});

test('missing tax fields are named without claiming a complete evidence check', () => {
  const attention = resolveAccountingWorkAttention({ ...base, invoiceStatus: 'NONE',
    openInvoiceCandidates: [], missingTaxFields: ['شناسه ملی شرکت'] });
  assert.match(attention?.evidence || '', /شناسه ملی شرکت/);
});
