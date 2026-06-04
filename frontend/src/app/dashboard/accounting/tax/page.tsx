'use client';

import { useEffect, useState } from 'react';
import { FaBalanceScale, FaCheck, FaSync, FaTimes } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { StatusBadge, dateFa, money, taxStatusLabels } from '@/features/accounting/accountingUi';

export default function AccountingTaxPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadRows = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getTaxRecords();
      if (response.data.success) setRows(response.data.data);
    } catch (error) {
      console.error('Error loading tax records:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const track = async (row: any, status: string) => {
    const trackingCode = status === 'SUBMITTED_MANUALLY' || status === 'SUBMITTED' ? window.prompt('کد پیگیری یا شماره مرجع را وارد کنید') : undefined;
    try {
      setActionLoading(`${row.id}:${status}`);
      await accountingAPI.executeAction({
        kind: 'TRACK_TAX_SUBMISSION',
        invoiceId: row.invoiceRecordId,
        status,
        trackingCode,
        submittedAt: new Date().toISOString(),
      });
      await loadRows();
    } catch (error) {
      console.error('Error tracking tax:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ErpColumn<any>[] = [
    { id: 'tax', header: 'پرونده مالیاتی', priority: 'primary', cell: (row) => <div><p className="font-semibold">{taxStatusLabels[row.submissionStatus] || row.submissionStatus}</p><p className="mt-1 text-xs text-slate-500">قرارداد: {row.contractId || '—'}</p></div> },
    { id: 'taxable', header: 'مشمول مالیات', mobileLabel: 'مشمول مالیات', priority: 'secondary', align: 'end', cell: (row) => money(row.taxableAmount) },
    { id: 'vat', header: 'ارزش افزوده', mobileLabel: 'ارزش افزوده', priority: 'secondary', align: 'end', cell: (row) => money(row.vatAmount) },
    { id: 'missing', header: 'کسری اطلاعات', mobileLabel: 'کسری اطلاعات', priority: 'meta', cell: (row) => row.missingFields?.length ? row.missingFields.join('، ') : '—' },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.submissionStatus} /> },
    { id: 'date', header: 'آخرین تغییر', mobileLabel: 'آخرین تغییر', priority: 'meta', cell: (row) => dateFa(row.updatedAt) },
  ];

  const rowActions = (row: any): ErpAction[] => [
    { label: 'ثبت دستی', icon: FaBalanceScale, tone: 'info', disabled: actionLoading === `${row.id}:SUBMITTED_MANUALLY`, onClick: () => track(row, 'SUBMITTED_MANUALLY') },
    { label: 'پذیرفته شد', icon: FaCheck, tone: 'success', disabled: actionLoading === `${row.id}:ACCEPTED`, onClick: () => track(row, 'ACCEPTED') },
    { label: 'رد شد', icon: FaTimes, tone: 'danger', disabled: actionLoading === `${row.id}:REJECTED`, onClick: () => track(row, 'REJECTED') },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="مالیات و سامانه مودیان"
      description="آمادگی اطلاعات مالیاتی و پیگیری دستی وضعیت ارسال، پذیرش یا رد صورتحساب در سامانه مودیان."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      emptyState={<ErpEmptyState icon={FaBalanceScale} title="پرونده مالیاتی ثبت نشده است" description="با ایجاد پیش‌نویس صورتحساب، پرونده مالیاتی و آمادگی سامانه مودیان ایجاد می‌شود." />}
    />
  );
}
