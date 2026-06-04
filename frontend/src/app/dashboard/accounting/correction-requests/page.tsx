'use client';

import { useEffect, useState } from 'react';
import { FaExclamationTriangle, FaSync } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { StatusBadge, dateFa } from '@/features/accounting/accountingUi';

export default function AccountingCorrectionRequestsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
      isLoading={loading}
      emptyState={<ErpEmptyState icon={FaExclamationTriangle} title="درخواست اصلاح بازی وجود ندارد" description="از رجیستر قراردادها یا پرونده قرارداد می‌توانید درخواست اصلاح ثبت کنید." />}
    />
  );
}
