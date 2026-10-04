'use client';
import React, { useState } from 'react';
import { ErpButton, ErpCard } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import AccountingActionModal from './AccountingActionModal';
import AccountingVoidWorkflowPanel from './AccountingVoidWorkflowPanel';
import type { PartnerInternalDocument } from './PartnerAccountingDetailView';
import { money, invoiceStatusLabels } from './accountingUi';

type Target = { kind: 'START_ACCOUNTING_VOID_CASE' | 'VOID_ACCOUNTING_RECORD' | 'VOID_ACCOUNTING_RECEIVABLE' | 'RESOLVE_TAX_FOR_VOID' | 'CANCEL_ACCOUNTING_VOID_CASE'; id: string };
export default function PartnerFinancialVoidPanel({ document: doc, pending, refresh }: {
  document: PartnerInternalDocument; pending: boolean; refresh: () => Promise<void>;
}) {
  const [target, setTarget] = useState<Target>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [requestKey, setRequestKey] = useState('');
  const open = (kind: Target['kind'], id: string) => { setTarget({ kind, id }); setRequestKey(crypto.randomUUID()); setError(undefined); };
  const start = target?.kind === 'START_ACCOUNTING_VOID_CASE';
  const final = target?.kind === 'VOID_ACCOUNTING_RECORD';
  const cancel = target?.kind === 'CANCEL_ACCOUNTING_VOID_CASE';
  const submit = async (values: Record<string, string | number>) => {
    if (!target || busy) return;
    setBusy(true); setError(undefined);
    try {
      await accountingAPI.executeAction({ kind: target.kind,
        ...(cancel ? { voidCaseId: target.id, cancellationReason: String(values.reason) }
          : target.kind === 'VOID_ACCOUNTING_RECEIVABLE' ? { receivableId: target.id }
          : target.kind === 'RESOLVE_TAX_FOR_VOID' ? { taxRecordId: target.id } : { recordId: target.id }),
        ...(!final && !cancel ? { reason: String(values.reason).trim(), effectiveAt: PersianCalendar.toGregorian(String(values.effectiveAt)).toISOString() } : {}),
        ...(start ? { reasonKind: String(values.reasonKind), ...(values.reasonKind === 'DUPLICATE_ISSUE' ? { retainedRecordId: String(values.retainedRecordId) } : {}) } : {}),
        idempotencyKey: requestKey, correlationId: requestKey,
      });
      setTarget(undefined); await refresh();
    } catch (failure) {
      const data = (failure as { response?: { data?: { error?: string; message?: string } } }).response?.data;
      setError(data?.message || data?.error || 'اقدام ابطال ثبت نشد؛ وضعیت پرونده را تازه‌سازی کنید.');
    } finally { setBusy(false); }
  };
  return <div className="space-y-4">
    {(doc.financialRecords || []).map(record => <ErpCard key={record.id} className="space-y-2 p-4">
      <strong>صورتحساب {record.systemInvoiceNumber || 'بدون شماره'}</strong>
      <p>{invoiceStatusLabels[record.status] || record.status} · {money(record.amount, record.currency)}</p>
      {['ISSUED', 'POSTED'].includes(record.status) && doc.actions.canVoidRecord &&
        !doc.voidWorkflows?.some(workflow => workflow.sourceRecordId === record.id && workflow.status === 'OPEN') &&
        <ErpButton label="شروع ابطال" tone="danger" variant="outline" disabled={pending || busy} onClick={() => open('START_ACCOUNTING_VOID_CASE', record.id)} />}
    </ErpCard>)}
    <AccountingVoidWorkflowPanel workflows={doc.voidWorkflows || []} busy={pending || busy} canAct={Boolean(doc.actions.canVoidRecord)}
      onResolveTax={(_, id) => open('RESOLVE_TAX_FOR_VOID', id)} onVoidReceivable={(_, id) => open('VOID_ACCOUNTING_RECEIVABLE', id)}
      onVoidRecord={(_, id) => open('VOID_ACCOUNTING_RECORD', id)} onCancel={workflow => open('CANCEL_ACCOUNTING_VOID_CASE', workflow.id)} />
    <AccountingActionModal open={Boolean(target)} title={start ? 'شروع پرونده ابطال مالی' : final ? 'تکمیل ابطال رکورد مالی' : cancel ? 'لغو پرونده ابطال' : target?.kind === 'RESOLVE_TAX_FOR_VOID' ? 'تعیین‌تکلیف مالیات' : 'ابطال دریافتنی'}
      description={final ? 'قرارداد مشتری و تعهد خرید همکار باقی می‌مانند. رکورد مالی باطل می‌شود و سابقه آن حفظ می‌شود.' : undefined}
      fields={[
        ...(start ? [{ id: 'reasonKind', label: 'نوع دلیل', type: 'select' as const, required: true, defaultValue: 'ENTRY_ERROR', options: [
          { label: 'صدور تکراری', value: 'DUPLICATE_ISSUE' }, { label: 'اشتباه ثبت', value: 'ENTRY_ERROR' }, { label: 'لغو معامله', value: 'SALE_CANCELLED' }, { label: 'سایر', value: 'OTHER' },
        ] }, { id: 'retainedRecordId', label: 'فاکتور معتبر باقی‌مانده', type: 'select' as const,
          visibleWhen: { fieldId: 'reasonKind', equals: 'DUPLICATE_ISSUE' }, requiredWhen: { fieldId: 'reasonKind', equals: 'DUPLICATE_ISSUE' },
          options: (doc.financialRecords || []).filter(record => record.id !== target?.id && ['ISSUED', 'POSTED'].includes(record.status))
            .map(record => ({ label: `فاکتور ${record.systemInvoiceNumber || record.id}`, value: record.id })) }] : []),
        ...(!final ? [{ id: 'reason', label: 'دلیل', type: 'textarea' as const, required: true }] : []),
        ...(!final && !cancel ? [{ id: 'effectiveAt', label: 'تاریخ مؤثر', type: 'date' as const, required: true }] : []),
      ]} destructive busy={busy} error={error} onClose={() => { if (!busy) setTarget(undefined); }} onSubmit={submit} />
  </div>;
}
