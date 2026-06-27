'use client';

import { useEffect, useState } from 'react';
import { FaCheckCircle, FaEdit, FaExclamationTriangle, FaEye, FaSync } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { StatusBadge, dateFa } from '@/features/accounting/accountingUi';

export default function AccountingCorrectionRequestsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadRows = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getCorrectionRequests();
      if (response.data.success) setRows(response.data.data);
    } catch (error) {
      console.error('Error loading correction requests:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const resolveCorrection = async (row: any) => {
    const resolutionNote = window.prompt('یادداشت بستن درخواست اصلاح را وارد کنید');
    if (resolutionNote === null) return;
    setActionLoading(row.id);
    try {
      await accountingAPI.executeAction({
        kind: 'RESOLVE_CORRECTION',
        correctionRequestId: row.id,
        resolutionNote: resolutionNote?.trim() || undefined,
      });
      await loadRows();
    } catch (error) {
      console.error('Resolve correction failed:', error);
      window.alert((error as any)?.response?.data?.error || 'بستن درخواست اصلاح انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const rowActions = (row: any): ErpAction[] => [
    ...(row.contractId ? [
      { label: 'مشاهده پرونده', href: `/dashboard/accounting/contracts/${row.contractId}`, icon: FaEye, tone: 'primary' as const },
      ...(!row.accountingEditLocked ? [{ label: 'ویرایش فروش', href: `/dashboard/sales/contracts/${row.contractId}/edit`, icon: FaEdit, tone: 'info' as const }] : []),
    ] : []),
    {
      label: 'بستن اصلاح',
      icon: FaCheckCircle,
      tone: 'success',
      disabled: !['OPEN', 'ACKNOWLEDGED'].includes(row.status) || actionLoading === row.id,
      onClick: () => resolveCorrection(row),
    },
  ];

  const columns: ErpColumn<any>[] = [
    { id: 'request', header: 'درخواست اصلاح', priority: 'primary', cell: (row) => <div><p className="font-semibold">{row.accountantNote}</p><p className="mt-1 text-xs text-slate-500">قرارداد: {row.contractId || '—'}</p></div> },
    { id: 'category', header: 'دسته', mobileLabel: 'دسته', priority: 'secondary', cell: (row) => row.category },
    { id: 'priority', header: 'اولویت', mobileLabel: 'اولویت', priority: 'secondary', cell: (row) => row.priority },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.status} /> },
    { id: 'date', header: 'ثبت', mobileLabel: 'ثبت', priority: 'meta', cell: (row) => dateFa(row.createdAt) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="درخواست‌های اصلاح"
      description="اصلاحیه‌های سبک برای برگشت دادن نقص‌های مشتری، مبلغ، پرداخت، تحویل، مالیات یا اسناد به فروش."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      emptyState={<ErpEmptyState icon={FaExclamationTriangle} title="درخواست اصلاح بازی وجود ندارد" description="از رجیستر قراردادها یا پرونده قرارداد می‌توانید درخواست اصلاح ثبت کنید." />}
    />
  );
}
