'use client';

import { useEffect, useState } from 'react';
import { FaHistory, FaSync } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { dateFa } from '@/features/accounting/accountingUi';

export default function AccountingAuditPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadRows = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getAuditLogs();
      if (response.data.success) setRows(response.data.data);
    } catch (error) {
      console.error('Error loading audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const columns: ErpColumn<any>[] = [
    { id: 'action', header: 'عملیات', priority: 'primary', cell: (row) => <div><p className="font-semibold">{row.action}</p><p className="mt-1 text-xs text-slate-500">{row.note || 'بدون یادداشت'}</p></div> },
    { id: 'contract', header: 'قرارداد', mobileLabel: 'قرارداد', priority: 'secondary', cell: (row) => row.contractId || '—' },
    { id: 'entity', header: 'رکورد', mobileLabel: 'رکورد', priority: 'meta', cell: (row) => row.entityType || row.recordId || '—' },
    { id: 'date', header: 'زمان', mobileLabel: 'زمان', priority: 'secondary', cell: (row) => dateFa(row.createdAt) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="سوابق عملیات"
      description="ردیابی اقدام‌های حسابداری برای حسابرسی داخلی و حفظ شفافیت."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      isLoading={loading}
      emptyState={<ErpEmptyState icon={FaHistory} title="هنوز سابقه‌ای ثبت نشده است" description="هر اقدام حسابداری در این بخش ثبت خواهد شد." />}
    />
  );
}
