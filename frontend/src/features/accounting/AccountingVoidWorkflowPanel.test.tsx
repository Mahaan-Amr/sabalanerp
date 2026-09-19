import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AccountingVoidWorkflowPanel, { type AccountingVoidWorkflowView } from './AccountingVoidWorkflowPanel';

const workflow: AccountingVoidWorkflowView = {
  id: 'void-case-1',
  sourceRecordId: 'invoice-1406',
  status: 'OPEN',
  reasonKind: 'DUPLICATE_ISSUE',
  reason: 'صدور تکراری فاکتور ۱۴۰۶',
  effectiveAt: '2026-09-19T00:00:00.000Z',
  retainedRecordId: 'invoice-1405',
  blockers: [{ code: 'ACTIVE_RECEIPT', messageFa: 'ابتدا دریافت ثبت‌شده را برگشت بزنید.', responsibleRoleFa: 'مدیر حسابداری' }],
  nextAction: { kind: 'REVERSE_RECEIPT', targetId: 'payment-1', href: '/dashboard/accounting/payments?recordId=payment-1', labelFa: 'برگشت دریافت' },
  canCancel: true,
  steps: [
    {
      id: 'COLLECTIONS', titleFa: 'تعیین‌تکلیف دریافت‌ها و چک‌ها', state: 'ACTIONABLE',
      messageFa: 'ابتدا دریافت ثبت‌شده را برگشت بزنید.',
      action: { kind: 'REVERSE_RECEIPT', targetId: 'payment-1', href: '/dashboard/accounting/payments?recordId=payment-1', labelFa: 'برگشت دریافت' },
    },
    { id: 'RECEIVABLES', titleFa: 'ابطال دریافتنی', state: 'WAITING', messageFa: 'پس از تعیین‌تکلیف مراحل قبل، دریافتنی را باطل کنید.' },
  ],
};

test('shows a simple resolution step, responsible role, and direct action for a blocker', () => {
  const html = renderToStaticMarkup(
    <AccountingVoidWorkflowPanel workflows={[workflow]} onVoidReceivable={() => undefined}
      onVoidRecord={() => undefined} onCancel={() => undefined} />,
  );
  assert.match(html, /راه‌حل: ابتدا دریافت ثبت‌شده را برگشت بزنید/);
  assert.match(html, /مسئول انجام: مدیر حسابداری/);
  assert.match(html, /href="\/dashboard\/accounting\/payments\?recordId=payment-1"/);
  assert.match(html, /برگشت دریافت/);
});
