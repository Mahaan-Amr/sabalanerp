'use client';

import { useEffect, useState } from 'react';
import { FaReceipt, FaSync } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { StatusBadge, dateFa, money } from '@/features/accounting/accountingUi';

export default function AccountingReceivablesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRows = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getReceivables();
      if (response.data.success) setRows(response.data.data);
    } catch (error) {
      console.error('Error loading receivables:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const columns: ErpColumn<any>[] = [
    { id: 'receivable', header: 'دریافتنی', priority: 'primary', cell: (row) => <div><p className="font-semibold">دریافتنی قرارداد</p><p className="mt-1 text-xs text-slate-500">قرارداد: {row.contractId || '—'}</p></div> },
    { id: 'original', header: 'اصل مبلغ', mobileLabel: 'اصل مبلغ', priority: 'secondary', align: 'end', cell: (row) => money(row.originalAmount, row.currency) },
    { id: 'paid', header: 'پرداخت شده', mobileLabel: 'پرداخت شده', priority: 'secondary', align: 'end', cell: (row) => money(row.paidAmount, row.currency) },
    { id: 'remaining', header: 'مانده', mobileLabel: 'مانده', priority: 'secondary', align: 'end', cell: (row) => <span className="font-semibold text-[#074747] dark:text-teal-200">{money(row.remainingAmount, row.currency)}</span> },
    { id: 'due', header: 'سررسید', mobileLabel: 'سررسید', priority: 'meta', cell: (row) => dateFa(row.dueDate) },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'meta', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="دریافتنی‌ها"
      description="مانده، سررسید، وصول بخشی و تسویه دریافتنی‌های ایجاد شده از قراردادها."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      isLoading={loading}
      emptyState={<ErpEmptyState icon={FaReceipt} title="دریافتنی ثبت نشده است" description="برای قراردادهای مجاز، دریافتنی برنامه‌ریزی شده ایجاد کنید." />}
    />
  );
}
