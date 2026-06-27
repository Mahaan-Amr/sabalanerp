'use client';

import { useEffect, useState } from 'react';
import { FaEye, FaFileInvoice, FaSync, FaTrashAlt } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { StatusBadge, dateFa, money } from '@/features/accounting/accountingUi';

export default function AccountingInvoiceCandidatesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadRows = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getFinancialRecords({ kind: 'INVOICE_CANDIDATE' });
      if (response.data.success) setRows(response.data.data);
    } catch (error) {
      console.error('Error loading invoice candidates:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const deleteDraftRecord = async (row: any) => {
    if (!window.confirm('این پیش‌نویس رکورد مالی حذف شود؟')) return;
    setActionLoading(row.id);
    try {
      await accountingAPI.executeAction({
        kind: 'DELETE_DRAFT_ACCOUNTING_RECORD',
        recordId: row.id,
        note: 'Deleted draft from invoice candidates register',
      });
      await loadRows();
    } catch (error) {
      console.error('Delete draft accounting record failed:', error);
      window.alert((error as any)?.response?.data?.error || 'حذف پیش‌نویس رکورد مالی انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const rowActions = (row: any): ErpAction[] => [
    ...(row.contractId ? [{ label: 'مشاهده پرونده', href: `/dashboard/accounting/contracts/${row.contractId}`, icon: FaEye, tone: 'primary' as const }] : []),
    {
      label: 'حذف پیش‌نویس',
      icon: FaTrashAlt,
      tone: 'danger',
      disabled: row.status !== 'DRAFT' || actionLoading === row.id,
      onClick: () => deleteDraftRecord(row),
    },
  ];

  const columns: ErpColumn<any>[] = [
    {
      id: 'invoice',
      header: 'پیش‌نویس صورتحساب',
      priority: 'primary',
      cell: (row) => (
        <div>
          <p className="font-semibold text-slate-950 dark:text-white">{row.id}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">قرارداد: {row.contractId || '—'}</p>
        </div>
      ),
    },
    { id: 'amount', header: 'مبلغ', mobileLabel: 'مبلغ', priority: 'secondary', align: 'end', cell: (row) => money(row.amount, row.currency) },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.status} /> },
    { id: 'items', header: 'اقلام', mobileLabel: 'اقلام', priority: 'meta', cell: (row) => (row.invoiceItems?.length || 0).toLocaleString('fa-IR') },
    { id: 'date', header: 'تاریخ ایجاد', mobileLabel: 'تاریخ ایجاد', priority: 'meta', cell: (row) => dateFa(row.createdAt) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="پیش‌نویس صورتحساب‌ها"
      description="صورتحساب‌های پیشنهادی که حسابداری از قراردادهای تایید شده، امضا شده یا چاپ شده ایجاد کرده است."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      emptyState={<ErpEmptyState icon={FaFileInvoice} title="پیش‌نویس صورتحسابی وجود ندارد" description="از رجیستر قراردادها، برای قراردادهای مجاز پیش‌نویس صورتحساب ایجاد کنید." />}
    />
  );
}
